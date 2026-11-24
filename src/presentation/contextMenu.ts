import { animateContextMenuIn, animateContextMenuOut } from "./animate";
import { h } from "./dom";

export type MenuEntry = { label: string; shortcut?: string; disabled?: boolean; run: () => unknown } | "separator";

let current: HTMLElement | null = null;
let attachTimer: ReturnType<typeof setTimeout> | null = null;

function onOutside (e: PointerEvent) {
    if (current && !current.contains(e.target as Node)) hideContextMenu();
}

function onEsc(e: KeyboardEvent) {
    if (e.key === "Escape") hideContextMenu();
}

export function hideContextMenu(immediate = false) {
    if (attachTimer !== null) {
        clearTimeout(attachTimer);
        attachTimer = null;
    }
    const closing = current;
    current = null;
    document.removeEventListener("pointerdown", onOutside);
    document.removeEventListener("keydown", onEsc);
    if (!closing) return;
    if (immediate) {
        closing.remove();
        return;
    }
    closing.style.pointerEvents = "none";
    animateContextMenuOut(closing, () => closing.remove());
}

export function showContextMenu(x: number, y: number, entries: MenuEntry[]) {
    hideContextMenu(true);

    const menu = h("div", { class: "context-menu", role: "menu" });

    for (const it of entries) {
        if (it === "separator") {
            menu.append(h("div", { class: "menu-sep" }))
            continue;
        }

        menu.append(
            h(
                "button",
                { class: "menu-item", role: "menuitem", disabled: !!it.disabled, onclick: () => { hideContextMenu(); void it.run(); } },
                h("span", {}, it.label),
                it.shortcut ? h("kbd", {}, it.shortcut) : null
            ),
        );
    }

    document.body.append(menu);
    const { width, height } = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(x, innerWidth - width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, innerHeight - height - 8))}px`;
    current = menu;
    animateContextMenuIn(menu);

    attachTimer = setTimeout(() => {
        attachTimer = null;
        if (current !== menu) return;
        document.addEventListener("pointerdown", onOutside);
        document.addEventListener("keydown", onEsc);
    });
}