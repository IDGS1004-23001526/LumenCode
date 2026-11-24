import { LRLanguage, LanguageSupport, syntaxTree } from "@codemirror/language";
import { RangeSetBuilder, StateEffect, StateField, Text, type Extension } from "@codemirror/state";
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
import type { SyntaxNodeRef, Tree } from "@lezer/common";
import { lspClient, type LspDiagnostic } from "../../infraestructure/lspClient";
import { languageFor } from "./languages";

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface LumenDiagnostic {
  from: number;
  to: number;
  line: number; // 1-based
  column: number; // 1-based
  severity: DiagnosticSeverity;
  message: string;
}

export const setDiagnosticsEffect = StateEffect.define<LumenDiagnostic[]>();

const SEVERITY_RANK: Record<DiagnosticSeverity, number> = {
  error: 3,
  warning: 2,
  info: 1,
};

const SKIP_LEZER_FALLBACK_EXTS = new Set(["scss", "less", "vue", "svelte", "astro", "jsonc"]);

class ErrorLensWidget extends WidgetType {
  constructor(
    readonly severity: DiagnosticSeverity,
    readonly message: string,
    readonly fullTitle: string,
  ) {
    super();
  }

  eq(other: ErrorLensWidget) {
    return (
      other.severity === this.severity &&
      other.message === this.message &&
      other.fullTitle === this.fullTitle
    );
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = `cm-el-inline cm-el-inline-${this.severity}`;
    span.textContent = this.message;
    span.title = this.fullTitle;
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

  const byLine = new Map<number, LumenDiagnostic[]>();
  for (const d of diags) {
    const list = byLine.get(d.line) ?? [];
    list.push(d);
    byLine.set(d.line, list);
  }

  const items: { from: number; to: number; deco: Decoration }[] = [];

  for (const [lineNum, lineDiags] of byLine.entries()) {
    if (lineNum < 1 || lineNum > doc.lines) continue;
    lineDiags.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
    const primary = lineDiags[0];
    const lineObj = doc.line(lineNum);

    items.push({
      from: lineObj.from,
      to: lineObj.from,
      deco: Decoration.line({ class: `cm-el-line cm-el-line-${primary.severity}` }),
    });

    const extra = lineDiags.length > 1 ? ` (+${lineDiags.length - 1} más)` : "";
    const cleanMsg = `${primary.message.replace(/\s+/g, " ").trim().slice(0, 110)}${extra}`;
    const fullTitle = lineDiags.map((d) => d.message).join("\n");

    items.push({
      from: lineObj.to,
      to: lineObj.to,
      deco: Decoration.widget({
        widget: new ErrorLensWidget(primary.severity, cleanMsg, fullTitle),
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
      const remapped = value.list.map((d) => {
        const nextFrom = Math.min(tr.state.doc.length, tr.changes.mapPos(d.from, 1));
        const nextTo = Math.max(nextFrom, Math.min(tr.state.doc.length, tr.changes.mapPos(d.to, -1)));
        const nextLine = tr.state.doc.lineAt(nextFrom).number;
        return nextFrom === d.from && nextTo === d.to && nextLine === d.line
          ? d
          : { ...d, from: nextFrom, to: nextTo, line: nextLine };
      });
      return {
        list: remapped,
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
    const lineDiags = diags.filter((d) => d.line === lineNum);
    if (lineDiags.length === 0) return null;
    lineDiags.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
    return new ErrorGutterMarker(lineDiags[0].severity, lineDiags.map((d) => d.message).join("\n"));
  },
  lineMarkerChange(update) {
    return update.docChanged || update.transactions.some((tr) => tr.effects.some((e) => e.is(setDiagnosticsEffect)));
  },
});

function posToOffset(doc: Text, lineZero: number, charZero: number): number {
  const lineNum = Math.max(1, Math.min(lineZero + 1, doc.lines));
  const line = doc.line(lineNum);
  return Math.min(line.from + Math.max(0, charZero), line.to);
}

export function lspDiagnosticsToLumen(doc: Text, lspDiags: LspDiagnostic[]): LumenDiagnostic[] {
  return lspDiags.slice(0, 80).map((d) => {
    const from = posToOffset(doc, d.range.start.line, d.range.start.character);
    const to = posToOffset(doc, d.range.end.line, d.range.end.character);
    const lineObj = doc.lineAt(from);
    const severity: DiagnosticSeverity =
      d.severity === 1 ? "error" : d.severity === 2 ? "warning" : "info";
    const prefix = d.source ? `[${d.source}] ` : "";
    return {
      from,
      to,
      line: lineObj.number,
      column: from - lineObj.from + 1,
      severity,
      message: `${prefix}${d.message}`,
    };
  });
}

function isBenignJsxCommentError(doc: Text, ref: SyntaxNodeRef): boolean {
  let cur = ref.node.parent;
  while (cur && cur.name !== "JSXEscape") cur = cur.parent;
  if (!cur) return false;
  if (doc.sliceString(cur.to, cur.to + 1) !== "}") return false;
  const text = doc.sliceString(cur.from, cur.to);
  const inner = text
    .replace(/^\{/, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .trim();
  return inner.length === 0;
}

function describeSyntaxError(doc: Text, ref: SyntaxNodeRef, snippet: string): string {
  const parentName = ref.node.parent?.name ?? "";
  if (parentName === "JSXElement" || parentName === "JSXOpenTag" || parentName === "JSXCloseTag") {
    return snippet ? `Etiqueta JSX inválida o sin cerrar cerca de '${snippet}'` : "Etiqueta JSX sin cerrar";
  }
  if (parentName === "OpenTag" || parentName === "Element") {
    return snippet ? `Etiqueta HTML inválida cerca de '${snippet}'` : "Etiqueta HTML sin cerrar";
  }
  if (parentName === "Block" || parentName === "ObjectExpression" || parentName === "JSXEscape") {
    return snippet ? `Se esperaba '}' o expresión válida cerca de '${snippet}'` : "Se esperaba '}' de cierre";
  }
  if (parentName === "ArgList" || parentName === "ParamList" || parentName === "ParenthesizedExpression") {
    return snippet ? `Se esperaba ')' cerca de '${snippet}'` : "Se esperaba ')' de cierre";
  }
  if (snippet) return `Error de sintaxis cerca de '${snippet}'`;
  const lineText = doc.lineAt(ref.from).text.trim();
  return lineText ? `Error de sintaxis al final de '${lineText.slice(-24)}'` : "Error de sintaxis";
}

function collectJsonParseError(doc: Text): LumenDiagnostic[] {
  const raw = doc.toString();
  if (!raw.trim()) return [];
  try {
    JSON.parse(raw);
    return [];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const posMatch = /position\s+(\d+)/i.exec(msg);
    const lcMatch = /line\s+(\d+)\s+column\s+(\d+)/i.exec(msg);
    let offset = 0;
    if (lcMatch) {
      offset = posToOffset(doc, Number(lcMatch[1]) - 1, Number(lcMatch[2]) - 1);
    } else if (posMatch) {
      offset = Math.max(0, Math.min(Number(posMatch[1]), doc.length));
    }
    const lineObj = doc.lineAt(offset);
    return [
      {
        from: offset,
        to: Math.min(offset + 1, doc.length),
        line: lineObj.number,
        column: offset - lineObj.from + 1,
        severity: "error",
        message: `[JSON] ${msg}`,
      },
    ];
  }
}

function collectJsxTagErrors(doc: Text, tree: ReturnType<typeof syntaxTree>): LumenDiagnostic[] {
  const stack: { name: string; from: number; to: number; line: number }[] = [];
  const errors: LumenDiagnostic[] = [];

  tree.iterate({
    enter(node) {
      if (node.name === "JSXOpenTag") {
        const raw = doc.sliceString(node.from, Math.min(node.to, node.from + 80));
        const m = /^<\s*([A-Za-z_$][\w$.:-]*)/.exec(raw);
        if (m) {
          const lineObj = doc.lineAt(node.from);
          stack.push({ name: m[1], from: node.from, to: node.from + m[0].length, line: lineObj.number });
        }
        return;
      }

      if (node.name === "JSXCloseTag") {
        const raw = doc.sliceString(node.from, Math.min(node.to, node.from + 80));
        const m = /^<\/\s*([A-Za-z_$][\w$.:-]*)/.exec(raw);
        if (!m) return false;
        const closeName = m[1];

        let matchIdx = -1;
        for (let i = stack.length - 1; i >= 0; i--) {
          if (stack[i].name === closeName) {
            matchIdx = i;
            break;
          }
        }

        if (matchIdx === -1) {
          const lineObj = doc.lineAt(node.from);
          errors.push({
            from: node.from,
            to: node.to,
            line: lineObj.number,
            column: node.from - lineObj.from + 1,
            severity: "error",
            message: `Etiqueta de cierre </${closeName}> sin apertura correspondiente`,
          });
        } else {
          // Cualquier etiqueta abierta encima de la coincidencia quedo sin cerrar
          while (stack.length - 1 > matchIdx) {
            const unclosed = stack.pop()!;
            const lineObj = doc.line(unclosed.line);
            errors.push({
              from: unclosed.from,
              to: unclosed.to,
              line: unclosed.line,
              column: unclosed.from - lineObj.from + 1,
              severity: "error",
              message: `Etiqueta JSX <${unclosed.name}> sin cerrar (se esperaba </${unclosed.name}>)`,
            });
          }
          stack.pop();
        }
        return false;
      }
    },
  });

  for (const unclosed of stack) {
    const lineObj = doc.line(unclosed.line);
    errors.push({
      from: unclosed.from,
      to: unclosed.to,
      line: unclosed.line,
      column: unclosed.from - lineObj.from + 1,
      severity: "error",
      message: `Etiqueta JSX <${unclosed.name}> sin cerrar (se esperaba </${unclosed.name}>)`,
    });
  }

  return errors;
}

function shouldSkipSyntaxFallback(filePath: string): { skip: boolean; ext: string } {
  const fileName = filePath.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  const ext = fileName.includes(".") ? fileName.split(".").pop() ?? "" : "";
  const skip =
    SKIP_LEZER_FALLBACK_EXTS.has(ext) ||
    fileName === "package-lock.json" ||
    fileName.startsWith("tsconfig") ||
    fileName.startsWith("jsconfig");
  return { skip, ext };
}

function collectTreeDiagnostics(doc: Text, tree: Tree, ext: string): LumenDiagnostic[] {
  const errors: LumenDiagnostic[] = [];
  const seenLines = new Set<number>();

  const isJsxLike = ["js", "jsx", "tsx", "mjs", "cjs"].includes(ext);
  const jsxErrors = isJsxLike ? collectJsxTagErrors(doc, tree) : [];
  for (const err of jsxErrors) {
    if (!seenLines.has(err.line)) {
      seenLines.add(err.line);
      errors.push(err);
    }
  }

  tree.iterate({
    enter(node) {
      if (errors.length >= 25) return false;
      if (!node.type.isError) return;
      if (isBenignJsxCommentError(doc, node)) return;

      // Si ya reportamos etiquetas JSX sin cerrar en su linea real, evita el error en cascada al final del archivo
      if (jsxErrors.length > 0 && node.from === node.to && node.from >= doc.length - 1) return;

      const lineObj = doc.lineAt(node.from);
      if (seenLines.has(lineObj.number)) return;
      seenLines.add(lineObj.number);

      const snippet = doc.sliceString(node.from, Math.min(node.to, node.from + 20)).trim();
      errors.push({
        from: node.from,
        to: Math.max(node.to, Math.min(node.from + 1, doc.length)),
        line: lineObj.number,
        column: node.from - lineObj.from + 1,
        severity: "error",
        message: describeSyntaxError(doc, node, snippet),
      });
    },
  });

  return errors;
}

const MAX_HEADLESS_DIAG_BYTES = 160_000;

/**
 * Analiza errores de sintaxis/JSON/JSX de cualquier archivo del workspace sin necesidad
 * de tenerlo abierto en una pestaña (para poblar el panel Problems de todo el proyecto).
 */
export function analyzeFileDiagnostics(filePath: string, content: string): LumenDiagnostic[] {
  if (!content || content.length > MAX_HEADLESS_DIAG_BYTES) return [];
  const { skip, ext } = shouldSkipSyntaxFallback(filePath);
  if (skip) return [];

  try {
    const doc = Text.of(content.split(/\r?\n/));
    if (ext === "json") {
      return collectJsonParseError(doc);
    }

    const lang = languageFor(filePath);
    if (lang.support instanceof LanguageSupport && lang.support.language instanceof LRLanguage) {
      const tree = lang.support.language.parser.parse(doc.toString());
      return collectTreeDiagnostics(doc, tree, ext);
    }
    return [];
  } catch {
    return [];
  }
}

function collectSyntaxDiagnostics(view: EditorView, filePath: string): LumenDiagnostic[] {
  const { skip, ext } = shouldSkipSyntaxFallback(filePath);
  if (skip) return [];

  const doc = view.state.doc;
  if (ext === "json") {
    return collectJsonParseError(doc);
  }

  return collectTreeDiagnostics(doc, syntaxTree(view.state), ext);
}

function createSyntaxFallbackPlugin(
  getPath: () => string,
  onDiagnostics?: (path: string, diags: LumenDiagnostic[]) => void,
) {
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
          const path = getPath();
          if (lspClient.hasActiveServerFor(path)) return;
          const diags = collectSyntaxDiagnostics(this.view, path);
          this.view.dispatch({ effects: setDiagnosticsEffect.of(diags) });
          onDiagnostics?.(path, diags);
        }, 320);
      }

      destroy() {
        if (this.timer) clearTimeout(this.timer);
      }
    },
  );
}

export function errorLensExtension(
  getPath: () => string,
  onDiagnostics?: (path: string, diags: LumenDiagnostic[]) => void,
): Extension {
  return [diagnosticsField, errorLensGutter, createSyntaxFallbackPlugin(getPath, onDiagnostics)];
}
