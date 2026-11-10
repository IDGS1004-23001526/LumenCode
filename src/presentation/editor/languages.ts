import { type Extension } from "@codemirror/state";

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

export const PLAIN: Lang = { name: "Texto plano", support: [] };

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