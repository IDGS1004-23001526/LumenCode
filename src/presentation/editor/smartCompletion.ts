import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
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
    const ext = activePath.split(".").pop()?.toLowerCase() ?? "";
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

    // 3c. Símbolos e identificadores del propio archivo actual
    if (!isInsideImportLine) {
      for (const sym of extractFileSymbols(activePath, docText)) {
        if (seen.has(sym.name)) continue;
        seen.add(sym.name);
        options.push({
          label: sym.name,
          type: sym.kind,
          detail: "este archivo",
          boost: 35,
        });
      }

      // Palabras clave del lenguaje activo
      const langGroup =
        ext === "py" ? "py" : ext === "rs" ? "rs" : ["c", "h", "cpp", "hpp", "cc"].includes(ext) ? "cpp" : "js";
      for (const kw of LANG_KEYWORDS[langGroup] ?? []) {
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