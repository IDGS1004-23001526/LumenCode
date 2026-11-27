import type { DropZone } from "../../domain/types";

export type DragSource = "tab" | "explorer";

export interface ActiveEditorDrag {
  path: string;
  source: DragSource;
  sourceGroupId?: string;
}

let currentDrag: ActiveEditorDrag | null = null;
const endListeners = new Set<() => void>();
let globalGuardsInstalled = false;

function onKeyDown(e: KeyboardEvent) {
  if (e.key === "Escape" && currentDrag) {
    endEditorDrag();
  }
}

function ensureGlobalGuards() {
  if (globalGuardsInstalled || typeof window === "undefined") return;
  globalGuardsInstalled = true;
  window.addEventListener("dragend", endEditorDrag);
  window.addEventListener("drop", endEditorDrag);
  window.addEventListener("blur", endEditorDrag);
  window.addEventListener("keydown", onKeyDown, { capture: true });
}

export function beginEditorDrag(path: string, source: DragSource, sourceGroupId?: string) {
  ensureGlobalGuards();
  currentDrag = { path, source, sourceGroupId };
}

export function getActiveEditorDrag(): ActiveEditorDrag | null {
  return currentDrag;
}

export function endEditorDrag() {
  if (!currentDrag) return;
  currentDrag = null;
  for (const fn of endListeners) fn();
}

export function onEditorDragEnd(fn: () => void): () => void {
  endListeners.add(fn);
  return () => endListeners.delete(fn);
}

/**
 * Calcula la zona de soltado (5 zonas estilo VS Code) dentro del cuerpo de un EditorGroup:
 * - Borde izquierdo (25% ancho) -> "left"
 * - Borde derecho (25% ancho) -> "right"
 * - Borde superior (25% alto) -> "top"
 * - Borde inferior (25% alto) -> "bottom"
 * - Área restante -> "center"
 * En las esquinas (cuando coincide borde horizontal y vertical), gana el borde proporcionalmente más cercano.
 */
export function resolveFiveZoneDrop(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  allowSplit = true,
): DropZone {
  if (!allowSplit || rect.width <= 0 || rect.height <= 0) return "center";

  const rx = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  const ry = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));

  const edge = 0.25;
  const candidates: Array<{ zone: DropZone; dist: number }> = [];
  if (rx < edge) candidates.push({ zone: "left", dist: rx });
  if (rx > 1 - edge) candidates.push({ zone: "right", dist: 1 - rx });
  if (ry < edge) candidates.push({ zone: "top", dist: ry });
  if (ry > 1 - edge) candidates.push({ zone: "bottom", dist: 1 - ry });

  if (candidates.length === 0) return "center";
  candidates.sort((a, b) => a.dist - b.dist);
  return candidates[0].zone;
}
