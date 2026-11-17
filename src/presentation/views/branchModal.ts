import type { AppStore } from "../../application/reducer";
import type { UseCases } from "../../application/useCases";
import type { GitBranches } from "../../domain/git";
import { gitClient } from "../../infraestructure/gitClient";
import { closePrettyModal, openPrettyModal } from "../animate";
import { cx, h } from "../dom";
import { promptModal } from "../promptModal";

export async function openBranchModal(store: AppStore, uc: UseCases, onError: (msg: string) => Promise<void>) {
  const s = store.getState();
  const repoRoot = s.git?.root ?? s.rootPath;
  if (!repoRoot || !s.git?.is_repo) return;
  const root: string = repoRoot;

  let data: GitBranches;
  try {
    data = await gitClient.branches(root);
  } catch (e) {
    await onError(`No se pudieron listar las ramas.\n\n${String(e)}`);
    return;
  }

  let query = "";
  let closing = false;
  const listEl = h("div", { class: "branch-list" });
  const inputEl = h("input", {
    class: "field branch-search",
    placeholder: "Buscar rama o escribir nombre para crear...",
    spellcheck: "false",
    autocomplete: "off",
  }) as HTMLInputElement;

  const dlg = h(
    "dialog",
    { class: "modal branch-modal" },
    h(
      "div",
      { class: "branch-shell" },
      h("div", { class: "branch-head" }, h("span", {}, "Ramas de Git"), h("button", { class: "btn ghost", onclick: () => close() }, "×")),
      inputEl,
      listEl,
    ),
  ) as HTMLDialogElement;

  const close = () => {
    if (closing) return;
    closing = true;
    closePrettyModal(dlg, () => dlg.remove());
  };

  const runAction = async (fn: () => Promise<void>) => {
    close();
    try {
      await fn();
      await uc.refresh();
    } catch (e) {
      await onError(`Error en operación de rama.\n\n${String(e)}`);
      await uc.refreshGit();
    }
  };

  function renderList() {
    const q = query.trim();
    const ql = q.toLowerCase();
    const items: HTMLElement[] = [];

    if (q && !data.local.some((b) => b.toLowerCase() === ql)) {
      items.push(
        h(
          "button",
          {
            class: "branch-item create",
            onclick: () => void runAction(() => gitClient.checkout(root, q, true)),
          },
          h("span", { class: "branch-name" }, `+ Crear nueva rama "${q}"`),
          h("span", { class: "branch-tag" }, "checkout -b"),
        ),
      );
    }

    for (const b of data.local) {
      if (ql && !b.toLowerCase().includes(ql)) continue;
      const isCur = b === data.current;
      items.push(
        h(
          "div",
          { class: cx("branch-row", isCur && "current") },
          h(
            "button",
            {
              class: "branch-item",
              onclick: () => {
                if (isCur) { close(); return; }
                void runAction(() => gitClient.checkout(root, b, false));
              },
            },
            h("span", { class: "branch-name" }, b),
            isCur ? h("span", { class: "branch-tag active" }, "actual") : null,
          ),
          h(
            "button",
            {
              class: "branch-act",
              title: "Renombrar rama",
              onclick: async () => {
                close();
                const next = await promptModal(`Renombrar rama "${b}"`, { initialValue: b, confirmLabel: "Renombrar" });
                if (next && next !== b) {
                  try {
                    await gitClient.renameBranch(root, b, next);
                    await uc.refreshGit();
                  } catch (e) {
                    await onError(`No se pudo renombrar la rama.\n\n${String(e)}`);
                  }
                }
              },
            },
            "✎",
          ),
          !isCur
            ? h(
                "button",
                {
                  class: "branch-act danger",
                  title: "Eliminar rama",
                  onclick: () => void runAction(() => gitClient.deleteBranch(root, b, false)),
                },
                "×",
              )
            : null,
        ),
      );
    }

    for (const rb of data.remote) {
      if (ql && !rb.toLowerCase().includes(ql)) continue;
      items.push(
        h(
          "div",
          { class: "branch-row" },
          h(
            "button",
            {
              class: "branch-item",
              onclick: () => void runAction(() => gitClient.checkout(root, rb.replace(/^[^/]+\//, ""), false)),
            },
            h("span", { class: "branch-name" }, rb),
            h("span", { class: "branch-tag" }, "remota"),
          ),
        ),
      );
    }

    if (items.length === 0) {
      items.push(h("div", { class: "placeholder" }, "Sin ramas coincidentes"));
    }
    listEl.replaceChildren(...items);
  }

  inputEl.addEventListener("input", () => {
    query = inputEl.value;
    renderList();
  });

  dlg.addEventListener("cancel", (e) => {
    e.preventDefault();
    close();
  });
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg) close();
  });

  renderList();
  document.body.append(dlg);
  openPrettyModal(dlg);
  inputEl.focus();
}
