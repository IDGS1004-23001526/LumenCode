import type { ExtensionManifest, ThemeManifest } from "../domain/types";
import { BUILTIN_THEMES, loadCustomThemes, removeCustomTheme, saveCustomTheme } from "./themeRepository";

const INSTALLED_KEY = "lumen.installedExtensions.v1";

export const COMMUNITY_EXTENSIONS: ExtensionManifest[] = [
  {
    id: "ext-tokyo-night",
    name: "Tokyo Night",
    author: "enkia · Comunidad",
    version: "1.2.0",
    category: "Theme",
    summary: "Tema oscuro inspirado en las luces nocturnas de Tokio, con contraste suave y acentos azul neón.",
    readme:
      "Tokyo Night adapta toda la interfaz de LumenCode: explorador de archivos, pestañas, terminal integrada, modales y resaltado de sintaxis.\n\n• Fondo azul profundo (#1a1b26) para reducir la fatiga visual.\n• Acentos en azul eléctrico (#7aa2f7) y sintaxis equilibrada.\n• Ideal para sesiones largas de programación nocturna.",
    theme: {
      id: "tokyo-night",
      name: "Tokyo Night",
      author: "enkia · Comunidad",
      dark: true,
      colors: {
        "--bg": "#1a1b26",
        "--surface": "#16161e",
        "--surface-2": "#24283b",
        "--fg": "#c0caf5",
        "--fg-muted": "#7982a9",
        "--border": "#292e42",
        "--accent": "#7aa2f7",
        "--accent-soft": "#283457",
        "--syn-keyword": "#bb9af7",
        "--syn-string": "#9ece6a",
        "--syn-comment": "#565f89",
        "--syn-number": "#ff9e64",
        "--syn-fn": "#7aa2f7",
      },
    },
  },
  {
    id: "ext-catppuccin-mocha",
    name: "Catppuccin Mocha",
    author: "Catppuccin · Comunidad",
    version: "2.0.1",
    category: "Theme",
    summary: "Paleta pastel oscura cálida y acogedora diseñada por la comunidad.",
    readme:
      "Catppuccin Mocha ofrece tonos pastel suaves sobre un fondo oscuro cálido.\n\n• Colores cuidadosamente balanceados para palabras clave, cadenas y funciones.\n• Compatible al 100% con la terminal, el árbol de archivos y los diálogos de LumenCode.",
    theme: {
      id: "catppuccin-mocha",
      name: "Catppuccin Mocha",
      author: "Catppuccin · Comunidad",
      dark: true,
      colors: {
        "--bg": "#1e1e2e",
        "--surface": "#181825",
        "--surface-2": "#313244",
        "--fg": "#cdd6f4",
        "--fg-muted": "#a6adc8",
        "--border": "#313244",
        "--accent": "#cba6f7",
        "--accent-soft": "#3b2c4e",
        "--syn-keyword": "#cba6f7",
        "--syn-string": "#a6e3a1",
        "--syn-comment": "#6c7086",
        "--syn-number": "#fab387",
        "--syn-fn": "#89b4fa",
      },
    },
  },
  {
    id: "ext-dracula-soft",
    name: "Dracula Soft",
    author: "Dracula · Comunidad",
    version: "1.0.4",
    category: "Theme",
    summary: "El clásico tema Dracula con contraste suavizado para mayor legibilidad.",
    readme:
      "Una variante más suave del clásico Dracula.\n\n• Acentos púrpura (#bd93f9), verde menta (#50fa7b) y rosa (#ff79c6).\n• Aplica automáticamente a toda la interfaz de LumenCode.",
    theme: {
      id: "dracula-soft",
      name: "Dracula Soft",
      author: "Dracula · Comunidad",
      dark: true,
      colors: {
        "--bg": "#282a36",
        "--surface": "#21222c",
        "--surface-2": "#343746",
        "--fg": "#f8f8f2",
        "--fg-muted": "#9ea4c2",
        "--border": "#383a59",
        "--accent": "#bd93f9",
        "--accent-soft": "#3a3254",
        "--syn-keyword": "#ff79c6",
        "--syn-string": "#f1fa8c",
        "--syn-comment": "#6272a4",
        "--syn-number": "#bd93f9",
        "--syn-fn": "#50fa7b",
      },
    },
  },
];

function builtinToExtensions(): ExtensionManifest[] {
  return BUILTIN_THEMES.map((t) => ({
    id: `builtin-${t.id}`,
    name: t.name,
    author: t.author,
    version: "1.0.0",
    category: "Theme",
    summary: `Tema integrado de LumenCode (${t.dark ? "oscuro" : "claro"}).`,
    readme: `${t.name} forma parte de los temas integrados de LumenCode.\n\nAdapta todas las variables de color de la interfaz (--bg, --surface, --accent, --syn-*) para ofrecer una experiencia uniforme en el editor, explorador y terminal.`,
    theme: t,
    builtin: true,
  }));
}

export function loadInstalledExtensionIds(): Set<string> {
  try {
    const raw = localStorage.getItem(INSTALLED_KEY);
    const ids = raw ? (JSON.parse(raw) as string[]) : [];
    const set = new Set(Array.isArray(ids) ? ids : []);
    for (const b of BUILTIN_THEMES) set.add(`builtin-${b.id}`);
    return set;
  } catch {
    return new Set(BUILTIN_THEMES.map((b) => `builtin-${b.id}`));
  }
}

function saveInstalledIds(ids: Set<string>): void {
  localStorage.setItem(INSTALLED_KEY, JSON.stringify([...ids]));
}

export function getCatalogExtensions(): ExtensionManifest[] {
  const builtins = builtinToExtensions();
  const communityThemeIds = new Set(COMMUNITY_EXTENSIONS.map((e) => e.theme?.id).filter(Boolean));
  const localCustom: ExtensionManifest[] = loadCustomThemes()
    .filter((t) => !communityThemeIds.has(t.id))
    .map((t: ThemeManifest) => ({
      id: `local-${t.id}`,
      name: t.name,
      author: t.author,
      version: "local",
      category: "Theme",
      summary: "Tema importado localmente desde archivo .json.",
      readme: `Tema personalizado importado desde un archivo .json local.\n\nAutor: ${t.author}\nModo: ${t.dark ? "Oscuro" : "Claro"}`,
      theme: t,
    }));

  return [...COMMUNITY_EXTENSIONS, ...localCustom, ...builtins];
}

export function isExtensionInstalled(ext: ExtensionManifest): boolean {
  if (ext.builtin || ext.id.startsWith("local-")) return true;
  return loadInstalledExtensionIds().has(ext.id);
}

export function installExtension(ext: ExtensionManifest): void {
  const ids = loadInstalledExtensionIds();
  ids.add(ext.id);
  saveInstalledIds(ids);
  if (ext.theme) saveCustomTheme(ext.theme);
}

export function uninstallExtension(ext: ExtensionManifest): void {
  if (ext.builtin) return;
  const ids = loadInstalledExtensionIds();
  ids.delete(ext.id);
  saveInstalledIds(ids);
  if (ext.theme) removeCustomTheme(ext.theme.id);
}
