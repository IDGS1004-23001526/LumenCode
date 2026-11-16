import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { htmlLanguage } from "@codemirror/lang-html";
import type { EditorView } from "@codemirror/view";
import { fileNameOf } from "../../domain/path";
import {
  buildAutoImportStatement,
  extractFileSymbols,
  relativeModulePath,
  type ExportedSymbol,
  type ProjectIndex,
} from "../../domain/symbolIndex";

/** Palabras clave por lenguaje para que override también sugiera sintaxis del lenguaje */
const LANG_KEYWORDS: Record<string, string[]> = {
  js: ["import", "export", "default", "from", "const", "let", "function", "return", "async", "await", "class", "extends", "new", "try", "catch", "if", "else", "switch", "case", "for", "while", "true", "false", "null"],
  py: ["def", "class", "import", "from", "return", "async", "await", "if", "elif", "else", "for", "while", "try", "except", "finally", "with", "as", "True", "False", "None", "self", "print"],
  rs: ["fn", "pub", "struct", "enum", "impl", "trait", "use", "mod", "crate", "let", "mut", "match", "if", "else", "for", "while", "loop", "return", "async", "await", "Self", "self", "Some", "None", "Ok", "Err"],
  cpp: ["#include", "class", "struct", "public", "private", "protected", "virtual", "override", "namespace", "using", "template", "typename", "const", "auto", "void", "int", "double", "bool", "std", "return", "if", "else", "for", "while"],
};

export function createSmartCompletionSource(getIndex: () => ProjectIndex, getActivePath: () => string | null) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const activePath = getActivePath();
    if (!activePath) return null;

    const ext = activePath.split(".").pop()?.toLowerCase() ?? "";
    const isHtmlMarkup = ["html", "htm", "astro", "vue", "svelte", "xml", "svg"].includes(ext)
      && htmlLanguage.isActiveAt(ctx.state, ctx.pos, -1);
    const isNonCodeDoc = ["css", "scss", "less", "json", "jsonc", "md", "yaml", "yml", "toml"].includes(ext);
    if (isHtmlMarkup || isNonCodeDoc) return null;

    const index = getIndex();
    const docText = ctx.state.doc.toString();
    const currentLine = ctx.state.doc.lineAt(ctx.pos);
    const lineText = currentLine.text;

    // 1. Dentro de comillas de `from "..."` o `import "..."` o `#include "..."`
    const importStringMatch = ctx.matchBefore(/(?:from\s+['"]|import\s+['"]|#include\s+['"<])([^'">]*)$/);
    if (importStringMatch) {
      const prefix = importStringMatch.text.replace(/^(?:from\s+['"]|import\s+['"]|#include\s+['"<])/, "");
      const from = ctx.pos - prefix.length;
      const options: Completion[] = [];

      for (const [filePath, symbols] of index.files.entries()) {
        if (filePath === activePath) continue;
        const relPath = relativeModulePath(activePath, filePath);
        const exportedNames = symbols.map((s) => s.name).join(", ");
        options.push({
          label: relPath,
          type: "module",
          detail: exportedNames ? `exports: ${exportedNames}` : fileNameOf(filePath),
          boost: 40,
        });
      }

      for (const p of index.packages) {
        options.push({
          label: p.name,
          type: "namespace",
          detail: `dependency (${p.ecosystem})`,
          boost: 30,
        });
      }

      return { from, options };
    }

    // 2. Acceso con punto `Objeto.` o `instancia.` -> miembros públicos
    const dotMatch = ctx.matchBefore(/([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)?$/);
    if (dotMatch && !/^\s*(import|from)\b/.test(lineText)) {
      const full = dotMatch.text;
      const dotIdx = full.indexOf(".");
      const receiver = full.slice(0, dotIdx);
      const from = dotMatch.from + dotIdx + 1;

      const targetClass = resolveReceiverClass(receiver, docText, activePath, index);
      if (!targetClass || targetClass.members.length === 0) return null;

      return {
        from,
        options: targetClass.members.map((m) => ({
          label: m.name,
          type: m.kind,
          detail: m.detail ?? `public ${m.kind}`,
          info: `Miembro público de ${targetClass.name}`,
          boost: m.kind === "method" ? 30 : 20,
        })),
      };
    }

    // 3. Escribiendo cualquier identificador (ej. `AuthContext`, `LoginRouter`, `React`, `useState`, `<AuthContext`)
    const word = ctx.matchBefore(/[A-Za-z_$#][\w$]*/);
    if (!word || word.text.length < 1) return null;

    const isInsideImportLine = /^\s*(import|from|use|#include)\b/.test(lineText);
    const options: Completion[] = [];
    const seen = new Set<string>();

    // 3a. Símbolos de TODOS los demás archivos del proyecto (Auto-import)
    for (const [filePath, symbols] of index.files.entries()) {
      if (filePath === activePath) continue;
      const relPath = relativeModulePath(activePath, filePath);

      for (const sym of symbols) {
        const key = `${sym.name}@${filePath}`;
        if (seen.has(key)) continue;
        seen.add(key);

        options.push({
          label: sym.name,
          type: sym.kind,
          detail: `Auto-import · ${relPath}`,
          boost: 50,
          apply: (view: EditorView, _c: Completion, from: number, to: number) => {
            applySymbolCompletion(view, from, to, sym.name, activePath, filePath, false, Boolean(sym.isDefault));
          },
        });
      }
    }

    // 3b. Símbolos y módulos de paquetes instalados (ej. `React`, `useState`, `useEffect`, `useReducer`, crates, pip)
    const eco = ext === "py" ? "pip" : ext === "rs" ? "cargo" : "npm";

    for (const pkgSym of index.packageSymbols) {
      if (pkgSym.ecosystem !== eco) continue;
      const key = `${pkgSym.symbol}@pkg:${pkgSym.pkg}`;
      if (seen.has(key)) continue;
      seen.add(key);

      options.push({
        label: pkgSym.symbol,
        type: pkgSym.isDefault ? "namespace" : "function",
        detail: `Auto-import · "${pkgSym.pkg}"`,
        boost: 45,
        apply: (view: EditorView, _c: Completion, from: number, to: number) => {
          applySymbolCompletion(view, from, to, pkgSym.symbol, activePath, pkgSym.pkg, true, pkgSym.isDefault);
        },
      });
    }

    // 3c. Símbolos, variables declaradas e identificadores del propio archivo actual
    if (!isInsideImportLine) {
      for (const sym of extractFileSymbols(activePath, docText)) {
        if (seen.has(sym.name)) continue;
        seen.add(sym.name);
        options.push({
          label: sym.name,
          type: sym.kind,
          detail: "este archivo",
          boost: 55,
        });
      }

      for (const local of collectLocalDeclarations(docText)) {
        if (seen.has(local.name)) continue;
        seen.add(local.name);
        options.push({
          label: local.name,
          type: local.kind,
          detail: "variable local",
          boost: 60,
        });
      }

      // Identificadores generales del archivo (excluye el token que se está escribiendo)
      for (const ident of collectDocumentWords(docText, word.from, word.to)) {
        if (seen.has(ident)) continue;
        seen.add(ident);
        options.push({
          label: ident,
          type: "text",
          detail: "en este archivo",
          boost: 25,
        });
      }

      // Palabras clave del lenguaje activo
      const isJsLike = ["js", "mjs", "cjs", "jsx", "ts", "mts", "cts", "tsx"].includes(ext);
      const langGroup =
        ext === "py" || ext === "pyw"
          ? "py"
          : ext === "rs"
            ? "rs"
            : ["c", "h", "cpp", "hpp", "cc"].includes(ext)
              ? "cpp"
              : isJsLike
                ? "js"
                : "";
      for (const kw of LANG_KEYWORDS[langGroup] ?? []) {
        if (seen.has(kw)) continue;
        options.push({ label: kw, type: "keyword", boost: 5 });
      }
    }

    return {
      from: word.from,
      options,
    };
  };
}

function resolveReceiverClass(
  receiver: string,
  docText: string,
  activePath: string,
  index: ProjectIndex,
): ExportedSymbol | null {
  const allClasses: ExportedSymbol[] = [
    ...extractFileSymbols(activePath, docText),
    ...[...index.files.values()].flat(),
  ].filter((s) => s.kind === "class");

  if (receiver === "this" || receiver === "self") {
    const localClasses = extractFileSymbols(activePath, docText).filter((s) => s.kind === "class");
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
    const m = regex.exec(docText);
    if (m) {
      const found = allClasses.find((c) => c.name === m[1]);
      if (found) return found;
    }
  }

  return null;
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
) {
  const doc = view.state.doc.toString();
  const line = view.state.doc.lineAt(from);
  const importStmt = buildAutoImportStatement(activePath, targetPathOrPkg, symbolName, isPackage, isDefault);

  // Si está escribiendo en una línea `import ...`, reemplaza toda esa línea con el import completo
  if (/^\s*(import|from|use|#include)\b/.test(line.text) && importStmt) {
    const cleanStmt = importStmt.replace(/\n$/, "");
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: cleanStmt },
      selection: { anchor: line.from + cleanStmt.length },
    });
    return;
  }

  const otherText = doc.slice(0, line.from) + doc.slice(line.to);
  const alreadyImported =
    !importStmt ||
    otherText.includes(importStmt.trim()) ||
    new RegExp(`\\bimport\\b[^;\\n]*\\b${symbolName}\\b`).test(otherText) ||
    new RegExp(`\\buse\\b[^;\\n]*\\b${symbolName}\\b`).test(otherText);

  if (alreadyImported) {
    view.dispatch({
      changes: { from, to, insert: symbolName },
      selection: { anchor: from + symbolName.length },
    });
    return;
  }

  const insertPos = findImportInsertOffset(doc);
  view.dispatch({
    changes: [
      { from: insertPos, to: insertPos, insert: importStmt },
      { from, to, insert: symbolName },
    ],
    selection: { anchor: from + importStmt.length + symbolName.length },
  });
}

function findImportInsertOffset(doc: string): number {
  const lines = doc.split("\n");
  let offset = 0;
  let lastImportEnd = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    const nextOffset = offset + line.length + 1;
    if (
      trimmed.startsWith("import ") ||
      trimmed.startsWith("from ") ||
      trimmed.startsWith("use ") ||
      trimmed.startsWith("#include ")
    ) {
      lastImportEnd = Math.min(nextOffset, doc.length);
    } else if (trimmed && !trimmed.startsWith("//") && !trimmed.startsWith("#") && lastImportEnd > 0) {
      break;
    }
    offset = nextOffset;
  }

  return lastImportEnd;
}

function collectLocalDeclarations(doc: string): { name: string; kind: string }[] {
  const out: { name: string; kind: string }[] = [];
  const seen = new Set<string>();
  const add = (name: string, kind: string) => {
    if (!name || name.length < 2 || seen.has(name)) return;
    seen.add(name);
    out.push({ name, kind });
  };

  let m: RegExpExecArray | null;

  // Variables simples y desestructuradas: const/let/var/val/mut/final
  const varDecl = /\b(?:const|let|var|val|final)\s+(?:mut\s+)?(\[[^\]]+\]|\{[^}]+\}|[A-Za-z_$][\w$]*)/g;
  while ((m = varDecl.exec(doc)) !== null) {
    const raw = m[1];
    if (raw.startsWith("[") || raw.startsWith("{")) {
      for (const id of raw.match(/[A-Za-z_$][\w$]*/g) ?? []) add(id, "variable");
    } else {
      add(raw, "variable");
    }
  }

  // Funciones, clases, interfaces, tipos, enums, structs (JS/TS/Py/Rust/Go/PHP/etc.)
  const fnOrType = /\b(?:function\*?|def|fn|func|class|struct|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;
  while ((m = fnOrType.exec(doc)) !== null) {
    const kind = m[0].startsWith("class") || m[0].startsWith("struct") ? "class" : "function";
    add(m[1], kind);
  }

  // Asignaciones directas estilo Python / Go (`x := ...` o `x = ...` al inicio de línea)
  const assignDecl = /^[ \t]*([A-Za-z_][\w]*)\s*:?=\s*[^=]/gm;
  while ((m = assignDecl.exec(doc)) !== null) {
    add(m[1], "variable");
  }

  // Variables tipadas estilo C# / Java / Dart / C++ (`Type name =` o `Type name;`)
  const typedDecl = /^[ \t]*(?:private|public|protected|internal|static|readonly|final|late|var)?\s*[A-Za-z_][\w<>, ?[\]]*\s+([A-Za-z_][\w]*)\s*(?:=|;)/gm;
  while ((m = typedDecl.exec(doc)) !== null) {
    if (!["return", "import", "package", "using", "namespace", "throw", "yield"].includes(m[1])) {
      add(m[1], "variable");
    }
  }

  // Símbolos importados localmente en el archivo
  const importDecl = /\bimport\s+([^;\n]+?)\s+from\b/g;
  while ((m = importDecl.exec(doc)) !== null) {
    for (const id of m[1].match(/[A-Za-z_$][\w$]*/g) ?? []) {
      if (id !== "type" && id !== "as") add(id, "variable");
    }
  }

  return out;
}

function collectDocumentWords(doc: string, curFrom: number, curTo: number): string[] {
  const seen = new Set<string>();
  const words: string[] = [];
  const regex = /[A-Za-z_$][\w$]{1,}/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(doc)) !== null) {
    if (m.index === curFrom && m.index + m[0].length === curTo) continue;
    const w = m[0];
    if (!seen.has(w)) {
      seen.add(w);
      words.push(w);
      if (words.length >= 250) break;
    }
  }
  return words;
}