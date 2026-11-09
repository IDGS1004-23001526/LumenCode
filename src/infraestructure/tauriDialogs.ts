import { ask, message, open } from "@tauri-apps/plugin-dialog";
import type { DialogPort } from "../application/ports";

/** Todo menos prompt que lo pone la capa de presentacion osea que Tauri no tiene prompt */
export function createTauriDialogs(): Omit<DialogPort, "prompt"> {
    return {
        async pickFolder() {
            const r = await open({ directory: true, multiple: false, recursive: true });
            return typeof r === "string" ? r : null;
        },
        confirm: (msg) =>
            ask(msg, {title: "LumenCode", kind: "warning", okLabel: "Descartar", cancelLabel: "Cancelar"}),
        error: async (msg) => {
            await message(msg, { title: "LumenCode", kind: "error" });
        }, 
    };
}