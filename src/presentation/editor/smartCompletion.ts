import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { htmlLanguage } from "@codemirror/lang-html";
import type { EditorView } from "@codemirror/view";
import { fileNameOf } from "../../domain/path";
import {
  buildAutoImportStatement,
  extractFileSymbols,
  relativeModulePath,
  stripComments,
  type ExportedSymbol,
  type MemberSymbol,
  type ProjectIndex,
} from "../../domain/symbolIndex";

interface LangProfile {
  keywords: string[];
  builtins: string[];
  ecosystem?: "npm" | "cargo" | "pip";
  commentStyle: "c" | "hash" | "both";
}

const JS_PROFILE: LangProfile = {
  keywords: [
    "import", "export", "default", "from", "const", "let", "var", "function", "return",
    "async", "await", "class", "extends", "new", "try", "catch", "finally", "throw",
    "if", "else", "switch", "case", "break", "continue", "for", "of", "in", "while",
    "typeof", "instanceof", "true", "false", "null", "undefined",
  ],
  builtins: [
    "console", "Promise", "Array", "Object", "Map", "Set", "WeakMap", "JSON", "Math",
    "Date", "RegExp", "Error", "Intl", "fetch", "setTimeout", "setInterval",
    "clearTimeout", "clearInterval", "document", "window", "localStorage", "sessionStorage",
    "URL", "URLSearchParams", "FormData", "Headers", "AbortController",
  ],
  ecosystem: "npm",
  commentStyle: "c",
};

const TS_PROFILE: LangProfile = {
  ...JS_PROFILE,
  keywords: [
    ...JS_PROFILE.keywords,
    "interface", "type", "enum", "implements", "readonly", "public", "private", "protected",
    "abstract", "as", "is", "keyof", "infer", "satisfies", "namespace", "declare",
  ],
  builtins: [
    ...JS_PROFILE.builtins,
    "Partial", "Required", "Readonly", "Record", "Pick", "Omit", "Exclude", "Extract",
    "NonNullable", "ReturnType", "Awaited", "unknown", "never", "any", "void",
  ],
};

const PY_PROFILE: LangProfile = {
  keywords: [
    "def", "class", "import", "from", "return", "async", "await", "if", "elif", "else",
    "for", "in", "while", "break", "continue", "try", "except", "finally", "raise",
    "with", "as", "yield", "lambda", "pass", "match", "case", "True", "False", "None", "self",
  ],
  builtins: [
    "print", "len", "range", "enumerate", "zip", "map", "filter", "sorted", "reversed",
    "isinstance", "issubclass", "type", "dir", "dict", "list", "set", "tuple", "str",
    "int", "float", "bool", "open", "sum", "min", "max", "any", "all", "super", "Exception",
  ],
  ecosystem: "pip",
  commentStyle: "hash",
};

const RUST_PROFILE: LangProfile = {
  keywords: [
    "fn", "pub", "struct", "enum", "impl", "trait", "use", "mod", "crate", "super",
    "let", "mut", "const", "static", "type", "where", "match", "if", "else", "for",
    "in", "while", "loop", "break", "continue", "return", "async", "await", "move", "Self", "self",
  ],
  builtins: [
    "Some", "None", "Ok", "Err", "Option", "Result", "Vec", "String", "Box", "Rc",
    "Arc", "HashMap", "HashSet", "BTreeMap", "println", "format", "eprintln", "vec", "todo",
  ],
  ecosystem: "cargo",
  commentStyle: "c",
};

const CPP_PROFILE: LangProfile = {
  keywords: [
    "#include", "#define", "#ifdef", "#ifndef", "#endif", "class", "struct", "enum",
    "public", "private", "protected", "virtual", "override", "final", "namespace", "using",
    "template", "typename", "const", "constexpr", "auto", "void", "int", "long", "double",
    "float", "bool", "char", "return", "if", "else", "switch", "case", "for", "while", "nullptr",
  ],
  builtins: [
    "std", "string", "vector", "map", "unordered_map", "set", "pair", "optional",
    "unique_ptr", "shared_ptr", "make_unique", "make_shared", "cout", "cin", "endl", "printf",
  ],
  commentStyle: "c",
};

const JAVA_PROFILE: LangProfile = {
  keywords: [
    "package", "import", "public", "private", "protected", "class", "interface", "enum",
    "extends", "implements", "static", "final", "abstract", "void", "boolean", "int", "long",
    "double", "new", "return", "if", "else", "switch", "case", "for", "while", "try", "catch",
    "finally", "throw", "throws", "this", "super", "true", "false", "null",
  ],
  builtins: [
    "String", "Object", "Integer", "Long", "Double", "Boolean", "List", "ArrayList",
    "Map", "HashMap", "Set", "HashSet", "Optional", "Stream", "System", "Math", "Exception",
  ],
  commentStyle: "c",
};

const KOTLIN_PROFILE: LangProfile = {
  keywords: [
    "package", "import", "fun", "val", "var", "class", "data", "sealed", "interface",
    "object", "enum", "companion", "override", "open", "private", "internal", "public",
    "suspend", "inline", "return", "if", "else", "when", "for", "in", "while", "try",
    "catch", "finally", "throw", "this", "super", "true", "false", "null",
  ],
  builtins: [
    "String", "Int", "Long", "Double", "Boolean", "Unit", "Any", "List", "MutableList",
    "Map", "MutableMap", "Set", "Result", "println", "listOf", "mapOf", "mutableListOf",
  ],
  commentStyle: "c",
};

const CSHARP_PROFILE: LangProfile = {
  keywords: [
    "using", "namespace", "public", "private", "protected", "internal", "class", "struct",
    "record", "interface", "enum", "static", "readonly", "const", "async", "await", "void",
    "var", "new", "return", "if", "else", "switch", "case", "for", "foreach", "while",
    "try", "catch", "finally", "throw", "true", "false", "null",
  ],
  builtins: [
    "string", "int", "long", "double", "bool", "object", "Task", "List", "Dictionary",
    "HashSet", "IEnumerable", "Console", "Math", "DateTime", "Guid", "Exception",
  ],
  commentStyle: "c",
};

const GO_PROFILE: LangProfile = {
  keywords: [
    "package", "import", "func", "type", "struct", "interface", "var", "const", "map",
    "chan", "go", "defer", "select", "return", "if", "else", "switch", "case", "default",
    "for", "range", "break", "continue", "true", "false", "nil", "iota",
  ],
  builtins: [
    "string", "int", "int64", "float64", "bool", "byte", "rune", "error", "any",
    "make", "len", "cap", "append", "copy", "delete", "new", "panic", "recover", "fmt",
  ],
  commentStyle: "c",
};

const PHP_PROFILE: LangProfile = {
  keywords: [
    "namespace", "use", "require", "require_once", "include", "class", "interface", "trait",
    "extends", "implements", "public", "private", "protected", "static", "function", "fn",
    "return", "if", "elseif", "else", "switch", "case", "foreach", "as", "for", "while",
    "try", "catch", "finally", "throw", "new", "echo", "true", "false", "null",
  ],
  builtins: [
    "array", "string", "int", "float", "bool", "void", "mixed", "array_map", "array_filter",
    "count", "json_encode", "json_decode", "strlen", "str_contains", "Exception",
  ],
  commentStyle: "both",
};

const DART_PROFILE: LangProfile = {
  keywords: [
    "import", "export", "part", "class", "mixin", "enum", "extension", "extends", "implements",
    "with", "abstract", "final", "const", "late", "var", "void", "async", "await", "Future",
    "Stream", "return", "if", "else", "switch", "case", "for", "in", "while", "try", "catch",
    "throw", "this", "super", "true", "false", "null", "required", "override",
  ],
  builtins: [
    "String", "int", "double", "bool", "num", "dynamic", "Object", "List", "Map", "Set",
    "Widget", "StatelessWidget", "StatefulWidget", "BuildContext", "State", "print",
  ],
  commentStyle: "c",
};

const SWIFT_PROFILE: LangProfile = {
  keywords: [
    "import", "struct", "class", "enum", "protocol", "extension", "func", "let", "var",
    "public", "private", "internal", "open", "override", "async", "await", "throws",
    "return", "if", "else", "guard", "switch", "case", "for", "in", "while", "try",
    "catch", "throw", "self", "Self", "true", "false", "nil",
  ],
  builtins: ["String", "Int", "Double", "Bool", "Array", "Dictionary", "Set", "Optional", "print"],
  commentStyle: "c",
};

const RUBY_PROFILE: LangProfile = {
  keywords: [
    "require", "require_relative", "module", "class", "def", "end", "do", "if", "elsif",
    "else", "unless", "case", "when", "while", "until", "for", "begin", "rescue", "ensure",
    "return", "yield", "self", "true", "false", "nil", "attr_reader", "attr_accessor",
  ],
  builtins: ["puts", "print", "p", "Array", "Hash", "String", "Integer", "StandardError"],
  commentStyle: "hash",
};

const LUA_PROFILE: LangProfile = {
  keywords: [
    "local", "function", "end", "return", "if", "then", "elseif", "else", "for", "in",
    "while", "do", "repeat", "until", "break", "and", "or", "not", "true", "false", "nil",
  ],
  builtins: ["require", "print", "pairs", "ipairs", "table", "string", "math", "tonumber", "tostring"],
  commentStyle: "c",
};

const SQL_PROFILE: LangProfile = {
  keywords: [
    "SELECT", "FROM", "WHERE", "INSERT", "INTO", "VALUES", "UPDATE", "SET", "DELETE",
    "CREATE", "TABLE", "ALTER", "DROP", "JOIN", "INNER", "LEFT", "RIGHT", "ON", "AS",
    "GROUP", "BY", "HAVING", "ORDER", "ASC", "DESC", "LIMIT", "OFFSET", "AND", "OR", "NOT", "NULL",
  ],
  builtins: ["COUNT", "SUM", "AVG", "MIN", "MAX", "COALESCE", "DISTINCT", "VARCHAR", "INTEGER", "BOOLEAN"],
  commentStyle: "c",
};

const SHELL_PROFILE: LangProfile = {
  keywords: [
    "if", "then", "else", "elif", "fi", "for", "in", "do", "done", "while", "case", "esac",
    "function", "return", "export", "local", "echo", "exit", "source", "true", "false",
  ],
  builtins: ["cd", "ls", "grep", "find", "cat", "curl", "git", "npm", "pnpm", "node", "python"],
  commentStyle: "hash",
};

const PS1_PROFILE: LangProfile = {
  keywords: [
    "function", "param", "begin", "process", "end", "if", "elseif", "else", "foreach",
    "for", "while", "switch", "return", "try", "catch", "finally", "throw", "$true", "$false", "$null",
  ],
  builtins: [
    "Write-Host", "Write-Output", "Get-ChildItem", "Get-Content", "Set-Content",
    "Select-String", "Test-Path", "Join-Path", "ForEach-Object", "Where-Object",
  ],
  commentStyle: "hash",
};

const LANG_PROFILES: Record<string, LangProfile> = {
  js: JS_PROFILE,
  jsx: JS_PROFILE,
  mjs: JS_PROFILE,
  cjs: JS_PROFILE,
  ts: TS_PROFILE,
  tsx: TS_PROFILE,
  mts: TS_PROFILE,
  cts: TS_PROFILE,
  astro: JS_PROFILE,
  vue: JS_PROFILE,
  svelte: JS_PROFILE,
  html: JS_PROFILE,
  htm: JS_PROFILE,
  py: PY_PROFILE,
  pyw: PY_PROFILE,
  rs: RUST_PROFILE,
  c: CPP_PROFILE,
  h: CPP_PROFILE,
  cpp: CPP_PROFILE,
  hpp: CPP_PROFILE,
  cc: CPP_PROFILE,
  cxx: CPP_PROFILE,
  java: JAVA_PROFILE,
  kt: KOTLIN_PROFILE,
  kts: KOTLIN_PROFILE,
  cs: CSHARP_PROFILE,
  go: GO_PROFILE,
  php: PHP_PROFILE,
  dart: DART_PROFILE,
  swift: SWIFT_PROFILE,
  rb: RUBY_PROFILE,
  lua: LUA_PROFILE,
  sql: SQL_PROFILE,
  sh: SHELL_PROFILE,
  bash: SHELL_PROFILE,
  zsh: SHELL_PROFILE,
  ps1: PS1_PROFILE,
};

const BUILTIN_MEMBERS: Record<string, MemberSymbol[]> = {
  console: [
    { name: "log", kind: "method", detail: "(...data)" },
    { name: "error", kind: "method", detail: "(...data)" },
    { name: "warn", kind: "method", detail: "(...data)" },
    { name: "info", kind: "method", detail: "(...data)" },
    { name: "table", kind: "method", detail: "(tabularData)" },
  ],
  Math: [
    { name: "max", kind: "method", detail: "(...values)" },
    { name: "min", kind: "method", detail: "(...values)" },
    { name: "floor", kind: "method", detail: "(x)" },
    { name: "ceil", kind: "method", detail: "(x)" },
    { name: "round", kind: "method", detail: "(x)" },
    { name: "random", kind: "method", detail: "()" },
    { name: "abs", kind: "method", detail: "(x)" },
  ],
  JSON: [
    { name: "parse", kind: "method", detail: "(text)" },
    { name: "stringify", kind: "method", detail: "(value, replacer?, space?)" },
  ],
  Object: [
    { name: "keys", kind: "method", detail: "(o)" },
    { name: "values", kind: "method", detail: "(o)" },
    { name: "entries", kind: "method", detail: "(o)" },
    { name: "assign", kind: "method", detail: "(target, ...sources)" },
    { name: "fromEntries", kind: "method", detail: "(entries)" },
  ],
  Array: [
    { name: "isArray", kind: "method", detail: "(arg)" },
    { name: "from", kind: "method", detail: "(iterable)" },
  ],
  Promise: [
    { name: "all", kind: "method", detail: "(values)" },
    { name: "allSettled", kind: "method", detail: "(values)" },
    { name: "race", kind: "method", detail: "(values)" },
    { name: "resolve", kind: "method", detail: "(value)" },
    { name: "reject", kind: "method", detail: "(reason)" },
  ],
  document: [
    { name: "getElementById", kind: "method", detail: "(id)" },
    { name: "querySelector", kind: "method", detail: "(selector)" },
    { name: "querySelectorAll", kind: "method", detail: "(selector)" },
    { name: "createElement", kind: "method", detail: "(tagName)" },
  ],
  React: [
    { name: "StrictMode", kind: "property", detail: "ExoticComponent" },
    { name: "Fragment", kind: "property", detail: "ExoticComponent" },
    { name: "Suspense", kind: "property", detail: "ExoticComponent" },
    { name: "useState", kind: "method", detail: "(initialState)" },
    { name: "useEffect", kind: "method", detail: "(effect, deps?)" },
    { name: "useRef", kind: "method", detail: "(initialValue)" },
    { name: "useMemo", kind: "method", detail: "(factory, deps)" },
    { name: "useCallback", kind: "method", detail: "(callback, deps)" },
    { name: "useContext", kind: "method", detail: "(context)" },
  ],
};

const JS_LIKE_EXTS = new Set(["js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts"]);

export function createSmartCompletionSource(
  getIndex: () => ProjectIndex,
  getActivePath: () => string | null,
  getAssetFiles?: () => Set<string>,
) {
  return (ctx: CompletionContext): CompletionResult | null => {
    try {
      const activePath = getActivePath();
      if (!activePath) return null;

      const ext = activePath.split(".").pop()?.toLowerCase() ?? "";
      const isHtmlDoc = ["html", "htm", "astro", "vue", "svelte", "xml", "svg"].includes(ext);
      if (isHtmlDoc && htmlLanguage.isActiveAt(ctx.state, ctx.pos, -1)) return null;

      // En hojas de estilo y datos estructurados dejamos actuar al completado nativo de CodeMirror/LSP
      if (["css", "scss", "less", "json", "jsonc", "md", "markdown", "yaml", "yml", "toml"].includes(ext)) {
        return null;
      }

      const profile = LANG_PROFILES[ext];
      const commentStyle = profile?.commentStyle ?? "c";
      const index = getIndex();
      const docText = ctx.state.doc.toString();
      const cleanDoc = stripComments(docText, commentStyle);
      const currentLine = ctx.state.doc.lineAt(ctx.pos);
      const lineText = currentLine.text;

      // 1. Dentro de comillas de `from "..."`, `import "..."`, `require("...")` o `#include "..."`
      const importStringMatch = ctx.matchBefore(
        /(?:from\s+['"]|import\s+['"]|require\(\s*['"]|#include\s+['"<])([^'">]*)$/,
      );
      if (importStringMatch) {
        const prefix = importStringMatch.text.replace(
          /^(?:from\s+['"]|import\s+['"]|require\(\s*['"]|#include\s+['"<])/,
          "",
        );
        const from = ctx.pos - prefix.length;
        const options: Completion[] = [];

        for (const [filePath, symbols] of index.files.entries()) {
          if (filePath === activePath) continue;
          const relPath = relativeModulePath(activePath, filePath);
          const exportedNames = symbols.map((s) => s.name).slice(0, 5).join(", ");
          options.push({
            label: relPath,
            type: "module",
            detail: exportedNames ? `exports: ${exportedNames}` : fileNameOf(filePath),
            boost: 50,
          });
        }

        if (getAssetFiles) {
          for (const assetPath of getAssetFiles()) {
            const relAsset = relativeModulePath(activePath, assetPath);
            options.push({
              label: relAsset,
              type: "file",
              detail: fileNameOf(assetPath),
              boost: 35,
            });
          }
        }

        for (const p of index.packages) {
          options.push({
            label: p.name,
            type: "namespace",
            detail: `dependency (${p.ecosystem})`,
            boost: 40,
          });
        }

        return {
          from,
          options,
          validFor: /^[^'">\s]*$/,
        };
      }

      // 2. Acceso con punto `Objeto.` o `instancia.` -> miembros publicos o builtins
      const dotMatch = ctx.matchBefore(/([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)?$/);
      if (dotMatch && !/^\s*(import|from)\b/.test(lineText)) {
        const full = dotMatch.text;
        const dotIdx = full.indexOf(".");
        const receiver = full.slice(0, dotIdx);
        const from = dotMatch.from + dotIdx + 1;

        const targetClass = resolveReceiverClass(receiver, cleanDoc, activePath, index);
        const members = targetClass?.members.length
          ? targetClass.members
          : (BUILTIN_MEMBERS[receiver] ?? []);

        if (members.length === 0) return null;

        return {
          from,
          options: members.map((m) => ({
            label: m.name,
            type: m.kind,
            detail: m.detail ?? `public ${m.kind}`,
            info: targetClass ? `Miembro publico de ${targetClass.name}` : `Miembro de ${receiver}`,
            boost: m.kind === "method" ? 35 : 25,
          })),
          validFor: /^[A-Za-z_$][\w$]*$/,
        };
      }

      // 3. Escribiendo un identificador o componente JSX (`Usua`, `<Usua`, etc.)
      const word = ctx.matchBefore(/[A-Za-z_$#][\w$]*/);
      if ((!word || word.text.length < 1) && !ctx.explicit) return null;
      const anchor = word ? word.from : ctx.pos;

      const isInsideImportLine = /^\s*(import|from|use|using|#include)\b/.test(lineText);
      const activeImportSpec = isInsideImportLine ? extractLineModuleSpec(lineText) : null;
      const options: Completion[] = [];
      const seen = new Set<string>();
      const importedMap = collectImportedModules(cleanDoc);

      // 3a. Simbolos exportados de TODOS los archivos del proyecto (Auto-import estilo VS Code)
      for (const [filePath, symbols] of index.files.entries()) {
        if (filePath === activePath) continue;
        const relPath = relativeModulePath(activePath, filePath);
        const matchesLineModule = activeImportSpec !== null && (
          relPath === activeImportSpec ||
          relPath.replace(/^\.\//, "") === activeImportSpec.replace(/^\.\//, "") ||
          relPath.replace(/\//g, ".") === activeImportSpec
        );

        for (const sym of symbols) {
          const key = `${sym.name}@${filePath}`;
          if (seen.has(key)) continue;
          seen.add(key);

          const isAlreadyImported = importedMap.has(sym.name);
          options.push({
            label: sym.name,
            type: sym.kind,
            detail: isAlreadyImported ? relPath : `Auto-import · ${relPath}`,
            info: isAlreadyImported
              ? `Ya importado desde ${relPath}`
              : `Auto-importar "${sym.name}" desde ${relPath}`,
            boost: matchesLineModule ? 95 : isAlreadyImported ? 72 : 65,
            apply: (view: EditorView, _c: Completion, from: number, to: number) => {
              applySymbolCompletion(
                view,
                from,
                to,
                sym.name,
                activePath,
                filePath,
                false,
                Boolean(sym.isDefault),
                sym.packageName,
                commentStyle,
              );
            },
          });
        }
      }

      // 3b. Simbolos y modulos de paquetes instalados (`React`, `useState`, crates, pip)
      const eco = profile?.ecosystem;
      if (eco) {
        for (const pkgSym of index.packageSymbols) {
          if (pkgSym.ecosystem !== eco) continue;
          const key = `${pkgSym.symbol}@pkg:${pkgSym.pkg}`;
          if (seen.has(key)) continue;
          seen.add(key);

          const isAlreadyImported = importedMap.has(pkgSym.symbol);
          const matchesLinePkg = activeImportSpec !== null && pkgSym.pkg === activeImportSpec;
          options.push({
            label: pkgSym.symbol,
            type: pkgSym.kind ?? (pkgSym.isDefault ? "namespace" : "function"),
            detail: isAlreadyImported ? pkgSym.pkg : `Auto-import · '${pkgSym.pkg}'`,
            boost: matchesLinePkg ? 95 : isAlreadyImported ? 66 : 56,
            apply: (view: EditorView, _c: Completion, from: number, to: number) => {
              applySymbolCompletion(
                view,
                from,
                to,
                pkgSym.symbol,
                activePath,
                pkgSym.pkg,
                true,
                pkgSym.isDefault,
                undefined,
                commentStyle,
              );
            },
          });
        }
      }

      // 3c. Simbolos, variables reales, builtins y palabras clave del archivo/lenguaje actual
      if (!isInsideImportLine) {
        for (const sym of extractFileSymbols(activePath, docText)) {
          if (seen.has(sym.name)) continue;
          seen.add(sym.name);
          options.push({
            label: sym.name,
            type: sym.kind,
            detail: "este archivo",
            boost: 74,
          });
        }

        for (const local of collectLocalDeclarations(cleanDoc)) {
          if (seen.has(local.name)) continue;
          seen.add(local.name);
          options.push({
            label: local.name,
            type: local.kind,
            detail: "local",
            boost: 70,
          });
        }

        for (const b of profile?.builtins ?? []) {
          if (seen.has(b)) continue;
          seen.add(b);
          options.push({
            label: b,
            type: /^[A-Z]/.test(b) ? "class" : "function",
            detail: ext.toUpperCase() || "builtin",
            boost: 30,
          });
        }

        for (const ident of collectDocumentWords(cleanDoc, anchor, ctx.pos)) {
          if (seen.has(ident)) continue;
          seen.add(ident);
          options.push({
            label: ident,
            type: "text",
            detail: "en este archivo",
            boost: 15,
          });
        }

        for (const kw of profile?.keywords ?? []) {
          if (seen.has(kw)) continue;
          options.push({ label: kw, type: "keyword", boost: 5 });
        }
      }

      if (options.length === 0) return null;

      return {
        from: anchor,
        options,
        validFor: /^[A-Za-z_$#][\w$]*$/,
      };
    } catch {
      return null;
    }
  };
}

function extractLineModuleSpec(lineText: string): string | null {
  const jsMatch = /\bfrom\s+['"]([^'"]+)['"]/.exec(lineText);
  if (jsMatch) return jsMatch[1];
  const pyMatch = /^\s*from\s+([.\w]+)\s+import\b/.exec(lineText);
  if (pyMatch) return pyMatch[1];
  const rustMatch = /^\s*use\s+(?:crate::)?([A-Za-z_]\w*)/.exec(lineText);
  if (rustMatch) return rustMatch[1];
  return null;
}

function collectImportedModules(cleanDoc: string): Set<string> {
  const imported = new Set<string>();
  const importLineRegex = /^\s*import\s+([^;\n]+?)\s+from\s+['"][^'"]+['"]/gm;
  let m: RegExpExecArray | null;
  while ((m = importLineRegex.exec(cleanDoc)) !== null) {
    for (const id of m[1].match(/[A-Za-z_$][\w$]*/g) ?? []) {
      if (id !== "type" && id !== "as") imported.add(id);
    }
  }
  const pyFromRegex = /^\s*from\s+[.\w]+\s+import\s+([^\n]+)/gm;
  while ((m = pyFromRegex.exec(cleanDoc)) !== null) {
    for (const id of m[1].match(/[A-Za-z_]\w*/g) ?? []) {
      if (id !== "as") imported.add(id);
    }
  }
  return imported;
}

function detectFileStyle(cleanDoc: string): { quote: "'" | '"'; semi: boolean } {
  const m = /^\s*import\s+[^;\n]+from\s+(['"])[^'"]+\1(;?)/m.exec(cleanDoc);
  if (m) {
    return {
      quote: (m[1] as "'" | '"') ?? "'",
      semi: m[2] === ";",
    };
  }
  const singleQuotes = (cleanDoc.match(/'/g) ?? []).length;
  const doubleQuotes = (cleanDoc.match(/"/g) ?? []).length;
  return {
    quote: singleQuotes > doubleQuotes ? "'" : '"',
    semi: /;\s*$/m.test(cleanDoc),
  };
}

function resolveReceiverClass(
  receiver: string,
  cleanDoc: string,
  activePath: string,
  index: ProjectIndex,
): ExportedSymbol | null {
  const allClasses: ExportedSymbol[] = [
    ...extractFileSymbols(activePath, cleanDoc),
    ...[...index.files.values()].flat(),
  ].filter((s) => s.kind === "class");

  if (receiver === "this" || receiver === "self") {
    const localClasses = extractFileSymbols(activePath, cleanDoc).filter((s) => s.kind === "class");
    return localClasses[0] ?? null;
  }

  const direct = allClasses.find((c) => c.name === receiver);
  if (direct) return direct;

  const escaped = receiver.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`\\b${escaped}\\s*=\\s*new\\s+([A-Za-z_$][\\w$]*)`),
    new RegExp(`\\b${escaped}\\s*:\\s*([A-Za-z_$][\\w$]*)`),
    new RegExp(`\\b${escaped}\\s*=\\s*([A-Za-z_][\\w]*)\\s*\\(`),
  ];

  for (const regex of patterns) {
    const m = regex.exec(cleanDoc);
    if (m) {
      const found = allClasses.find((c) => c.name === m[1]);
      if (found) return found;
    }
  }

  return null;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tryMergeJsTsImport(
  rawDoc: string,
  cleanDoc: string,
  spec: string,
  symbolName: string,
  isDefault: boolean,
): { from: number; to: number; insert: string } | null {
  const escSpec = escapeRegExp(spec);
  const re = new RegExp(`^([ \\t]*import\\s+)([^;\\n]+?)(\\s+from\\s+(['"])${escSpec}\\4[ \\t]*;?)`, "gm");
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleanDoc)) !== null) {
    const clauseStart = m.index + m[1].length;
    const clauseEnd = clauseStart + m[2].length;
    const rawClause = rawDoc.slice(clauseStart, clauseEnd).trim();
    if (rawClause.startsWith("*")) continue;

    if (isDefault) {
      if (rawClause.startsWith("{")) {
        return { from: clauseStart, to: clauseEnd, insert: `${symbolName}, ${rawClause}` };
      }
      return null;
    }

    const braceOpen = rawClause.indexOf("{");
    const braceClose = rawClause.lastIndexOf("}");
    if (braceOpen !== -1 && braceClose > braceOpen) {
      const inner = rawClause.slice(braceOpen + 1, braceClose).trim();
      const updatedInner = inner ? `${inner}, ${symbolName}` : symbolName;
      const beforeBrace = rawClause.slice(0, braceOpen);
      const afterBrace = rawClause.slice(braceClose + 1);
      return {
        from: clauseStart,
        to: clauseEnd,
        insert: `${beforeBrace}{ ${updatedInner} }${afterBrace}`,
      };
    }

    if (/^[A-Za-z_$][\w$]*$/.test(rawClause)) {
      return { from: clauseStart, to: clauseEnd, insert: `${rawClause}, { ${symbolName} }` };
    }
  }
  return null;
}

function tryMergePythonImport(
  rawDoc: string,
  cleanDoc: string,
  moduleSpec: string,
  symbolName: string,
): { from: number; to: number; insert: string } | null {
  const escMod = escapeRegExp(moduleSpec);
  const re = new RegExp(`^([ \\t]*from\\s+${escMod}\\s+import\\s+)([^\\n#]+)`, "gm");
  const m = re.exec(cleanDoc);
  if (!m) return null;
  const listStart = m.index + m[1].length;
  const listEnd = listStart + m[2].length;
  const existing = rawDoc.slice(listStart, listEnd).trim();
  if (!existing || existing.includes("(")) return null;
  return { from: listStart, to: listEnd, insert: `${existing}, ${symbolName}` };
}

function applySymbolCompletion(
  view: EditorView,
  from: number,
  to: number,
  symbolName: string,
  activePath: string,
  targetPathOrPkg: string,
  isPackage: boolean,
  isDefault: boolean,
  packageName: string | undefined,
  commentStyle: "c" | "hash" | "both",
) {
  const doc = view.state.doc.toString();
  const cleanDoc = stripComments(doc, commentStyle);
  const line = view.state.doc.lineAt(from);
  const ext = activePath.split(".").pop()?.toLowerCase() ?? "";
  const style = detectFileStyle(cleanDoc);
  const importStmt = buildAutoImportStatement(
    activePath,
    targetPathOrPkg,
    symbolName,
    isPackage,
    isDefault,
    { ...style, packageName },
  );

  // Si esta escribiendo en una linea `import ...` / `from ...` / `use ...` / `#include ...`:
  // - Si ya hay lista `{ ... }`, coma `,` o un especificador `from '...'` / `from mod import ...`,
  //   solo reemplaza el identificador escrito (`from..to`) para NO borrar los simbolos ya importados.
  // - Solo reemplaza toda la linea cuando es una linea incompleta simple (ej. `import useSta`).
  if (/^\s*(import|from|use|using|#include)\b/.test(line.text) && importStmt) {
    const hasExistingStructure =
      line.text.includes(",") ||
      line.text.includes("{") ||
      /\bfrom\s+['"][^'"]+['"]/.test(line.text) ||
      /^\s*from\s+[.\w]+\s+import\s+\S+/.test(line.text);

    if (hasExistingStructure) {
      view.dispatch({
        changes: { from, to, insert: symbolName },
        selection: { anchor: from + symbolName.length },
      });
      return;
    }

    const cleanStmt = importStmt.replace(/\n$/, "");
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: cleanStmt },
      selection: { anchor: line.from + cleanStmt.length },
    });
    return;
  }

  // Verifica si el simbolo ya esta importado usando codigo SIN comentarios (ignorando `//import ...`)
  const cleanBefore = stripComments(doc.slice(0, line.from), commentStyle);
  const cleanAfter = stripComments(doc.slice(line.to), commentStyle);
  const cleanOther = `${cleanBefore}\n${cleanAfter}`;
  const escSym = escapeRegExp(symbolName);
  const alreadyImported =
    !importStmt ||
    cleanOther.includes(importStmt.trim()) ||
    new RegExp(`^\\s*import\\b[^;\\n]*\\b${escSym}\\b`, "m").test(cleanOther) ||
    new RegExp(`^\\s*from\\s+[.\\w]+\\s+import\\b[^\\n]*\\b${escSym}\\b`, "m").test(cleanOther) ||
    new RegExp(`^\\s*use\\b[^;\\n]*\\b${escSym}\\b`, "m").test(cleanOther);

  if (alreadyImported) {
    view.dispatch({
      changes: { from, to, insert: symbolName },
      selection: { anchor: from + symbolName.length },
    });
    return;
  }

  // Intenta fusionar dentro de un import existente del mismo modulo (estilo VS Code)
  if (JS_LIKE_EXTS.has(ext)) {
    const spec = isPackage ? targetPathOrPkg : relativeModulePath(activePath, targetPathOrPkg);
    const mergeEdit = tryMergeJsTsImport(doc, cleanDoc, spec, symbolName, isDefault);
    if (mergeEdit && mergeEdit.to <= from) {
      const delta = mergeEdit.insert.length - (mergeEdit.to - mergeEdit.from);
      view.dispatch({
        changes: [
          mergeEdit,
          { from, to, insert: symbolName },
        ],
        selection: { anchor: from + delta + symbolName.length },
      });
      return;
    }
  } else if (ext === "py" || ext === "pyw") {
    const modSpec = isPackage
      ? targetPathOrPkg
      : relativeModulePath(activePath, targetPathOrPkg).replace(/^\.\//, "").replace(/\//g, ".");
    const mergeEdit = tryMergePythonImport(doc, cleanDoc, modSpec, symbolName);
    if (mergeEdit && mergeEdit.to <= from) {
      const delta = mergeEdit.insert.length - (mergeEdit.to - mergeEdit.from);
      view.dispatch({
        changes: [
          mergeEdit,
          { from, to, insert: symbolName },
        ],
        selection: { anchor: from + delta + symbolName.length },
      });
      return;
    }
  }

  const insertPos = Math.min(findImportInsertOffset(doc, ext), from);
  view.dispatch({
    changes: [
      { from: insertPos, to: insertPos, insert: importStmt },
      { from, to, insert: symbolName },
    ],
    selection: { anchor: from + importStmt.length + symbolName.length },
  });
}

function findImportInsertOffset(doc: string, ext: string): number {
  const lines = doc.split("\n");
  let offset = 0;
  let afterHeaderOffset = 0;
  let lastImportEnd = -1;
  let inBlockComment = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const nextOffset = Math.min(offset + line.length + 1, doc.length);

    if (inBlockComment) {
      if (trimmed.includes("*/")) inBlockComment = false;
      if (lastImportEnd === -1) afterHeaderOffset = nextOffset;
      offset = nextOffset;
      continue;
    }

    if (trimmed.startsWith("/*")) {
      if (!trimmed.includes("*/")) inBlockComment = true;
      if (lastImportEnd === -1) afterHeaderOffset = nextOffset;
      offset = nextOffset;
      continue;
    }

    const isPreamble =
      trimmed.startsWith("#!") ||
      /^['"]use (client|server|strict)['"];?$/.test(trimmed) ||
      trimmed === "<?php" ||
      trimmed.startsWith("declare(") ||
      (["java", "kt", "kts", "go", "php"].includes(ext) && /^package\s+/.test(trimmed)) ||
      (ext === "php" && /^namespace\s+/.test(trimmed));

    if (isPreamble && lastImportEnd === -1) {
      afterHeaderOffset = nextOffset;
      offset = nextOffset;
      continue;
    }

    const isImportLine =
      trimmed.startsWith("import ") ||
      trimmed.startsWith("from ") ||
      trimmed.startsWith("use ") ||
      trimmed.startsWith("using ") ||
      trimmed.startsWith("#include ") ||
      trimmed.startsWith("require");

    if (isImportLine) {
      lastImportEnd = nextOffset;
    } else if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("#")) {
      // comentarios o lineas vacias antes del bloque de codigo no rompen el bloque
    } else {
      break;
    }

    offset = nextOffset;
  }

  return lastImportEnd !== -1 ? lastImportEnd : afterHeaderOffset;
}

function collectLocalDeclarations(cleanDoc: string): { name: string; kind: string }[] {
  const out: { name: string; kind: string }[] = [];
  const seen = new Set<string>();
  const add = (name: string, kind: string) => {
    if (!name || name.length < 2 || seen.has(name)) return;
    seen.add(name);
    out.push({ name, kind });
  };

  let m: RegExpExecArray | null;

  const varDecl = /\b(?:const|let|var|val|final)\s+(?:mut\s+)?(\[[^\]]+\]|\{[^}]+\}|[A-Za-z_$][\w$]*)/g;
  while ((m = varDecl.exec(cleanDoc)) !== null) {
    const raw = m[1];
    if (raw.startsWith("[") || raw.startsWith("{")) {
      for (const id of raw.match(/[A-Za-z_$][\w$]*/g) ?? []) add(id, "variable");
    } else {
      add(raw, "variable");
    }
  }

  const fnOrType = /\b(?:function\*?|def|fn|func|class|struct|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;
  while ((m = fnOrType.exec(cleanDoc)) !== null) {
    const kind = m[0].startsWith("class") || m[0].startsWith("struct") ? "class" : "function";
    add(m[1], kind);
  }

  const assignDecl = /^[ \t]*([A-Za-z_][\w]*)\s*:?=\s*[^=]/gm;
  while ((m = assignDecl.exec(cleanDoc)) !== null) {
    add(m[1], "variable");
  }

  const typedDecl =
    /^[ \t]*(?:private|public|protected|internal|static|readonly|final|late|var)?\s*[A-Za-z_][\w<>, ?[\]]*\s+([A-Za-z_][\w]*)\s*(?:=|;)/gm;
  while ((m = typedDecl.exec(cleanDoc)) !== null) {
    if (!["return", "import", "package", "using", "namespace", "throw", "yield"].includes(m[1])) {
      add(m[1], "variable");
    }
  }

  const importDecl = /^\s*import\s+([^;\n]+?)\s+from\b/gm;
  while ((m = importDecl.exec(cleanDoc)) !== null) {
    for (const id of m[1].match(/[A-Za-z_$][\w$]*/g) ?? []) {
      if (id !== "type" && id !== "as") add(id, "variable");
    }
  }

  return out;
}

function collectDocumentWords(cleanDoc: string, curFrom: number, curTo: number): string[] {
  const seen = new Set<string>();
  const words: string[] = [];
  const regex = /[A-Za-z_$][\w$]{1,}/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(cleanDoc)) !== null) {
    if (m.index <= curFrom && m.index + m[0].length >= curTo) continue;
    const w = m[0];
    if (!seen.has(w)) {
      seen.add(w);
      words.push(w);
      if (words.length >= 250) break;
    }
  }
  return words;
}
