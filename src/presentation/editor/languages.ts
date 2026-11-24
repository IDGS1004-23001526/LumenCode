import { type Extension } from "@codemirror/state";
import { StreamLanguage } from "@codemirror/language";
import { fileExtensionOf } from "../../domain/path";

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
  if (fileName === "dockerfile" || fileName.startsWith("dockerfile.")) {
    return { name: "Dockerfile", support: StreamLanguage.define(dockerFile) };
  }
  if (fileName === "makefile" || fileName === ".gitignore" || fileName === ".dockerignore" || fileName === ".npmignore" || fileName.startsWith(".env")) {
    return { name: fileName.startsWith(".env") ? "Env" : "Config", support: StreamLanguage.define(shell) };
  }
  if (fileName === ".editorconfig") {
    return { name: "EditorConfig", support: StreamLanguage.define(toml) };
  }

  const ext = fileExtensionOf(fileName);
  switch (ext) {
    // Web / JS / TS
    case "js":
    case "mjs":
    case "cjs":
      return { name: "JavaScript", support: javascript({ jsx: true }) };
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

export interface LspServerSpec {
  /** Clave compartida del proceso (ej. "typescript" para js/jsx/ts/tsx) */
  serverKey: string;
  /** languageId estándar LSP */
  languageId: string;
  /** Candidatos [comando, args] ordenados por preferencia */
  candidates: [string, string[]][];
}

export function lspSpecFor(path: string | null): LspServerSpec | null {
  if (!path) return null;
  const fileName = path.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  if (fileName === "dockerfile" || fileName.startsWith("dockerfile.")) {
    return { serverKey: "dockerfile", languageId: "dockerfile", candidates: [["docker-langserver", ["--stdio"]]] };
  }

  const ext = fileExtensionOf(fileName);
  switch (ext) {
    case "js":
    case "mjs":
    case "cjs":
      return { serverKey: "typescript", languageId: "javascriptreact", candidates: [["typescript-language-server", ["--stdio"]]] };
    case "jsx":
      return { serverKey: "typescript", languageId: "javascriptreact", candidates: [["typescript-language-server", ["--stdio"]]] };
    case "ts":
    case "mts":
    case "cts":
      return { serverKey: "typescript", languageId: "typescript", candidates: [["typescript-language-server", ["--stdio"]]] };
    case "tsx":
      return { serverKey: "typescript", languageId: "typescriptreact", candidates: [["typescript-language-server", ["--stdio"]]] };
    case "html":
    case "htm":
    case "astro":
    case "vue":
    case "svelte":
      return { serverKey: "html", languageId: "html", candidates: [["vscode-html-language-server", ["--stdio"]]] };
    case "css":
    case "scss":
    case "less":
      return { serverKey: "css", languageId: ext === "scss" ? "scss" : ext === "less" ? "less" : "css", candidates: [["vscode-css-language-server", ["--stdio"]]] };
    case "json":
    case "jsonc":
      return { serverKey: "json", languageId: ext === "jsonc" ? "jsonc" : "json", candidates: [["vscode-json-language-server", ["--stdio"]]] };
    case "dart":
      return { serverKey: "dart", languageId: "dart", candidates: [["dart", ["language-server", "--protocol=lsp"]]] };
    case "kt":
    case "kts":
      return { serverKey: "kotlin", languageId: "kotlin", candidates: [["kotlin-language-server", []]] };
    case "java":
      return { serverKey: "java", languageId: "java", candidates: [["jdtls", []]] };
    case "swift":
      return { serverKey: "swift", languageId: "swift", candidates: [["sourcekit-lsp", []]] };
    case "rs":
      return { serverKey: "rust", languageId: "rust", candidates: [["rust-analyzer", []]] };
    case "py":
    case "pyw":
      return { serverKey: "python", languageId: "python", candidates: [["pyright-langserver", ["--stdio"]], ["pylsp", []]] };
    case "go":
      return { serverKey: "go", languageId: "go", candidates: [["gopls", []]] };
    case "cs":
      return { serverKey: "csharp", languageId: "csharp", candidates: [["csharp-ls", []], ["omnisharp", ["-lsp"]]] };
    case "php":
      return { serverKey: "php", languageId: "php", candidates: [["intelephense", ["--stdio"]], ["phpactor", ["language-server"]]] };
    case "rb":
      return { serverKey: "ruby", languageId: "ruby", candidates: [["ruby-lsp", []], ["solargraph", ["stdio"]]] };
    case "lua":
      return { serverKey: "lua", languageId: "lua", candidates: [["lua-language-server", []]] };
    case "c":
    case "h":
      return { serverKey: "cpp", languageId: "c", candidates: [["clangd", []]] };
    case "cpp":
    case "hpp":
    case "cc":
    case "cxx":
      return { serverKey: "cpp", languageId: "cpp", candidates: [["clangd", []]] };
    case "sql":
      return { serverKey: "sql", languageId: "sql", candidates: [["sqls", []]] };
    case "yml":
    case "yaml":
      return { serverKey: "yaml", languageId: "yaml", candidates: [["yaml-language-server", ["--stdio"]]] };
    case "toml":
      return { serverKey: "toml", languageId: "toml", candidates: [["taplo", ["lsp", "stdio"]]] };
    case "xml":
    case "svg":
    case "plist":
    case "iml":
      return { serverKey: "xml", languageId: "xml", candidates: [["lemminx", []]] };
    case "md":
    case "markdown":
      return { serverKey: "markdown", languageId: "markdown", candidates: [["marksman", ["server"]]] };
    case "sh":
    case "bash":
    case "zsh":
      return { serverKey: "shell", languageId: "shellscript", candidates: [["bash-language-server", ["start"]]] };
    default:
      return null;
  }
}