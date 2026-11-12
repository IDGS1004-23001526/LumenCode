import type { AppState, CursorBlinking } from "../../domain/types";
import type { AppStore } from "../../application/reducer";
import { h } from "../dom";

const FONTS = [
    { label: "Monaspace Krypton", value: "'Monaspace Krypton', 'JetBrains Mono Variable', monospace" },
    { label: "JetBrains Mono", value: "'JetBrains Mono Variable', monospace" },
    { label: "Consolas", value: "Consolas, monospace" },
];

const SHORTCUTS = [
    ["Ctrl+S", "Guardar"], ["Ctrl+W", "Cerrar pestaña"], ["Ctrl+O", "Abrir carpeta"],
    ["Ctrl+`", "Mostrar/ocultar panel"], ["Ctrl+B", "Mostrar/ocultar explorador"], ["Ctrl+,", "Configuración"],
];

const BLINK_MODES: { label: string; value: CursorBlinking }[] = [
    { label: "Expand", value: "expand" },
    { label: "Smoth", value: "smooth" },
    { label: "Phase", value: "phase" },
    { label: "Blink", value: "blink" },
    { label: "Solid", value: "solid" },
];

export function mountSettingsModal(store: AppStore) {
    const theme = h("select", { class: "field" }, h("option", { value: "lumen-light" }, "Lumen Light (pastel)")) as HTMLSelectElement;
    const font = h("select", { class: "field" }, ...FONTS.map((f) => h("option", { value: f.value }, f.label))) as HTMLSelectElement;
    const size = h("input", { class: "field", type: "number", min: 10, max: 28 }) as HTMLInputElement;
    const blink = h("select", { class: "field" }, ...BLINK_MODES.map((b) => h("option", { value: b.value }, b.label))) as HTMLSelectElement;

    const smooth = h(
        "select",
        { class: "field" },
        h("option", { value: "on" }, "On"),
        h("option", { value: "off" }, "Off")
    ) as HTMLSelectElement;

    font.addEventListener("change", () => store.dispatch({ type: "settings/update", patch: { fontFamily: font.value } }));
    size.addEventListener("input", () => {
        const n = Number(size.value);
        if (n >= 10 && n <= 28) store.dispatch({ type: "settings/update", patch: { fontSize: n } });
    });

    blink.addEventListener("change", () => store.dispatch({ type: "settings/update", patch: { cursorBlinking: blink.value as CursorBlinking } }),);

    smooth.addEventListener("change", () => store.dispatch({ type: "settings/update", patch: { cursorSmooth: smooth.value === "on" } }),);

    const row = (label: string, control: HTMLElement) => h("label", { class: "settings-row" }, h("span", {}, label), control);
    const close = () => store.dispatch({ type: "settings/open", open: false });

    const dlg = h("dialog", { class: "modal settings" },
        h("h2", {}, "Preferencias"),
        row("Tema", theme),
        row("Fuente del editor", font),
        row("Tamaño de fuente", size),
        row("Cursor Blinking", blink),
        row("Smooth Caret Animation", smooth),
        h("h3", {}, "Atajos de teclado"),
        h("table", { class: "shortcuts" }, ...SHORTCUTS.map(([k, d]) => h("tr", {}, h("td", {}, h("kbd", {}, k)), h("td", {}, d)))),
        h("div", { class: "modal-actions" }, h("button", { class: "btn primary", onclick: close }, "Cerrar")),
    ) as HTMLDialogElement;

    dlg.addEventListener("close", () => { if (store.getState().settingsOpen) close(); }) // Esc
    document.body.append(dlg);

    const sync = (s: AppState) => {
        if (s.settingsOpen && !dlg.open) {
            theme.value = s.settings.theme;
            font.value = s.settings.fontFamily;
            size.value = String(s.settings.fontSize);
            blink.value = s.settings.cursorBlinking;
            smooth.value = s.settings.cursorSmooth ? "on" : "off";
            dlg.showModal();
        } else if (!s.settingsOpen && dlg.open) dlg.close();
    };

    store.subscribe(sync);
}