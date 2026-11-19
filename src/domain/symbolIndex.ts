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
  packageName?: string;
  members: MemberSymbol[];
}

export interface PackageExport {
  symbol: string;
  pkg: string;
  isDefault: boolean;
  ecosystem: "npm" | "cargo" | "pip";
  kind?: SymbolKind;
}

export interface ProjectIndex {
  files: Map<string, ExportedSymbol[]>;
  packages: { name: string; ecosystem: "npm" | "cargo" | "pip" }[];
  packageSymbols: PackageExport[];
}

export function createEmptyIndex(): ProjectIndex {
  return { files: new Map(), packages: [], packageSymbols: [] };
}

/** Exports conocidos de librerias populares para auto-importar al instante. */
const KNOWN_PACKAGE_EXPORTS: Record<string, { defaults?: string[]; named?: string[] }> = {
  react: {
    defaults: ["React"],
    named: [
      "useState", "useEffect", "useContext", "useReducer", "useRef",
      "useMemo", "useCallback", "useLayoutEffect", "useId", "useTransition",
      "useDeferredValue", "useImperativeHandle", "createContext", "createRef",
      "Fragment", "StrictMode", "Suspense", "memo", "forwardRef", "lazy",
    ],
  },
  "react-dom": { defaults: ["ReactDOM"], named: ["createPortal", "flushSync"] },
  "react-dom/client": { named: ["createRoot", "hydrateRoot"] },
  "react-router": {
    named: [
      "BrowserRouter", "Routes", "Route", "Link", "NavLink", "Navigate",
      "Outlet", "useNavigate", "useParams", "useLocation", "useSearchParams",
    ],
  },
  "react-router-dom": {
    named: [
      "BrowserRouter", "Routes", "Route", "Link", "NavLink", "Navigate",
      "Outlet", "useNavigate", "useParams", "useLocation", "useSearchParams",
    ],
  },
  axios: { defaults: ["axios"] },
  zustand: { named: ["create"] },
  "@reduxjs/toolkit": { named: ["configureStore", "createSlice", "createAsyncThunk"] },
  "react-redux": { named: ["Provider", "useSelector", "useDispatch"] },
  clsx: { defaults: ["clsx"], named: ["clsx"] },
  "tailwind-merge": { named: ["twMerge"] },
  vue: {
    named: [
      "ref", "reactive", "computed", "watch", "watchEffect",
      "onMounted", "onUnmounted", "defineComponent", "defineProps", "defineEmits",
    ],
  },
  svelte: { named: ["onMount", "onDestroy", "tick", "createEventDispatcher"] },
  "@tauri-apps/api/core": { named: ["invoke"] },
  "@tauri-apps/api/event": { named: ["listen", "emit"] },
};

const KNOWN_PIP_MODULES: Record<string, string[]> = {
  fastapi: ["FastAPI", "APIRouter", "Depends", "HTTPException", "Query", "Path", "Body"],
  pydantic: ["BaseModel", "Field", "validator"],
  flask: ["Flask", "Blueprint", "request", "jsonify", "render_template"],
  typing: ["List", "Dict", "Set", "Tuple", "Optional", "Union", "Any", "Callable"],
  pathlib: ["Path"],
  datetime: ["datetime", "date", "timedelta"],
  collections: ["defaultdict", "Counter", "deque", "namedtuple"],
};

export function buildPackageSymbols(
  packages: { name: string; ecosystem: "npm" | "cargo" | "pip" }[],
  discoveredExports?: PackageExport[],
): PackageExport[] {
  const out: PackageExport[] = [...(discoveredExports ?? [])];
  const seen = new Set(out.map((e) => `${e.ecosystem}:${e.pkg}:${e.symbol}:${e.isDefault}`));

  const pushUnique = (entry: PackageExport) => {
    const k = `${entry.ecosystem}:${entry.pkg}:${entry.symbol}:${entry.isDefault}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(entry);
  };

  for (const p of packages) {
    const known = KNOWN_PACKAGE_EXPORTS[p.name];
    if (known) {
      for (const d of known.defaults ?? []) {
        pushUnique({ symbol: d.trim(), pkg: p.name, isDefault: true, ecosystem: p.ecosystem, kind: "module" });
      }
      for (const n of known.named ?? []) {
        pushUnique({
          symbol: n.trim(),
          pkg: p.name,
          isDefault: false,
          ecosystem: p.ecosystem,
          kind: /^[A-Z]/.test(n.trim()) ? "class" : "function",
        });
      }
    }

    if (p.name === "react-dom") {
      for (const n of KNOWN_PACKAGE_EXPORTS["react-dom/client"].named ?? []) {
        pushUnique({ symbol: n, pkg: "react-dom/client", isDefault: false, ecosystem: "npm", kind: "function" });
      }
    }

    if (p.ecosystem === "pip") {
      const pipSyms = KNOWN_PIP_MODULES[p.name.toLowerCase()];
      if (pipSyms) {
        for (const s of pipSyms) {
          pushUnique({ symbol: s, pkg: p.name, isDefault: false, ecosystem: "pip", kind: "class" });
        }
      }
    }

    const raw = p.name.split("/").pop()?.replace(/[^A-Za-z0-9_$]/g, "") ?? "";
    if (raw) {
      const pascal = raw[0].toUpperCase() + raw.slice(1);
      pushUnique({ symbol: pascal, pkg: p.name, isDefault: true, ecosystem: p.ecosystem, kind: "module" });
      pushUnique({ symbol: raw, pkg: p.name, isDefault: true, ecosystem: p.ecosystem, kind: "module" });
    }
  }

  return out;
}

/**
 * Elimina comentarios manteniendo cadenas de texto y saltos de linea para que los
 * indices y regex de declaraciones/imports no generen falsos positivos.
 */
export function stripComments(code: string, style: "c" | "hash" | "both" = "c"): string {
  const allowSlash = style === "c" || style === "both";
  const allowHash = style === "hash" || style === "both";
  let out = "";
  let i = 0;

  while (i < code.length) {
    const ch = code[i];
    const next = code[i + 1];

    // Cadenas con comillas simples, dobles o backticks
    if (ch === "'" || ch === '"' || ch === "`") {
      const quote = ch;
      out += ch;
      i++;
      while (i < code.length) {
        const c = code[i];
        out += c;
        i++;
        if (c === "\\" && i < code.length) {
          out += code[i];
          i++;
          continue;
        }
        if (c === quote) break;
      }
      continue;
    }

    if (allowSlash && ch === "/" && next === "/") {
      while (i < code.length && code[i] !== "\n") {
        out += " ";
        i++;
      }
      continue;
    }

    if (allowSlash && ch === "/" && next === "*") {
      out += "  ";
      i += 2;
      while (i < code.length) {
        if (code[i] === "*" && code[i + 1] === "/") {
          out += "  ";
          i += 2;
          break;
        }
        out += code[i] === "\n" ? "\n" : " ";
        i++;
      }
      continue;
    }

    if (allowHash && ch === "#") {
      while (i < code.length && code[i] !== "\n") {
        out += " ";
        i++;
      }
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

const JS_KEYWORDS = new Set([
  "if", "for", "while", "switch", "catch", "function", "return", "constructor", "super",
  "async", "default", "export", "import", "from", "class", "extends", "new",
]);

function extractBraceBlock(code: string, openBraceIdx: number): string {
  let depth = 0;
  for (let i = openBraceIdx; i < code.length; i++) {
    const ch = code[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return code.slice(openBraceIdx + 1, i);
    }
  }
  return code.slice(openBraceIdx + 1);
}

export function extractFileSymbols(filePath: string, content: string): ExportedSymbol[] {
  try {
    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
    if (["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"].includes(ext)) {
      return parseJsTs(filePath, content);
    }
    if (ext === "py" || ext === "pyw") return parsePython(filePath, content);
    if (ext === "rs") return parseRust(filePath, content);
    if (["c", "h", "cpp", "hpp", "cc", "cxx"].includes(ext)) return parseCpp(filePath, content);
    return parseUniversalLanguage(filePath, content);
  } catch {
    return [];
  }
}

function parseJsTs(filePath: string, rawCode: string): ExportedSymbol[] {
  const code = stripComments(rawCode, "c");
  const out: ExportedSymbol[] = [];
  const seen = new Set<string>();

  const defaultDeclMatch =
    /\bexport\s+default\s+(?:async\s+)?(?:function\*?\s+|(?:abstract\s+)?class\s+)?([A-Za-z_$][\w$]*)/.exec(code);
  const rawDefault = defaultDeclMatch?.[1] ?? null;
  const defaultName = rawDefault && !JS_KEYWORDS.has(rawDefault) ? rawDefault : null;

  // Recopila identificadores re-exportados explicitamente: `export { A, B as C }` y `export { X } from '...'`
  const namedExports = new Set<string>();
  const localAliasedDecls = new Map<string, SymbolKind>();
  const exportBlockRegex = /\bexport\s+(?:type\s+)?\{([^}]+)\}(?:\s*from\s*['"][^'"]+['"])?/g;
  let m: RegExpExecArray | null;
  while ((m = exportBlockRegex.exec(code)) !== null) {
    const isReexportFrom = /from\s*['"][^'"]+['"]\s*$/.test(m[0]);
    for (const part of m[1].split(",")) {
      const cleaned = part.trim().replace(/^type\s+/, "");
      if (!cleaned) continue;
      const asMatch = /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/.exec(cleaned);
      if (asMatch) {
        if (asMatch[2] !== "default") {
          namedExports.add(asMatch[2]);
          if (isReexportFrom) localAliasedDecls.set(asMatch[2], /^[A-Z]/.test(asMatch[2]) ? "class" : "function");
        }
        namedExports.add(asMatch[1]);
      } else if (/^[A-Za-z_$][\w$]*$/.test(cleaned)) {
        namedExports.add(cleaned);
        if (isReexportFrom) localAliasedDecls.set(cleaned, /^[A-Z]/.test(cleaned) ? "class" : "function");
      }
    }
  }

  // 1. Clases (con conteo real de llaves)
  const classHeaderRegex = /\b(export\s+(?:default\s+)?)?(?:abstract\s+|declare\s+)*class\s+([A-Za-z_$][\w$]*)[^{]*\{/g;
  while ((m = classHeaderRegex.exec(code)) !== null) {
    const className = m[2];
    const openIdx = m.index + m[0].length - 1;
    const body = extractBraceBlock(code, openIdx);
    const isDefault = Boolean(m[1]?.includes("default")) || className === defaultName;
    const isExported = Boolean(m[1]) || isDefault || namedExports.has(className);
    if (!isExported) continue;

    const members: MemberSymbol[] = [];
    for (const rawLine of body.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || /^(private|protected)\b/.test(line) || line.startsWith("#")) continue;

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

    if (!seen.has(className)) {
      seen.add(className);
      out.push({ name: className, kind: "class", filePath, isDefault, members });
    }
  }

  // 2. Funciones, componentes, constantes, variables, interfaces, types, enums
  const declRegex =
    /(^[ \t]*|\bexport\s+(?:default\s+)?)(?:declare\s+)?(?:async\s+)?(function\*?|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm;
  while ((m = declRegex.exec(code)) !== null) {
    const prefix = m[1];
    const kw = m[2].replace("*", "");
    const name = m[3];
    if (seen.has(name) || name.startsWith("_") || JS_KEYWORDS.has(name)) continue;

    const isDefault = prefix.includes("default") || name === defaultName;
    const hasExport = prefix.includes("export") || isDefault || namedExports.has(name);
    if (!hasExport) continue;

    const kindMap: Record<string, SymbolKind> = {
      function: "function",
      const: "variable",
      let: "variable",
      var: "variable",
      interface: "interface",
      type: "type",
      enum: "type",
    };
    seen.add(name);
    out.push({
      name,
      kind: /^[A-Z]/.test(name) && (kw === "function" || kw === "const") ? "function" : (kindMap[kw] ?? "variable"),
      filePath,
      isDefault,
      members: [],
    });
  }

  // 3. Declaraciones desestructuradas exportadas: `export const { a, b } = ...`
  const destructExport = /\bexport\s+(?:const|let|var)\s+\{([^}]+)\}\s*=/g;
  while ((m = destructExport.exec(code)) !== null) {
    for (const part of m[1].split(",")) {
      const id = part.trim().split(/[:=]/).pop()?.trim() ?? "";
      if (/^[A-Za-z_$][\w$]*$/.test(id) && !seen.has(id) && !id.startsWith("_")) {
        seen.add(id);
        out.push({ name: id, kind: "variable", filePath, isDefault: false, members: [] });
      }
    }
  }

  // 4. Barrel re-exports (`export { X } from './Y'`)
  for (const [name, kind] of localAliasedDecls) {
    if (!seen.has(name)) {
      seen.add(name);
      out.push({ name, kind, filePath, isDefault: false, members: [] });
    }
  }

  // 5. CommonJS (`exports.X = ...`, `module.exports = { X, Y }`)
  const cjsProp = /\b(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=/g;
  while ((m = cjsProp.exec(code)) !== null) {
    const name = m[1];
    if (!seen.has(name) && !name.startsWith("_")) {
      seen.add(name);
      out.push({ name, kind: /^[A-Z]/.test(name) ? "function" : "variable", filePath, isDefault: false, members: [] });
    }
  }
  const cjsObj = /\bmodule\.exports\s*=\s*\{([^}]+)\}/g;
  while ((m = cjsObj.exec(code)) !== null) {
    for (const part of m[1].split(",")) {
      const id = part.trim().split(":")[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(id) && !seen.has(id)) {
        seen.add(id);
        out.push({ name: id, kind: "variable", filePath, isDefault: false, members: [] });
      }
    }
  }

  // 6. Nombre propio del archivo (ej. `App.js` -> `export default function App`)
  const baseName = filePath
    .split(/[\\/]/)
    .pop()
    ?.replace(/\.(tsx?|jsx?|mjs|cjs|mts|cts)$/i, "") ?? "";

  if (baseName && baseName !== "index" && /^[A-Za-z_$][\w$]*$/.test(baseName) && !seen.has(baseName) && !defaultName) {
    const hasDefaultExport = /\bexport\s+default\b/.test(code);
    const hasNamedOnly = /\bexport\s+(?:async\s+)?(?:const|let|var|function|class|interface|type|enum)\b/.test(code);
    if (hasDefaultExport || !hasNamedOnly) {
      out.push({
        name: baseName,
        kind: /^[A-Z]/.test(baseName) ? "class" : "module",
        filePath,
        isDefault: hasDefaultExport || !hasNamedOnly,
        members: [],
      });
    }
  }

  return out;
}

function parsePython(filePath: string, rawCode: string): ExportedSymbol[] {
  const code = stripComments(rawCode, "hash");
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

    const topFnMatch = /^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/.exec(raw);
    if (topFnMatch) {
      currentClass = null;
      const fnName = topFnMatch[1];
      if (!fnName.startsWith("_")) {
        seen.add(fnName);
        out.push({ name: fnName, kind: "function", filePath, members: [] });
      }
      continue;
    }

    if (/^\S/.test(raw) && raw.trim()) {
      currentClass = null;
      const varMatch = /^([A-Za-z][A-Za-z0-9_]*)\s*(?::[^=]+)?=/.exec(raw);
      if (varMatch && !varMatch[1].startsWith("_")) {
        seen.add(varMatch[1]);
        out.push({ name: varMatch[1], kind: "variable", filePath, members: [] });
      }
      continue;
    }

    if (currentClass) {
      const methodMatch = /^\s+(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/.exec(raw);
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
      const attrMatch = /^\s+self\.([A-Za-z][A-Za-z0-9_]*)\s*(?::[^=]+)?=/.exec(raw);
      if (attrMatch && !attrMatch[1].startsWith("_")) {
        if (!currentClass.members.some((m) => m.name === attrMatch[1])) {
          currentClass.members.push({ name: attrMatch[1], kind: "property" });
        }
      }
    }
  }

  const baseName = filePath.split(/[\\/]/).pop()?.replace(/\.pyw?$/i, "") ?? "";
  if (baseName && baseName !== "__init__" && !seen.has(baseName)) {
    out.push({ name: baseName, kind: "module", filePath, isDefault: true, members: [] });
  }

  return out;
}

function parseRust(filePath: string, rawCode: string): ExportedSymbol[] {
  const code = stripComments(rawCode, "c");
  const out: ExportedSymbol[] = [];
  const structs = new Map<string, ExportedSymbol>();
  let m: RegExpExecArray | null;

  const structRegex = /pub\s+(?:struct|enum|trait)\s+([A-Za-z_]\w*)\s*(?:<[^>]*>)?\s*\{/g;
  while ((m = structRegex.exec(code)) !== null) {
    const name = m[1];
    const body = extractBraceBlock(code, m.index + m[0].length - 1);
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

  const implRegex = /impl(?:\s*<[^>]*>)?\s+([A-Za-z_]\w*)\s*\{/g;
  while ((m = implRegex.exec(code)) !== null) {
    const target = structs.get(m[1]);
    if (!target) continue;
    const body = extractBraceBlock(code, m.index + m[0].length - 1);
    const fnRegex = /pub\s+(?:async\s+)?fn\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/g;
    let fm: RegExpExecArray | null;
    while ((fm = fnRegex.exec(body)) !== null) {
      target.members.push({ name: fm[1], kind: "method", detail: `(${fm[2].trim()})` });
    }
  }

  const pubFnRegex = /\bpub\s+(?:async\s+)?fn\s+([A-Za-z_]\w*)/g;
  while ((m = pubFnRegex.exec(code)) !== null) {
    if (!structs.has(m[1])) {
      out.push({ name: m[1], kind: "function", filePath, members: [] });
    }
  }

  const pubConstRegex = /\bpub\s+(?:const|static|type)\s+([A-Za-z_]\w*)/g;
  while ((m = pubConstRegex.exec(code)) !== null) {
    out.push({ name: m[1], kind: "variable", filePath, members: [] });
  }

  return out;
}

function parseCpp(filePath: string, rawCode: string): ExportedSymbol[] {
  const code = stripComments(rawCode, "c");
  const out: ExportedSymbol[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;

  const classRegex = /\b(?:class|struct)\s+([A-Za-z_]\w*)\s*(?::[^{]*)?\{/g;
  while ((m = classRegex.exec(code)) !== null) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      out.push({ name: m[1], kind: "class", filePath, members: [] });
    }
  }

  const fnRegex = /^[ \t]*(?:[A-Za-z_][\w:<>*&\s]+)\s+([A-Za-z_]\w*)\s*\([^;]*\)\s*(?:\{|;)/gm;
  while ((m = fnRegex.exec(code)) !== null) {
    const name = m[1];
    if (!seen.has(name) && !["if", "while", "for", "switch", "return", "catch"].includes(name)) {
      seen.add(name);
      out.push({ name, kind: "function", filePath, members: [] });
    }
  }
  return out;
}

export interface AutoImportOptions {
  quote?: "'" | '"';
  semi?: boolean;
  packageName?: string;
}

export function buildAutoImportStatement(
  activeFile: string,
  targetFileOrPkg: string,
  symbolName: string,
  isPackage: boolean,
  isDefault = false,
  opts: AutoImportOptions = {},
): string | null {
  const ext = activeFile.split(".").pop()?.toLowerCase() ?? "";
  const q = opts.quote ?? "'";
  const semi = opts.semi === false ? "" : ";";

  if (["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"].includes(ext)) {
    const spec = isPackage ? targetFileOrPkg : relativeModulePath(activeFile, targetFileOrPkg);
    return isDefault
      ? `import ${symbolName} from ${q}${spec}${q}${semi}\n`
      : `import { ${symbolName} } from ${q}${spec}${q}${semi}\n`;
  }

  if (ext === "py" || ext === "pyw") {
    if (isPackage) {
      return isDefault
        ? `import ${targetFileOrPkg}\n`
        : `from ${targetFileOrPkg} import ${symbolName}\n`;
    }
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

  if (["c", "h", "cpp", "hpp", "cc", "cxx"].includes(ext) && !isPackage) {
    const rel = relativeModulePath(activeFile, targetFileOrPkg).replace(/^\.\//, "");
    return `#include "${rel}"\n`;
  }

  if (["java", "kt", "kts"].includes(ext)) {
    const fqn = opts.packageName ? `${opts.packageName}.${symbolName}` : symbolName;
    const kotlinSemi = ext === "java" ? ";" : "";
    return `import ${fqn}${kotlinSemi}\n`;
  }

  if (ext === "cs") {
    const ns = opts.packageName ?? symbolName;
    return `using ${ns};\n`;
  }

  if (ext === "go") {
    const rel = relativeModulePath(activeFile, targetFileOrPkg);
    return `import "${rel}"\n`;
  }

  if (ext === "php") {
    if (opts.packageName) return `use ${opts.packageName}\\${symbolName};\n`;
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
    .replace(/\.(tsx?|mts|cts|jsx?|mjs|cjs|pyw?|rs|php|dart|rb)$/i, "")
    .replace(/\/index$/i, "")
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
 * Parser universal para Java, C#, Go, PHP, Kotlin, Swift, Dart, Ruby, Lua, etc.
 * Respeta visibilidad publica/privada y captura `package`/`namespace` para auto-import real.
 */
function parseUniversalLanguage(filePath: string, rawCode: string): ExportedSymbol[] {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const commentStyle = ["rb", "sh", "bash", "zsh", "ps1"].includes(ext) ? "hash" : "both";
  const code = stripComments(rawCode, commentStyle);
  const out: ExportedSymbol[] = [];
  const seen = new Set<string>();

  const pkgMatch = /^\s*(?:package|namespace)\s+([A-Za-z_][\w.\\]*)/m.exec(code);
  const packageName = pkgMatch?.[1];

  const classRegex =
    /(?:public\s+|export\s+|open\s+|final\s+|abstract\s+)?(?:class|interface|struct|trait|enum|mixin|object)\s+([A-Za-z_]\w*)[^{;]*\{?/gm;
  let m: RegExpExecArray | null;

  while ((m = classRegex.exec(code)) !== null) {
    const className = m[1];
    if (ext === "go" && /^[a-z]/.test(className)) continue;

    const openBrace = code.indexOf("{", m.index + m[0].length - 1);
    const body = openBrace !== -1 && openBrace - (m.index + m[0].length) < 120
      ? extractBraceBlock(code, openBrace)
      : "";

    const members: MemberSymbol[] = [];
    for (const raw of body.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      if (/\b(private|protected|internal)\b/.test(line)) continue;

      const fnMatch =
        /(?:public\s+|func\s+|fun\s+|def\s+|void\s+|int\s+|string\s+|String\s+|bool\s+|boolean\s+|Future<[^>]+>\s+)([A-Za-z_]\w*)\s*\(([^)]*)\)/.exec(
          line,
        );
      if (fnMatch && !fnMatch[1].startsWith("_")) {
        if (ext === "go" && /^[a-z]/.test(fnMatch[1])) continue;
        members.push({ name: fnMatch[1], kind: "method", detail: `(${fnMatch[2].trim()})` });
      }
    }

    if (!seen.has(className)) {
      seen.add(className);
      out.push({ name: className, kind: "class", filePath, packageName, members });
    }
  }

  const fnRegex = /^[ \t]*(?:pub\s+|public\s+|export\s+)?(?:async\s+)?(?:func|fun|function|def)\s+([A-Za-z_]\w*)\s*\(/gm;
  while ((m = fnRegex.exec(code)) !== null) {
    const fnName = m[1];
    if (seen.has(fnName) || fnName.startsWith("_")) continue;
    if (ext === "go" && /^[a-z]/.test(fnName)) continue;
    seen.add(fnName);
    out.push({ name: fnName, kind: "function", filePath, packageName, members: [] });
  }

  const baseName = filePath.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") ?? "";
  if (baseName && /^[A-Za-z_]\w*$/.test(baseName) && !seen.has(baseName)) {
    out.push({ name: baseName, kind: "module", filePath, isDefault: true, packageName, members: [] });
  }

  return out;
}
