import { closePrettyModal, openPrettyModal } from "./animate";
import { h } from "./dom";

export function promptModal(
    label: string,
    options?: { initialValue?: string; confirmLabel?: string },
): Promise<string | null> {
    return new Promise((resolve) => {
        const initialValue = options?.initialValue ?? "";
        const confirmLabel = options?.confirmLabel ?? "Crear";
        const input = h("input", {
            class: "field",
            spellcheck: "false",
            autocomplete: "off",
            value: initialValue,
        }) as HTMLInputElement;

        let closing = false;
        let settled = false;

        const finish = (ok: boolean) => {
            if (closing || settled) return;
            closing = true;
            const value = ok ? input.value.trim() : "";
            closePrettyModal(dlg, () => {
                settled = true;
                dlg.remove();
                resolve(value || null);
            });
        };

        const dlg = h(
            "dialog",
            { class: "modal" },
            h("form", {
                method: "dialog",
                class: "modal-form",
                onsubmit: (e: SubmitEvent) => {
                    e.preventDefault();
                    const submitter = e.submitter as HTMLButtonElement | null;
                    finish(submitter?.value !== "cancel");
                },
            },
                h("label", { class: "modal-title" }, label),
                input,
                h("div", { class: "modal-actions" },
                    h("button", { type: "button", class: "btn ghost", onclick: () => finish(false) }, "Cancelar"),
                    h("button", { type: "submit", value: "ok", class: "btn primary" }, confirmLabel),
                ),
            ),
        ) as HTMLDialogElement;

        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                finish(true);
            }
        });

        dlg.addEventListener("cancel", (e) => {
            e.preventDefault();
            finish(false);
        });

        dlg.addEventListener("close", () => {
            if (settled) return;
            settled = true;
            dlg.remove();
            resolve(null);
        });

        document.body.append(dlg);
        openPrettyModal(dlg);
        input.focus();
        if (initialValue) {
            const dot = initialValue.lastIndexOf(".");
            input.setSelectionRange(0, dot > 0 ? dot : initialValue.length);
        }
    });
}

export function confirmModal(message: string, okLabel = "Confirmar"): Promise<boolean> {
    return new Promise((resolve) => {
        let closing = false;
        let settled = false;

        const finish = (ok: boolean) => {
            if (closing || settled) return;
            closing = true;
            closePrettyModal(dlg, () => {
                settled = true;
                dlg.remove();
                resolve(ok);
            });
        };

        const dlg = h(
            "dialog",
            { class: "modal" },
            h("div", { class: "modal-form" },
                h("div", { class: "modal-title" }, message),
                h("div", { class: "modal-actions" },
                    h("button", { type: "button", class: "btn ghost", onclick: () => finish(false) }, "Cancelar"),
                    h("button", { type: "button", class: "btn primary", onclick: () => finish(true) }, okLabel),
                ),
            ),
        ) as HTMLDialogElement;

        dlg.addEventListener("cancel", (e) => {
            e.preventDefault();
            finish(false);
        });

        dlg.addEventListener("close", () => {
            if (settled) return;
            settled = true;
            dlg.remove();
            resolve(false);
        });

        document.body.append(dlg);
        openPrettyModal(dlg);
    });
}