interface EdgeResizerConfig {
  target: HTMLElement;
  axis: "x" | "y";
  cssVar: string;
  getBounds: () => { min: number; max: number };
  onResizeEnd?: () => void;
}

function attachEdgeResizer({ target, axis, cssVar, getBounds, onResizeEnd }: EdgeResizerConfig): void {
  const handle = document.createElement("div");
  handle.className = axis === "x" ? "resize-handle-x" : "resize-handle-y";
  target.append(handle);

  let dragging = false;
  let startPos = 0;
  let startSize = 0;

  const stop = (pointerId?: number) => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove("active");
    document.body.style.cursor = "";
    if (pointerId !== undefined && handle.hasPointerCapture(pointerId)) {
      handle.releasePointerCapture(pointerId);
    }
    onResizeEnd?.();
  };

  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragging = true;
    const rect = target.getBoundingClientRect();
    startPos = axis === "x" ? e.clientX : e.clientY;
    startSize = axis === "x" ? rect.width : rect.height;
    handle.classList.add("active");
    document.body.style.cursor = axis === "x" ? "ew-resize" : "ns-resize";
    handle.setPointerCapture(e.pointerId);
  });

  handle.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const delta = axis === "x" ? e.clientX - startPos : startPos - e.clientY;
    const { min, max } = getBounds();
    const next = Math.max(min, Math.min(max, Math.round(startSize + delta)));
    document.documentElement.style.setProperty(cssVar, `${next}px`);
  });

  handle.addEventListener("pointerup", (e) => stop(e.pointerId));
  handle.addEventListener("pointercancel", (e) => stop(e.pointerId));
  handle.addEventListener("dblclick", () => {
    document.documentElement.style.removeProperty(cssVar);
    onResizeEnd?.();
  });
}

export function mountResizers(sidebarEl: HTMLElement, panelEl: HTMLElement, onResizeEnd: () => void): void {
  attachEdgeResizer({
    target: sidebarEl,
    axis: "x",
    cssVar: "--sidebar-width",
    getBounds: () => {
      const min = Math.max(200, Math.min(260, Math.round(window.innerWidth * 0.18)));
      const max = Math.max(min, Math.min(520, Math.round(window.innerWidth * 0.45)));
      return { min, max };
    },
    onResizeEnd,
  });

  attachEdgeResizer({
    target: panelEl,
    axis: "y",
    cssVar: "--panel-height",
    getBounds: () => {
      const min = 215;
      const max = Math.max(min, Math.min(560, Math.round(window.innerHeight * 0.65)));
      return { min, max };
    },
    onResizeEnd,
  });
}
