import type { IconSpec, IconThemeManifest } from "../domain/types";

const s = (body: string, size = 14) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS = {
  dots: `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><circle cx="3" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="13" cy="8" r="1.4"/></svg>`,
  chevron: s(`<path d="M6 4l4 4-4 4"/>`, 12),
  folder: `<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 3.5A1.5 1.5 0 0 1 3 2h3.2l1.6 1.8H13a1.5 1.5 0 0 1 1.5 1.5v6.7A1.5 1.5 0 0 1 13 13.5H3A1.5 1.5 0 0 1 1.5 12z"/></svg>`,
  file: s(`<path d="M4 1.8h5l3 3v9.4H4z"/><path d="M9 1.8v3h3"/>`, 13),
  panel: s(`<rect x="1.8" y="2.5" width="12.4" height="11" rx="2"/><path d="M4.5 6.5l2 1.5-2 1.5M8 10h3"/>`),
  split: s(`<rect x="1.8" y="2.5" width="12.4" height="11" rx="2"/><path d="M8 2.5v11"/>`),
  git: s(`<circle cx="4.5" cy="3.5" r="1.6"/><circle cx="4.5" cy="12.5" r="1.6"/><circle cx="11.5" cy="5.5" r="1.6"/><path d="M4.5 5.1v5.8M11.5 7.1c0 2.6-7 1.6-7 3.8"/>`),
  gear: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`,
};

const ALLOWED_SVG_TAGS = new Set([
  "svg",
  "g",
  "path",
  "circle",
  "ellipse",
  "rect",
  "line",
  "polyline",
  "polygon",
]);

const ALLOWED_SVG_ATTRS = new Set([
  "d",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "viewbox",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "width",
  "height",
  "points",
  "fill",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "opacity",
  "fill-opacity",
  "stroke-opacity",
  "fill-rule",
  "clip-rule",
  "transform",
]);

const SAFE_HEX_COLOR = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const SAFE_FUNC_COLOR = /^(?:rgb|rgba|hsl|hsla)\(\s*[0-9.,%\s/+-]+\s*\)$/;
const SAFE_VAR_COLOR = /^var\(\s*--[a-zA-Z0-9_-]+\s*(?:,\s*(?:#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,24}))?\s*\)$/;
const SAFE_NAMED_COLOR = /^[a-zA-Z]{3,24}$/;

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function sanitizeCssColor(color: unknown, fallback = "currentColor"): string {
  if (typeof color !== "string") return fallback;
  const trimmed = color.trim();
  if (
    SAFE_HEX_COLOR.test(trimmed) ||
    SAFE_FUNC_COLOR.test(trimmed) ||
    SAFE_VAR_COLOR.test(trimmed) ||
    SAFE_NAMED_COLOR.test(trimmed)
  ) {
    return trimmed;
  }
  return fallback;
}

function sanitizeSvgAttrValue(name: string, rawValue: string): string | null {
  const val = rawValue.trim();
  if (!val || /[<>"'`]|javascript:|data:|url\s*\(/i.test(val)) return null;
  if (name === "fill" || name === "stroke") {
    if (val === "none") return "none";
    const safe = sanitizeCssColor(val, "");
    return safe || null;
  }
  if (name === "transform") {
    return /^[a-zA-Z0-9\s.,()+-]+$/.test(val) ? val : null;
  }
  if (name === "viewbox") {
    return /^-?[0-9.]+(?:[\s,]+-?[0-9.]+){3}$/.test(val) ? val : null;
  }
  if (name === "d") {
    return /^[MmZzLlHhVvCcSsQqTtAaEe0-9\s.,+-]+$/.test(val) ? val : null;
  }
  if (name === "points" || name === "stroke-dasharray") {
    return /^[0-9eE\s.,+-]+$/.test(val) ? val : null;
  }
  return /^[a-zA-Z0-9\s.%+-]+$/.test(val) ? val : null;
}

/**
 * Sanitiza un fragmento SVG mediante allowlist estricta de etiquetas geométricas y atributos.
 * Descarta scripts, handlers on*, <foreignObject>, <img>, <use>, <style>, etc.
 */
export function sanitizeSvgFragment(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) return "";
  // Elimina comentarios, CDATA e instrucciones de procesamiento
  const cleaned = raw
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "")
    .replace(/<\?[\s\S]*?\?>/g, "");

  const out: string[] = [];
  const openStack: string[] = [];
  const tagRe = /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9:-]*)([^>]*?)\s*(\/?)\s*>/g;
  const attrRe = /([a-zA-Z][a-zA-Z0-9:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(cleaned)) !== null) {
    const isClosing = m[1] === "/";
    const tag = m[2].toLowerCase();
    const rawAttrs = m[3] ?? "";
    const selfClosing = m[4] === "/";

    if (!ALLOWED_SVG_TAGS.has(tag)) continue;

    if (isClosing) {
      const idx = openStack.lastIndexOf(tag);
      if (idx !== -1) {
        while (openStack.length > idx) {
          const popped = openStack.pop()!;
          out.push(`</${popped}>`);
        }
      }
      continue;
    }

    const attrs: string[] = [];
    attrRe.lastIndex = 0;
    let am: RegExpExecArray | null;
    while ((am = attrRe.exec(rawAttrs)) !== null) {
      const attrName = am[1].toLowerCase();
      if (!ALLOWED_SVG_ATTRS.has(attrName)) continue;
      // Un <svg> anidado debe heredar el viewport del icono; su tamaño fijo lo recortaría.
      if (tag === "svg" && (attrName === "width" || attrName === "height")) continue;
      const attrRaw = am[2] ?? am[3] ?? "";
      const safeVal = sanitizeSvgAttrValue(attrName, attrRaw);
      if (safeVal !== null) {
        const outName = attrName === "viewbox" ? "viewBox" : attrName;
        attrs.push(`${outName}="${escapeXml(safeVal)}"`);
      }
    }

    const attrStr = attrs.length > 0 ? ` ${attrs.join(" ")}` : "";
    if (selfClosing) {
      out.push(`<${tag}${attrStr}/>`);
    } else {
      openStack.push(tag);
      out.push(`<${tag}${attrStr}>`);
    }
  }

  while (openStack.length > 0) {
    out.push(`</${openStack.pop()!}>`);
  }

  return out.join("");
}

function ownGet<T>(map: Record<string, T> | undefined, key: string): T | undefined {
  if (!map || !Object.prototype.hasOwnProperty.call(map, key)) return undefined;
  return map[key];
}

function renderFolderSvg(spec: IconSpec, open: boolean): string {
  const color = sanitizeCssColor(spec?.color, "var(--icon-folder)");
  if (spec?.svg) {
    const safeSvg = sanitizeSvgFragment(spec.svg);
    if (safeSvg) {
      return `<svg width="14" height="14" viewBox="0 0 16 16" style="color:${color}">${safeSvg}</svg>`;
    }
  }

  const body = open
    ? `<path d="M1.5 3.5A1.3 1.3 0 0 1 2.8 2.2h3.1l1.4 1.5H13a1.3 1.3 0 0 1 1.3 1.3v1.2H3.4L1.5 12V3.5z" opacity="0.85"/><path d="M3.1 6.8h11.3l-1.5 6.1a1 1 0 0 1-1 .8H2.2a.8.8 0 0 1-.8-1l1.7-5.9z"/>`
    : `<path d="M1.5 3.5A1.4 1.4 0 0 1 2.9 2.1h3.2l1.5 1.6H13a1.4 1.4 0 0 1 1.4 1.4v7.1a1.4 1.4 0 0 1-1.4 1.4H2.9a1.4 1.4 0 0 1-1.4-1.4z"/>`;

  const badge = spec?.badge
    ? `<rect x="7.5" y="7.5" width="8" height="7.5" rx="2" fill="var(--surface)" stroke="${color}" stroke-width="0.9"/><text x="11.5" y="12.9" text-anchor="middle" font-size="6.2" font-weight="700" font-family="system-ui, sans-serif" fill="${color}">${escapeXml(spec.badge)}</text>`
    : "";

  return `<svg width="14" height="14" viewBox="0 0 16 16" fill="${color}" style="flex:none">${body}${badge}</svg>`;
}

function renderFileSvg(spec: IconSpec): string {
  const color = sanitizeCssColor(spec?.color, "var(--fg-muted)");
  if (spec?.svg) {
    const safeSvg = sanitizeSvgFragment(spec.svg);
    if (safeSvg) {
      return `<svg width="14" height="14" viewBox="0 0 16 16" style="color:${color}">${safeSvg}</svg>`;
    }
  }
  if (!spec?.badge) {
    return `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="${color}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3.8 1.8h5.2l3.2 3.2v9.2H3.8z"/><path d="M9 1.8v3.2h3.2"/></svg>`;
  }

  const len = spec.badge.length;
  const fontSize = len >= 3 ? "5.8" : len === 2 ? "6.8" : "8";
  return `<svg width="14" height="14" viewBox="0 0 16 16" style="flex:none"><text x="8" y="11.2" text-anchor="middle" font-size="${fontSize}" font-weight="800" font-family="var(--editor-font, monospace)" fill="${color}">${escapeXml(spec.badge)}</text></svg>`;
}

export function iconForFolder(name: string, open: boolean, theme: IconThemeManifest): string {
  const key = name.toLowerCase();
  const spec =
    ownGet(theme.folderNames, key) ??
    (open && theme.defaultFolderOpen ? theme.defaultFolderOpen : theme.defaultFolder);
  return renderFolderSvg(spec, open);
}

export function iconForFile(name: string, theme: IconThemeManifest): string {
  const lower = name.toLowerCase();
  const exact = ownGet(theme.fileNames, lower);
  if (exact) return renderFileSvg(exact);

  if (/\.(test|spec)\.[^.]+$/i.test(lower)) {
    return renderFileSvg({ color: "#FB923C", badge: "⚗" });
  }

  const ext = lower.includes(".") ? lower.split(".").pop() ?? "" : "";
  const spec = (ext ? ownGet(theme.fileExtensions, ext) : undefined) ?? theme.defaultFile;
  return renderFileSvg(spec);
}