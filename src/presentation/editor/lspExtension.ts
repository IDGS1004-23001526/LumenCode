import { Prec, StateEffect, StateField, type Extension, type Text } from "@codemirror/state";
import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { Decoration, EditorView, ViewPlugin, hoverTooltip, keymap, type DecorationSet } from "@codemirror/view";
import { joinPath, normalizePath, parentDirOf, pathsEqual } from "../../domain/path";
import type { ProjectIndex } from "../../domain/symbolIndex";
import { lspClient, type LspCompletionItem, type LspLocation } from "../../infraestructure/lspClient";

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

function lspPosToOffset(doc: Text, pos: { line: number; character: number }): number {
  const lineNum = Math.max(1, Math.min(doc.lines, pos.line + 1));
  const line = doc.line(lineNum);
  return Math.min(line.to, line.from + Math.max(0, pos.character));
}

function matchRank(candidate: string, query: string): number {
  if (!query) return 1;
  const c = candidate.toLowerCase();
  const q = query.toLowerCase();
  if (candidate.startsWith(query)) return 4;
  if (c.startsWith(q)) return 3;
  if (c.includes(q)) return 2;
  let qi = 0;
  for (let i = 0; i < c.length && qi < q.length; i++) {
    if (c[i] === q[qi]) qi++;
  }
  return qi === q.length ? 1 : 0;
}

function stripLspSnippet(raw: string): string {
  return raw
    .replace(/\$\{\d+:([^}]*)\}/g, "$1")
    .replace(/\$\d+/g, "")
    .replace(/\$0/g, "");
}

function applyLspCompletionItem(
  view: EditorView,
  item: LspCompletionItem,
  activePath: string,
  getActivePath: () => string | null,
  from: number,
  to: number,
) {
  const execute = (resolved: LspCompletionItem) => {
    const doc = view.state.doc;
    const rawInsert = resolved.textEdit?.newText ?? resolved.insertText ?? resolved.label;
    const text = stripLspSnippet(rawInsert);
    const mainFrom = resolved.textEdit ? lspPosToOffset(doc, resolved.textEdit.range.start) : from;
    // Bajo `validFor`, el usuario pudo seguir escribiendo tras recibir el item: cubre hasta `to`
    const mainTo = resolved.textEdit
      ? Math.max(to, lspPosToOffset(doc, resolved.textEdit.range.end))
      : to;

    const edits: { from: number; to: number; insert: string }[] = [
      { from: mainFrom, to: mainTo, insert: text },
    ];

    let cursorDelta = 0;
    for (const extra of resolved.additionalTextEdits ?? []) {
      const eFrom = lspPosToOffset(doc, extra.range.start);
      const eTo = lspPosToOffset(doc, extra.range.end);
      const eText = extra.newText;
      if (eTo <= mainFrom) {
        cursorDelta += eText.length - (eTo - eFrom);
      }
      edits.push({ from: eFrom, to: eTo, insert: eText });
    }

    edits.sort((a, b) => a.from - b.from || a.to - b.to);
    view.dispatch({
      changes: edits,
      selection: { anchor: mainFrom + cursorDelta + text.length },
    });
  };

  if (!item.additionalTextEdits?.length && item.data !== undefined) {
    execute(item);
    void lspClient.resolveCompletion(activePath, item).then((resolved) => {
      if (getActivePath() !== activePath) return;
      if (!resolved?.additionalTextEdits?.length) return;
      const doc = view.state.doc;
      const curText = doc.toString();
      const extraEdits: { from: number; to: number; insert: string }[] = [];
      for (const extra of resolved.additionalTextEdits) {
        if (extra.newText.trim() && curText.includes(extra.newText.trim())) continue;
        extraEdits.push({
          from: lspPosToOffset(doc, extra.range.start),
          to: lspPosToOffset(doc, extra.range.end),
          insert: extra.newText,
        });
      }
      if (extraEdits.length > 0) {
        extraEdits.sort((a, b) => a.from - b.from || a.to - b.to);
        view.dispatch({ changes: extraEdits });
      }
    });
    return;
  }

  execute(item);
}

export function createLspCompletionSource(
  _getIndex: () => ProjectIndex,
  getActivePath: () => string | null,
) {
  return async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    const activePath = getActivePath();
    if (!activePath || !lspClient.hasActiveServerFor(activePath)) {
      return null;
    }

    const word = ctx.matchBefore(/[A-Za-z_$][\w$]*/);
    const dot = ctx.matchBefore(/(\.|::|->)$/);

    if (!ctx.explicit && !word && !dot) return null;

    const lineObj = ctx.state.doc.lineAt(ctx.pos);
    const line = lineObj.number - 1;
    const character = ctx.pos - lineObj.from;
    const triggerChar = dot ? dot.text.slice(-1) : undefined;

    const lspItems = await lspClient.complete(activePath, line, character, triggerChar);
    if (!lspItems || lspItems.length === 0) {
      return null;
    }

    const query = word?.text ?? "";
    const from = word ? word.from : ctx.pos;

    const ranked = lspItems
      .map((item) => ({
        item,
        rank: matchRank(item.filterText ?? item.label, query),
      }))
      .filter((x) => !query || x.rank > 0)
      .sort((a, b) => {
        if (b.rank !== a.rank) return b.rank - a.rank;
        return (a.item.sortText ?? a.item.label).localeCompare(b.item.sortText ?? b.item.label);
      })
      .slice(0, 80);

    const options: Completion[] = ranked.map(({ item }) => {
      const hasEdits = Boolean(item.additionalTextEdits?.length || item.textEdit || item.data !== undefined);
      return {
        label: item.label,
        type: item.kind ? LSP_KIND_MAP[item.kind] ?? "text" : "text",
        detail: item.detail,
        info: formatDoc(item.documentation),
        boost: item.additionalTextEdits?.length ? 75 : 40,
        apply: hasEdits
          ? (view, _c, applyFrom, applyTo) =>
              applyLspCompletionItem(view, item, activePath, getActivePath, applyFrom, applyTo)
          : stripLspSnippet(item.insertText ?? item.label),
      };
    });

    if (options.length === 0) {
      // `fastLocalSource` ya provee sugerencias locales/auto-imports/snippets; evita duplicarlas
      return null;
    }

    return {
      from,
      options,
      validFor: /^[A-Za-z_$][\w$]*$/,
    };
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
  const symRe = new RegExp(`\\b${esc}\\b`);
  const stmtRe = /import\s+(?:type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;

  let spec: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = stmtRe.exec(docText)) !== null) {
    if (symRe.test(m[1])) {
      spec = m[2];
      break;
    }
  }
  if (!spec || !spec.startsWith(".")) return null;

  const base = normalizePath(joinPath(parentDirOf(activePath), spec));
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.mjs`,
    joinPath(base, "index.ts"),
    joinPath(base, "index.tsx"),
    joinPath(base, "index.js"),
  ];

  for (const filePath of index.files.keys()) {
    for (const cand of candidates) {
      if (pathsEqual(filePath, cand)) return filePath;
    }
  }
  return null;
}

async function findFallbackDefinition(
  docText: string,
  curLine: number,
  pos: number,
  activePath: string,
  deps: DefinitionDeps,
): Promise<LspLocation | null> {
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
  if (localDecl && localDecl.line !== curLine) {
    return { path: activePath, line: localDecl.line, character: localDecl.character };
  }

  // 3. Buscar símbolo exportado en el índice del proyecto
  for (const [filePath, symbols] of index.files.entries()) {
    if (pathsEqual(filePath, activePath)) continue;
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

    const docSnapshot = view.state.doc.toString();
    const safePos = Math.max(0, Math.min(docSnapshot.length, pos));
    const lineObj = view.state.doc.lineAt(safePos);
    const line = lineObj.number - 1;
    const character = safePos - lineObj.from;

    const lspLoc = await lspClient.definition(activePath, line, character);
    if (deps.getActivePath() !== activePath) return;
    if (lspLoc) {
      deps.onNavigate(lspLoc.path, lspLoc.line, lspLoc.character);
      return;
    }

    const fallbackLoc = await findFallbackDefinition(docSnapshot, line, safePos, activePath, deps);
    if (deps.getActivePath() !== activePath) return;
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

  const windowCleanupPlugin = ViewPlugin.fromClass(
    class {
      private onWinKeyUp = (e: KeyboardEvent) => {
        if (e.key === "Control" || e.key === "Meta") refreshHoverLink(this.view, false);
      };
      private onWinBlur = () => {
        lastMouse = null;
        refreshHoverLink(this.view, false);
      };
      constructor(private readonly view: EditorView) {
        window.addEventListener("keyup", this.onWinKeyUp);
        window.addEventListener("blur", this.onWinBlur);
      }
      destroy() {
        window.removeEventListener("keyup", this.onWinKeyUp);
        window.removeEventListener("blur", this.onWinBlur);
      }
    },
  );

  return [
    hoverLinkField,
    windowCleanupPlugin,
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
