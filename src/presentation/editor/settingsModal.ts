import type { AppState } from "../../domain/types";
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

export function mountSettingsModal(store: AppStore) {
    const theme = h("select", { class: "field" }, h("option", { value: "lumen-light" }, "Lumen Light (pastel)")) as HTMLSelectElement;
    const font = h("select", { class: "field" }, ...FONTS.map((f) => h("option", { value: f.value }, f.label))) as HTMLSelectElement;
    const size = h("input", { class: "field", type: "number", min: 10, max: 28 }) as HTMLInputElement;

    font.addEventListener("change", () => store.dispatch({ type: "settings/update", patch: { fontFamily: font.value } }));
    size.addEventListener("input", () => {
        const n = Number(size.value);
        if (n >= 10 && n <= 28) store.dispatch({ type: "settings/update", patch: { fontSize: n } });
    });

    const row = (label: string, control: HTMLElement) => h("label", { class: "settings-row" }, h("span", {}, label), control);
    const close = () => store.dispatch({ type: "settings/open", open: false });

    const dlg = h("dialog", { class: "modal settings" },
        h("h2", {}, "Preferencias"),
        row("Tema", theme),
        row("Fuente del editor", font),
        row("Tamaño de fuente", size),
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
            dlg.showModal();
        } else if (!s.settingsOpen && dlg.open) dlg.close();
    };

    store.subscribe(sync);
}