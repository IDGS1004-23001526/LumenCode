import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./styles.css";

import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask, open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

import { createEditor } from "./editor";

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

let currentPath: string | null = null;
let dirty = false;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const docTitle = $("doc-title");
const stDirty = $("st-dirty");
const stPos = $("st-pos");
const stLang = $("st-lang");

const appWindow = getCurrentWindow();

const fileName = (p: string | null) => (p ? (p.split(/[\\/]/).pop() ?? p) : "Sin título");

function refreshChrome() {
  const name = fileName(currentPath);
  docTitle.textContent = dirty ? `${name} •` : name;
  stDirty.hidden = !dirty;
  document.title = `${dirty ? "● " : ""}${name} — Lumen`;
  void appWindow.setTitle(document.title);
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

const editor = createEditor($("editor"), {
  onChange: () => {
    if (!dirty) {
      dirty = true;
      refreshChrome();
    }
  },
  onCursor: (line, col) => {
    stPos.textContent = `Ln ${line}, Col ${col}`;
  },
});

// ---------------------------------------------------------------------------
// Acciones de archivo
// ---------------------------------------------------------------------------

async function confirmDiscard(): Promise<boolean> {
  if (!dirty) return true;
  return ask("Tienes cambios sin guardar. ¿Descartarlos?", {
    title: "Lumen",
    kind: "warning",
    okLabel: "Descartar",
    cancelLabel: "Cancelar",
  });
}

async function newFile() {
  if (!(await confirmDiscard())) return;
  currentPath = null;
  dirty = false;
  stLang.textContent = editor.load("", null).name;
  refreshChrome();
}

async function openFile() {
  if (!(await confirmDiscard())) return;
  const selected = await open({ multiple: false, directory: false });
  if (typeof selected !== "string") return;
  try {
    const text = await readTextFile(selected);
    currentPath = selected;
    dirty = false;
    stLang.textContent = editor.load(text, selected).name;
    refreshChrome();
  } catch (err) {
    await ask(`No se pudo abrir el archivo.\n\n${String(err)}`, { title: "Lumen", kind: "error", okLabel: "Ok" });
  }
}

async function saveFile(forceDialog = false) {
  let target = currentPath;
  if (!target || forceDialog) {
    const chosen = await save({ defaultPath: currentPath ?? undefined });
    if (!chosen) return;
    target = chosen;
  }
  try {
    await writeTextFile(target, editor.getText());
    currentPath = target;
    dirty = false;
    stLang.textContent = editor.setLanguage(target).name;
    refreshChrome();
  } catch (err) {
    await ask(`No se pudo guardar el archivo.\n\n${String(err)}`, { title: "Lumen", kind: "error", okLabel: "Ok" });
  }
}

// ---------------------------------------------------------------------------
// Eventos de UI
// ---------------------------------------------------------------------------

$("btn-open").addEventListener("click", () => void openFile());
$("btn-save").addEventListener("click", () => void saveFile());
$("win-min").addEventListener("click", () => void appWindow.minimize());
$("win-max").addEventListener("click", () => void appWindow.toggleMaximize());
$("win-close").addEventListener("click", () => void appWindow.close());

window.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  const key = e.key.toLowerCase();
  if (key === "s") {
    e.preventDefault();
    void saveFile(e.shiftKey);
  } else if (key === "o") {
    e.preventDefault();
    void openFile();
  } else if (key === "n") {
    e.preventDefault();
    void newFile();
  }
});

// Pregunta antes de cerrar si hay cambios sin guardar.
void appWindow.onCloseRequested(async (event) => {
  if (!(await confirmDiscard())) event.preventDefault();
});

refreshChrome();
editor.focus();
