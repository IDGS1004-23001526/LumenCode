import type { AppStore } from "../application/reducer";
import type { UseCases } from "../application/useCases";

export function registerShortcuts(store: AppStore, uc: UseCases) {
    window.addEventListener("keydown", (e) => {
        if (!(e.ctrlKey || e.metaKey)) return;

        const k = e.key.toLowerCase();
        let action: (() => unknown) | null = null;

        if (k === "s") action = uc.saveActive;
        else if (k === "w") action = () => { const a = store.getState().activePath; if (a) return uc.closeTab(a); };
        else if (k === "o") action = uc.openFolder;
        else if (k === "b") action = () => store.dispatch({ type: "sidebar/toggle" });
        else if (e.code === "Backquote" || k === "ñ") action = () => store.dispatch({ type: "panel/toggle" });
        else if (k === ",") action = () => store.dispatch({ type: "settings/open", open: true });

        if (!action) return;
        e.preventDefault();
        void action();
    });
}