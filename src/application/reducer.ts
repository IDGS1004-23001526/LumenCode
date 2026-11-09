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
  | { type: "panel/toggle" }
  | { type: "panel/show"; view: PanelView }
  | { type: "sidebar/toggle" }
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
  panelVisible: true,
  panelView: "terminal",
  settingsOpen: false,
  settings,
});

export function reducer(s: AppState, a: Action): AppState {
  switch (a.type) {
    case "workspace/loaded":
      return {
        ...s,
        rootPath: a.root,
        tree: a.tree,
        expanded: s.rootPath === a.root ? s.expanded : new Set([a.root]),
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

    case "panel/toggle":
      return { ...s, panelVisible: !s.panelVisible };
    case "panel/show":
      return { ...s, panelVisible: true, panelView: a.view };
    case "sidebar/toggle":
      return { ...s, sidebarVisible: !s.sidebarVisible };
    case "settings/open":
      return s.settingsOpen === a.open ? s : { ...s, settingsOpen: a.open };
    case "settings/update":
      return { ...s, settings: { ...s.settings, ...a.patch } };
  }
}