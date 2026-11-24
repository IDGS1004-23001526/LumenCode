import type { IconSpec, IconThemeManifest } from "../domain/types";
import { sanitizeCssColor, sanitizeSvgFragment } from "../presentation/icons";

const CUSTOM_ICON_THEMES_KEY = "lumen.customIconThemes.v1";

const DEFAULT_VARS: Record<string, string> = {
  "--icon-folder": "#6B8CAE",
  "--icon-folder-src": "#5D9CEC",
  "--icon-folder-components": "#2DD4BF",
  "--icon-folder-routes": "#34D399",
  "--icon-folder-utils": "#F59E0B",
  "--icon-folder-context": "#A78BFA",
  "--icon-folder-pages": "#818CF8",
  "--icon-folder-api": "#14B8A6",
  "--icon-folder-styles": "#F472B6",
  "--icon-folder-assets": "#4ADE80",
  "--icon-folder-tests": "#FB923C",
  "--icon-folder-git": "#F05032",
  "--icon-folder-muted": "#7A869A",
};

const BASE_FILE_EXTENSIONS: Record<string, IconSpec> = {
  // Web / JS / TS / React
  ts: { color: "#3178C6", badge: "TS" },
  mts: { color: "#3178C6", badge: "TS" },
  cts: { color: "#3178C6", badge: "TS" },
  tsx: { color: "#38BDF8", badge: "⚛" },
  js: { color: "#F7DF1E", badge: "JS" },
  mjs: { color: "#F7DF1E", badge: "JS" },
  cjs: { color: "#F7DF1E", badge: "JS" },
  jsx: { color: "#61DAFB", badge: "⚛" },
  html: { color: "#E34F26", badge: "<>" },
  htm: { color: "#E34F26", badge: "<>" },
  vue: { color: "#42B883", badge: "V" },
  svelte: { color: "#FF3E00", badge: "S" },
  astro: { color: "#FF5D01", badge: "A" },
  css: { color: "#38BDF8", badge: "#" },
  scss: { color: "#CD6799", badge: "S#" },
  less: { color: "#2B5B84", badge: "L#" },
  json: { color: "#FBBF24", badge: "{}" },
  jsonc: { color: "#FBBF24", badge: "{}" },

  // Backend & Sistemas
  rs: { color: "#DEA584", badge: "RS" },
  py: { color: "#3776AB", badge: "PY" },
  pyw: { color: "#3776AB", badge: "PY" },
  cs: { color: "#9B4F96", badge: "C#" },
  csproj: { color: "#9B4F96", badge: "CS" },
  sln: { color: "#9B4F96", badge: "SL" },
  go: { color: "#00ADD8", badge: "GO" },
  java: { color: "#ED8B00", badge: "JV" },
  kt: { color: "#A97BFF", badge: "KT" },
  kts: { color: "#A97BFF", badge: "KT" },
  dart: { color: "#0175C2", badge: "DA" },
  swift: { color: "#F05138", badge: "SW" },
  php: { color: "#777BB4", badge: "PHP" },
  rb: { color: "#CC342D", badge: "RB" },
  lua: { color: "#3B82F6", badge: "LU" },
  c: { color: "#60A5FA", badge: "C" },
  h: { color: "#A78BFA", badge: "H" },
  cpp: { color: "#3B82F6", badge: "C+" },
  hpp: { color: "#A78BFA", badge: "H+" },
  cc: { color: "#3B82F6", badge: "C+" },
  sql: { color: "#F59E0B", badge: "DB" },

  // Config / Docs / Media
  yml: { color: "#CB171E", badge: "YM" },
  yaml: { color: "#CB171E", badge: "YM" },
  toml: { color: "#9C4221", badge: "TM" },
  xml: { color: "#F97316", badge: "<>" },
  md: { color: "#60A5FA", badge: "M↓" },
  markdown: { color: "#60A5FA", badge: "M↓" },
  sh: { color: "#4ADE80", badge: ">_" },
  bash: { color: "#4ADE80", badge: ">_" },
  ps1: { color: "#38BDF8", badge: ">_" },
  svg: { color: "#FFB13B", badge: "◈" },
  png: { color: "#34D399", badge: "▣" },
  jpg: { color: "#34D399", badge: "▣" },
  jpeg: { color: "#34D399", badge: "▣" },
  webp: { color: "#34D399", badge: "▣" },
  ico: { color: "#34D399", badge: "▣" },
  env: { color: "#EAB308", badge: "⚿" },
};

const BASE_FILE_NAMES: Record<string, IconSpec> = {
  "package.json": { color: "#4ADE80", badge: "{}" },
  "package-lock.json": { color: "#94A3B8", badge: "⚿" },
  "tsconfig.json": { color: "#3178C6", badge: "TS" },
  "jsconfig.json": { color: "#F7DF1E", badge: "JS" },
  "cargo.toml": { color: "#DEA584", badge: "RS" },
  "cargo.lock": { color: "#94A3B8", badge: "⚿" },
  dockerfile: { color: "#2496ED", badge: "🐳" },
  ".gitignore": { color: "#F05032", badge: "⎇" },
  ".gitattributes": { color: "#F05032", badge: "⎇" },
  ".env": { color: "#EAB308", badge: "⚿" },
  ".env.local": { color: "#EAB308", badge: "⚿" },
  "readme.md": { color: "#60A5FA", badge: "ℹ" },
};

const BASE_FOLDER_NAMES: Record<string, IconSpec> = {
  src: { color: "var(--icon-folder-src)", badge: "‹›" },
  app: { color: "var(--icon-folder-src)", badge: "‹›" },
  components: { color: "var(--icon-folder-components)", badge: "❖" },
  ui: { color: "var(--icon-folder-components)", badge: "❖" },
  routes: { color: "var(--icon-folder-routes)", badge: "⇄" },
  router: { color: "var(--icon-folder-routes)", badge: "⇄" },
  utils: { color: "var(--icon-folder-utils)", badge: "⚙" },
  helpers: { color: "var(--icon-folder-utils)", badge: "⚙" },
  lib: { color: "var(--icon-folder-utils)", badge: "⚙" },
  context: { color: "var(--icon-folder-context)", badge: "◎" },
  store: { color: "var(--icon-folder-context)", badge: "◎" },
  state: { color: "var(--icon-folder-context)", badge: "◎" },
  pages: { color: "var(--icon-folder-pages)", badge: "▤" },
  views: { color: "var(--icon-folder-pages)", badge: "▤" },
  screens: { color: "var(--icon-folder-pages)", badge: "▤" },
  hooks: { color: "var(--icon-folder-components)", badge: "⚓" },
  services: { color: "var(--icon-folder-api)", badge: "⚡" },
  api: { color: "var(--icon-folder-api)", badge: "⚡" },
  controllers: { color: "var(--icon-folder-api)", badge: "⚡" },
  models: { color: "var(--icon-folder-context)", badge: "◈" },
  types: { color: "var(--icon-folder-src)", badge: "T" },
  domain: { color: "var(--icon-folder-context)", badge: "◈" },
  application: { color: "var(--icon-folder-src)", badge: "◈" },
  infraestructure: { color: "var(--icon-folder-api)", badge: "◈" },
  infrastructure: { color: "var(--icon-folder-api)", badge: "◈" },
  presentation: { color: "var(--icon-folder-pages)", badge: "◈" },
  styles: { color: "var(--icon-folder-styles)", badge: "✿" },
  css: { color: "var(--icon-folder-styles)", badge: "✿" },
  themes: { color: "var(--icon-folder-styles)", badge: "✿" },
  assets: { color: "var(--icon-folder-assets)", badge: "▣" },
  public: { color: "var(--icon-folder-assets)", badge: "▣" },
  images: { color: "var(--icon-folder-assets)", badge: "▣" },
  img: { color: "var(--icon-folder-assets)", badge: "▣" },
  media: { color: "var(--icon-folder-assets)", badge: "▣" },
  tests: { color: "var(--icon-folder-tests)", badge: "⚗" },
  __tests__: { color: "var(--icon-folder-tests)", badge: "⚗" },
  test: { color: "var(--icon-folder-tests)", badge: "⚗" },
  spec: { color: "var(--icon-folder-tests)", badge: "⚗" },
  config: { color: "var(--icon-folder-muted)", badge: "⚙" },
  ".vscode": { color: "var(--icon-folder-src)", badge: "⚙" },
  ".github": { color: "var(--icon-folder-muted)", badge: "⚙" },
  ".git": { color: "var(--icon-folder-git)", badge: "⎇" },
  node_modules: { color: "var(--icon-folder-muted)", badge: "📦" },
  dist: { color: "var(--icon-folder-muted)", badge: "▤" },
  build: { color: "var(--icon-folder-muted)", badge: "▤" },
  out: { color: "var(--icon-folder-muted)", badge: "▤" },
  target: { color: "var(--icon-folder-muted)", badge: "▤" },
};

export const BUILTIN_ICON_THEMES: IconThemeManifest[] = [
  {
    id: "lumen-icons",
    name: "Lumen Icons",
    author: "LumenCode",
    description: "Iconos por defecto de LumenCode con badges por tecnología y carpetas semánticas.",
    vars: DEFAULT_VARS,
    defaultFile: { color: "var(--fg-muted)" },
    defaultFolder: { color: "var(--icon-folder)" },
    fileNames: BASE_FILE_NAMES,
    fileExtensions: BASE_FILE_EXTENSIONS,
    folderNames: BASE_FOLDER_NAMES,
  },
];

export function loadCustomIconThemes(): IconThemeManifest[] {
  try {
    const raw = localStorage.getItem(CUSTOM_ICON_THEMES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => sanitizeIconThemeManifest(item as Partial<IconThemeManifest>))
      .filter((t): t is IconThemeManifest => t !== null);
  } catch {
    return [];
  }
}

export function getAllIconThemes(): IconThemeManifest[] {
  const custom = loadCustomIconThemes();
  const seen = new Set(BUILTIN_ICON_THEMES.map((t) => t.id));
  return [...BUILTIN_ICON_THEMES, ...custom.filter((t) => !seen.has(t.id))];
}

export function findIconTheme(id: string): IconThemeManifest {
  return getAllIconThemes().find((t) => t.id === id) ?? BUILTIN_ICON_THEMES[0];
}

export function saveCustomIconTheme(theme: IconThemeManifest): void {
  const safe = sanitizeIconThemeManifest(theme);
  if (!safe) return;
  const list = loadCustomIconThemes().filter((t) => t.id !== safe.id);
  list.push(safe);
  try {
    localStorage.setItem(CUSTOM_ICON_THEMES_KEY, JSON.stringify(list));
  } catch {}
}

export function removeCustomIconTheme(id: string): void {
  const list = loadCustomIconThemes().filter((t) => t.id !== id);
  try {
    localStorage.setItem(CUSTOM_ICON_THEMES_KEY, JSON.stringify(list));
  } catch {}
}

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function sanitizeIconSpec(raw: unknown, fallbackColor: string): IconSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const color = sanitizeCssColor(obj.color, fallbackColor);
  const badge = typeof obj.badge === "string" && obj.badge.trim() ? obj.badge.trim().slice(0, 6) : undefined;
  const svg = typeof obj.svg === "string" ? sanitizeSvgFragment(obj.svg) || undefined : undefined;
  return { color, ...(badge ? { badge } : {}), ...(svg ? { svg } : {}) };
}

function sanitizeIconMap(raw: unknown, fallbackColor: string): Record<string, IconSpec> {
  const out: Record<string, IconSpec> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = k.toLowerCase();
    if (!key || FORBIDDEN_KEYS.has(key)) continue;
    const spec = sanitizeIconSpec(v, fallbackColor);
    if (spec) out[key] = spec;
  }
  return out;
}

function sanitizeVars(raw: unknown): Record<string, string> {
  const out: Record<string, string> = { ...DEFAULT_VARS };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^--[a-zA-Z0-9_-]+$/.test(k)) continue;
    const safe = sanitizeCssColor(v, "");
    if (safe) out[k] = safe;
  }
  return out;
}

function sanitizeIconThemeManifest(data: Partial<IconThemeManifest>): IconThemeManifest | null {
  if (!data || typeof data.name !== "string" || !data.name.trim() || !data.fileExtensions || !data.folderNames) {
    return null;
  }
  const id = (typeof data.id === "string" && data.id.trim() ? data.id : data.name)
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-|-$/g, "");
  return {
    id: id || `icons-${Date.now()}`,
    name: data.name.trim(),
    author: typeof data.author === "string" && data.author.trim() ? data.author.trim() : "Comunidad",
    description: typeof data.description === "string" ? data.description : undefined,
    vars: sanitizeVars(data.vars),
    defaultFile: sanitizeIconSpec(data.defaultFile, "var(--fg-muted)") ?? { color: "var(--fg-muted)" },
    defaultFolder: sanitizeIconSpec(data.defaultFolder, "var(--icon-folder)") ?? { color: "var(--icon-folder)" },
    defaultFolderOpen: data.defaultFolderOpen
      ? sanitizeIconSpec(data.defaultFolderOpen, "var(--icon-folder)") ?? undefined
      : undefined,
    fileNames: sanitizeIconMap(data.fileNames, "var(--fg-muted)"),
    fileExtensions: sanitizeIconMap(data.fileExtensions, "var(--fg-muted)"),
    folderNames: sanitizeIconMap(data.folderNames, "var(--icon-folder)"),
  };
}

export function parseIconThemeJson(raw: string): IconThemeManifest | null {
  try {
    const data = JSON.parse(raw) as Partial<IconThemeManifest>;
    return sanitizeIconThemeManifest(data);
  } catch {
    return null;
  }
}

export function cloneBaseIconMaps() {
  return {
    vars: { ...DEFAULT_VARS },
    fileNames: { ...BASE_FILE_NAMES },
    fileExtensions: { ...BASE_FILE_EXTENSIONS },
    folderNames: { ...BASE_FOLDER_NAMES },
  };
}
