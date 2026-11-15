import { h } from "../dom";

export interface ImageEntry {
  path: string;
  url: string;
  byteSize: number;
  zoom: number; // 0 = fit-to-view, >0 = explicit scale (e.g. 1 = 100%)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function createImagePreviewHost(parent: HTMLElement) {
  const root = h("div", { class: "image-viewer", hidden: true });
  const stage = h("div", { class: "image-stage" });
  const infoEl = h("span", { class: "image-meta" });
  const zoomLabel = h("span", { class: "image-zoom-label" }, "Ajustar");

  let current: ImageEntry | null = null;
  let imgEl: HTMLImageElement | null = null;

  const applyZoom = () => {
    if (!current || !imgEl) return;
    if (current.zoom === 0) {
      imgEl.style.maxWidth = "100%";
      imgEl.style.maxHeight = "100%";
      imgEl.style.width = "";
      imgEl.style.height = "";
      imgEl.style.transform = "";
      zoomLabel.textContent = "Ajustar";
    } else {
      imgEl.style.maxWidth = "none";
      imgEl.style.maxHeight = "none";
      imgEl.style.transform = `scale(${current.zoom})`;
      imgEl.style.transformOrigin = "center center";
      zoomLabel.textContent = `${Math.round(current.zoom * 100)}%`;
    }
  };

  const stepZoom = (dir: 1 | -1) => {
    if (!current) return;
    const base = current.zoom === 0 ? 1 : current.zoom;
    current.zoom = Math.max(0.1, Math.min(8, Number((base + dir * 0.25).toFixed(2))));
    applyZoom();
  };

  const toolbar = h(
    "div",
    { class: "image-toolbar" },
    infoEl,
    h(
      "div",
      { class: "image-controls" },
      h("button", { class: "btn ghost", title: "Alejar", onclick: () => stepZoom(-1) }, "−"),
      zoomLabel,
      h("button", { class: "btn ghost", title: "Acercar", onclick: () => stepZoom(1) }, "+"),
      h(
        "button",
        {
          class: "btn ghost",
          title: "Ajustar a la ventana",
          onclick: () => {
            if (!current) return;
            current.zoom = 0;
            applyZoom();
          },
        },
        "Ajustar",
      ),
      h(
        "button",
        {
          class: "btn ghost",
          title: "Tamaño real (100%)",
          onclick: () => {
            if (!current) return;
            current.zoom = 1;
            applyZoom();
          },
        },
        "100%",
      ),
    ),
  );

  stage.addEventListener(
    "wheel",
    (e) => {
      if (!current) return;
      e.preventDefault();
      stepZoom(e.deltaY < 0 ? 1 : -1);
    },
    { passive: false },
  );

  root.append(stage, toolbar);
  parent.append(root);

  return {
    show(entry: ImageEntry) {
      current = entry;
      root.hidden = false;

      const ext = entry.path.split(".").pop()?.toUpperCase() ?? "IMG";
      infoEl.textContent = `${ext} · ${formatBytes(entry.byteSize)}`;

      const img = document.createElement("img");
      img.className = "image-preview-img";
      img.src = entry.url;
      img.alt = entry.path;
      img.draggable = false;
      img.onload = () => {
        if (current !== entry) return;
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        if (w === 0 && h === 0 && entry.zoom === 0) {
          img.style.width = "320px";
          img.style.height = "320px";
        }
        infoEl.textContent = w && h
          ? `${ext} · ${w} × ${h} px · ${formatBytes(entry.byteSize)}`
          : `${ext} · ${formatBytes(entry.byteSize)}`;
      };
      img.onerror = () => {
        if (current === entry) {
          infoEl.textContent = `No se pudo renderizar ${ext}`;
        }
      };

      imgEl = img;
      stage.replaceChildren(img);
      applyZoom();
    },
    hide() {
      current = null;
      imgEl = null;
      root.hidden = true;
      stage.replaceChildren();
    },
  };
}
