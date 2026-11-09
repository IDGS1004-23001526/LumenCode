import { EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  dropCursor,
  rectangularSelection,
  placeholder,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
  HighlightStyle,
} from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { tags as t } from "@lezer/highlight";

import { javascript } from "@codemirror/lang-javascript";
import { rust } from "@codemirror/lang-rust";
import { python } from "@codemirror/lang-python";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { cpp } from "@codemirror/lang-cpp";

// ---------------------------------------------------------------------------
// Lenguajes por extensión
// ---------------------------------------------------------------------------

export interface Lang {
  name: string;
  support: Extension;
}

const PLAIN: Lang = { name: "Texto plano", support: [] };

export function languageFor(path: string | null): Lang {
  if (!path) return PLAIN;
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "js":
    case "mjs":
    case "cjs":
      return { name: "JavaScript", support: javascript() };
    case "jsx":
      return { name: "JSX", support: javascript({ jsx: true }) };
    case "ts":
      return { name: "TypeScript", support: javascript({ typescript: true }) };
    case "tsx":
      return { name: "TSX", support: javascript({ typescript: true, jsx: true }) };
    case "rs":
      return { name: "Rust", support: rust() };
    case "py":
      return { name: "Python", support: python() };
    case "html":
    case "htm":
      return { name: "HTML", support: html() };
    case "css":
      return { name: "CSS", support: css() };
    case "json":
      return { name: "JSON", support: json() };
    case "md":
    case "markdown":
      return { name: "Markdown", support: markdown() };
    case "c":
    case "h":
    case "cpp":
    case "hpp":
    case "cc":
      return { name: "C / C++", support: cpp() };
    default:
      return PLAIN;
  }
}

// ---------------------------------------------------------------------------
// Tema: todo el color sale de variables CSS (ver styles.css)
// ---------------------------------------------------------------------------

const theme = EditorView.theme(
  {
    "&": {
      height: "100%",
      color: "var(--fg)",
      backgroundColor: "var(--bg)",
      fontSize: "14px",
    },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": {
      fontFamily: "var(--font-mono)",
      lineHeight: "1.7",
      padding: "8px 0 40vh",
    },
    ".cm-content": { caretColor: "var(--accent)", padding: "0 24px 0 4px" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "2px" },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection":
      { backgroundColor: "var(--selection)" },
    ".cm-activeLine": { backgroundColor: "var(--line-active)" },
    ".cm-gutters": {
      backgroundColor: "var(--bg)",
      color: "var(--fg-faint)",
      border: "none",
      paddingLeft: "12px",
    },
    ".cm-lineNumbers .cm-gutterElement": { padding: "0 14px 0 6px", minWidth: "36px" },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--fg-muted)" },
    ".cm-foldGutter span": { color: "var(--fg-faint)" },
    ".cm-matchingBracket": {
      backgroundColor: "var(--selection)",
      outline: "1px solid var(--accent-soft)",
    },
    ".cm-selectionMatch": { backgroundColor: "var(--selection-soft)" },
    ".cm-placeholder": { color: "var(--fg-faint)" },
    ".cm-tooltip": {
      backgroundColor: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: "10px",
      overflow: "hidden",
      boxShadow: "0 12px 32px rgba(0,0,0,.4)",
    },
    ".cm-tooltip-autocomplete > ul": { fontFamily: "var(--font-mono)", fontSize: "13px" },
    ".cm-tooltip-autocomplete ul li[aria-selected]": {
      backgroundColor: "var(--selection)",
      color: "var(--fg)",
    },
    ".cm-panels": { backgroundColor: "var(--surface)", color: "var(--fg)", borderTop: "1px solid var(--border)" },
    ".cm-searchMatch": { backgroundColor: "var(--selection-soft)", outline: "1px solid var(--accent-soft)" },
    ".cm-textfield": {
      backgroundColor: "var(--bg)",
      border: "1px solid var(--border)",
      borderRadius: "6px",
      color: "var(--fg)",
    },
    ".cm-button": {
      backgroundImage: "none",
      backgroundColor: "var(--surface-2)",
      border: "1px solid var(--border)",
      borderRadius: "6px",
      color: "var(--fg)",
    },
  },
  { dark: true },
);

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.operatorKeyword], color: "var(--syn-keyword)" },
  { tag: [t.string, t.special(t.string), t.regexp], color: "var(--syn-string)" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "var(--syn-number)" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: "var(--syn-function)" },
  { tag: [t.typeName, t.className, t.namespace], color: "var(--syn-type)" },
  { tag: [t.propertyName, t.attributeName], color: "var(--syn-property)" },
  { tag: [t.comment, t.docComment], color: "var(--fg-faint)", fontStyle: "italic" },
  { tag: [t.operator, t.punctuation, t.bracket], color: "var(--fg-muted)" },
  { tag: [t.tagName], color: "var(--syn-keyword)" },
  { tag: [t.heading], color: "var(--syn-function)", fontWeight: "600" },
  { tag: [t.emphasis], fontStyle: "italic" },
  { tag: [t.strong], fontWeight: "600" },
  { tag: [t.link, t.url], color: "var(--accent)", textDecoration: "underline" },
]);

// ---------------------------------------------------------------------------
// API del editor
// ---------------------------------------------------------------------------

export interface EditorCallbacks {
  onChange: () => void;
  onCursor: (line: number, col: number) => void;
}

export interface Editor {
  focus: () => void;
  getText: () => string;
  /** Reemplaza el documento completo (y reinicia el historial de deshacer). */
  load: (text: string, path: string | null) => Lang;
  /** Cambia el resaltado según la nueva ruta (p. ej. tras "Guardar como"). */
  setLanguage: (path: string | null) => Lang;
}

export function createEditor(parent: HTMLElement, cb: EditorCallbacks): Editor {
  let currentPath: string | null = null;

  const buildState = (doc: string, lang: Lang) =>
    EditorState.create({
      doc,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        foldGutter({ openText: "⌄", closedText: "›" }),
        history(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        rectangularSelection(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        EditorView.lineWrapping,
        placeholder("Empieza a escribir…  ·  Ctrl+O abre un archivo"),
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...completionKeymap,
          indentWithTab,
        ]),
        theme,
        syntaxHighlighting(highlight),
        lang.support,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) cb.onChange();
          if (u.docChanged || u.selectionSet) {
            const head = u.state.selection.main.head;
            const line = u.state.doc.lineAt(head);
            cb.onCursor(line.number, head - line.from + 1);
          }
        }),
      ],
    });

  const view = new EditorView({ parent, state: buildState("", PLAIN) });

  return {
    focus: () => view.focus(),
    getText: () => view.state.doc.toString(),
    load(text, path) {
      currentPath = path;
      const lang = languageFor(path);
      view.setState(buildState(text, lang));
      view.focus();
      return lang;
    },
    setLanguage(path) {
      if (path === currentPath) return languageFor(path);
      const text = view.state.doc.toString();
      const sel = view.state.selection;
      currentPath = path;
      const lang = languageFor(path);
      const next = buildState(text, lang);
      view.setState(next.update({ selection: sel }).state);
      return lang;
    },
  };
}
