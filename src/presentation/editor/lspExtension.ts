import type { Extension } from "@codemirror/state";
import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { hoverTooltip } from "@codemirror/view";
import type { ProjectIndex } from "../../domain/symbolIndex";
import { lspClient, type LspCompletionItem } from "../../infraestructure/lspClient";
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
