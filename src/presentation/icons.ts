const s = (body: string, size = 14) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS = {
  dots: `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><circle cx="3" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="13" cy="8" r="1.4"/></svg>`,
  chevron: s(`<path d="M6 4l4 4-4 4"/>`, 12),
  folder: `<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 3.5A1.5 1.5 0 0 1 3 2h3.2l1.6 1.8H13a1.5 1.5 0 0 1 1.5 1.5v6.7A1.5 1.5 0 0 1 13 13.5H3A1.5 1.5 0 0 1 1.5 12z"/></svg>`,
  file: s(`<path d="M4 1.8h5l3 3v9.4H4z"/><path d="M9 1.8v3h3"/>`, 13),
  panel: s(`<rect x="1.8" y="2.5" width="12.4" height="11" rx="2"/><path d="M4.5 6.5l2 1.5-2 1.5M8 10h3"/>`),
  gear: s(`<circle cx="8" cy="8" r="2.2"/><path d="M8 1.5v1.8M8 12.7v1.8M14.5 8h-1.8M3.3 8H1.5M12.6 3.4l-1.3 1.3M4.7 11.3l-1.3 1.3M12.6 12.6l-1.3-1.3M4.7 4.7L3.4 3.4"/>`),
};