export type SymbolKind = "class" | "function" | "variable" | "interface" | "type" | "module" | "keyword";

export interface MemberSymbol {
  name: string;
  kind: "method" | "property";
  detail?: string;
}

export interface ExportedSymbol {
  name: string;
  kind: SymbolKind;
  filePath: string;
  isDefault?: boolean;
  members: MemberSymbol[];
}

export interface PackageExport {
  symbol: string;
  pkg: string;
  isDefault: boolean;
  ecosystem: "npm" | "cargo" | "pip";
}

export interface ProjectIndex {
  files: Map<string, ExportedSymbol[]>;
  packages: { name: string; ecosystem: "npm" | "cargo" | "pip" }[];
  packageSymbols: PackageExport[];
}

export function createEmptyIndex(): ProjectIndex {
  return { files: new Map(), packages: [], packageSymbols: [] };
}

/** Exports conocidos de librerías populares para auto-importar al instante (React, Router, Tauri, Python, etc.) */
const KNOWN_PACKAGE_EXPORTS: Record<string, { defaults?: string[]; named?: string[] }> = {
  react: {
    defaults: ["React"],
    named: [
      "useState", "useEffect", "useContext", "useReducer", "useRef",
      "useMemo", "useCallback", "createContext", "Fragment", "memo", " forwardRef",
    ],
  },
  "react-dom/client": { named: ["createRoot", "hydrateRoot"] },
  "react-router": { named: ["BrowserRouter", "Routes", "Route", "Link", "NavLink", "Navigate", "Outlet", "useNavigate", "useParams", "useLocation"] },
  "react-router-dom": { named: ["BrowserRouter", "Routes", "Route", "Link", "NavLink", "Navigate", "Outlet", "useNavigate", "useParams", "useLocation"] },
};

export function buildPackageSymbols(packages: { name: string; ecosystem: "npm" | "cargo" | "pip" }[]): PackageExport[] {
  const out: PackageExport[] = [];
  for (const p of packages) {
    const known = KNOWN_PACKAGE_EXPORTS[p.name];
    if (known) {
      for (const d of known.defaults ?? []) {
        out.push({ symbol: d.trim(), pkg: p.name, isDefault: true, ecosystem: p.ecosystem });
      }
      for (const n of known.named ?? []) {
        out.push({ symbol: n.trim(), pkg: p.name, isDefault: false, ecosystem: p.ecosystem });
      }
    }

    // Genera también el identificador tanto en camelCase como en PascalCase (ej. "react" -> "React" y "react")
    const raw = p.name.split("/").pop()!.replace(/[^A-Za-z0-9_$]/g, "");
    if (raw) {
      const pascal = raw[0].toUpperCase() + raw.slice(1);
      if (!out.some((x) => x.symbol === pascal && x.pkg === p.name)) {
        out.push({ symbol: pascal, pkg: p.name, isDefault: true, ecosystem: p.ecosystem });
      }
      if (!out.some((x) => x.symbol === raw && x.pkg === p.name)) {
        out.push({ symbol: raw, pkg: p.name, isDefault: true, ecosystem: p.ecosystem });
      }
    }
  }
  return out;
}

const JS_KEYWORDS = new Set([
  "if", "for", "while", "switch", "catch", "function", "return", "constructor", "super",
]);

export function extractFileSymbols(filePath: string, content: string): ExportedSymbol[] {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  if (["ts", "tsx", "js", "jsx", "mjs", "cjs"].includes(ext)) return parseJsTs(filePath, content);
  if (ext === "py") return parsePython(filePath, content);
  if (ext === "rs") return parseRust(filePath, content);
  if (["c", "h", "cpp", "hpp", "cc"].includes(ext)) return parseCpp(filePath, content);
  return parseUniversalLanguage(filePath, content);
}

function parseJsTs(filePath: string, code: string): ExportedSymbol[] {
  const out: ExportedSymbol[] = [];
  const seen = new Set<string>();

  const defaultExportMatch = /export\s+default\s+(?:function\s+|class\s+)?([A-Za-z_$][\w$]*)/.exec(code);
  const defaultName = defaultExportMatch?.[1] ?? null;

  // 1. Clases (con o sin export)
  const classRegex = /(export\s+(?:default\s+)?)?class\s+([A-Za-z_$][\w$]*)[^{]*\{([\s\S]*?)^\}/gm;
  let m: RegExpExecArray | null;
  while ((m = classRegex.exec(code)) !== null) {
    const isDefault = Boolean(m[1]?.includes("default")) || m[2] === defaultName;
    const className = m[2];
    const body = m[3];
    const members: MemberSymbol[] = [];

    for (const rawLine of body.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("//") || line.startsWith("/*") || line.startsWith("*")) continue;
      if (/^(private|protected)\b/.test(line) || line.startsWith("#")) continue;

      const methodMatch = /^(?:public\s+)?(?:static\s+)?(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/.exec(line);
      if (methodMatch && !JS_KEYWORDS.has(methodMatch[1])) {
        members.push({ name: methodMatch[1], kind: "method", detail: `(${methodMatch[2].trim()})` });
        continue;
      }

      const propMatch = /^(?:public\s+)?(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*(?::|=)/.exec(line);
      if (propMatch && !JS_KEYWORDS.has(propMatch[1])) {
        members.push({ name: propMatch[1], kind: "property" });
      }
    }

    seen.add(className);
    out.push({ name: className, kind: "class", filePath, isDefault, members });
  }

  // 2. Funciones, componentes, Contexts, Reducers, constantes, interfaces y types
  const declRegex =
    /(?:^|\bexport\s+(?:default\s+)?)(?:async\s+)?(function|const|let|var|interface|type)\s+([A-Za-z_$][\w$]*)/gm;
  while ((m = declRegex.exec(code)) !== null) {
    const fullMatch = m[0];
    const kw = m[1];
    const name = m[2];
    if (seen.has(name) || name.startsWith("_")) continue;

    const isDefault = fullMatch.includes("default") || name === defaultName;
    const hasExport = fullMatch.includes("export") || isDefault || new RegExp(`export\\s*\\{[^}]*\\b${name}\\b`).test(code);
    if (!hasExport) continue;

    const kindMap: Record<string, SymbolKind> = {
      function: "function",
      const: "variable",
      let: "variable",
      var: "variable",
      interface: "interface",
      type: "type",
    };
    seen.add(name);
    out.push({
      name,
      kind: /^[A-Z]/.test(name) ? "class" : (kindMap[kw] ?? "variable"),
      filePath,
      isDefault,
      members: [],
    });
  }

  // 3. Siempre indexa el nombre propio del archivo (ej. AuthContext.jsx -> AuthContext, LoginRouter.jsx -> LoginRouter)
  const baseName = filePath
    .split(/[\\/]/)
    .pop()
    ?.replace(/\.(tsx?|jsx?|mjs|cjs)$/i, "") ?? "";

  if (baseName && baseName !== "index" && /^[A-Za-z_$][\w$]*$/.test(baseName) && !seen.has(baseName)) {
    out.push({
      name: baseName,
      kind: "module",
      filePath,
      isDefault: defaultName !== null || !/export\s+(const|function|class)\b/.test(code),
      members: [],
    });
  }

  return out;
}

function parsePython(filePath: string, code: string): ExportedSymbol[] {
  const out: ExportedSymbol[] = [];
  const seen = new Set<string>();
  const lines = code.split(/\r?\n/);
  let currentClass: ExportedSymbol | null = null;

  for (const raw of lines) {
    const classMatch = /^class\s+([A-Za-z_]\w*)/.exec(raw);
    if (classMatch) {
      const name = classMatch[1];
      if (!name.startsWith("_")) {
        currentClass = { name, kind: "class", filePath, members: [] };
        seen.add(name);
        out.push(currentClass);
      } else {
        currentClass = null;
      }
      continue;
    }

    const topFnMatch = /^def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/.exec(raw);
    if (topFnMatch) {
      currentClass = null;
      const fnName = topFnMatch[1];
      if (!fnName.startsWith("_")) {
        seen.add(fnName);
        out.push({ name: fnName, kind: "function", filePath, members: [] });
      }
      continue;
    }

    if (/^\S/.test(raw) && !raw.startsWith("#")) {
      currentClass = null;
      const varMatch = /^([A-Za-z][A-Za-z0-9_]*)\s*=/.exec(raw);
      if (varMatch && !varMatch[1].startsWith("_")) {
        seen.add(varMatch[1]);
        out.push({ name: varMatch[1], kind: "variable", filePath, members: [] });
      }
      continue;
    }

    if (currentClass) {
      const methodMatch = /^\s+def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/.exec(raw);
      if (methodMatch) {
        const mName = methodMatch[1];
        if (!mName.startsWith("_")) {
          const params = methodMatch[2]
            .split(",")
            .map((p) => p.trim())
            .filter((p) => p && p !== "self" && p !== "cls")
            .join(", ");
          currentClass.members.push({ name: mName, kind: "method", detail: `(${params})` });
        }
        continue;
      }
      const attrMatch = /^\s+self\.([A-Za-z][A-Za-z0-9_]*)\s*=/.exec(raw);
      if (attrMatch && !attrMatch[1].startsWith("_")) {
        if (!currentClass.members.some((m) => m.name === attrMatch[1])) {
          currentClass.members.push({ name: attrMatch[1], kind: "property" });
        }
      }
    }
  }

  const baseName = filePath.split(/[\\/]/).pop()?.replace(/\.py$/i, "") ?? "";
  if (baseName && baseName !== "__init__" && !seen.has(baseName)) {
    out.push({ name: baseName, kind: "module", filePath, isDefault: true, members: [] });
  }

  return out;
}

function parseRust(filePath: string, code: string): ExportedSymbol[] {
  const out: ExportedSymbol[] = [];
  const structs = new Map<string, ExportedSymbol>();
  let m: RegExpExecArray | null;

  const structRegex = /pub\s+struct\s+([A-Za-z_]\w*)\s*\{([\s\S]*?)\}/g;
  while ((m = structRegex.exec(code)) !== null) {
    const name = m[1];
    const body = m[2];
    const members: MemberSymbol[] = [];
    const fieldRegex = /pub\s+([A-Za-z_]\w*)\s*:/g;
    let fm: RegExpExecArray | null;
    while ((fm = fieldRegex.exec(body)) !== null) {
      members.push({ name: fm[1], kind: "property" });
    }
    const sym: ExportedSymbol = { name, kind: "class", filePath, members };
    structs.set(name, sym);
    out.push(sym);
  }

  const implRegex = /impl(?:\s*<[^>]*>)?\s+([A-Za-z_]\w*)\s*\{([\s\S]*?)^\}/gm;
  while ((m = implRegex.exec(code)) !== null) {
    const target = structs.get(m[1]);
    if (!target) continue;
    const fnRegex = /pub\s+(?:async\s+)?fn\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/g;
    let fm: RegExpExecArray | null;
    while ((fm = fnRegex.exec(m[2])) !== null) {
      target.members.push({ name: fm[1], kind: "method", detail: `(${fm[2].trim()})` });
    }
  }

  const pubFnRegex = /^pub\s+(?:async\s+)?fn\s+([A-Za-z_]\w*)/gm;
  while ((m = pubFnRegex.exec(code)) !== null) {
    out.push({ name: m[1], kind: "function", filePath, members: [] });
  }

  return out;
}

function parseCpp(filePath: string, code: string): ExportedSymbol[] {
  const out: ExportedSymbol[] = [];
  let m: RegExpExecArray | null;
  const classRegex = /\b(?:class|struct)\s+([A-Za-z_]\w*)\s*\{([\s\S]*?)\};/g;
  while ((m = classRegex.exec(code)) !== null) {
    out.push({ name: m[1], kind: "class", filePath, members: [] });
  }
  const fnRegex = /^(?:[A-Za-z_][\w:<>*&\s]+)\s+([A-Za-z_]\w*)\s*\([^;]*\)\s*\{/gm;
  while ((m = fnRegex.exec(code)) !== null) {
    if (m[1] !== "if" && m[1] !== "while" && m[1] !== "for" && m[1] !== "switch") {
      out.push({ name: m[1], kind: "function", filePath, members: [] });
    }
  }
  return out;
}

export function buildAutoImportStatement(
  activeFile: string,
  targetFileOrPkg: string,
  symbolName: string,
  isPackage: boolean,
  isDefault = false,
): string | null {
  const ext = activeFile.split(".").pop()?.toLowerCase() ?? "";

  if (["ts", "tsx", "js", "jsx", "mjs", "cjs"].includes(ext)) {
    const spec = isPackage ? targetFileOrPkg : relativeModulePath(activeFile, targetFileOrPkg);
    return isDefault
      ? `import ${symbolName} from "${spec}";\n`
      : `import { ${symbolName} } from "${spec}";\n`;
  }

  if (ext === "py") {
    if (isPackage) return `import ${targetFileOrPkg}\n`;
    const rel = relativeModulePath(activeFile, targetFileOrPkg)
      .replace(/^\.\//, "")
      .replace(/\//g, ".");
    return rel ? `from ${rel} import ${symbolName}\n` : null;
  }

  if (ext === "rs") {
    if (isPackage) return `use ${targetFileOrPkg.replace(/-/g, "_")}::*;\n`;
    const modName = targetFileOrPkg.split(/[\\/]/).pop()?.replace(/\.rs$/i, "") ?? "";
    return modName && modName !== "main" && modName !== "lib"
      ? `use crate::${modName}::${symbolName};\n`
      : null;
  }

  if (["c", "h", "cpp", "hpp", "cc"].includes(ext) && !isPackage) {
    const rel = relativeModulePath(activeFile, targetFileOrPkg).replace(/^\.\//, "");
    return `#include "${rel}"\n`;
  }

  if (["java", "kt", "kts"].includes(ext)) {
    const pkgPath = relativeModulePath(activeFile, targetFileOrPkg)
      .replace(/^\.+[\\/]?/, "")
      .replace(/\//g, ".");
    return `import ${pkgPath || symbolName};\n`;
  }

  if (ext === "cs") return `using ${symbolName};\n`;
  
  if (ext === "go") {
    const rel = relativeModulePath(activeFile, targetFileOrPkg);
    return `import "${rel}"\n`;
  }
  if (ext === "php") {
    const rel = relativeModulePath(activeFile, targetFileOrPkg);
    return `require_once '${rel}.php';\n`;
  }
  if (ext === "dart") {
    const rel = relativeModulePath(activeFile, targetFileOrPkg);
    return `import '${rel}.dart';\n`;
  }
  if (ext === "rb") {
    const rel = relativeModulePath(activeFile, targetFileOrPkg);
    return `require_relative '${rel}'\n`;
  }

  return null;
}

export function relativeModulePath(fromFile: string, toFile: string): string {
  const fromParts = fromFile.replace(/\\/g, "/").split("/").slice(0, -1);
  const toParts = toFile
    .replace(/\\/g, "/")
    .replace(/\.(tsx?|jsx?|mjs|cjs|py|rs)$/i, "")
    .split("/");

  let common = 0;
  while (common < fromParts.length && common < toParts.length && fromParts[common] === toParts[common]) {
    common++;
  }
  const up = fromParts.length - common;
  const rel = [...Array(up).fill(".."), ...toParts.slice(common)].join("/");
  return rel.startsWith(".") ? rel : `./${rel}`;
}

/**
 * Parser universal para Java, C#, Go, PHP, Kotlin, Swift, Dart, Ruby, etc.
 * Respeta visibilidad pública/privada (`private`, `protected`, `_nombre` o minúscula inicial en Go).
 */
function parseUniversalLanguage(filePath: string, code: string): ExportedSymbol[] {
  const out: ExportedSymbol[] = [];
  const seen = new Set<string>();
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";

  // Clases, interfaces, structs, traits (Java, C#, PHP, Kotlin, Swift, Dart, Go, Ruby)
  const classRegex =
    /(?:public\s+|export\s+|open\s+)?(?:class|interface|struct|trait|enum)\s+([A-Za-z_]\w*)[^{;]*\{?([\s\S]*?)(?:^\}|\bend\b)/gm;
  let m: RegExpExecArray | null;

  while ((m = classRegex.exec(code)) !== null) {
    const className = m[1];
    const body = m[2] ?? "";
    if (ext === "go" && /^[a-z]/.test(className)) continue; // En Go, minúscula inicial = privado

    const members: MemberSymbol[] = [];
    for (const raw of body.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("//") || line.startsWith("#")) continue;
      if (/\b(private|protected|internal)\b/.test(line)) continue;

      const fnMatch =
        /(?:public\s+|func\s+|fun\s+|def\s+|void\s+|int\s+|string\s+|String\s+|bool\s+|boolean\s+)([A-Za-z_]\w*)\s*\(([^)]*)\)/.exec(
          line,
        );
      if (fnMatch && !fnMatch[1].startsWith("_")) {
        if (ext === "go" && /^[a-z]/.test(fnMatch[1])) continue;
        members.push({ name: fnMatch[1], kind: "method", detail: `(${fnMatch[2].trim()})` });
      }
    }

    seen.add(className);
    out.push({ name: className, kind: "class", filePath, members });
  }

  // Funciones públicas sueltas (Go `func Nombre`, Kotlin `fun`, PHP `function`, Swift `func`, Ruby `def`)
  const fnRegex = /^(?:pub\s+|public\s+)?(?:func|fun|function|def)\s+([A-Za-z_]\w*)\s*\(/gm;
  while ((m = fnRegex.exec(code)) !== null) {
    const fnName = m[1];
    if (seen.has(fnName) || fnName.startsWith("_")) continue;
    if (ext === "go" && /^[a-z]/.test(fnName)) continue;
    seen.add(fnName);
    out.push({ name: fnName, kind: "function", filePath, members: [] });
  }

  // Nombre del archivo como módulo/clase importable
  const baseName = filePath.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") ?? "";
  if (baseName && /^[A-Za-z_]\w*$/.test(baseName) && !seen.has(baseName)) {
    out.push({ name: baseName, kind: "module", filePath, isDefault: true, members: [] });
  }

  return out;
}