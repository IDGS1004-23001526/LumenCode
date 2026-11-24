import type { GitStatus } from "../domain/git";
import type { AppState, FileNode, PanelView, Settings } from "../domain/types";
import { setChildren } from "../domain/fileTree";
import { fileNameOf } from "../domain/path";
import { nextActiveAfterClose } from "../domain/tabs";
import type { Store } from "./store";

export type Action =
  | { type: "workspace/loaded"; root: string; tree: FileNode[] }
  | { type: "tree/children"; path: string; children: FileNode[] }
  | { type: "tree/setExpanded"; path: string; expanded: boolean }
  | { type: "tree/collapseAll" }
  | { type: "tab/open"; path: string }
  | { type: "tab/activate"; path: string }
  | { type: "tab/close"; path: string }
  | { type: "tab/dirty"; path: string; dirty: boolean }
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

export const initialState = (settings: Settings): AppState => ({
  rootPath: null,
  tree: [],
  expanded: new Set(),
  tabs: [],
  activePath: null,
  sidebarVisible: true,
  gitOpen: false,
  panelVisible: true,
  panelView: "terminal",
  settingsOpen: false,
  settings,
  git: null,
});

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

    case "tab/open":
      if (s.tabs.some((t) => t.path === a.path)) return { ...s, activePath: a.path };
      return {
        ...s,
        tabs: [...s.tabs, { path: a.path, name: fileNameOf(a.path), dirty: false }],
        activePath: a.path,
      };
    case "tab/activate":
      return s.activePath === a.path ? s : { ...s, activePath: a.path };
    case "tab/close":
      return {
        ...s,
        tabs: s.tabs.filter((t) => t.path !== a.path),
        activePath: nextActiveAfterClose(s.tabs, a.path, s.activePath),
      };
    case "tab/dirty": {
      const tab = s.tabs.find((t) => t.path === a.path);
      if (!tab || tab.dirty === a.dirty) return s; // evita re-render en cada tecla
      return { ...s, tabs: s.tabs.map((t) => (t.path === a.path ? { ...t, dirty: a.dirty } : t)) };
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
      return {
        ...s,
        expanded,
        activePath: s.activePath ? remap(s.activePath) : null,
        tabs: s.tabs.map((t) => {
          const nextPath = remap(t.path);
          return nextPath === t.path ? t : { ...t, path: nextPath, name: fileNameOf(nextPath) };
        }),
      };
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