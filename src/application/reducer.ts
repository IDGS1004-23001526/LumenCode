import type { GitStatus } from "../domain/git";
import type { AppState, DropZone, FileNode, PanelView, Settings } from "../domain/types";
import {
  activateTabInGroup,
  createInitialLayout,
  dropTabInGroup,
  findGroup,
  getFirstGroup,
  isPathOpenInAnyGroup,
  openTabInGroup,
  remapLayoutPaths,
  removeTabFromAllGroups,
  removeTabFromGroup,
  reorderTabInGroup,
  setSplitRatio,
  splitGroupRight,
} from "../domain/editorLayout";
import { setChildren } from "../domain/fileTree";
import { fileNameOf } from "../domain/path";
import type { Store } from "./store";

export type Action =
  | { type: "workspace/loaded"; root: string; tree: FileNode[] }
  | { type: "tree/children"; path: string; children: FileNode[] }
  | { type: "tree/setExpanded"; path: string; expanded: boolean }
  | { type: "tree/collapseAll" }
  | { type: "tab/open"; path: string; groupId?: string }
  | { type: "tab/activate"; path: string; groupId?: string }
  | { type: "tab/close"; path: string; groupId?: string; allGroups?: boolean }
  | { type: "tab/dirty"; path: string; dirty: boolean }
  | { type: "tab/reorder"; groupId: string; fromPath: string; toPath: string; position: "before" | "after" }
  | { type: "group/focus"; groupId: string }
  | { type: "group/split"; groupId?: string; path?: string }
  | { type: "group/drop"; targetGroupId: string; zone: DropZone; path: string; sourceGroupId?: string }
  | { type: "group/resize"; splitId: string; ratio: number }
  | { type: "entry/renamed"; oldPath: string; newPath: string; isDir: boolean }
  | { type: "panel/toggle" }
  | { type: "panel/show"; view: PanelView }
  | { type: "sidebar/toggle" }
  | { type: "git/toggle" }
  | { type: "git/open"; open: boolean }
  | { type: "git/status"; status: GitStatus | null }
  | { type: "settings/open"; open: boolean }
  | { type: "settings/update"; patch: Partial<Settings> };

export type AppStore = Store<AppState, Action>;

export const initialState = (settings: Settings): AppState => {
  const editorLayout = createInitialLayout();
  return {
    rootPath: null,
    tree: [],
    expanded: new Set(),
    tabs: [],
    activePath: null,
    editorLayout,
    activeGroupId: editorLayout.id,
    sidebarVisible: true,
    gitOpen: false,
    panelVisible: true,
    panelView: "terminal",
    settingsOpen: false,
    settings,
    git: null,
  };
};

function ensureGlobalTab(tabs: AppState["tabs"], path: string): AppState["tabs"] {
  if (tabs.some((t) => t.path === path)) return tabs;
  return [...tabs, { path, name: fileNameOf(path), dirty: false }];
}

function withDerived(s: AppState): AppState {
  const activeGroup = findGroup(s.editorLayout, s.activeGroupId) ?? getFirstGroup(s.editorLayout);
  const prunedTabs = s.tabs.filter((t) => isPathOpenInAnyGroup(s.editorLayout, t.path));
  const tabs = prunedTabs.length === s.tabs.length ? s.tabs : prunedTabs;
  return {
    ...s,
    tabs,
    activeGroupId: activeGroup.id,
    activePath: activeGroup.activePath,
  };
}

export function reducer(s: AppState, a: Action): AppState {
  switch (a.type) {
    case "workspace/loaded":
      return {
        ...s,
        rootPath: a.root,
        tree: a.tree,
        expanded: s.rootPath === a.root ? s.expanded : new Set([a.root]),
        git: s.rootPath === a.root ? s.git : null,
      };
    case "tree/children":
      return { ...s, tree: setChildren(s.tree, a.path, a.children) };
    case "tree/setExpanded": {
      if (s.expanded.has(a.path) === a.expanded) return s;
      const expanded = new Set(s.expanded);
      if (a.expanded) expanded.add(a.path);
      else expanded.delete(a.path);
      return { ...s, expanded };
    }
    case "tree/collapseAll":
      return { ...s, expanded: new Set() };

    case "tab/open": {
      const targetId = (a.groupId && findGroup(s.editorLayout, a.groupId)?.id) || s.activeGroupId;
      const tabs = ensureGlobalTab(s.tabs, a.path);
      const editorLayout = openTabInGroup(s.editorLayout, targetId, a.path);
      return withDerived({ ...s, tabs, editorLayout, activeGroupId: targetId });
    }
    case "tab/activate": {
      const targetId = (a.groupId && findGroup(s.editorLayout, a.groupId)?.id) || s.activeGroupId;
      const group = findGroup(s.editorLayout, targetId);
      if (!group) return s;
      const editorLayout = group.tabs.includes(a.path)
        ? activateTabInGroup(s.editorLayout, targetId, a.path)
        : openTabInGroup(s.editorLayout, targetId, a.path);
      if (editorLayout === s.editorLayout && s.activeGroupId === targetId && s.activePath === a.path) return s;
      const tabs = ensureGlobalTab(s.tabs, a.path);
      return withDerived({ ...s, tabs, editorLayout, activeGroupId: targetId });
    }
    case "tab/close": {
      const editorLayout = a.allGroups
        ? removeTabFromAllGroups(s.editorLayout, a.path)
        : removeTabFromGroup(s.editorLayout, a.groupId ?? s.activeGroupId, a.path);
      if (editorLayout === s.editorLayout) return s;
      return withDerived({ ...s, editorLayout });
    }
    case "tab/reorder": {
      const editorLayout = reorderTabInGroup(s.editorLayout, a.groupId, a.fromPath, a.toPath, a.position);
      return editorLayout === s.editorLayout ? s : { ...s, editorLayout };
    }
    case "tab/dirty": {
      const tab = s.tabs.find((t) => t.path === a.path);
      if (!tab || tab.dirty === a.dirty) return s; // evita re-render en cada tecla
      return { ...s, tabs: s.tabs.map((t) => (t.path === a.path ? { ...t, dirty: a.dirty } : t)) };
    }

    case "group/focus": {
      const group = findGroup(s.editorLayout, a.groupId);
      if (!group) return s;
      if (s.activeGroupId === group.id && s.activePath === group.activePath) return s;
      return { ...s, activeGroupId: group.id, activePath: group.activePath };
    }
    case "group/split": {
      const targetId = a.groupId ?? s.activeGroupId;
      const tabs = a.path ? ensureGlobalTab(s.tabs, a.path) : s.tabs;
      const res = splitGroupRight(s.editorLayout, targetId, a.path);
      if (res.layout === s.editorLayout && res.activeGroupId === s.activeGroupId) return s;
      return withDerived({ ...s, tabs, editorLayout: res.layout, activeGroupId: res.activeGroupId });
    }
    case "group/drop": {
      const tabs = ensureGlobalTab(s.tabs, a.path);
      const res = dropTabInGroup(s.editorLayout, a.targetGroupId, a.zone, a.path, a.sourceGroupId);
      if (res.layout === s.editorLayout && res.activeGroupId === s.activeGroupId) return s;
      return withDerived({ ...s, tabs, editorLayout: res.layout, activeGroupId: res.activeGroupId });
    }
    case "group/resize": {
      const editorLayout = setSplitRatio(s.editorLayout, a.splitId, a.ratio);
      return editorLayout === s.editorLayout ? s : { ...s, editorLayout };
    }

    case "entry/renamed": {
      const remap = (p: string): string => {
        if (p === a.oldPath) return a.newPath;
        if (a.isDir && (p.startsWith(`${a.oldPath}/`) || p.startsWith(`${a.oldPath}\\`))) {
          return a.newPath + p.slice(a.oldPath.length);
        }
        return p;
      };
      const expanded = new Set<string>();
      for (const p of s.expanded) expanded.add(remap(p));
      const editorLayout = remapLayoutPaths(s.editorLayout, remap);
      const tabs = s.tabs.map((t) => {
        const nextPath = remap(t.path);
        return nextPath === t.path ? t : { ...t, path: nextPath, name: fileNameOf(nextPath) };
      });
      return withDerived({ ...s, expanded, editorLayout, tabs });
    }

    case "panel/toggle":
      return { ...s, panelVisible: !s.panelVisible };
    case "panel/show":
      return { ...s, panelVisible: true, panelView: a.view };
    case "sidebar/toggle":
      return { ...s, sidebarVisible: !s.sidebarVisible };
    case "git/toggle":
      return { ...s, gitOpen: !s.gitOpen };
    case "git/open":
      return s.gitOpen === a.open ? s : { ...s, gitOpen: a.open };
    case "git/status":
      return { ...s, git: a.status };
    case "settings/open":
      return s.settingsOpen === a.open ? s : { ...s, settingsOpen: a.open };
    case "settings/update":
      return { ...s, settings: { ...s.settings, ...a.patch } };
  }
}
