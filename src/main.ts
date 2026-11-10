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

import { createCodeMirrorEditor } from "./presentation/editor/codemirrorEditor";
import { promptModal } from "./presentation/promptModal";
import { registerShortcuts } from "./presentation/shortcuts";
import { mountExplorer } from "./presentation/views/explorerView";
import { mountTabBar } from "./presentation/editor/tabBarView";
import { mountBottomPanel } from "./presentation/editor/bottomPanelView";
import { mountSettingsModal } from "./presentation/editor/settingsModal";

const $ = (id: string) => document.getElementById(id) as HTMLElement;

// Estado
const settingsRepo = localSettingsRepository;
const store = createStore(reducer, initialState({ ...DEFAULT_SETTINGS, ...settingsRepo.load() }));

// Adaptadores
const fs = createTauriFileSystem();
const dialogs: DialogPort = { ...createTauriDialogs(), prompt: promptModal };
const terminal = new NativeTerminal(); // Aquí invoca PowerShell en Win, zsh en Mac o bash en Linux
const editor = createCodeMirrorEditor($("editor"), {
  onChange: (path) => store.dispatch({ type: "tab/dirty", path, dirty: true }),
});

// Casos de uso
const uc = createUseCases({ store, fs, dialogs, editor, terminal });

// Vistas
mountExplorer($("sidebar"), store, uc);
mountTabBar($("tabbar"), store, uc);
mountBottomPanel($("panel"), store, terminal);
mountSettingsModal(store);
registerShortcuts(store, uc);

// Efectos globales derivados del estado
function applySettings(s: Settings) {
  const root = document.documentElement.style;
  root.setProperty("--editor-font", s.fontFamily);
  root.setProperty("--editor-font-size", `${s.fontSize}px`);
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

// Avisar al cerrar la ventana si hay cambios sin guardar
void getCurrentWindow().onCloseRequested(async (event) => {
  const dirty = store.getState().tabs.some((t) => t.dirty);
  if (dirty && !(await dialogs.confirm("Hay archivos con cambios sin guardar. ¿Salir de todos modos?"))) {
    event.preventDefault();
  }
});