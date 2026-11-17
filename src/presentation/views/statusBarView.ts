import type { AppStore } from "../../application/reducer";
import type { UseCases } from "../../application/useCases";
import type { AppState } from "../../domain/types";
import { h } from "../dom";
import { languageFor } from "../editor/languages";
import { openBranchModal } from "./branchModal";

export function mountStatusBar(
  el: HTMLElement,
  store: AppStore,
  uc: UseCases,
  onError: (msg: string) => Promise<void>,
) {
  const leftEl = h("div", { class: "status-left" });
  const rightEl = h("div", { class: "status-right" });
  el.append(leftEl, rightEl);

  function render(s: AppState) {
    const leftItems: (HTMLElement | string)[] = [];
    const g = s.git;

    if (g?.installed && g.is_repo) {
      leftItems.push(
        h(
          "button",
          {
            class: "status-item status-branch",
            title: "Cambiar o crear rama",
            onclick: () => void openBranchModal(store, uc, onError),
          },
          `⎇ ${g.branch || "HEAD"}`,
        ),
      );

      if (g.op_state) {
        leftItems.push(
          h("span", { class: "status-item status-op" }, g.op_state),
        );
      }

      if (g.upstream) {
        leftItems.push(
          h(
            "button",
            {
              class: "status-item",
              title: `Sincronizar con ${g.upstream}`,
              onclick: () => void uc.gitRemoteOp("sync"),
            },
            `↓${g.behind} ↑${g.ahead}`,
          ),
        );
      } else {
        leftItems.push(
          h(
            "button",
            {
              class: "status-item",
              title: "Publicar rama en origin",
              onclick: () => void uc.gitRemoteOp("publish"),
            },
            "☁ Publicar",
          ),
        );
      }

      if (g.entries.length > 0) {
        leftItems.push(
          h(
            "button",
            {
              class: "status-item",
              title: "Ver cambios en Source Control (Ctrl+Shift+G)",
              onclick: () => store.dispatch({ type: "sidebar/view", view: "git" }),
            },
            `● ${g.entries.length}`,
          ),
        );
      }
    } else if (g && !g.installed) {
      leftItems.push(h("span", { class: "status-item muted" }, "Git no instalado"));
    } else if (g && g.installed && !g.is_repo && s.rootPath) {
      leftItems.push(
        h(
          "button",
          {
            class: "status-item",
            title: "Inicializar repositorio Git",
            onclick: () => void uc.gitInit(),
          },
          "+ Inicializar Git",
        ),
      );
    }

    leftEl.replaceChildren(...leftItems);

    const lang = languageFor(s.activePath).name;
    rightEl.replaceChildren(
      h("span", { class: "status-item" }, lang),
      h("span", { class: "status-item muted" }, "UTF-8"),
    );
  }

  render(store.getState());
  store.subscribe((s, p) => {
    if (s.git !== p.git || s.activePath !== p.activePath || s.rootPath !== p.rootPath) {
      render(s);
    }
  });
}
