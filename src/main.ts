import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./styles.css";

import { getCurrentWindow } from "@tauri-apps/api/window";

import { DEFAULT_SETTINGS, type Settings } from "./domain/types";
import { createStore } from "./application/store";
import { initialState, reducer } from "./application/reducer";
import type { DialogPort } from "./application/ports";
import { createUseCases } from "./application/useCases";

import { createTauriFileSystem } from "./infraestructure/tauriFileSystem";
import { createTauriDialogs } from "./infraestructure/tauriDialogs";
import { NativeTerminal } from "./infraestructure/nativeTerminal";
import { localSettingsRepository } from "./infraestructure/localSettingsRepository";
import { findTheme } from "./infraestructure/themeRepository";
import { setAnimationsEnabled } from "./presentation/animate";

import { createCodeMirrorEditor } from "./presentation/editor/codemirrorEditor";
import { promptModal } from "./presentation/promptModal";
import { registerShortcuts } from "./presentation/shortcuts";
import { mountExplorer } from "./presentation/views/explorerView";
import { mountTabBar } from "./presentation/editor/tabBarView";
import { mountBottomPanel } from "./presentation/editor/bottomPanelView";
import { mountSettingsModal } from "./presentation/editor/settingsModal";
import { showContextMenu } from "./presentation/contextMenu";
import { WorkspaceIndexer } from "./application/workspaceIndexer";

const $ = (id: string) => document.getElementById(id) as HTMLElement;

// Estado
const settingsRepo = localSettingsRepository;
const store = createStore(reducer, initialState({ ...DEFAULT_SETTINGS, ...settingsRepo.load() }));

// Adaptadores
const fs = createTauriFileSystem();
const dialogs: DialogPort = { ...createTauriDialogs(), prompt: promptModal };
const terminal = new NativeTerminal(); // Aquí invoca PowerShell en Win, zsh en Mac o bash en Linux
const indexer = new WorkspaceIndexer(fs);
const editor = createCodeMirrorEditor($("editor"), {
  onChange: (path, content) => {
    store.dispatch({ type: "tab/dirty", path, dirty: true });
    indexer.updateFile(path, content);
  },
  getIndex: () => indexer.index,
});

// Casos de uso
const uc = createUseCases({ store, fs, dialogs, editor, terminal, indexer });

// Vistas
mountExplorer($("sidebar"), store, uc);
mountTabBar($("tabbar"), store, uc);
mountBottomPanel($("panel"), store, terminal);
mountSettingsModal(store);
registerShortcuts(store, uc);

// Efectos globales derivados del estado
let appliedThemeVars: string[] = [];

function applySettings(s: Settings) {
  setAnimationsEnabled(s.animations ?? true);
  const root = document.documentElement.style;
  const activeTheme = findTheme(s.theme);
  for (const k of appliedThemeVars) root.removeProperty(k);
  appliedThemeVars = Object.keys(activeTheme.colors);
  for (const [varName, value] of Object.entries(activeTheme.colors)) {
    root.setProperty(varName, value);
  }
  root.setProperty("--tab-inactive", activeTheme.colors["--tab-inactive"] ?? activeTheme.colors["--surface"] ?? "#eaeff5");
  root.setProperty("--fg-faint", activeTheme.colors["--fg-faint"] ?? activeTheme.colors["--fg-muted"] ?? "#9aa5b1");
  root.colorScheme = activeTheme.dark ? "dark" : "light";

  root.setProperty("--editor-font", s.fontFamily);
  root.setProperty("--editor-font-size", `${s.fontSize}px`);
  root.setProperty(
    "--cursor-transition",
    s.cursorSmooth ? "left 85ms cubic-bezier(0.22, 1, 0.36, 1), top 85ms cubic-bezier(0.22, 1, 0.36, 1)" : "none",
  );

  const animMap: Record<Settings["cursorBlinking"], string> = {
    expand: "cm-expand 1.1s ease-in-out infinite",
    smooth: "cm-smooth 1.1s ease-in-out infinite",
    phase: "cm-phase 1.1s ease-in-out infinite",
    blink: "cm-blink 1.1s step-end infinite",
    solid: "none",
  };
  root.setProperty("--cursor-animation", animMap[s.cursorBlinking] ?? "none");
  settingsRepo.save(s);
  editor.remeasure();
}

store.subscribe((s, p) => {
  if (s.activePath !== p.activePath) editor.activate(s.activePath);
  if (s.settings !== p.settings) applySettings(s.settings);
  if (s.sidebarVisible !== p.sidebarVisible) $("app").classList.toggle("no-sidebar", !s.sidebarVisible);
  if (s.panelVisible !== p.panelVisible) editor.remeasure();
  const active = s.tabs.find((t) => t.path === s.activePath);
  document.title = active ? `${active.dirty ? "● " : ""}${active.name} - Lumencode` : "LumenCode";
});

applySettings(store.getState().settings);

// Avisar al cerrar la ventana si hay cambios sin guardar y liberar subprocesos
const appWin = getCurrentWindow();
void appWin.onCloseRequested(async (event) => {
  const dirty = store.getState().tabs.some((t) => t.dirty);
  if (dirty) {
    event.preventDefault();
    const ok = await dialogs.confirm(
      "Hay archivos con cambios sin guardar. ¿Salir de todos modos?",
      "Salir sin guardar",
    );
    if (!ok) return;
  }
  await terminal.kill().catch(() => {});
  await appWin.destroy();
});

window.addEventListener("contextmenu", (e) => {
  e.preventDefault();

  const root = store.getState().rootPath;
  const noRoot = !root;

  showContextMenu(e.clientX, e.clientY, [
    { label: "Nuevo archivo", disabled: noRoot, run: () => uc.createEntry("file") },
    { label: "Nueva Carpeta", disabled: noRoot, run: () => uc.createEntry("folder") },
    "separator",
    { label: "Abrir carpeta...", shortcut: "Ctrl+O", run: uc.openFolder },
    { label: "Guardar archivo", shortcut: "Ctrl+s", disabled: !store.getState().activePath, run: uc.saveActive },
    "separator",
    { label: "Mostrar/ocultar terminal", shortcut: "Ctrl+`", run: () => store.dispatch({ type: "panel/toggle" }) },
    { label: "Preferencias...", shortcut: "Ctrl+,", run: () => store.dispatch({ type: "settings/open", open: true }) },
  ]);
});