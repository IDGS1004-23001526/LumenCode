import type { AppState } from "../../domain/types";
import type { AppStore } from "../../application/reducer";
import type { UseCases } from "../../application/useCases";
import { cx, h, iconButton } from "../dom";
import { ICONS } from "../icons";

export function mountTabBar(el: HTMLElement, store: AppStore, uc: UseCases) {
    const list = h("div", { class: "tabs", role: "tablist" });
    const panelBtn = iconButton(ICONS.panel, "Mostrar/ocultar panel (Ctrl+`)", () => store.dispatch({ type: "panel/toggle" }));
    const gearBtn = iconButton(ICONS.gear, "Configuración (Ctrl + ,)", () => store.dispatch({ type: "settings/open", open: true }));
    el.append(list, h("div", { class: "tab-actions" }, panelBtn, gearBtn));

    function render(s: AppState) {
        list.replaceChildren(
            ...s.tabs.map((t) => {
                const active = t.path === s.activePath;

                return h(
                    "div",
                    {
                        class: cx("tab", active && "active"),
                        role: "tab",
                        "aria-selected": String(active),
                        title: t.path,
                        onclick: () => store.dispatch({ type: "tab/activate", path: t.path }),
                        onauxclick: (e: MouseEvent) => { if (e.button === 1) void uc.closeTab(t.path) },
                    },
                    h("span", { class: "tab-name" }, t.name),
                    t.dirty ? h("span", { class: "tab-dirty" }, "*") : null,
                    h("button", {
                        class: "tab-close",
                        "aria-label": `Cerrar ${t.name}`,
                        title: "Cerrar (Ctrl + W)",
                        onclick: (e: MouseEvent) => { e.stopPropagation(); void uc.closeTab(t.path) },
                    }, "×"),
                );
            }),
        );

        list.querySelector(".tab.active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
        panelBtn.classList.toggle("on", s.panelVisible);
    }

    render(store.getState());
    store.subscribe((s, p) => {
        if (s.tabs !== p.tabs || s.activePath !== p.activePath || s.panelVisible !== p.panelVisible) render(s);
    });
}