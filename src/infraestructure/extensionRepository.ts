import type { ExtensionManifest, IconThemeManifest, ThemeManifest } from "../domain/types";
import { BUILTIN_THEMES, loadCustomThemes, removeCustomTheme, saveCustomTheme } from "./themeRepository";
import {
  BUILTIN_ICON_THEMES,
  cloneBaseIconMaps,
  loadCustomIconThemes,
  removeCustomIconTheme,
  saveCustomIconTheme,
} from "./iconThemeRepository";

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
  {
    id: "ext-rose-milk-light",
    name: "Rose Milk Light",
    author: "Lumen Community",
    version: "1.0.0",
    category: "Theme",
    summary: "Tema claro en rosa pastel suave con tipografía ciruela oscura de alta legibilidad.",
    readme:
      "Rose Milk Light combina tonos rosa pastel crema con un contraste nítido para programar cómodamente de día.\n\n• Fondo rosa crema (#FDF4F7) y paneles en rosa empolvado (#F7E9EF).\n• Texto ciruela profundo (#3D2430) y sintaxis equilibrada en tonos berry, menta y lavanda.",
    theme: {
      id: "rose-milk-light",
      name: "Rose Milk Light",
      author: "Lumen Community",
      dark: false,
      colors: {
        "--bg": "#FDF4F7",
        "--surface": "#F7E9EF",
        "--surface-2": "#EED8E2",
        "--tab-inactive": "#F1DFE7",
        "--fg": "#3D2430",
        "--fg-muted": "#846273",
        "--fg-faint": "#A48695",
        "--border": "#E6CAD6",
        "--accent": "#D85C8A",
        "--accent-soft": "#FADCE7",
        "--syn-keyword": "#B83B74",
        "--syn-string": "#2D8A6E",
        "--syn-comment": "#A48695",
        "--syn-number": "#C96A3B",
        "--syn-fn": "#6C5CE7",
      },
    },
  },
  {
    id: "ext-velvet-rose-dark",
    name: "Velvet Rose Dark",
    author: "Lumen Community",
    version: "1.0.0",
    category: "Theme",
    summary: "Tema oscuro elegante con acentos rosa sakura pastel, lila y menta suave.",
    readme:
      "Velvet Rose Dark mezcla un fondo ciruela oscuro acogedor con acentos en rosa pastel pensados para largas sesiones sin fatiga visual.\n\n• Fondo ciruela profundo (#1D141B) con acentos sakura (#F48FB1).\n• Resaltado legible en rosa pastel, lila, durazno y menta suave.",
    theme: {
      id: "velvet-rose-dark",
      name: "Velvet Rose Dark",
      author: "Lumen Community",
      dark: true,
      colors: {
        "--bg": "#1D141B",
        "--surface": "#160F15",
        "--surface-2": "#2A1D27",
        "--tab-inactive": "#1A1118",
        "--fg": "#F7E6EE",
        "--fg-muted": "#B392A3",
        "--fg-faint": "#876979",
        "--border": "#382634",
        "--accent": "#F48FB1",
        "--accent-soft": "#3D2233",
        "--syn-keyword": "#F48FB1",
        "--syn-string": "#A6E3B9",
        "--syn-comment": "#7D6171",
        "--syn-number": "#FFBE98",
        "--syn-fn": "#C7A4FF",
      },
    },
  },
  {
    id: "ext-coral-pastel",
    name: "Coral Pastel",
    author: "Lumen Community",
    version: "1.0.0",
    category: "Theme",
    summary: "Tema rojo coral pastel suave con alto contraste cálido y lectura cómoda.",
    readme:
      "Coral Pastel ofrece una paleta en rojo pastel cálido con texto burdeos oscuro para una lectura clara.\n\n• Fondo rojo crema pastel (#FDF5F4) y paneles coral suave (#F7EAE8).\n• Acentos coral (#DF5E5E) con sintaxis equilibrada y sin fatiga visual.",
    theme: {
      id: "coral-pastel",
      name: "Coral Pastel",
      author: "Lumen Community",
      dark: false,
      colors: {
        "--bg": "#FDF5F4",
        "--surface": "#F7EAE8",
        "--surface-2": "#EEDAD7",
        "--tab-inactive": "#F2E1DE",
        "--fg": "#3C2323",
        "--fg-muted": "#855F5E",
        "--fg-faint": "#A68482",
        "--border": "#E5C8C4",
        "--accent": "#DF5E5E",
        "--accent-soft": "#FADCDC",
        "--syn-keyword": "#C43E44",
        "--syn-function": "#B5546A",
        "--syn-fn": "#B5546A",
        "--syn-string": "#3D8B68",
        "--syn-comment": "#A68482",
        "--syn-number": "#C86D3B",
      },
    },
  },
  {
    id: "ext-mint-breeze",
    name: "Mint Breeze",
    author: "Lumen Community",
    version: "1.0.0",
    category: "Theme",
    summary: "Tema verde menta pastel fresco y sereno con tipografía bosque oscuro.",
    readme:
      "Mint Breeze utiliza tonos verde menta pastel pensados para un entorno limpio, relajado y muy legible.\n\n• Fondo menta claro (#F3FAF7) y paneles eucalipto suave (#E6F4EE).\n• Acentos esmeralda menta (#34A882) con sintaxis natural y nítida.",
    theme: {
      id: "mint-breeze",
      name: "Mint Breeze",
      author: "Lumen Community",
      dark: false,
      colors: {
        "--bg": "#F3FAF7",
        "--surface": "#E6F4EE",
        "--surface-2": "#D6EAE1",
        "--tab-inactive": "#DFEFE8",
        "--fg": "#1E3830",
        "--fg-muted": "#597A6E",
        "--fg-faint": "#7D9E92",
        "--border": "#C2DFD2",
        "--accent": "#34A882",
        "--accent-soft": "#D2F2E5",
        "--syn-keyword": "#228668",
        "--syn-function": "#2E7D8A",
        "--syn-fn": "#2E7D8A",
        "--syn-string": "#5A8F3D",
        "--syn-comment": "#7D9E92",
        "--syn-number": "#C4753E",
      },
    },
  },
  {
    id: "ext-buttercream-pastel",
    name: "Buttercream Pastel",
    author: "Lumen Community",
    version: "1.0.0",
    category: "Theme",
    summary: "Tema amarillo mantequilla pastel luminoso y cálido con contraste suave.",
    readme:
      "Buttercream Pastel aporta una paleta en amarillo pastel vainilla ideal para sesiones largas de día.\n\n• Fondo crema amarillo suave (#FEFBF0) y paneles vainilla (#F7F0DC).\n• Acentos miel (#D49A2A) y texto espresso cálido (#3B311D) de alta legibilidad.",
    theme: {
      id: "buttercream-pastel",
      name: "Buttercream Pastel",
      author: "Lumen Community",
      dark: false,
      colors: {
        "--bg": "#FEFBF0",
        "--surface": "#F7F0DC",
        "--surface-2": "#EFE4C6",
        "--tab-inactive": "#F3EAD1",
        "--fg": "#3B311D",
        "--fg-muted": "#806F4D",
        "--fg-faint": "#A1906D",
        "--border": "#E3D4AE",
        "--accent": "#D49A2A",
        "--accent-soft": "#FBECC7",
        "--syn-keyword": "#B8731A",
        "--syn-function": "#9E5E3A",
        "--syn-fn": "#9E5E3A",
        "--syn-string": "#4A8B5C",
        "--syn-comment": "#A1906D",
        "--syn-number": "#C2584B",
      },
    },
  },
  {
    id: "ext-material-vivid-icons",
    name: "Material Vivid Icons",
    author: "Lumen Community",
    version: "1.1.0",
    category: "IconTheme",
    summary: "Paquete de iconos vibrantes estilo Material para archivos y carpetas semánticas (routes, utils, context, components).",
    readme:
      "Material Vivid Icons aporta colores vibrantes y alto contraste para distinguir al instante cada tecnología y carpeta del proyecto.\n\n• Carpetas semánticas: src, routes, utils, context, pages, hooks, api, styles, tests.\n• Archivos por tecnología: TS, React, JS, Python, Rust, C#, Go, Docker, Git y más.",
    iconTheme: (() => {
      const base = cloneBaseIconMaps();
      return {
        id: "material-vivid-icons",
        name: "Material Vivid Icons",
        author: "Lumen Community",
        vars: {
          ...base.vars,
          "--icon-folder": "#64B5F6",
          "--icon-folder-src": "#42A5F5",
          "--icon-folder-components": "#26C6DA",
          "--icon-folder-routes": "#66BB6A",
          "--icon-folder-utils": "#FFA726",
          "--icon-folder-context": "#AB47BC",
          "--icon-folder-pages": "#5C6BC0",
          "--icon-folder-api": "#26A69A",
          "--icon-folder-styles": "#EC407A",
          "--icon-folder-assets": "#9CCC65",
          "--icon-folder-tests": "#FF7043",
        },
        defaultFile: { color: "var(--fg-muted)" },
        defaultFolder: { color: "var(--icon-folder)" },
        fileNames: base.fileNames,
        fileExtensions: base.fileExtensions,
        folderNames: base.folderNames,
      };
    })(),
  },
  {
    id: "ext-minimal-mono-icons",
    name: "Minimal Mono Icons",
    author: "Lumen Community",
    version: "1.0.0",
    category: "IconTheme",
    summary: "Iconos monocromáticos minimalistas que heredan el color de acento del tema activo.",
    readme:
      "Minimal Mono Icons reduce el ruido visual manteniendo los símbolos por tecnología y carpeta pero usando exclusivamente los colores del tema activo (--accent y --fg-muted).",
    iconTheme: (() => {
      const base = cloneBaseIconMaps();
      const monoMap = (m: Record<string, { color: string; badge?: string }>, color: string) =>
        Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { ...v, color }]));
      return {
        id: "minimal-mono-icons",
        name: "Minimal Mono Icons",
        author: "Lumen Community",
        vars: {
          "--icon-folder": "var(--fg-muted)",
          "--icon-folder-src": "var(--accent)",
          "--icon-folder-components": "var(--accent)",
          "--icon-folder-routes": "var(--accent)",
          "--icon-folder-utils": "var(--fg-muted)",
          "--icon-folder-context": "var(--accent)",
          "--icon-folder-pages": "var(--fg-muted)",
          "--icon-folder-api": "var(--accent)",
          "--icon-folder-styles": "var(--fg-muted)",
          "--icon-folder-assets": "var(--fg-muted)",
          "--icon-folder-tests": "var(--fg-muted)",
          "--icon-folder-git": "var(--accent)",
          "--icon-folder-muted": "var(--fg-faint)",
        },
        defaultFile: { color: "var(--fg-muted)" },
        defaultFolder: { color: "var(--fg-muted)" },
        fileNames: monoMap(base.fileNames, "var(--fg-muted)"),
        fileExtensions: monoMap(base.fileExtensions, "var(--accent)"),
        folderNames: base.folderNames,
      };
    })(),
  },
];

function builtinToExtensions(): ExtensionManifest[] {
  const themeExts: ExtensionManifest[] = BUILTIN_THEMES.map((t) => ({
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

  const iconExts: ExtensionManifest[] = BUILTIN_ICON_THEMES.map((it) => ({
    id: `builtin-icon-${it.id}`,
    name: it.name,
    author: it.author,
    version: "1.0.0",
    category: "IconTheme",
    summary: it.description ?? "Paquete de iconos integrado de LumenCode.",
    readme: `${it.name} incluye iconos por defecto de LumenCode para tecnologías y carpetas semánticas (src, routes, components, utils, context, pages, api, styles, tests, etc.).`,
    iconTheme: it,
    builtin: true,
  }));

  return [...themeExts, ...iconExts];
}

export function loadInstalledExtensionIds(): Set<string> {
  try {
    const raw = localStorage.getItem(INSTALLED_KEY);
    const ids = raw ? (JSON.parse(raw) as string[]) : [];
    const set = new Set(Array.isArray(ids) ? ids : []);
    for (const b of BUILTIN_THEMES) set.add(`builtin-${b.id}`);
    for (const it of BUILTIN_ICON_THEMES) set.add(`builtin-icon-${it.id}`);
    return set;
  } catch {
    return new Set([
      ...BUILTIN_THEMES.map((b) => `builtin-${b.id}`),
      ...BUILTIN_ICON_THEMES.map((it) => `builtin-icon-${it.id}`),
    ]);
  }
}

function saveInstalledIds(ids: Set<string>): void {
  localStorage.setItem(INSTALLED_KEY, JSON.stringify([...ids]));
}

export function getCatalogExtensions(): ExtensionManifest[] {
  const builtins = builtinToExtensions();
  const communityThemeIds = new Set(COMMUNITY_EXTENSIONS.map((e) => e.theme?.id).filter(Boolean));
  const communityIconIds = new Set(COMMUNITY_EXTENSIONS.map((e) => e.iconTheme?.id).filter(Boolean));

  const localThemes: ExtensionManifest[] = loadCustomThemes()
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

  const localIcons: ExtensionManifest[] = loadCustomIconThemes()
    .filter((it) => !communityIconIds.has(it.id))
    .map((it: IconThemeManifest) => ({
      id: `local-icon-${it.id}`,
      name: it.name,
      author: it.author,
      version: "local",
      category: "IconTheme",
      summary: "Paquete de iconos importado localmente desde archivo .json.",
      readme: `Paquete de iconos importado desde un archivo .json local.\n\nAutor: ${it.author}`,
      iconTheme: it,
    }));

  return [...COMMUNITY_EXTENSIONS, ...localThemes, ...localIcons, ...builtins];
}

export function isExtensionInstalled(ext: ExtensionManifest): boolean {
  if (ext.builtin || ext.id.startsWith("local-") || ext.id.startsWith("local-icon-")) return true;
  return loadInstalledExtensionIds().has(ext.id);
}

export function installExtension(ext: ExtensionManifest): void {
  const ids = loadInstalledExtensionIds();
  ids.add(ext.id);
  saveInstalledIds(ids);
  if (ext.theme) saveCustomTheme(ext.theme);
  if (ext.iconTheme) saveCustomIconTheme(ext.iconTheme);
}

export function uninstallExtension(ext: ExtensionManifest): void {
  if (ext.builtin) return;
  const ids = loadInstalledExtensionIds();
  ids.delete(ext.id);
  saveInstalledIds(ids);
  if (ext.theme) removeCustomTheme(ext.theme.id);
  if (ext.iconTheme) removeCustomIconTheme(ext.iconTheme.id);
}
