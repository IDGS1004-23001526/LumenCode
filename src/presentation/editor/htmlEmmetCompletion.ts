import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { htmlLanguage } from "@codemirror/lang-html";
import { syntaxTree } from "@codemirror/language";
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

const HTML_EXTENSIONS = new Set(["html", "htm", "astro", "vue", "svelte"]);

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img",
  "input", "link", "meta", "param", "source", "track", "wbr",
]);

const COMMON_HTML_TAGS = [
  "div", "span", "p", "a", "button", "input", "img", "ul", "ol", "li",
  "section", "header", "footer", "nav", "main", "article", "aside",
  "form", "label", "select", "option", "textarea",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "table", "thead", "tbody", "tr", "th", "td",
  "strong", "em", "code", "pre", "blockquote", "figure", "figcaption",
  "br", "hr", "link", "meta", "script", "style", "canvas", "svg",
  "video", "audio", "iframe", "html", "head", "body", "title",
];

const BLOCKED_NODE_NAMES = new Set([
  "OpenTag", "CloseTag", "SelfClosingTag", "TagName",
  "Attribute", "AttributeName", "AttributeValue", "Is",
  "Comment", "ProcessingInst", "DoctypeDecl",
]);

const HTML5_BOILERPLATE = [
  "<!DOCTYPE html>",
  '<html lang="es">',
  "<head>",
  '  <meta charset="UTF-8">',
  '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
  "  <title>Document</title>",
  "</head>",
  "<body>",
  "  ",
  "</body>",
  "</html>",
].join("\n");

function isInsideHtmlTextContext(state: CompletionContext["state"], pos: number): boolean {
  if (!htmlLanguage.isActiveAt(state, pos, -1)) return false;

  let node: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]> | null =
    syntaxTree(state).resolveInner(pos, -1);

  while (node) {
    if (BLOCKED_NODE_NAMES.has(node.name)) return false;
    node = node.parent;
  }

  return true;
}

interface ParsedEmmet {
  tag: string;
  id: string;
  classes: string[];
}

function parseEmmetAbbreviation(raw: string): ParsedEmmet | null {
  if (!raw || (!raw.includes(".") && !raw.includes("#"))) return null;

  let tag = "";
  let id = "";
  const classes: string[] = [];

  // Divide en tokens conservando el prefijo `.` o `#`
  const parts = raw.match(/(?:^[a-zA-Z][\w-]*)|(?:[.#][a-zA-Z0-9_-]*)/g);
  if (!parts || parts.join("") !== raw) return null;

  for (const part of parts) {
    if (part.startsWith(".")) {
      const cls = part.slice(1);
      if (cls) classes.push(cls);
    } else if (part.startsWith("#")) {
      const parsedId = part.slice(1);
      if (parsedId) id = parsedId;
    } else {
      tag = part.toLowerCase();
    }
  }

  if (!tag) tag = "div";
  return { tag, id, classes };
}

function buildTagSnippet(tag: string, id?: string, classes?: string[]): { text: string; cursorOffset: number } {
  const attrs: string[] = [];
  if (id) attrs.push(`id="${id}"`);
  if (classes && classes.length > 0) attrs.push(`class="${classes.join(" ")}"`);

  if (tag === "a" && !attrs.some((a) => a.startsWith("href="))) {
    attrs.unshift('href=""');
  } else if (tag === "img") {
    attrs.push('src=""', 'alt=""');
  } else if (tag === "input") {
    attrs.unshift('type="text"');
  } else if (tag === "link") {
    attrs.unshift('rel="stylesheet"', 'href=""');
  }

  const attrStr = attrs.length > 0 ? ` ${attrs.join(" ")}` : "";

  if (VOID_TAGS.has(tag)) {
    const text = `<${tag}${attrStr}>`;
    const emptyAttr = text.indexOf('""');
    return {
      text,
      cursorOffset: emptyAttr !== -1 ? emptyAttr + 1 : text.length,
    };
  }

  const open = `<${tag}${attrStr}>`;
  const text = `${open}</${tag}>`;
  const emptyAttr = open.indexOf('""');
  const cursorOffset =
    (tag === "a" && emptyAttr !== -1) ? emptyAttr + 1 : open.length;

  return { text, cursorOffset };
}

function applySnippet(view: EditorView, from: number, to: number, text: string, cursorOffset: number) {
  view.dispatch({
    changes: { from, to, insert: text },
    selection: EditorSelection.cursor(from + cursorOffset),
  });
}

export function createHtmlEmmetCompletionSource(getActivePath: () => string | null) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const activePath = getActivePath();
    if (!activePath) return null;

    const ext = activePath.split(".").pop()?.toLowerCase() ?? "";
    if (!HTML_EXTENSIONS.has(ext)) return null;
    if (!isInsideHtmlTextContext(ctx.state, ctx.pos)) return null;

    // 1. `!` -> plantilla HTML5 completa
    const bangMatch = ctx.matchBefore(/(?:^|\s)!/);
    if (bangMatch) {
      const from = bangMatch.to - 1;
      return {
        from,
        options: [
          {
            label: "!",
            type: "text",
            detail: "HTML5 boilerplate",
            boost: 95,
            apply: (view, _c, start, end) => {
              const bodyCursor = HTML5_BOILERPLATE.indexOf("<body>\n  ") + "<body>\n  ".length;
              applySnippet(view, start, end, HTML5_BOILERPLATE, bodyCursor);
            },
          },
        ],
      };
    }

    // 2. Abreviaciones tipo Emmet con `.` o `#` (ej. `div.container`, `.card`, `span#title.bold`)
    const emmetMatch = ctx.matchBefore(/(?:^|[\s>])([a-zA-Z][\w-]*)?(?:[.#][a-zA-Z0-9_-]*)+$/);
    if (emmetMatch) {
      const raw = emmetMatch.text.replace(/^[\s>]/, "");
      const from = emmetMatch.to - raw.length;
      const parsed = parseEmmetAbbreviation(raw);

      if (parsed) {
        const { text, cursorOffset } = buildTagSnippet(parsed.tag, parsed.id, parsed.classes);
        return {
          from,
          options: [
            {
              label: raw,
              type: "class",
              detail: text,
              boost: 99,
              apply: (view, _c, start, end) => applySnippet(view, start, end, text, cursorOffset),
            },
          ],
        };
      }
    }

    // 3. Etiquetas HTML simples sin `<` (ej. `div` -> `<div></div>`)
    const tagMatch = ctx.matchBefore(/(?:^|[\s>])([a-zA-Z][a-zA-Z0-9-]*)$/);
    if (!tagMatch) return null;

    const rawTag = tagMatch.text.replace(/^[\s>]/, "");
    const from = tagMatch.to - rawTag.length;
    const lower = rawTag.toLowerCase();

    const matchingTags = COMMON_HTML_TAGS.filter((t) => t.startsWith(lower));
    if (matchingTags.length === 0) return null;

    const options: Completion[] = matchingTags.map((tag) => {
      const { text, cursorOffset } = buildTagSnippet(tag);
      return {
        label: tag,
        type: "keyword",
        detail: text,
        boost: tag === lower ? 80 : 60,
        apply: (view, _c, start, end) => applySnippet(view, start, end, text, cursorOffset),
      };
    });

    return {
      from,
      options,
      validFor: /^[a-zA-Z][a-zA-Z0-9-]*$/,
    };
  };
}

/**
 * Expande una abreviación Emmet HTML directamente bajo el cursor al presionar Tab
 * (por ejemplo `div.container` -> `<div class="container"></div>`), incluso antes
 * de que aparezca el menú de autocompletado.
 */
export function expandHtmlEmmetAtCursor(view: EditorView, activePath: string | null): boolean {
  if (!activePath) return false;
  const ext = activePath.split(".").pop()?.toLowerCase() ?? "";
  if (!HTML_EXTENSIONS.has(ext)) return false;

  const sel = view.state.selection.main;
  if (!sel.empty) return false;

  const pos = sel.head;
  if (!isInsideHtmlTextContext(view.state, pos)) return false;

  const line = view.state.doc.lineAt(pos);
  const before = line.text.slice(0, pos - line.from);

  // 1. `!` -> plantilla HTML5
  const bang = /(?:^|\s)!$/.exec(before);
  if (bang) {
    const from = pos - 1;
    const bodyCursor = HTML5_BOILERPLATE.indexOf("<body>\n  ") + "<body>\n  ".length;
    applySnippet(view, from, pos, HTML5_BOILERPLATE, bodyCursor);
    return true;
  }

  // 2. `tag.class` / `.class` / `tag#id.class`
  const emmet = /(?:^|[\s>])((?:[a-zA-Z][\w-]*)?(?:[.#][a-zA-Z0-9_-]*)+)$/.exec(before);
  if (emmet) {
    const raw = emmet[1];
    const parsed = parseEmmetAbbreviation(raw);
    if (parsed) {
      const from = pos - raw.length;
      const { text, cursorOffset } = buildTagSnippet(parsed.tag, parsed.id, parsed.classes);
      applySnippet(view, from, pos, text, cursorOffset);
      return true;
    }
  }

  // 3. Etiqueta HTML común (ej. `div`, `span`, `p`)
  const tagOnly = /(?:^|[\s>])([a-zA-Z][a-zA-Z0-9-]*)$/.exec(before);
  if (tagOnly) {
    const rawTag = tagOnly[1].toLowerCase();
    if (COMMON_HTML_TAGS.includes(rawTag)) {
      const from = pos - tagOnly[1].length;
      const { text, cursorOffset } = buildTagSnippet(rawTag);
      applySnippet(view, from, pos, text, cursorOffset);
      return true;
    }
  }

  return false;
}
