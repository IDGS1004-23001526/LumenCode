import { h } from "./dom";

export function promptModal(label: string): Promise<string | null> {
    return new Promise((resolve) => {
        const input = h("input", { class: "field", spellcheck: "false", autocomplete: "off" }) as HTMLInputElement;

        const dlg = h(
            "dialog",
            { class: "modal" },
            h("form", { method: "dialog", class: "modal-form" },
                h("label", { class: "modal-title" }, label),
                input,
                h("div", { class: "modal-actions" },
                    h("button", { value: "cancel", class: "btn ghost" }, "Cancelar"),
                    h("button", { value: "ok", class: "btn primary" }, "Crear"),
                ),
            ),
        ) as HTMLDialogElement;

        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                dlg.close("ok");
            }
        });

        dlg.addEventListener("close", () => {
            const value = dlg.returnValue === "ok" ? input.value.trim() : "";
            dlg.remove();
            resolve(value || null);
        });

        document.body.append(dlg);
        dlg.showModal();
        input.focus();
    });
}