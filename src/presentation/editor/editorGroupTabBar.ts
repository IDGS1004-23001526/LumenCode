import type { AppState, EditorGroupNode } from "../../domain/types";
import type { AppStore } from "../../application/reducer";
import type { UseCases } from "../../application/useCases";
import { fileNameOf } from "../../domain/path";
import { toRelativeRepoPath } from "../../infraestructure/gitClient";
import { animateTabIn, animateTabOut, captureTabsFlip, playTabsFlip } from "../animate";
import { showContextMenu } from "../contextMenu";
import { cx, h, iconButton } from "../dom";
import { ICONS } from "../icons";
import { beginEditorDrag, endEditorDrag, getActiveEditorDrag, onEditorDragEnd } from "./tabDrag";

export interface EditorGroupTabBar {
  readonly el: HTMLElement;
  update(group: EditorGroupNode, state: AppState, isFocusedGroup: boolean): void;
  dispose(): void;
}

export function createEditorGroupTabBar(
  groupId: string,
  store: AppStore,
  uc: UseCases,
): EditorGroupTabBar {
  const list = h("div", { class: "tabs", role: "tablist" });
  const splitBtn = iconButton(ICONS.split, "Dividir editor a la derecha (Ctrl+\\)", () => {
    uc.splitActiveGroup(groupId);
  }) as HTMLButtonElement;
  const actions = h("div", { class: "group-tab-actions" }, splitBtn);
  const el = h("div", { class: "group-tabbar" }, list, actions);

  const clearDropVisuals = () => {
    list.classList.remove("tabbar-drop-hover");
    list.querySelectorAll(".drop-before, .drop-after, .dragging").forEach((n) => {
      n.classList.remove("drop-before", "drop-after", "dragging");
    });
  };
  const unsubDragEnd = onEditorDragEnd(clearDropVisuals);

  // Soltar sobre el espacio vacío de la barra de pestañas mueve/abre la pestaña en este grupo
  list.addEventListener("dragover", (e) => {
    const drag = getActiveEditorDrag();
    if (!drag) return;
    if (drag.source === "tab" && drag.sourceGroupId === groupId) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = drag.source === "tab" ? "move" : "copy";
    list.classList.add("tabbar-drop-hover");
  });
  list.addEventListener("dragleave", (e) => {
    const rel = e.relatedTarget as Node | null;
    if (rel && list.contains(rel)) return;
    list.classList.remove("tabbar-drop-hover");
  });
  list.addEventListener("drop", (e) => {
    const drag = getActiveEditorDrag();
    list.classList.remove("tabbar-drop-hover");
    if (!drag) return;
    if (drag.source === "tab" && drag.sourceGroupId === groupId) return;
    e.preventDefault();
    e.stopPropagation();
    const { path, sourceGroupId } = drag;
    endEditorDrag();
    void uc.dropFileInGroup(path, groupId, "center", sourceGroupId);
  });

  let prevTabPaths: string[] = [];
  let prevActivePath: string | null = null;

  function patchExistingTabs(group: EditorGroupNode, state: AppState, isFocusedGroup: boolean) {
    const g = state.git;
    const globalTabMap = new Map(state.tabs.map((t) => [t.path, t]));
    const children = Array.from(list.children) as HTMLElement[];

    for (let i = 0; i < group.tabs.length; i++) {
      const path = group.tabs[i];
      const tabEl = children[i];
      if (!tabEl) continue;

      const meta = globalTabMap.get(path);
      const name = meta?.name ?? fileNameOf(path);
      const dirty = meta?.dirty ?? false;
      const active = path === group.activePath;
      const rel = g?.is_repo && g.root ? toRelativeRepoPath(g.root, path)?.toLowerCase() ?? null : null;
      const gitEntry = rel ? g?.entries.find((e) => e.path.replace(/\\/g, "/").toLowerCase() === rel) : undefined;

      tabEl.classList.toggle("active", active);
      tabEl.classList.toggle("focused-tab", active && isFocusedGroup);
      tabEl.setAttribute("aria-selected", String(active));

      const nameEl = tabEl.querySelector<HTMLElement>(".tab-name");
      if (nameEl) {
        if (nameEl.textContent !== name) nameEl.textContent = name;
        nameEl.className = cx("tab-name", gitEntry && `git-label-${gitEntry.status}`);
      }

      const existingBadge = tabEl.querySelector<HTMLElement>(".git-badge");
      if (gitEntry) {
        if (existingBadge) {
          existingBadge.className = `git-badge git-${gitEntry.status}`;
          existingBadge.textContent = gitEntry.status;
        } else {
          const badge = h("span", { class: `git-badge git-${gitEntry.status}` }, gitEntry.status);
          nameEl?.after(badge);
        }
      } else {
        existingBadge?.remove();
      }

      const existingDirty = tabEl.querySelector<HTMLElement>(".tab-dirty");
      if (dirty && !existingDirty) {
        const closeBtn = tabEl.querySelector(".tab-close");
        const dot = h("span", { class: "tab-dirty" }, "*");
        if (closeBtn) closeBtn.before(dot);
        else tabEl.append(dot);
      } else if (!dirty && existingDirty) {
        existingDirty.remove();
      }
    }

    if (group.activePath !== prevActivePath) {
      list.querySelector(".tab.active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
      prevActivePath = group.activePath;
    }
    splitBtn.disabled = group.tabs.length === 0;
  }

  function renderTabs(group: EditorGroupNode, state: AppState, isFocusedGroup: boolean) {
    const g = state.git;
    const globalTabMap = new Map(state.tabs.map((t) => [t.path, t]));

    list.replaceChildren(
      ...group.tabs.map((path) => {
        const meta = globalTabMap.get(path);
        const name = meta?.name ?? fileNameOf(path);
        const dirty = meta?.dirty ?? false;
        const active = path === group.activePath;
        const rel = g?.is_repo && g.root ? toRelativeRepoPath(g.root, path)?.toLowerCase() ?? null : null;
        const gitEntry = rel ? g?.entries.find((e) => e.path.replace(/\\/g, "/").toLowerCase() === rel) : undefined;

        const tabEl = h(
          "div",
          {
            class: cx("tab", active && "active", active && isFocusedGroup && "focused-tab"),
            role: "tab",
            "aria-selected": String(active),
            "data-flip-id": path,
            title: path,
            draggable: "true",
            onclick: () => store.dispatch({ type: "tab/activate", path, groupId }),
            onauxclick: (e: MouseEvent) => {
              if (e.button === 1) void uc.closeTab(path, groupId);
            },
            ondragstart: (e: DragEvent) => {
              if ((e.target as HTMLElement | null)?.closest(".tab-close")) {
                e.preventDefault();
                return;
              }
              beginEditorDrag(path, "tab", groupId);
              if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", path);
              }
              tabEl.classList.add("dragging");
            },
            ondragend: () => {
              tabEl.classList.remove("dragging");
              list.classList.remove("tabbar-drop-hover");
              list.querySelectorAll(".drop-before, .drop-after").forEach((n) => {
                n.classList.remove("drop-before", "drop-after");
              });
              endEditorDrag();
            },
            ondragover: (e: DragEvent) => {
              const drag = getActiveEditorDrag();
              if (!drag) return;
              if (drag.source === "tab" && drag.sourceGroupId === groupId && drag.path === path) return;
              e.preventDefault();
              e.stopPropagation();
              list.classList.remove("tabbar-drop-hover");
              if (e.dataTransfer) e.dataTransfer.dropEffect = drag.source === "tab" ? "move" : "copy";
              const rect = tabEl.getBoundingClientRect();
              const isAfter = e.clientX > rect.left + rect.width / 2;
              tabEl.classList.toggle("drop-after", isAfter);
              tabEl.classList.toggle("drop-before", !isAfter);
            },
            ondragleave: (e: DragEvent) => {
              const relNode = e.relatedTarget as Node | null;
              if (relNode && tabEl.contains(relNode)) return;
              tabEl.classList.remove("drop-before", "drop-after");
            },
            ondrop: (e: DragEvent) => {
              const drag = getActiveEditorDrag();
              tabEl.classList.remove("drop-before", "drop-after");
              list.classList.remove("tabbar-drop-hover");
              if (!drag) return;
              e.preventDefault();
              e.stopPropagation();
              const rect = tabEl.getBoundingClientRect();
              const position = e.clientX > rect.left + rect.width / 2 ? "after" : "before";
              const { path: draggedPath, source, sourceGroupId } = drag;
              endEditorDrag();
              if (source === "tab" && sourceGroupId === groupId) {
                if (draggedPath !== path) {
                  store.dispatch({
                    type: "tab/reorder",
                    groupId,
                    fromPath: draggedPath,
                    toPath: path,
                    position,
                  });
                }
              } else {
                void uc.dropFileInGroup(draggedPath, groupId, "center", sourceGroupId).then((opened) => {
                  if (opened && opened !== path) {
                    store.dispatch({
                      type: "tab/reorder",
                      groupId,
                      fromPath: opened,
                      toPath: path,
                      position,
                    });
                  }
                });
              }
            },
            oncontextmenu: (e: MouseEvent) => {
              e.preventDefault();
              e.stopPropagation();
              showContextMenu(e.clientX, e.clientY, [
                { label: "Dividir a la derecha", shortcut: "Ctrl+\\", run: () => void uc.openFileInSplit(path, groupId) },
                "separator",
                { label: "Cerrar pestaña", shortcut: "Ctrl+W", run: () => void uc.closeTab(path, groupId) },
              ]);
            },
          },
          h("span", { class: cx("tab-name", gitEntry && `git-label-${gitEntry.status}`) }, name),
          gitEntry ? h("span", { class: `git-badge git-${gitEntry.status}` }, gitEntry.status) : null,
          dirty ? h("span", { class: "tab-dirty" }, "*") : null,
          h(
            "button",
            {
              class: "tab-close",
              "aria-label": `Cerrar ${name}`,
              title: "Cerrar (Ctrl + W)",
              onclick: (e: MouseEvent) => {
                e.stopPropagation();
                void uc.closeTab(path, groupId);
              },
            },
            "×",
          ),
        );
        return tabEl;
      }),
    );

    list.querySelector(".tab.active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
    splitBtn.disabled = group.tabs.length === 0;
  }

  return {
    el,
    update(group, state, isFocusedGroup) {
      const listChanged =
        group.tabs.length !== prevTabPaths.length ||
        group.tabs.some((p, i) => p !== prevTabPaths[i]);

      if (listChanged) {
        const prevSet = new Set(prevTabPaths);
        const nextSet = new Set(group.tabs);
        const prevChildren = Array.from(list.children) as HTMLElement[];
        const stayingPrev = prevChildren.filter((n) => nextSet.has(n.dataset.flipId ?? ""));
        const removed = prevChildren.filter((n) => !nextSet.has(n.dataset.flipId ?? ""));

        for (const node of removed) animateTabOut(node);
        const flipState = captureTabsFlip(stayingPrev);

        renderTabs(group, state, isFocusedGroup);

        const nextChildren = Array.from(list.children) as HTMLElement[];
        const stayingNext = nextChildren.filter((n) => prevSet.has(n.dataset.flipId ?? ""));
        const added = nextChildren.filter((n) => !prevSet.has(n.dataset.flipId ?? ""));

        playTabsFlip(flipState, stayingNext);
        for (const node of added) animateTabIn(node);
        prevTabPaths = [...group.tabs];
        prevActivePath = group.activePath;
        return;
      }

      patchExistingTabs(group, state, isFocusedGroup);
    },
    dispose() {
      unsubDragEnd();
      clearDropVisuals();
    },
  };
}
