import { type Extension } from "@codemirror/state";
import { StreamLanguage } from "@codemirror/language";

import { javascript } from "@codemirror/lang-javascript";
import { rust } from "@codemirror/lang-rust";
import { python } from "@codemirror/lang-python";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { cpp } from "@codemirror/lang-cpp";
import { java } from "@codemirror/lang-java";
import { go } from "@codemirror/lang-go";
import { php } from "@codemirror/lang-php";
import { sql } from "@codemirror/lang-sql";
import { yaml } from "@codemirror/lang-yaml";
import { xml } from "@codemirror/lang-xml";

// Gramáticas adicionales oficiales de CodeMirror (Dart, Kotlin, C#, Swift, Ruby, Lua, Shell, PowerShell, TOML)
import { dart, kotlin, csharp } from "@codemirror/legacy-modes/mode/clike";
import { swift } from "@codemirror/legacy-modes/mode/swift";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { powerShell } from "@codemirror/legacy-modes/mode/powershell";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";

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
  const fileName = path.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  if (fileName === "dockerfile") {
    return { name: "Dockerfile", support: StreamLanguage.define(dockerFile) };
  }

  const ext = fileName.split(".").pop() ?? "";
  switch (ext) {
    // Web / JS / TS
    case "js":
    case "mjs":
    case "cjs":
      return { name: "JavaScript", support: javascript() };
    case "jsx":
      return { name: "JSX", support: javascript({ jsx: true }) };
    case "ts":
    case "mts":
    case "cts":
      return { name: "TypeScript", support: javascript({ typescript: true }) };
    case "tsx":
      return { name: "TSX", support: javascript({ typescript: true, jsx: true }) };
    case "html":
    case "htm":
    case "astro":
    case "vue":
    case "svelte":
      return { name: "HTML", support: html() };
    case "css":
    case "scss":
    case "less":
      return { name: "CSS", support: css() };
    case "json":
    case "jsonc":
      return { name: "JSON", support: json() };

    // Móvil y Multiplataforma (Flutter / Android / iOS)
    case "dart":
      return { name: "Dart", support: StreamLanguage.define(dart) };
    case "kt":
    case "kts":
      return { name: "Kotlin", support: StreamLanguage.define(kotlin) };
    case "java":
    case "gradle":
      return { name: "Java", support: java() };
    case "swift":
      return { name: "Swift", support: StreamLanguage.define(swift) };

    // Sistemas y Backend
    case "rs":
      return { name: "Rust", support: rust() };
    case "py":
    case "pyw":
      return { name: "Python", support: python() };
    case "go":
      return { name: "Go", support: go() };
    case "cs":
      return { name: "C#", support: StreamLanguage.define(csharp) };
    case "php":
      return { name: "PHP", support: php() };
    case "rb":
      return { name: "Ruby", support: StreamLanguage.define(ruby) };
    case "lua":
      return { name: "Lua", support: StreamLanguage.define(lua) };
    case "c":
    case "h":
    case "cpp":
    case "hpp":
    case "cc":
    case "cxx":
      return { name: "C / C++", support: cpp() };

    // Datos, Configuración y Scripts
    case "sql":
      return { name: "SQL", support: sql() };
    case "yml":
    case "yaml":
      return { name: "YAML", support: yaml() };
    case "toml":
    case "lock":
      return { name: "TOML", support: StreamLanguage.define(toml) };
    case "xml":
    case "svg":
    case "plist":
    case "iml":
      return { name: "XML", support: xml() };
    case "md":
    case "markdown":
      return { name: "Markdown", support: markdown() };
    case "sh":
    case "bash":
    case "zsh":
    case "env":
      return { name: "Shell", support: StreamLanguage.define(shell) };
    case "ps1":
      return { name: "PowerShell", support: StreamLanguage.define(powerShell) };

    default:
      return PLAIN;
  }
}