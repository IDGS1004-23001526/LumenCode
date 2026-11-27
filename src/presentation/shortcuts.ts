import type { AppStore } from "../application/reducer";
import type { UseCases } from "../application/useCases";
import { isBusyLoaderActive } from "./busyLoader";

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

/** En Windows, AltGr dispara ctrlKey && altKey simultáneamente; nunca debe interpretarse como atajo Ctrl+. */
function isAltGrEvent(e: KeyboardEvent): boolean {
    return (e.ctrlKey && e.altKey) || Boolean(e.getModifierState?.("AltGraph"));
}

export function registerShortcuts(store: AppStore, uc: UseCases) {
    // Fase capture: solo bloqueo de busyLoader y atajos explícitos de la aplicación.
    window.addEventListener("keydown", (e) => {
        if (isBusyLoaderActive()) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        if (isAltGrEvent(e)) return;
        if (!(e.ctrlKey || e.metaKey) || e.altKey) return;

        const k = e.key.toLowerCase();
        let action: (() => unknown) | null = null;

        if (e.shiftKey && k === "s") action = uc.saveActiveAs;
        else if (!e.shiftKey && k === "s") action = uc.saveActive;
        else if (!e.shiftKey && k === "o") action = uc.openFileDialog;
        else if (e.shiftKey && k === "o") action = uc.openFolder;
        else if (!e.shiftKey && k === "n") action = () => uc.createEntry("file");
        else if (!e.shiftKey && k === "w") action = () => { const st = store.getState(); if (st.activePath) return uc.closeTab(st.activePath, st.activeGroupId); };
        else if (!e.shiftKey && k === "b") action = () => store.dispatch({ type: "sidebar/toggle" });
        else if (!e.shiftKey && (e.code === "Backslash" || k === "\\")) action = () => uc.splitActiveGroup();
        else if (e.shiftKey && k === "g") action = () => store.dispatch({ type: "git/toggle" });
        else if (!e.shiftKey && (e.code === "Backquote" || k === "ñ")) action = () => store.dispatch({ type: "panel/toggle" });
        else if (!e.shiftKey && k === ",") action = () => store.dispatch({ type: "settings/open", open: true });
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
        } else if (!e.shiftKey && (k === "0" || e.code === "Digit0" || e.code === "Numpad0")) {
            action = () => store.dispatch({ type: "settings/update", patch: { fontSize: 14 } });
        }

        if (action) {
            e.preventDefault();
            void action();
        }
    }, { capture: true });

    // Fase bubble: bloquea atajos nativos del navegador solo si CodeMirror/controles no los consumieron.
    window.addEventListener("keydown", (e) => {
        if (e.defaultPrevented || isAltGrEvent(e)) return;

        const inEditor = e.target instanceof HTMLElement && Boolean(e.target.closest(".cm-editor"));

        if (
            e.key === "BrowserBack" ||
            e.key === "BrowserForward" ||
            (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) ||
            BLOCKED_FUNCTION_KEYS.has(e.key)
        ) {
            e.preventDefault();
            return;
        }

        if (!(e.ctrlKey || e.metaKey) || e.altKey) return;

        const k = e.key.toLowerCase();
        const browserOnlyOutsideEditor = (k === "h" || k === "d" || k === "l" || k === "f") && !inEditor;
        const blockedShiftCombo = e.shiftKey && !isEditableTarget(e.target);

        if (BLOCKED_CTRL_KEYS.has(k) || browserOnlyOutsideEditor || (blockedShiftCombo && k !== "z")) {
            e.preventDefault();
        }
    }, { capture: false });

    // Evita zoom nativo del WebView con Ctrl + rueda del ratón
    window.addEventListener("wheel", (e) => {
        if (e.ctrlKey || e.metaKey) e.preventDefault();
    }, { passive: false });

    // Evita que arrastrar y soltar archivos en la ventana navegue fuera de la app
    window.addEventListener("dragover", (e) => e.preventDefault());
    window.addEventListener("drop", (e) => e.preventDefault());
}