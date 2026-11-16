import { Prec, StateEffect, StateField, type Extension } from "@codemirror/state";
import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { Decoration, EditorView, hoverTooltip, keymap, type DecorationSet } from "@codemirror/view";
import { joinPath, normalizePath, parentDirOf } from "../../domain/path";
import type { ProjectIndex } from "../../domain/symbolIndex";
import { lspClient, type LspCompletionItem, type LspLocation } from "../../infraestructure/lspClient";
import { createSmartCompletionSource } from "./smartCompletion";

const LSP_KIND_MAP: Record<number, string> = {
  1: "text",
  2: "method",
  3: "function",
  4: "class",
  5: "property",
  6: "variable",
  7: "class",
  8: "interface",
  9: "namespace",
  10: "property",
  11: "constant",
  12: "constant",
  13: "enum",
  14: "keyword",
  15: "text",
  16: "constant",
  17: "file",
  18: "namespace",
  19: "folder",
  20: "constant",
  21: "constant",
  22: "class",
  23: "type",
  24: "keyword",
  25: "type",
};

function formatDoc(doc?: LspCompletionItem["documentation"]): string | undefined {
  if (!doc) return undefined;
  const text = typeof doc === "string" ? doc : doc.value;
  return text?.trim() || undefined;
}

export function createLspCompletionSource(
  getIndex: () => ProjectIndex,
  getActivePath: () => string | null,
) {
  const fallback = createSmartCompletionSource(getIndex, getActivePath);

  return async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    const activePath = getActivePath();
    if (!activePath) return null;

    const word = ctx.matchBefore(/[A-Za-z_$][\w$]*/);
    const dot = ctx.matchBefore(/(\.|::|->)$/);

    if (!ctx.explicit && !word && !dot) return null;

    const lineObj = ctx.state.doc.lineAt(ctx.pos);
    const line = lineObj.number - 1;
    const character = ctx.pos - lineObj.from;
    const triggerChar = dot ? dot.text.slice(-1) : undefined;

    const lspItems = await lspClient.complete(activePath, line, character, triggerChar);
    if (lspItems && lspItems.length > 0) {
      const from = word ? word.from : ctx.pos;
      const options: Completion[] = lspItems.slice(0, 80).map((item) => ({
        label: item.label,
        type: item.kind ? LSP_KIND_MAP[item.kind] ?? "text" : "text",
        detail: item.detail,
        info: formatDoc(item.documentation),
        apply: item.textEdit?.newText ?? item.insertText ?? item.label,
      }));

      return {
        from,
        options,
        validFor: /^[A-Za-z_$][\w$]*$/,
      };
    }

    // Fallback instantáneo al autocompletado local ligero si no hay LSP instalado
    return fallback(ctx);
  };
}

export function createLspHoverExtension(getActivePath: () => string | null): Extension {
  return hoverTooltip(async (view, pos) => {
    const activePath = getActivePath();
    if (!activePath) return null;

    const lineObj = view.state.doc.lineAt(pos);
    const text = await lspClient.hover(activePath, lineObj.number - 1, pos - lineObj.from);
    if (!text) return null;

    return {
      pos,
      above: true,
      create() {
        const dom = document.createElement("div");
        dom.className = "cm-lsp-hover";
        dom.textContent = text;
        return { dom };
      },
    };
  });
}

export interface DefinitionDeps {
  getActivePath: () => string | null;
  getIndex: () => ProjectIndex;
  readText: (path: string) => Promise<string>;
  onNavigate: (path: string, line: number, character: number) => void;
}

function wordAt(docText: string, pos: number): { text: string; from: number; to: number } | null {
  const isIdent = (ch: string) => /[A-Za-z0-9_$]/.test(ch);
  let from = pos;
  let to = pos;
  while (from > 0 && isIdent(docText[from - 1])) from--;
  while (to < docText.length && isIdent(docText[to])) to++;
  if (from === to) return null;
  const text = docText.slice(from, to);
  return /^[A-Za-z_$]/.test(text) ? { text, from, to } : null;
}

function findDeclarationInText(text: string, symbol: string): { line: number; character: number } | null {
  const esc = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`\\b(?:export\\s+(?:default\\s+)?)?(?:async\\s+)?function\\s+(${esc})\\b`),
    new RegExp(`\\b(?:export\\s+(?:default\\s+)?)?(?:abstract\\s+)?class\\s+(${esc})\\b`),
    new RegExp(`\\b(?:export\\s+)?(?:interface|type|enum)\\s+(${esc})\\b`),
    new RegExp(`\\b(?:export\\s+)?(?:const|let|var)\\s+(${esc})\\b\\s*(?::[^=]+)?=`),
    new RegExp(`^\\s*(?:async\\s+)?def\\s+(${esc})\\b`, "m"),
    new RegExp(`^\\s*(?:pub\\s+)?(?:async\\s+)?fn\\s+(${esc})\\b`, "m"),
    new RegExp(`^\\s*(?:pub\\s+)?(?:struct|enum|trait|type)\\s+(${esc})\\b`, "m"),
    new RegExp(`\\b(${esc})\\s*\\([^)]*\\)\\s*\\{`),
  ];

  const lines = text.split(/\r?\n/);
  for (const regex of patterns) {
    for (let i = 0; i < lines.length; i++) {
      const m = regex.exec(lines[i]);
      if (m) {
        const idx = lines[i].indexOf(symbol, m.index);
        return { line: i, character: idx >= 0 ? idx : m.index };
      }
    }
  }
  return null;
}

function resolveImportedModulePath(
  docText: string,
  activePath: string,
  symbol: string,
  index: ProjectIndex,
): string | null {
  const esc = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const importRegex = new RegExp(
    `import\\s+(?:[^;\\n]*\\b${esc}\\b[^;\\n]*from\\s+|\\b${esc}\\b\\s+from\\s+)['"]([^'"]+)['"]`,
  );
  const m = importRegex.exec(docText);
  if (!m) return null;

  const spec = m[1];
  if (!spec.startsWith(".")) return null;

  const base = normalizePath(joinPath(parentDirOf(activePath), spec)).toLowerCase();
  const exts = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", "/index.ts", "/index.tsx", "/index.js"];

  for (const filePath of index.files.keys()) {
    const norm = filePath.toLowerCase();
    for (const ext of exts) {
      if (norm === base + ext) return filePath;
    }
  }
  return null;
}

async function findFallbackDefinition(
  view: EditorView,
  pos: number,
  activePath: string,
  deps: DefinitionDeps,
): Promise<LspLocation | null> {
  const docText = view.state.doc.toString();
  const word = wordAt(docText, pos);
  if (!word) return null;

  const index = deps.getIndex();

  // 1. Si el símbolo viene de un import relativo, ir directo al archivo importado
  const importedFile = resolveImportedModulePath(docText, activePath, word.text, index);
  if (importedFile) {
    try {
      const content = await deps.readText(importedFile);
      const decl = findDeclarationInText(content, word.text);
      return { path: importedFile, line: decl?.line ?? 0, character: decl?.character ?? 0 };
    } catch {
      // continuar con otros fallbacks
    }
  }

  // 2. Buscar declaración en el archivo actual (si no es la misma línea de uso o es distinta posición)
  const localDecl = findDeclarationInText(docText, word.text);
  if (localDecl) {
    const curLine = view.state.doc.lineAt(pos).number - 1;
    if (localDecl.line !== curLine) {
      return { path: activePath, line: localDecl.line, character: localDecl.character };
    }
  }

  // 3. Buscar símbolo exportado en el índice del proyecto
  for (const [filePath, symbols] of index.files.entries()) {
    if (filePath === activePath) continue;
    if (!symbols.some((s) => s.name === word.text)) continue;
    try {
      const content = await deps.readText(filePath);
      const decl = findDeclarationInText(content, word.text);
      return { path: filePath, line: decl?.line ?? 0, character: decl?.character ?? 0 };
    } catch {
      return { path: filePath, line: 0, character: 0 };
    }
  }

  return null;
}

const setHoverLinkEffect = StateEffect.define<{ from: number; to: number } | null>();

const hoverLinkField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    let next = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setHoverLinkEffect)) {
        next = e.value
          ? Decoration.set([Decoration.mark({ class: "cm-def-link" }).range(e.value.from, e.value.to)])
          : Decoration.none;
      }
    }
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export function createLspDefinitionExtension(deps: DefinitionDeps): Extension {
  async function goToDefinitionAt(view: EditorView, pos: number) {
    const activePath = deps.getActivePath();
    if (!activePath) return;

    const lineObj = view.state.doc.lineAt(pos);
    const line = lineObj.number - 1;
    const character = pos - lineObj.from;

    const lspLoc = await lspClient.definition(activePath, line, character);
    if (lspLoc) {
      deps.onNavigate(lspLoc.path, lspLoc.line, lspLoc.character);
      return;
    }

    const fallbackLoc = await findFallbackDefinition(view, pos, activePath, deps);
    if (fallbackLoc) {
      deps.onNavigate(fallbackLoc.path, fallbackLoc.line, fallbackLoc.character);
    }
  }

  let lastMouse: { x: number; y: number } | null = null;
  let lastRange: { from: number; to: number } | null = null;

  const setHoveredRange = (view: EditorView, range: { from: number; to: number } | null) => {
    if (lastRange?.from === range?.from && lastRange?.to === range?.to) return;
    lastRange = range;
    view.dispatch({ effects: setHoverLinkEffect.of(range) });
  };

  const refreshHoverLink = (view: EditorView, ctrlDown: boolean) => {
    view.dom.classList.toggle("cm-ctrl-down", ctrlDown);
    if (!ctrlDown || !lastMouse) {
      setHoveredRange(view, null);
      return;
    }
    const pos = view.posAtCoords(lastMouse);
    if (pos === null) {
      setHoveredRange(view, null);
      return;
    }
    const word = wordAt(view.state.doc.toString(), pos);
    setHoveredRange(view, word ? { from: word.from, to: word.to } : null);
  };

  return [
    hoverLinkField,
    Prec.highest(
      keymap.of([
        {
          key: "F12",
          run: (view) => {
            void goToDefinitionAt(view, view.state.selection.main.head);
            return true;
          },
        },
      ]),
    ),
    EditorView.domEventHandlers({
      mousemove(e, view) {
        lastMouse = { x: e.clientX, y: e.clientY };
        refreshHoverLink(view, (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey);
      },
      mouseleave(_e, view) {
        lastMouse = null;
        refreshHoverLink(view, false);
      },
      keydown(e, view) {
        if (e.key === "Control" || e.key === "Meta") refreshHoverLink(view, true);
      },
      keyup(e, view) {
        if (e.key === "Control" || e.key === "Meta") refreshHoverLink(view, false);
      },
      blur(_e, view) {
        lastMouse = null;
        refreshHoverLink(view, false);
      },
      mousedown(e, view) {
        if (!(e.ctrlKey || e.metaKey) || e.button !== 0 || e.shiftKey || e.altKey) return;
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
        if (pos === null) return;
        const word = wordAt(view.state.doc.toString(), pos);
        if (!word) return;
        e.preventDefault();
        refreshHoverLink(view, false);
        void goToDefinitionAt(view, pos);
      },
    }),
  ];
}
