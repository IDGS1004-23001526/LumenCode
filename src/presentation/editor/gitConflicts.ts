import { RangeSetBuilder, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import type { DiffPayload } from "../../domain/git";
import { h } from "../dom";

export interface ConflictBlock {
  startLine: number;
  baseLine: number;
  sepLine: number;
  endLine: number;
  startPos: number;
  endPos: number;
  currentText: string;
  baseText: string | null;
  incomingText: string;
  currentLabel: string;
  incomingLabel: string;
}

function isStartMarker(text: string): boolean {
  return /^<{7}(?:\s|$)/.test(text);
}

function isBaseMarker(text: string): boolean {
  return /^\|{7}(?:\s|$)/.test(text);
}

function isSepMarker(text: string): boolean {
  return /^={7}\s*$/.test(text);
}

function isEndMarker(text: string): boolean {
  return /^>{7}(?:\s|$)/.test(text);
}

export function findConflictBlocks(doc: EditorView["state"]["doc"]): ConflictBlock[] {
  const blocks: ConflictBlock[] = [];
  let line = 1;

  while (line <= doc.lines) {
    const lineObj = doc.line(line);
    if (isStartMarker(lineObj.text)) {
      let startLine = line;
      let currentLabel = lineObj.text.slice(7).trim() || "Current";
      let baseLine = -1;
      let sepLine = -1;
      let endLine = -1;
      let scan = line + 1;

      while (scan <= doc.lines) {
        const txt = doc.line(scan).text;
        if (isStartMarker(txt)) {
          // Reinicia el bloque si aparece otro marcador de inicio sin haberse cerrado el anterior
          startLine = scan;
          currentLabel = txt.slice(7).trim() || "Current";
          baseLine = -1;
          sepLine = -1;
        } else if (sepLine === -1 && baseLine === -1 && isBaseMarker(txt)) {
          baseLine = scan;
        } else if (sepLine === -1 && isSepMarker(txt)) {
          sepLine = scan;
        } else if (sepLine !== -1 && isEndMarker(txt)) {
          endLine = scan;
          break;
        }
        scan++;
      }

      if (sepLine !== -1 && endLine !== -1) {
        const startPos = doc.line(startLine).from;
        const endPos = doc.line(endLine).to;
        const currentEnd = baseLine !== -1 ? baseLine : sepLine;
        const curLines: string[] = [];
        for (let i = startLine + 1; i < currentEnd; i++) curLines.push(doc.line(i).text);
        let baseText: string | null = null;
        if (baseLine !== -1) {
          const baseLines: string[] = [];
          for (let i = baseLine + 1; i < sepLine; i++) baseLines.push(doc.line(i).text);
          baseText = baseLines.join("\n");
        }
        const incLines: string[] = [];
        for (let i = sepLine + 1; i < endLine; i++) incLines.push(doc.line(i).text);
        const incomingLabel = doc.line(endLine).text.slice(7).trim() || "Incoming";

        blocks.push({
          startLine,
          baseLine,
          sepLine,
          endLine,
          startPos,
          endPos,
          currentText: curLines.join("\n"),
          baseText,
          incomingText: incLines.join("\n"),
          currentLabel,
          incomingLabel,
        });
        line = endLine + 1;
        continue;
      }
      // Si llegó al final sin cerrar ningún bloque, no tiene sentido seguir escaneando
      break;
    }
    line++;
  }

  return blocks;
}

class ConflictWidget extends WidgetType {
  constructor(
    readonly block: ConflictBlock,
    readonly onCompare: (block: ConflictBlock) => void,
  ) {
    super();
  }

  eq(other: ConflictWidget) {
    return (
      other.block.startPos === this.block.startPos &&
      other.block.endPos === this.block.endPos &&
      other.block.currentText === this.block.currentText &&
      other.block.incomingText === this.block.incomingText
    );
  }

  toDOM(view: EditorView) {
    const resolveWith = (insert: string) => {
      const doc = view.state.doc;
      let from = this.block.startPos;
      let to = this.block.endPos;
      if (insert === "") {
        if (to < doc.length && doc.sliceString(to, to + 1) === "\n") {
          to += 1;
        } else if (from > 0 && doc.sliceString(from - 1, from) === "\n") {
          from -= 1;
        }
      }
      view.dispatch({
        changes: { from, to, insert },
      });
    };

    const bothText = [this.block.currentText, this.block.incomingText].filter(Boolean).join("\n");

    return h(
      "div",
      { class: "cm-conflict-lens" },
      h("button", { class: "cm-conflict-btn", onclick: () => resolveWith(this.block.currentText) }, `Accept Current (${this.block.currentLabel})`),
      h("span", { class: "cm-conflict-sep" }, "|"),
      h("button", { class: "cm-conflict-btn", onclick: () => resolveWith(this.block.incomingText) }, `Accept Incoming (${this.block.incomingLabel})`),
      h("span", { class: "cm-conflict-sep" }, "|"),
      h("button", { class: "cm-conflict-btn", onclick: () => resolveWith(bothText) }, "Accept Both"),
      h("span", { class: "cm-conflict-sep" }, "|"),
      h("button", { class: "cm-conflict-btn", onclick: () => this.onCompare(this.block) }, "Compare Changes"),
    );
  }

  ignoreEvent() {
    return true;
  }
}

export function createGitConflictExtension(
  getPath: () => string | null,
  onCompareDiff: (diff: DiffPayload) => void,
): Extension {
  const buildDecorations = (doc: EditorView["state"]["doc"]): DecorationSet => {
    const builder = new RangeSetBuilder<Decoration>();
    const blocks = findConflictBlocks(doc);

    const handleCompare = (block: ConflictBlock) => {
      const path = getPath() ?? "Conflicto";
      onCompareDiff({
        id: `conflict:${path}:${block.startLine}`,
        title: `Conflict: ${path.split(/[\\/]/).pop()}`,
        relPath: path,
        repoRoot: "",
        leftTitle: `Current (${block.currentLabel})`,
        rightTitle: `Incoming (${block.incomingLabel})`,
        leftText: block.currentText,
        rightText: block.incomingText,
        mode: "commit",
      });
    };

    for (const b of blocks) {
      const startLineObj = doc.line(b.startLine);
      builder.add(
        startLineObj.from,
        startLineObj.from,
        Decoration.widget({ widget: new ConflictWidget(b, handleCompare), side: -1, block: true }),
      );
      builder.add(startLineObj.from, startLineObj.from, Decoration.line({ class: "cm-conflict-marker" }));

      const currentEnd = b.baseLine !== -1 ? b.baseLine : b.sepLine;
      for (let ln = b.startLine + 1; ln < currentEnd; ln++) {
        const l = doc.line(ln);
        builder.add(l.from, l.from, Decoration.line({ class: "cm-conflict-current" }));
      }

      if (b.baseLine !== -1) {
        const baseObj = doc.line(b.baseLine);
        builder.add(baseObj.from, baseObj.from, Decoration.line({ class: "cm-conflict-marker" }));
        for (let ln = b.baseLine + 1; ln < b.sepLine; ln++) {
          const l = doc.line(ln);
          builder.add(l.from, l.from, Decoration.line({ class: "cm-conflict-marker" }));
        }
      }

      const sepObj = doc.line(b.sepLine);
      builder.add(sepObj.from, sepObj.from, Decoration.line({ class: "cm-conflict-marker" }));

      for (let ln = b.sepLine + 1; ln < b.endLine; ln++) {
        const l = doc.line(ln);
        builder.add(l.from, l.from, Decoration.line({ class: "cm-conflict-incoming" }));
      }

      const endObj = doc.line(b.endLine);
      builder.add(endObj.from, endObj.from, Decoration.line({ class: "cm-conflict-marker" }));
    }

    return builder.finish();
  };

  return StateField.define<DecorationSet>({
    create: (state) => buildDecorations(state.doc),
    update: (deco, tr) => (tr.docChanged ? buildDecorations(tr.newDoc) : deco),
    provide: (f) => EditorView.decorations.from(f),
  });
}
