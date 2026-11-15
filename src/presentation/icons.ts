import type { IconSpec, IconThemeManifest } from "../domain/types";

const s = (body: string, size = 14) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS = {
  dots: `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><circle cx="3" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="13" cy="8" r="1.4"/></svg>`,
  chevron: s(`<path d="M6 4l4 4-4 4"/>`, 12),
  folder: `<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 3.5A1.5 1.5 0 0 1 3 2h3.2l1.6 1.8H13a1.5 1.5 0 0 1 1.5 1.5v6.7A1.5 1.5 0 0 1 13 13.5H3A1.5 1.5 0 0 1 1.5 12z"/></svg>`,
  file: s(`<path d="M4 1.8h5l3 3v9.4H4z"/><path d="M9 1.8v3h3"/>`, 13),
  panel: s(`<rect x="1.8" y="2.5" width="12.4" height="11" rx="2"/><path d="M4.5 6.5l2 1.5-2 1.5M8 10h3"/>`),
  gear: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`,
};

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderFolderSvg(spec: IconSpec, open: boolean): string {
  if (spec.svg) {
    return `<svg width="14" height="14" viewBox="0 0 16 16" style="color:${spec.color}">${spec.svg}</svg>`;
  }

  const body = open
    ? `<path d="M1.5 3.5A1.3 1.3 0 0 1 2.8 2.2h3.1l1.4 1.5H13a1.3 1.3 0 0 1 1.3 1.3v1.2H3.4L1.5 12V3.5z" opacity="0.85"/><path d="M3.1 6.8h11.3l-1.5 6.1a1 1 0 0 1-1 .8H2.2a.8.8 0 0 1-.8-1l1.7-5.9z"/>`
    : `<path d="M1.5 3.5A1.4 1.4 0 0 1 2.9 2.1h3.2l1.5 1.6H13a1.4 1.4 0 0 1 1.4 1.4v7.1a1.4 1.4 0 0 1-1.4 1.4H2.9a1.4 1.4 0 0 1-1.4-1.4z"/>`;

  const badge = spec.badge
    ? `<rect x="7.5" y="7.5" width="8" height="7.5" rx="2" fill="var(--surface)" stroke="${spec.color}" stroke-width="0.9"/><text x="11.5" y="12.9" text-anchor="middle" font-size="6.2" font-weight="700" font-family="system-ui, sans-serif" fill="${spec.color}">${escapeXml(spec.badge)}</text>`
    : "";

  return `<svg width="14" height="14" viewBox="0 0 16 16" fill="${spec.color}" style="flex:none">${body}${badge}</svg>`;
}

function renderFileSvg(spec: IconSpec): string {
  if (spec.svg) {
    return `<svg width="14" height="14" viewBox="0 0 16 16" style="color:${spec.color}">${spec.svg}</svg>`;
  }
  if (!spec.badge) {
    return `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="${spec.color}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3.8 1.8h5.2l3.2 3.2v9.2H3.8z"/><path d="M9 1.8v3.2h3.2"/></svg>`;
  }

  const len = spec.badge.length;
  const fontSize = len >= 3 ? "5.8" : len === 2 ? "6.8" : "8";
  return `<svg width="14" height="14" viewBox="0 0 16 16" style="flex:none"><text x="8" y="11.2" text-anchor="middle" font-size="${fontSize}" font-weight="800" font-family="var(--editor-font, monospace)" fill="${spec.color}">${escapeXml(spec.badge)}</text></svg>`;
}

export function iconForFolder(name: string, open: boolean, theme: IconThemeManifest): string {
  const key = name.toLowerCase();
  const spec = theme.folderNames[key] ?? (open && theme.defaultFolderOpen ? theme.defaultFolderOpen : theme.defaultFolder);
  return renderFolderSvg(spec, open);
}

export function iconForFile(name: string, theme: IconThemeManifest): string {
  const lower = name.toLowerCase();
  const exact = theme.fileNames[lower];
  if (exact) return renderFileSvg(exact);

  if (/\.(test|spec)\.[^.]+$/i.test(lower)) {
    return renderFileSvg({ color: "#FB923C", badge: "⚗" });
  }

  const ext = lower.includes(".") ? lower.split(".").pop() ?? "" : "";
  const spec = (ext && theme.fileExtensions[ext]) || theme.defaultFile;
  return renderFileSvg(spec);
}