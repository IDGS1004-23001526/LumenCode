import type { ThemeManifest } from "../domain/types";
import { sanitizeCssColor } from "../presentation/icons";

const CUSTOM_THEMES_KEY = "lumencode.customThemes";

export const BUILTIN_THEMES: ThemeManifest[] = [
  {
    id: "lumen-light",
    name: "Lumen Light",
    author: "LumenCode",
    dark: false,
    colors: {
      "--bg": "#F0F4F8",
      "--surface": "#E1E8ED",
      "--tab-inactive": "#D8E1E8",
      "--border": "#D3DCE4",
      "--fg": "#3E4A5B",
      "--fg-muted": "#718096",
      "--fg-faint": "#A0AEC0",
      "--accent": "#5D9CEC",
      "--syn-keyword": "#82A0D8",
      "--syn-function": "#5D9CEC",
      "--syn-string": "#88C5A1",
      "--syn-number": "#F5A6AD",
      "--syn-comment": "#A0AEC0",
    },
  },
  {
    id: "midnight-pastel",
    name: "Midnight Pastel",
    author: "LumenCode",
    dark: true,
    colors: {
      "--bg": "#1A1F2B",
      "--surface": "#222938",
      "--tab-inactive": "#151923",
      "--border": "#2E374B",
      "--fg": "#E2E8F0",
      "--fg-muted": "#94A3B8",
      "--fg-faint": "#64748B",
      "--accent": "#7AA2F7",
      "--syn-keyword": "#BB9AF7",
      "--syn-function": "#7AA2F7",
      "--syn-string": "#9ECE6A",
      "--syn-number": "#F7768E",
      "--syn-comment": "#565F89",
    },
  },
  {
    id: "nord-frost",
    name: "Nord Frost",
    author: "Comunidad",
    dark: true,
    colors: {
      "--bg": "#2E3440",
      "--surface": "#3B4252",
      "--tab-inactive": "#272C36",
      "--border": "#434C5E",
      "--fg": "#ECEFF4",
      "--fg-muted": "#D8DEE9",
      "--fg-faint": "#7B88A1",
      "--accent": "#88C0D0",
      "--syn-keyword": "#81A1C1",
      "--syn-function": "#88C0D0",
      "--syn-string": "#A3BE8C",
      "--syn-number": "#B48EAD",
      "--syn-comment": "#616E88",
    },
  },
  {
    id: "rose-pine-dawn",
    name: "Rosé Pine Dawn",
    author: "Comunidad",
    dark: false,
    colors: {
      "--bg": "#FAF4ED",
      "--surface": "#F2E9E1",
      "--tab-inactive": "#EAE0D6",
      "--border": "#DFDAD9",
      "--fg": "#575279",
      "--fg-muted": "#797593",
      "--fg-faint": "#9893A5",
      "--accent": "#286983",
      "--syn-keyword": "#907AA9",
      "--syn-function": "#286983",
      "--syn-string": "#56949F",
      "--syn-number": "#D7827E",
      "--syn-comment": "#9893A5",
    },
  },
];

function sanitizeThemeColors(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, string> = {};
  let count = 0;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^--[a-zA-Z0-9_-]+$/.test(k)) continue;
    const safe = sanitizeCssColor(v, "");
    if (safe) {
      out[k] = safe;
      count++;
    }
  }
  return count > 0 ? out : null;
}

function sanitizeThemeManifest(data: Partial<ThemeManifest>): ThemeManifest | null {
  if (!data || typeof data.name !== "string" || !data.name.trim()) {
    return null;
  }
  const colors = sanitizeThemeColors(data.colors);
  if (!colors) return null;

  const slug =
    typeof data.id === "string" && data.id.trim()
      ? data.id.trim().toLowerCase().replace(/[^a-z0-9-_]+/g, "-").replace(/^-|-$/g, "")
      : data.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return {
    id: slug || `theme-${Date.now()}`,
    name: data.name.trim(),
    author: typeof data.author === "string" && data.author.trim() ? data.author.trim() : "Comunidad",
    dark: Boolean(data.dark),
    colors,
  };
}

export function loadCustomThemes(): ThemeManifest[] {
  try {
    const raw = JSON.parse(localStorage.getItem(CUSTOM_THEMES_KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item) => sanitizeThemeManifest(item as Partial<ThemeManifest>))
      .filter((t): t is ThemeManifest => t !== null);
  } catch {
    return [];
  }
}

export function getAllThemes(): ThemeManifest[] {
  const seen = new Set(BUILTIN_THEMES.map((t) => t.id));
  return [...BUILTIN_THEMES, ...loadCustomThemes().filter((t) => !seen.has(t.id))];
}

export function findTheme(id: string): ThemeManifest {
  return getAllThemes().find((t) => t.id === id) ?? BUILTIN_THEMES[0];
}

export function saveCustomTheme(theme: ThemeManifest): void {
  const safe = sanitizeThemeManifest(theme);
  if (!safe) return;
  const existing = loadCustomThemes().filter((t) => t.id !== safe.id);
  existing.push(safe);
  try {
    localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(existing));
  } catch {}
}

export function removeCustomTheme(id: string): void {
  const next = loadCustomThemes().filter((t) => t.id !== id);
  try {
    localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(next));
  } catch {}
}

export function parseThemeJson(raw: string): ThemeManifest | null {
  try {
    const data = JSON.parse(raw) as Partial<ThemeManifest>;
    return sanitizeThemeManifest(data);
  } catch {
    return null;
  }
}
