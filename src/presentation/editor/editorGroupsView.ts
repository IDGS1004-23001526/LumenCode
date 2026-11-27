import type { AppState, DropZone, EditorGroupNode, LayoutNode, SplitContainerNode } from "../../domain/types";
import { getAllGroups } from "../../domain/editorLayout";
import type { EditorPort } from "../../application/ports";
import type { AppStore } from "../../application/reducer";
import type { UseCases } from "../../application/useCases";
import { h } from "../dom";
import { createEditorGroupTabBar, type EditorGroupTabBar } from "./editorGroupTabBar";
import { endEditorDrag, getActiveEditorDrag, onEditorDragEnd, resolveFiveZoneDrop } from "./tabDrag";

interface GroupViewEntry {
  id: string;
  root: HTMLElement;
  tabBar: EditorGroupTabBar;
  body: HTMLElement;
  overlay: HTMLElement;
  tabCount: number;
  lastActivePath: string | null;
  dispose: () => void;
}

interface SplitViewEntry {
  id: string;
  root: HTMLElement;
  firstSlot: HTMLElement;
  divider: HTMLElement;
  secondSlot: HTMLElement;
  direction: SplitContainerNode["direction"];
  dispose: () => void;
}

export function mountEditorGroups(
  host: HTMLElement,
  store: AppStore,
  uc: UseCases,
  editor: EditorPort,
) {
  const groupViews = new Map<string, GroupViewEntry>();
  const splitViews = new Map<string, SplitViewEntry>();

  function getOrCreateGroupView(group: EditorGroupNode): GroupViewEntry {
    const existing = groupViews.get(group.id);
    if (existing) {
      existing.tabCount = group.tabs.length;
      return existing;
    }

    const tabBar = createEditorGroupTabBar(group.id, store, uc);
    const overlay = h("div", { class: "editor-drop-overlay", hidden: true });
    const body = h("div", { class: "editor-group-body" }, overlay);
    const root = h(
      "div",
      { class: "editor-group", "data-group-id": group.id },
      tabBar.el,
      body,
    );

    const entry: GroupViewEntry = {
      id: group.id,
      root,
      tabBar,
      body,
      overlay,
      tabCount: group.tabs.length,
      lastActivePath: null,
      dispose: () => {},
    };

    const focusThisGroup = () => {
      if (store.getState().activeGroupId !== group.id) {
        store.dispatch({ type: "group/focus", groupId: group.id });
      }
    };
    root.addEventListener("pointerdown", focusThisGroup);
    root.addEventListener("focusin", focusThisGroup);

    // 5-Zone Drop Overlay con captura para interceptar antes de CodeMirror
    let currentZone: DropZone | null = null;
    let cachedRect: DOMRect | null = null;

    const hideOverlay = () => {
      currentZone = null;
      cachedRect = null;
      if (!overlay.hidden) {
        overlay.hidden = true;
        overlay.removeAttribute("data-zone");
      }
    };

    const isSelfSingleTab = () => {
      const drag = getActiveEditorDrag();
      return Boolean(drag && drag.source === "tab" && drag.sourceGroupId === group.id && entry.tabCount <= 1);
    };

    const unsubDragEnd = onEditorDragEnd(hideOverlay);
    const onBlur = () => hideOverlay();
    window.addEventListener("blur", onBlur);

    body.addEventListener(
      "dragenter",
      (e) => {
        if (!getActiveEditorDrag()) return;
        e.preventDefault();
        e.stopPropagation();
        if (!cachedRect) cachedRect = body.getBoundingClientRect();
      },
      { capture: true },
    );

    body.addEventListener(
      "dragover",
      (e) => {
        const drag = getActiveEditorDrag();
        if (!drag) return;
        e.preventDefault();
        e.stopPropagation();

        // Regla obligatoria: no dividir un grupo de 1 sola pestaña consigo mismo ni mostrar overlay
        if (isSelfSingleTab()) {
          if (e.dataTransfer) e.dataTransfer.dropEffect = "none";
          hideOverlay();
          return;
        }

        if (e.dataTransfer) {
          e.dataTransfer.dropEffect = drag.source === "tab" ? "move" : "copy";
        }
        const rect = cachedRect ?? (cachedRect = body.getBoundingClientRect());
        const allowSplit = entry.tabCount > 0;
        const zone = resolveFiveZoneDrop(e.clientX, e.clientY, rect, allowSplit);
        if (zone !== currentZone) {
          currentZone = zone;
          overlay.dataset.zone = zone;
          if (overlay.hidden) overlay.hidden = false;
        }
      },
      { capture: true },
    );

    body.addEventListener("dragleave", (e) => {
      if (!getActiveEditorDrag()) return;
      const rel = e.relatedTarget as Node | null;
      if (!rel || !body.contains(rel)) hideOverlay();
    });

    body.addEventListener(
      "drop",
      (e) => {
        const drag = getActiveEditorDrag();
        if (!drag) return;
        e.preventDefault();
        e.stopPropagation();

        if (isSelfSingleTab()) {
          hideOverlay();
          endEditorDrag();
          return;
        }

        const rect = cachedRect ?? body.getBoundingClientRect();
        const allowSplit = entry.tabCount > 0;
        const zone = currentZone ?? resolveFiveZoneDrop(e.clientX, e.clientY, rect, allowSplit);
        const { path, sourceGroupId } = drag;
        hideOverlay();
        endEditorDrag();
        void uc.dropFileInGroup(path, group.id, zone, sourceGroupId);
      },
      { capture: true },
    );

    editor.mountGroup(group.id, body);

    entry.dispose = () => {
      unsubDragEnd();
      window.removeEventListener("blur", onBlur);
      hideOverlay();
      tabBar.dispose();
      editor.unmountGroup(group.id);
      root.remove();
    };

    groupViews.set(group.id, entry);
    return entry;
  }

  function getOrCreateSplitView(split: SplitContainerNode): SplitViewEntry {
    const existing = splitViews.get(split.id);
    if (existing) {
      if (existing.direction !== split.direction) {
        existing.direction = split.direction;
        existing.root.classList.toggle("vertical", split.direction === "vertical");
        existing.root.classList.toggle("horizontal", split.direction === "horizontal");
        existing.divider.setAttribute(
          "aria-orientation",
          split.direction === "vertical" ? "vertical" : "horizontal",
        );
      }
      existing.root.style.setProperty("--split-ratio", `${(split.ratio * 100).toFixed(3)}%`);
      return existing;
    }

    const firstSlot = h("div", { class: "split-slot split-first" });
    const secondSlot = h("div", { class: "split-slot split-second" });
    const divider = h("div", {
      class: "split-divider",
      role: "separator",
      "aria-orientation": split.direction === "vertical" ? "vertical" : "horizontal",
      title: "Arrastra para redimensionar · Doble clic para centrar",
    });
    const root = h(
      "div",
      {
        class: `split-container ${split.direction}`,
        "data-split-id": split.id,
      },
      firstSlot,
      divider,
      secondSlot,
    );
    root.style.setProperty("--split-ratio", `${(split.ratio * 100).toFixed(3)}%`);

    let activePointerId: number | null = null;
    let latestRatio = split.ratio;
    let currentDir = split.direction;

    const stopDrag = () => {
      if (activePointerId === null) return;
      const id = activePointerId;
      activePointerId = null;
      divider.classList.remove("dragging");
      document.body.style.userSelect = "";
      if (divider.hasPointerCapture(id)) {
        try {
          divider.releasePointerCapture(id);
        } catch {
          // El puntero pudo haberse liberado
        }
      }
      store.dispatch({ type: "group/resize", splitId: split.id, ratio: latestRatio });
      editor.remeasure();
    };

    divider.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      activePointerId = e.pointerId;
      divider.setPointerCapture(e.pointerId);
      divider.classList.add("dragging");
      document.body.style.userSelect = "none";
    });
    divider.addEventListener("pointermove", (e) => {
      if (activePointerId !== e.pointerId) return;
      const rect = root.getBoundingClientRect();
      const size = currentDir === "vertical" ? rect.width : rect.height;
      if (size <= 0) return;
      const minPx = Math.min(currentDir === "vertical" ? 160 : 110, size * 0.35);
      const pos = currentDir === "vertical" ? e.clientX - rect.left : e.clientY - rect.top;
      const clamped = Math.max(minPx, Math.min(size - minPx, pos));
      latestRatio = Math.max(0.15, Math.min(0.85, clamped / size));
      root.style.setProperty("--split-ratio", `${(latestRatio * 100).toFixed(3)}%`);
    });
    divider.addEventListener("pointerup", (e) => {
      if (activePointerId === e.pointerId) stopDrag();
    });
    divider.addEventListener("pointercancel", (e) => {
      if (activePointerId === e.pointerId) stopDrag();
    });
    divider.addEventListener("lostpointercapture", stopDrag);
    window.addEventListener("blur", stopDrag);
    divider.addEventListener("dblclick", () => {
      latestRatio = 0.5;
      root.style.setProperty("--split-ratio", "50%");
      store.dispatch({ type: "group/resize", splitId: split.id, ratio: 0.5 });
      editor.remeasure();
    });

    const entry: SplitViewEntry = {
      id: split.id,
      root,
      firstSlot,
      divider,
      secondSlot,
      get direction() {
        return currentDir;
      },
      set direction(d) {
        currentDir = d;
      },
      dispose: () => {
        stopDrag();
        window.removeEventListener("blur", stopDrag);
        root.remove();
      },
    };
    splitViews.set(split.id, entry);
    return entry;
  }

  function reconcileNode(
    node: LayoutNode,
    liveGroups: Set<string>,
    liveSplits: Set<string>,
    onReparent: () => void,
  ): HTMLElement {
    if (node.kind === "group") {
      liveGroups.add(node.id);
      return getOrCreateGroupView(node).root;
    }
    liveSplits.add(node.id);
    const sv = getOrCreateSplitView(node);
    const firstEl = reconcileNode(node.first, liveGroups, liveSplits, onReparent);
    const secondEl = reconcileNode(node.second, liveGroups, liveSplits, onReparent);
    if (sv.firstSlot.firstElementChild !== firstEl) {
      sv.firstSlot.replaceChildren(firstEl);
      onReparent();
    }
    if (sv.secondSlot.firstElementChild !== secondEl) {
      sv.secondSlot.replaceChildren(secondEl);
      onReparent();
    }
    return sv.root;
  }

  let prevActiveGroupId: string | null = null;
  let prevGroupCount = 0;

  function render(state: AppState) {
    // Captura posición de scroll del contenedor visible antes de reparentar nodos DOM
    const savedScrolls = new Map<string, { scroller: HTMLElement; top: number; left: number; path: string | null }>();
    for (const [id, entry] of groupViews) {
      const scroller = Array.from(
        entry.body.querySelectorAll<HTMLElement>(".cm-scroller, .diff-body, .image-stage"),
      ).find((el) => !el.closest("[hidden]"));
      if (scroller) {
        savedScrolls.set(id, {
          scroller,
          top: scroller.scrollTop,
          left: scroller.scrollLeft,
          path: entry.lastActivePath,
        });
      }
    }

    const groups = getAllGroups(state.editorLayout);
    const liveGroups = new Set<string>(groups.map((g) => g.id));
    const liveSplits = new Set<string>();

    // Desmonta grupos que desaparecieron ANTES de reparentar para que conserven su bounding rect y animen su salida
    for (const [id, entry] of [...groupViews.entries()]) {
      if (!liveGroups.has(id)) {
        entry.dispose();
        groupViews.delete(id);
      }
    }

    let domReparented = false;
    const markReparented = () => { domReparented = true; };
    const rootEl = reconcileNode(state.editorLayout, liveGroups, liveSplits, markReparented);

    if (host.firstElementChild !== rootEl) {
      host.replaceChildren(rootEl);
      domReparented = true;
    }

    // Limpia contenedores split que desaparecieron (auto-colapso)
    for (const [id, entry] of [...splitViews.entries()]) {
      if (!liveSplits.has(id)) {
        entry.dispose();
        splitViews.delete(id);
      }
    }

    const isMultiGroup = groups.length > 1;
    host.classList.toggle("multi-group", isMultiGroup);

    const activeGroupChanged = prevActiveGroupId !== state.activeGroupId;
    const structureChanged = prevGroupCount !== groups.length;
    const toRestoreScroll: Array<{ scroller: HTMLElement; top: number; left: number }> = [];

    for (const g of groups) {
      const entry = groupViews.get(g.id);
      if (!entry) continue;
      const isFocused = g.id === state.activeGroupId;
      entry.root.classList.toggle("focused", isFocused);
      entry.tabBar.update(g, state, isFocused);
      const pathChanged = entry.lastActivePath !== g.activePath;
      entry.lastActivePath = g.activePath;
      const shouldFocus = isFocused && (activeGroupChanged || pathChanged);
      editor.syncGroup(g.id, g.activePath, isFocused, shouldFocus);

      if (domReparented && !pathChanged) {
        const saved = savedScrolls.get(g.id);
        if (saved && saved.path === g.activePath) {
          saved.scroller.scrollTop = saved.top;
          saved.scroller.scrollLeft = saved.left;
          toRestoreScroll.push(saved);
        }
      }
    }

    if (toRestoreScroll.length > 0) {
      requestAnimationFrame(() => {
        for (const s of toRestoreScroll) {
          if (s.scroller.isConnected) {
            s.scroller.scrollTop = s.top;
            s.scroller.scrollLeft = s.left;
          }
        }
      });
    }

    editor.setActiveGroup(state.activeGroupId);
    prevActiveGroupId = state.activeGroupId;
    prevGroupCount = groups.length;

    if (structureChanged) {
      requestAnimationFrame(() => editor.remeasure());
    }
  }

  render(store.getState());
  store.subscribe((s, p) => {
    if (
      s.editorLayout !== p.editorLayout ||
      s.activeGroupId !== p.activeGroupId ||
      s.tabs !== p.tabs ||
      s.git !== p.git
    ) {
      render(s);
    }
  });
}
