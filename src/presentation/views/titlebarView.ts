import { getCurrentWindow } from "@tauri-apps/api/window";
import type { AppState } from "../../domain/types";
import { fileNameOf } from "../../domain/path";
import type { AppStore } from "../../application/reducer";
import { h, iconButton } from "../dom";
import { ICONS } from "../icons";

const TITLEBAR_LOGO_SVG = `<svg width="16" height="16" viewBox="0 0 96 96"><rect x="10" y="10" width="76" height="76" rx="22" fill="var(--bg)" stroke="var(--border)" stroke-width="4"/><path d="M36 30 V62 H56" fill="none" stroke="var(--fg)" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="58" cy="35" r="6.5" fill="var(--accent)"/></svg>`;

const WIN_ICONS = {
  min: `<svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 5h8" stroke="currentColor" stroke-width="1.2"/></svg>`,
  max: `<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="1.5" y="1.5" width="7" height="7" stroke="currentColor" stroke-width="1.1"/></svg>`,
  close: `<svg width="10" height="10" viewBox="0 0 10 10"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`,
};

export function mountTitlebar(el: HTMLElement, store: AppStore) {
  const appWin = getCurrentWindow();
  const isMac = /Mac/i.test(navigator.platform || navigator.userAgent);
  if (isMac) el.classList.add("is-mac");

  const iconEl = h("span", {
    class: "titlebar-icon",
    "data-tauri-drag-region": "",
  });
  iconEl.innerHTML = TITLEBAR_LOGO_SVG;
  const titleEl = h("span", { class: "titlebar-title", "data-tauri-drag-region": "" }, "LumenCode");

  const left = h(
    "div",
    { class: "titlebar-left", "data-tauri-drag-region": "" },
    iconEl,
    h("span", { class: "titlebar-brand", "data-tauri-drag-region": "" }, "LumenCode"),
    titleEl,
  );

  // Acciones globales del workbench (Git, Terminal/Panel, Configuración)
  const gitBadge = h("span", { class: "git-trigger-badge", hidden: true }, "0");
  const gitBtn = iconButton(ICONS.git, "Source Control (Ctrl+Shift+G)", () => store.dispatch({ type: "git/toggle" }));
  gitBtn.classList.add("git-trigger-btn");
  gitBtn.dataset.gitTrigger = "true";
  gitBtn.append(gitBadge);
  const panelBtn = iconButton(ICONS.panel, "Mostrar/ocultar panel (Ctrl+`)", () => store.dispatch({ type: "panel/toggle" }));
  const gearBtn = iconButton(ICONS.gear, "Configuración (Ctrl + ,)", () => store.dispatch({ type: "settings/open", open: true }));
  const actions = h("div", { class: "titlebar-actions" }, gitBtn, panelBtn, gearBtn);

  const mkBtn = (svg: string, title: string, cls: string, onclick: () => void) => {
    const btn = h("button", { class: `titlebar-btn ${cls}`, title, onclick });
    btn.innerHTML = svg;
    return btn;
  };

  const controls = h(
    "div",
    { class: "titlebar-controls" },
    mkBtn(WIN_ICONS.min, "Minimizar", "", () => void appWin.minimize()),
    mkBtn(WIN_ICONS.max, "Maximizar / Restaurar", "", () => void appWin.toggleMaximize()),
    mkBtn(WIN_ICONS.close, "Cerrar", "close", () => void appWin.close()),
  );

  const right = isMac
    ? h("div", { class: "titlebar-right" }, actions)
    : h("div", { class: "titlebar-right" }, actions, h("span", { class: "titlebar-sep", "aria-hidden": "true" }), controls);

  el.replaceChildren(left, right);

  const update = (s: AppState) => {
    const folder = s.rootPath ? fileNameOf(s.rootPath) : null;
    const active = s.tabs.find((t) => t.path === s.activePath);
    const parts: string[] = [];
    if (folder) parts.push(folder);
    if (active) parts.push(`${active.dirty ? "● " : ""}${active.name}`);
    titleEl.textContent = parts.length ? `— ${parts.join(" / ")}` : "";

    panelBtn.classList.toggle("on", s.panelVisible);
    gitBtn.classList.toggle("on", s.gitOpen);
    const count = s.git?.is_repo ? s.git.entries.length : 0;
    gitBadge.hidden = count === 0;
    gitBadge.textContent = count > 99 ? "99+" : String(count);
  };

  update(store.getState());
  store.subscribe((s, p) => {
    if (
      s.rootPath !== p.rootPath ||
      s.activePath !== p.activePath ||
      s.tabs !== p.tabs ||
      s.panelVisible !== p.panelVisible ||
      s.gitOpen !== p.gitOpen ||
      s.git !== p.git
    ) {
      update(s);
    }
  });
}
