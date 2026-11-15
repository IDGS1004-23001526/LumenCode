import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder, StateEffect, StateField, type Extension, type Text } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  GutterMarker,
  ViewPlugin,
  WidgetType,
  gutter,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { lspClient, type LspDiagnostic } from "../../infraestructure/lspClient";

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface LumenDiagnostic {
  from: number;
  to: number;
  line: number; // 1-based
  severity: DiagnosticSeverity;
  message: string;
}

export const setDiagnosticsEffect = StateEffect.define<LumenDiagnostic[]>();

const SEVERITY_RANK: Record<DiagnosticSeverity, number> = {
  error: 3,
  warning: 2,
  info: 1,
};

class ErrorLensWidget extends WidgetType {
  constructor(
    readonly severity: DiagnosticSeverity,
    readonly message: string,
  ) {
    super();
  }

  eq(other: ErrorLensWidget) {
    return other.severity === this.severity && other.message === this.message;
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = `cm-el-inline cm-el-inline-${this.severity}`;
    span.textContent = this.message;
    span.setAttribute("aria-hidden", "true");
    return span;
  }

  ignoreEvent() {
    return true;
  }
}

class ErrorGutterMarker extends GutterMarker {
  constructor(
    readonly severity: DiagnosticSeverity,
    readonly message: string,
  ) {
    super();
  }

  eq(other: ErrorGutterMarker) {
    return other.severity === this.severity && other.message === this.message;
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = `cm-el-gutter-icon cm-el-gutter-${this.severity}`;
    span.textContent = this.severity === "error" ? "✕" : this.severity === "warning" ? "▲" : "●";
    span.title = this.message;
    return span;
  }
}

function buildDecorations(doc: Text, diags: LumenDiagnostic[]): DecorationSet {
  if (diags.length === 0) return Decoration.none;

  // Agrupar el diagnóstico más severo por línea para no saturar el UI
  const byLine = new Map<number, LumenDiagnostic>();
  for (const d of diags) {
    const prev = byLine.get(d.line);
    if (!prev || SEVERITY_RANK[d.severity] > SEVERITY_RANK[prev.severity]) {
      byLine.set(d.line, d);
    }
  }

  const items: { from: number; to: number; deco: Decoration }[] = [];

  for (const [lineNum, d] of byLine.entries()) {
    if (lineNum < 1 || lineNum > doc.lines) continue;
    const lineObj = doc.line(lineNum);
    items.push({
      from: lineObj.from,
      to: lineObj.from,
      deco: Decoration.line({ class: `cm-el-line cm-el-line-${d.severity}` }),
    });
    const cleanMsg = d.message.replace(/\s+/g, " ").trim().slice(0, 120);
    items.push({
      from: lineObj.to,
      to: lineObj.to,
      deco: Decoration.widget({
        widget: new ErrorLensWidget(d.severity, cleanMsg),
        side: 1,
      }),
    });
  }

  for (const d of diags) {
    const from = Math.max(0, Math.min(d.from, doc.length));
    const to = Math.max(from, Math.min(d.to, doc.length));
    if (to > from) {
      items.push({
        from,
        to,
        deco: Decoration.mark({ class: `cm-el-mark cm-el-mark-${d.severity}` }),
      });
    }
  }

  items.sort((a, b) => a.from - b.from || a.deco.startSide - b.deco.startSide);

  const builder = new RangeSetBuilder<Decoration>();
  for (const it of items) {
    builder.add(it.from, it.to, it.deco);
  }
  return builder.finish();
}

export const diagnosticsField = StateField.define<{
  list: LumenDiagnostic[];
  decorations: DecorationSet;
}>({
  create() {
    return { list: [], decorations: Decoration.none };
  },
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setDiagnosticsEffect)) {
        return {
          list: e.value,
          decorations: buildDecorations(tr.state.doc, e.value),
        };
      }
    }
    if (tr.docChanged && value.list.length > 0) {
      // Mapeo rápido de posiciones mientras llega la siguiente respuesta LSP
      return {
        list: value.list,
        decorations: value.decorations.map(tr.changes),
      };
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.decorations),
});

const errorLensGutter = gutter({
  class: "cm-el-gutter",
  lineMarker(view, line) {
    const diags = view.state.field(diagnosticsField, false)?.list;
    if (!diags || diags.length === 0) return null;
    const lineNum = view.state.doc.lineAt(line.from).number;
    let best: LumenDiagnostic | null = null;
    for (const d of diags) {
      if (d.line === lineNum && (!best || SEVERITY_RANK[d.severity] > SEVERITY_RANK[best.severity])) {
        best = d;
      }
    }
    return best ? new ErrorGutterMarker(best.severity, best.message) : null;
  },
  lineMarkerChange(update) {
    return update.transactions.some((tr) => tr.effects.some((e) => e.is(setDiagnosticsEffect)));
  },
});

function posToOffset(doc: Text, lineZero: number, charZero: number): number {
  const lineNum = Math.max(1, Math.min(lineZero + 1, doc.lines));
  const line = doc.line(lineNum);
  return Math.min(line.from + Math.max(0, charZero), line.to);
}

export function lspDiagnosticsToLumen(doc: Text, lspDiags: LspDiagnostic[]): LumenDiagnostic[] {
  return lspDiags.slice(0, 60).map((d) => {
    const from = posToOffset(doc, d.range.start.line, d.range.start.character);
    const to = posToOffset(doc, d.range.end.line, d.range.end.character);
    const line = doc.lineAt(from).number;
    const severity: DiagnosticSeverity =
      d.severity === 1 ? "error" : d.severity === 2 ? "warning" : "info";
    const prefix = d.source ? `[${d.source}] ` : "";
    return { from, to, line, severity, message: `${prefix}${d.message}` };
  });
}

function collectLezerSyntaxErrors(view: EditorView): LumenDiagnostic[] {
  const doc = view.state.doc;
  const tree = syntaxTree(view.state);
  const errors: LumenDiagnostic[] = [];
  const seenLines = new Set<number>();

  tree.iterate({
    enter(node) {
      if (errors.length >= 20) return false;
      if (node.type.isError) {
        const line = doc.lineAt(node.from).number;
        if (!seenLines.has(line)) {
          seenLines.add(line);
          const snippet = doc.sliceString(node.from, Math.min(node.to, node.from + 20)).trim();
          errors.push({
            from: node.from,
            to: Math.max(node.to, Math.min(node.from + 1, doc.length)),
            line,
            severity: "error",
            message: snippet ? `Error de sintaxis cerca de '${snippet}'` : "Error de sintaxis",
          });
        }
      }
    },
  });

  return errors;
}

function createSyntaxFallbackPlugin(getPath: () => string) {
  return ViewPlugin.fromClass(
    class {
      private timer: ReturnType<typeof setTimeout> | null = null;

      constructor(private view: EditorView) {
        this.schedule();
      }

      update(u: ViewUpdate) {
        if (u.docChanged) this.schedule();
      }

      private schedule() {
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          this.timer = null;
          if (lspClient.hasActiveServerFor(getPath())) return;
          const diags = collectLezerSyntaxErrors(this.view);
          this.view.dispatch({ effects: setDiagnosticsEffect.of(diags) });
        }, 350);
      }

      destroy() {
        if (this.timer) clearTimeout(this.timer);
      }
    },
  );
}

export function errorLensExtension(getPath: () => string): Extension {
  return [diagnosticsField, errorLensGutter, createSyntaxFallbackPlugin(getPath)];
}
