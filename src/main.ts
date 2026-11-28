import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./styles.css";

import { Image } from "@tauri-apps/api/image";
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
import { findIconTheme } from "./infraestructure/iconThemeRepository";
import { lspClient } from "./infraestructure/lspClient";
import { updaterClient } from "./infraestructure/updaterClient";
import { animateLayoutWithPanel, setAnimationsEnabled } from "./presentation/animate";

import { createCodeMirrorEditor } from "./presentation/editor/codemirrorEditor";
import { withBusyLoader } from "./presentation/busyLoader";
import { confirmModal, promptModal } from "./presentation/promptModal";
import { mountResizers } from "./presentation/resizer";
import { registerShortcuts } from "./presentation/shortcuts";
import { mountExplorer } from "./presentation/views/explorerView";
import { mountSourceControl } from "./presentation/views/sourceControlView";
import { mountStatusBar } from "./presentation/views/statusBarView";
import { mountTitlebar } from "./presentation/views/titlebarView";
import { mountEditorGroups } from "./presentation/editor/editorGroupsView";
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
const dialogs: DialogPort = {
  ...createTauriDialogs(),
  prompt: promptModal,
  confirm: confirmModal,
  withBusy: withBusyLoader,
};
const terminal = new NativeTerminal(); // Aquí invoca PowerShell en Win, zsh en Mac o bash en Linux
const indexer = new WorkspaceIndexer(fs);
let bottomPanel: ReturnType<typeof mountBottomPanel> | null = null;
let statusBar: ReturnType<typeof mountStatusBar> | null = null;
const editor = createCodeMirrorEditor({
  onChange: (path, content) => {
    store.dispatch({ type: "tab/dirty", path, dirty: true });
    indexer.updateFile(path, content);
  },
  getIndex: () => indexer.index,
  getAssetFiles: () => indexer.assetFiles,
  getRootPath: () => store.getState().rootPath,
  getGitRoot: () => {
    const g = store.getState().git;
    return g?.is_repo ? g.root : store.getState().rootPath;
  },
  readText: (path) => fs.readText(path),
  onNavigate: (path, line, character) => void uc.openFileAt(path, line, character),
  onGitMutated: () => uc.scheduleGitRefresh(),
  onOpenDiff: (diff) => uc.openDiffTab(diff),
  onDiffMutated: (repoRoot, relPath, touchedDisk) => uc.gitReloadAfterDiffMutation(repoRoot, relPath, touchedDisk),
  confirmAction: (msg, okLabel) => dialogs.confirm(msg, okLabel),
  onError: (msg) => dialogs.error(msg),
  onDiagnostics: (path, diags) => bottomPanel?.updateDiagnostics(path, diags),
  onIndentChange: (label) => statusBar?.setIndentation(label),
});

// Casos de uso
const uc = createUseCases({ store, fs, dialogs, editor, terminal, indexer });

// Vistas
mountTitlebar($("titlebar"), store, () => {
  void updaterClient.installAndRestart({
    beforeInstall: async () => {
      const dirty = store.getState().tabs.some((t) => t.dirty);
      if (dirty) {
        const ok = await dialogs.confirm(
          "Hay archivos con cambios sin guardar. ¿Reiniciar y actualizar de todos modos?",
          "Reiniciar y actualizar",
        );
        if (!ok) return false;
      }
      await Promise.allSettled([terminal.kill(), lspClient.stopAll()]);
      return true;
    },
    onError: (msg) => dialogs.error(msg),
  });
});
updaterClient.start((state) => store.dispatch({ type: "update/state", state }));
mountExplorer($("sidebar"), store, uc);
mountSourceControl(store, uc, dialogs.error);
mountEditorGroups($("editor"), store, uc, editor);
bottomPanel = mountBottomPanel(
  $("panel"),
  store,
  terminal,
  (cmd) => {
    if (/^\s*git\b/i.test(cmd)) {
      void uc.refresh();
    } else {
      uc.scheduleGitRefresh();
      uc.scheduleIndexRefresh();
    }
  },
  (path, line, character) => void uc.openFileAt(path, line, character),
);
indexer.setDiagnosticsListener((diagsByFile) => bottomPanel?.replaceWorkspaceDiagnostics(diagsByFile));
statusBar = mountStatusBar($("statusbar"), store, uc, dialogs.error);
mountResizers($("sidebar"), $("panel"), () => editor.remeasure());
mountSettingsModal(store);
registerShortcuts(store, uc);

window.addEventListener("focus", () => {
  uc.scheduleGitRefresh();
  uc.scheduleIndexRefresh();
});

// Efectos globales derivados del estado
let appliedThemeVars: string[] = [];
let appliedIconVars: string[] = [];
let lastTaskbarThemeKey = "";

async function updateTaskbarIcon(surface: string, border: string, fg: string, accent: string) {
  const key = `${surface}|${border}|${fg}|${accent}`;
  if (key === lastTaskbarThemeKey) return;
  lastTaskbarThemeKey = key;

  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const s = size / 96;
  ctx.scale(s, s);

  ctx.beginPath();
  ctx.roundRect(10, 10, 76, 76, 22);
  ctx.fillStyle = surface;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = border;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(36, 30);
  ctx.lineTo(36, 62);
  ctx.lineTo(56, 62);
  ctx.strokeStyle = fg;
  ctx.lineWidth = 8;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(58, 35, 6.5, 0, Math.PI * 2);
  ctx.fillStyle = accent;
  ctx.fill();

  const rgba = new Uint8Array(ctx.getImageData(0, 0, size, size).data);
  try {
    const icon = await Image.new(rgba, size, size);
    await getCurrentWindow().setIcon(icon);
  } catch {}
}

function applySettings(s: Settings) {
  const animEnabled = s.animations ?? true;
  setAnimationsEnabled(animEnabled);
  if (!animEnabled) document.documentElement.setAttribute("data-no-anim", "true");
  else document.documentElement.removeAttribute("data-no-anim");
  const root = document.documentElement.style;
  const activeTheme = findTheme(s.theme);
  for (const k of appliedThemeVars) root.removeProperty(k);
  const synFn = activeTheme.colors["--syn-function"] ?? activeTheme.colors["--syn-fn"];
  const safeVarKeys = Object.keys(activeTheme.colors).filter((k) => k.startsWith("--"));
  appliedThemeVars = [...new Set([...safeVarKeys, "--syn-function", "--syn-fn"])];
  for (const varName of safeVarKeys) {
    root.setProperty(varName, activeTheme.colors[varName]);
  }
  if (synFn) {
    root.setProperty("--syn-function", synFn);
    root.setProperty("--syn-fn", synFn);
  }
  root.setProperty("--tab-inactive", activeTheme.colors["--tab-inactive"] ?? activeTheme.colors["--surface"] ?? "#eaeff5");
  root.setProperty("--fg-faint", activeTheme.colors["--fg-faint"] ?? activeTheme.colors["--fg-muted"] ?? "#9aa5b1");
  root.colorScheme = activeTheme.dark ? "dark" : "light";

  const activeIconTheme = findIconTheme(s.iconTheme);
  for (const k of appliedIconVars) root.removeProperty(k);
  appliedIconVars = Object.keys(activeIconTheme.vars ?? {});
  for (const [varName, value] of Object.entries(activeIconTheme.vars ?? {})) {
    root.setProperty(varName, value);
  }

  root.setProperty("--editor-font", s.fontFamily);
  root.setProperty("--editor-font-size", `${s.fontSize}px`);
  root.setProperty("--ui-font-size", `${Math.max(10, Math.min(20, s.fontSize))}px`);
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
  try {
    localStorage.setItem("lumen.startupTheme.v1", JSON.stringify({
      bg: activeTheme.colors["--bg"] ?? "#F0F4F8",
      surface: activeTheme.colors["--surface"] ?? "#E1E8ED",
      border: activeTheme.colors["--border"] ?? "#D3DCE4",
      fg: activeTheme.colors["--fg"] ?? "#3E4A5B",
      accent: activeTheme.colors["--accent"] ?? "#5D9CEC",
      dark: activeTheme.dark,
      animations: s.animations ?? true,
    }));
  } catch {}
  void updateTaskbarIcon(
    activeTheme.colors["--surface"] ?? activeTheme.colors["--bg"] ?? "#E1E8ED",
    activeTheme.colors["--border"] ?? "#D3DCE4",
    activeTheme.colors["--fg"] ?? "#3E4A5B",
    activeTheme.colors["--accent"] ?? "#5D9CEC",
  );
  settingsRepo.save(s);
  editor.configure({ tabSize: s.tabSize, wordWrap: s.wordWrap, dark: activeTheme.dark });
  editor.remeasure();
}

store.subscribe((s, p) => {
  if (s.rootPath !== p.rootPath) void lspClient.stopAll();
  if (s.settings !== p.settings) applySettings(s.settings);
  if (s.sidebarVisible !== p.sidebarVisible) {
    const appEl = $("app");
    const sidebarEl = $("sidebar");
    const workbenchEl = document.querySelector(".workbench") as HTMLElement | null;
    animateLayoutWithPanel(
      sidebarEl,
      workbenchEl,
      s.sidebarVisible,
      () => appEl.classList.toggle("no-sidebar", !s.sidebarVisible),
      () => editor.remeasure(),
    );
  }
  if (s.panelVisible !== p.panelVisible) editor.remeasure();
  const active = s.tabs.find((t) => t.path === s.activePath);
  document.title = active ? `${active.dirty ? "● " : ""}${active.name} - Lumencode` : "LumenCode";
});

applySettings(store.getState().settings);

const appWin = getCurrentWindow();
void appWin.show();

const splash = document.getElementById("lumen-splash");
if (splash) {
  const hideSplash = () => {
    if (!splash.isConnected) return;
    if (!(store.getState().settings.animations ?? true)) {
      splash.remove();
      return;
    }
    splash.classList.add("hide");
    setTimeout(() => splash.remove(), 300);
  };
  void Promise.race([
    document.fonts.ready,
    new Promise((r) => setTimeout(r, 400)),
  ]).then(() => requestAnimationFrame(hideSplash));
}
let closingWindow = false;
void appWin.onCloseRequested(async (event) => {
  event.preventDefault();
  if (closingWindow) return;
  closingWindow = true;
  try {
    const dirty = store.getState().tabs.some((t) => t.dirty);
    if (dirty) {
      const ok = await dialogs.confirm(
        "Hay archivos con cambios sin guardar. ¿Salir de todos modos?",
        "Salir sin guardar",
      );
      if (!ok) {
        closingWindow = false;
        return;
      }
    }
    await Promise.allSettled([terminal.kill(), lspClient.stopAll()]);
    await appWin.destroy();
  } catch {
    closingWindow = false;
  }
});

window.addEventListener("contextmenu", (e) => {
  if (e.defaultPrevented) return;
  e.preventDefault();

  const root = store.getState().rootPath;
  const noRoot = !root;

  const activePath = store.getState().activePath;
  const canSave = Boolean(activePath && editor.isEditable(activePath));

  showContextMenu(e.clientX, e.clientY, [
    { label: "Nuevo archivo", disabled: noRoot, run: () => uc.createEntry("file") },
    { label: "Nueva Carpeta", disabled: noRoot, run: () => uc.createEntry("folder") },
    "separator",
    { label: "Abrir archivo...", shortcut: "Ctrl+O", run: uc.openFileDialog },
    { label: "Abrir carpeta...", shortcut: "Ctrl+Shift+O", run: uc.openFolder },
    { label: "Guardar archivo", shortcut: "Ctrl+s", disabled: !canSave, run: uc.saveActive },
    "separator",
    { label: "Mostrar/ocultar terminal", shortcut: "Ctrl+`", run: () => store.dispatch({ type: "panel/toggle" }) },
    { label: "Preferencias...", shortcut: "Ctrl+,", run: () => store.dispatch({ type: "settings/open", open: true }) },
  ]);
});