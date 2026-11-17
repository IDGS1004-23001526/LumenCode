import { RangeSetBuilder, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import type { DiffPayload } from "../../domain/git";
import { h } from "../dom";

export interface ConflictBlock {
  startLine: number;
  sepLine: number;
  endLine: number;
  startPos: number;
  endPos: number;
  currentText: string;
  incomingText: string;
  currentLabel: string;
  incomingLabel: string;
}

export function findConflictBlocks(doc: EditorView["state"]["doc"]): ConflictBlock[] {
  const blocks: ConflictBlock[] = [];
  let line = 1;

  while (line <= doc.lines) {
    const lineObj = doc.line(line);
    if (lineObj.text.startsWith("<<<<<<<")) {
      const startLine = line;
      const currentLabel = lineObj.text.slice(7).trim() || "Current";
      let sepLine = -1;
      let endLine = -1;
      let scan = line + 1;

      while (scan <= doc.lines) {
        const txt = doc.line(scan).text;
        if (sepLine === -1 && txt.startsWith("=======")) {
          sepLine = scan;
        } else if (sepLine !== -1 && txt.startsWith(">>>>>>>")) {
          endLine = scan;
          break;
        }
        scan++;
      }

      if (sepLine !== -1 && endLine !== -1) {
        const startPos = doc.line(startLine).from;
        const endPos = doc.line(endLine).to;
        const curLines: string[] = [];
        for (let i = startLine + 1; i < sepLine; i++) curLines.push(doc.line(i).text);
        const incLines: string[] = [];
        for (let i = sepLine + 1; i < endLine; i++) incLines.push(doc.line(i).text);
        const incomingLabel = doc.line(endLine).text.slice(7).trim() || "Incoming";

        blocks.push({
          startLine,
          sepLine,
          endLine,
          startPos,
          endPos,
          currentText: curLines.join("\n"),
          incomingText: incLines.join("\n"),
          currentLabel,
          incomingLabel,
        });
        line = endLine + 1;
        continue;
      }
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
      view.dispatch({
        changes: { from: this.block.startPos, to: this.block.endPos, insert },
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

      for (let ln = b.startLine + 1; ln < b.sepLine; ln++) {
        const l = doc.line(ln);
        builder.add(l.from, l.from, Decoration.line({ class: "cm-conflict-current" }));
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
