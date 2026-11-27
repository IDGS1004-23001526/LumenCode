import type { DropZone, EditorGroupNode, LayoutNode, SplitContainerNode, SplitDirection } from "./types";

let nextNodeSeq = 2;

export function createInitialLayout(): EditorGroupNode {
  return { kind: "group", id: "group-1", tabs: [], activePath: null };
}

function makeGroupId(root: LayoutNode): string {
  const used = new Set<string>();
  const walk = (n: LayoutNode) => {
    used.add(n.id);
    if (n.kind === "split") {
      walk(n.first);
      walk(n.second);
    }
  };
  walk(root);
  while (used.has(`group-${nextNodeSeq}`)) nextNodeSeq++;
  return `group-${nextNodeSeq++}`;
}

function makeSplitId(root: LayoutNode): string {
  const used = new Set<string>();
  const walk = (n: LayoutNode) => {
    used.add(n.id);
    if (n.kind === "split") {
      walk(n.first);
      walk(n.second);
    }
  };
  walk(root);
  while (used.has(`split-${nextNodeSeq}`)) nextNodeSeq++;
  return `split-${nextNodeSeq++}`;
}

export function findGroup(root: LayoutNode, groupId: string): EditorGroupNode | null {
  if (root.kind === "group") return root.id === groupId ? root : null;
  return findGroup(root.first, groupId) ?? findGroup(root.second, groupId);
}

export function getAllGroups(root: LayoutNode): EditorGroupNode[] {
  const out: EditorGroupNode[] = [];
  const walk = (n: LayoutNode) => {
    if (n.kind === "group") out.push(n);
    else {
      walk(n.first);
      walk(n.second);
    }
  };
  walk(root);
  return out;
}

export function getFirstGroup(root: LayoutNode): EditorGroupNode {
  return root.kind === "group" ? root : getFirstGroup(root.first);
}

export function isPathOpenInAnyGroup(root: LayoutNode, path: string): boolean {
  if (root.kind === "group") return root.tabs.includes(path);
  return isPathOpenInAnyGroup(root.first, path) || isPathOpenInAnyGroup(root.second, path);
}

export function getVisiblePaths(root: LayoutNode): string[] {
  const out: string[] = [];
  const walk = (n: LayoutNode) => {
    if (n.kind === "group") {
      if (n.activePath) out.push(n.activePath);
    } else {
      walk(n.first);
      walk(n.second);
    }
  };
  walk(root);
  return out;
}

function replaceGroup(
  root: LayoutNode,
  groupId: string,
  updater: (g: EditorGroupNode) => LayoutNode,
): LayoutNode {
  if (root.kind === "group") {
    return root.id === groupId ? updater(root) : root;
  }
  const nextFirst = replaceGroup(root.first, groupId, updater);
  const nextSecond = replaceGroup(root.second, groupId, updater);
  if (nextFirst === root.first && nextSecond === root.second) return root;
  return { ...root, first: nextFirst, second: nextSecond };
}

/**
 * Elimina cualquier grupo vacío que tenga un hermano (auto-colapso recursivo).
 * Si la raíz es un único grupo vacío, se conserva intacta.
 */
export function collapseEmptyGroups(root: LayoutNode): LayoutNode {
  if (root.kind === "group") return root;
  const first = collapseEmptyGroups(root.first);
  const second = collapseEmptyGroups(root.second);
  const firstEmpty = first.kind === "group" && first.tabs.length === 0;
  const secondEmpty = second.kind === "group" && second.tabs.length === 0;
  if (firstEmpty && secondEmpty) return first;
  if (firstEmpty) return second;
  if (secondEmpty) return first;
  if (first === root.first && second === root.second) return root;
  return { ...root, first, second };
}

export function nextTabAfterRemove(tabs: readonly string[], removedPath: string, currentActive: string | null): string | null {
  const idx = tabs.indexOf(removedPath);
  const next = tabs.filter((p) => p !== removedPath);
  if (next.length === 0) return null;
  if (currentActive !== removedPath && currentActive && next.includes(currentActive)) return currentActive;
  if (idx === -1) return next[0];
  return next[Math.min(idx, next.length - 1)] ?? null;
}

export function openTabInGroup(root: LayoutNode, groupId: string, path: string): LayoutNode {
  return replaceGroup(root, groupId, (g) => {
    if (g.tabs.includes(path)) {
      return g.activePath === path ? g : { ...g, activePath: path };
    }
    return { ...g, tabs: [...g.tabs, path], activePath: path };
  });
}

export function activateTabInGroup(root: LayoutNode, groupId: string, path: string): LayoutNode {
  return replaceGroup(root, groupId, (g) => {
    if (!g.tabs.includes(path) || g.activePath === path) return g;
    return { ...g, activePath: path };
  });
}

export function removeTabFromGroup(root: LayoutNode, groupId: string, path: string): LayoutNode {
  const updated = replaceGroup(root, groupId, (g) => {
    if (!g.tabs.includes(path)) return g;
    const tabs = g.tabs.filter((p) => p !== path);
    const activePath = nextTabAfterRemove(g.tabs, path, g.activePath);
    return { ...g, tabs, activePath };
  });
  return collapseEmptyGroups(updated);
}

export function removeTabFromAllGroups(root: LayoutNode, path: string): LayoutNode {
  const walk = (n: LayoutNode): LayoutNode => {
    if (n.kind === "group") {
      if (!n.tabs.includes(path)) return n;
      const tabs = n.tabs.filter((p) => p !== path);
      const activePath = nextTabAfterRemove(n.tabs, path, n.activePath);
      return { ...n, tabs, activePath };
    }
    const first = walk(n.first);
    const second = walk(n.second);
    if (first === n.first && second === n.second) return n;
    return { ...n, first, second };
  };
  return collapseEmptyGroups(walk(root));
}

export function reorderTabInGroup(
  root: LayoutNode,
  groupId: string,
  fromPath: string,
  toPath: string,
  position: "before" | "after",
): LayoutNode {
  if (fromPath === toPath) return root;
  return replaceGroup(root, groupId, (g) => {
    const fromIdx = g.tabs.indexOf(fromPath);
    const toIdx = g.tabs.indexOf(toPath);
    if (fromIdx === -1 || toIdx === -1) return g;
    const next = [...g.tabs];
    const [moved] = next.splice(fromIdx, 1);
    const targetIdx = next.indexOf(toPath);
    const insertAt = position === "after" ? targetIdx + 1 : targetIdx;
    if (insertAt === fromIdx) return g;
    next.splice(insertAt, 0, moved);
    return { ...g, tabs: next };
  });
}

export interface SplitResult {
  layout: LayoutNode;
  activeGroupId: string;
}

/**
 * Divide un grupo en la dirección indicada (`left` | `right` | `top` | `bottom`) colocando `path` en el nuevo grupo.
 * Si `removeFromGroupId` se indica (al mover una pestaña), la extrae del grupo origen y colapsa si queda vacío.
 * Regla obligatoria: si `removeFromGroupId === targetGroupId` y el grupo solo tiene 1 pestaña, no divide consigo mismo.
 */
export function dropTabInGroup(
  root: LayoutNode,
  targetGroupId: string,
  zone: DropZone,
  path: string,
  sourceGroupId?: string,
): SplitResult {
  const targetGroup = findGroup(root, targetGroupId) ?? getFirstGroup(root);

  // Regla obligatoria: no dividir un grupo de 1 sola pestaña consigo mismo
  if (zone !== "center" && sourceGroupId === targetGroup.id && targetGroup.tabs.length <= 1) {
    return { layout: root, activeGroupId: targetGroup.id };
  }

  // Si se suelta en el centro del mismo grupo, simplemente enfoca/activa la pestaña
  if (zone === "center") {
    let next = openTabInGroup(root, targetGroup.id, path);
    if (sourceGroupId && sourceGroupId !== targetGroup.id) {
      next = removeTabFromGroup(next, sourceGroupId, path);
    }
    const stillExists = findGroup(next, targetGroup.id);
    return {
      layout: next,
      activeGroupId: stillExists ? targetGroup.id : getFirstGroup(next).id,
    };
  }

  // División en borde (left | right | top | bottom)
  const direction: SplitDirection = zone === "left" || zone === "right" ? "vertical" : "horizontal";
  const newFirst = zone === "left" || zone === "top";
  const newGroupId = makeGroupId(root);
  const splitId = makeSplitId(root);
  const newGroup: EditorGroupNode = {
    kind: "group",
    id: newGroupId,
    tabs: [path],
    activePath: path,
  };

  let next = replaceGroup(root, targetGroup.id, (g): SplitContainerNode => {
    const existingGroup: EditorGroupNode =
      sourceGroupId === g.id
        ? {
            ...g,
            tabs: g.tabs.filter((p) => p !== path),
            activePath: nextTabAfterRemove(g.tabs, path, g.activePath),
          }
        : g;
    return {
      kind: "split",
      id: splitId,
      direction,
      ratio: 0.5,
      first: newFirst ? newGroup : existingGroup,
      second: newFirst ? existingGroup : newGroup,
    };
  });

  if (sourceGroupId && sourceGroupId !== targetGroup.id) {
    next = removeTabFromGroup(next, sourceGroupId, path);
  } else {
    next = collapseEmptyGroups(next);
  }

  const createdStillExists = findGroup(next, newGroupId);
  return {
    layout: next,
    activeGroupId: createdStillExists ? newGroupId : getFirstGroup(next).id,
  };
}

/**
 * Divide un grupo con el botón/atajo rápido (`Ctrl+\`): abre `path` (o el archivo activo del grupo)
 * en un nuevo grupo a la derecha sin quitarlo del grupo origen.
 */
export function splitGroupRight(root: LayoutNode, groupId: string, path?: string | null): SplitResult {
  const group = findGroup(root, groupId) ?? getFirstGroup(root);
  const targetPath = path ?? group.activePath ?? group.tabs[0] ?? null;
  if (!targetPath) {
    // Si el grupo está vacío, no tiene sentido crear dos grupos vacíos
    return { layout: root, activeGroupId: group.id };
  }
  return dropTabInGroup(root, group.id, "right", targetPath, undefined);
}

export function setSplitRatio(root: LayoutNode, splitId: string, ratio: number): LayoutNode {
  const clamped = Math.max(0.15, Math.min(0.85, ratio));
  if (root.kind === "group") return root;
  if (root.id === splitId) {
    if (Math.abs(root.ratio - clamped) < 0.0001) return root;
    return { ...root, ratio: clamped };
  }
  const first = setSplitRatio(root.first, splitId, clamped);
  const second = setSplitRatio(root.second, splitId, clamped);
  if (first === root.first && second === root.second) return root;
  return { ...root, first, second };
}

export function remapLayoutPaths(root: LayoutNode, remap: (path: string) => string): LayoutNode {
  if (root.kind === "group") {
    let changed = false;
    const tabs = root.tabs.map((p) => {
      const m = remap(p);
      if (m !== p) changed = true;
      return m;
    });
    const activePath = root.activePath ? remap(root.activePath) : null;
    if (activePath !== root.activePath) changed = true;
    return changed ? { ...root, tabs, activePath } : root;
  }
  const first = remapLayoutPaths(root.first, remap);
  const second = remapLayoutPaths(root.second, remap);
  if (first === root.first && second === root.second) return root;
  return { ...root, first, second };
}
