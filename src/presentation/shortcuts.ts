import type { AppStore } from "../application/reducer";
import type { UseCases } from "../application/useCases";

const BLOCKED_FUNCTION_KEYS = new Set(["F1", "F3", "F5", "F6", "F7", "F10", "F12"]);
const BLOCKED_CTRL_KEYS = new Set([
    "r", "p", "u", "n", "t", "j", "g", "k", "e", "i", "q", "m",
    "tab", "pageup", "pagedown", "f4", "f5", "f12",
]);

function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target.closest(".cm-editor")) return true;
    const tag = target.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

export function registerShortcuts(store: AppStore, uc: UseCases) {
    window.addEventListener("keydown", (e) => {
        const inEditor = e.target instanceof HTMLElement && Boolean(e.target.closest(".cm-editor"));

        // Bloquea navegación atrás/adelante y teclas de función del navegador
        if (
            e.key === "BrowserBack" ||
            e.key === "BrowserForward" ||
            (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) ||
            (!e.defaultPrevented && BLOCKED_FUNCTION_KEYS.has(e.key) && !(e.key === "F3" && inEditor))
        ) {
            e.preventDefault();
            return;
        }

        if (!(e.ctrlKey || e.metaKey)) return;

        const k = e.key.toLowerCase();
        let action: (() => unknown) | null = null;

        if (k === "s") action = uc.saveActive;
        else if (k === "w") action = () => { const a = store.getState().activePath; if (a) return uc.closeTab(a); };
        else if (k === "o") action = uc.openFolder;
        else if (k === "b") action = () => store.dispatch({ type: "sidebar/toggle" });
        else if (e.code === "Backquote" || k === "ñ") action = () => store.dispatch({ type: "panel/toggle" });
        else if (k === ",") action = () => store.dispatch({ type: "settings/open", open: true });
        else if (k === "+" || k === "=" || e.code === "Equal" || e.code === "NumpadAdd") {
            action = () => {
                const cur = store.getState().settings.fontSize;
                store.dispatch({ type: "settings/update", patch: { fontSize: Math.min(26, cur + 1) } });
            };
        } else if (k === "-" || k === "_" || e.code === "Minus" || e.code === "NumpadSubtract") {
            action = () => {
                const cur = store.getState().settings.fontSize;
                store.dispatch({ type: "settings/update", patch: { fontSize: Math.max(10, cur - 1) } });
            };
        } else if (k === "0" || e.code === "Digit0" || e.code === "Numpad0") {
            action = () => store.dispatch({ type: "settings/update", patch: { fontSize: 14 } });
        }

        if (action) {
            e.preventDefault();
            void action();
            return;
        }

        if (e.defaultPrevented) return;

        // Bloquea atajos de navegador (recarga, imprimir, historial, marcadores, nueva pestaña/ventana, devtools, etc.)
        const browserOnlyOutsideEditor = (k === "h" || k === "d" || k === "l" || k === "f") && !inEditor;
        const blockedShiftCombo = e.shiftKey && !isEditableTarget(e.target);

        if (BLOCKED_CTRL_KEYS.has(k) || browserOnlyOutsideEditor || (blockedShiftCombo && k !== "z")) {
            e.preventDefault();
        }
    }, { capture: true });

    // Evita zoom nativo del WebView con Ctrl + rueda del ratón
    window.addEventListener("wheel", (e) => {
        if (e.ctrlKey || e.metaKey) e.preventDefault();
    }, { passive: false });

    // Evita que arrastrar y soltar archivos en la ventana navegue fuera de la app
    window.addEventListener("dragover", (e) => e.preventDefault());
    window.addEventListener("drop", (e) => e.preventDefault());
}