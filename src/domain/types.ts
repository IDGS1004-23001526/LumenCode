export interface FileNode {
    path: string;
    name: string;
    isDir: boolean;

    /** undefined => todavia no se ha leido (osea es una carga perezosa) */
    children?: FileNode[];
}

export interface Tab {
    path: string;
    name: string;
    dirty: boolean;
}

export type PanelView = "problems" | "output" | "debug" | "terminal";

export interface Settings {
    theme: "lumen-light",
    fontFamily: string;
    fontSize: number;
}

export interface AppState {
    rootPath: string | null;
    tree: FileNode[];
    expanded: ReadonlySet<string>;
    tabs: Tab[];
    activePath: string | null;
    sidebarVisible: boolean;
    panelVisible: boolean;
    panelView: PanelView;
    settingsOpen: boolean;
    settings: Settings;
}

export const DEFAULT_SETTINGS: Settings = {
    theme: "lumen-light",
    fontFamily: "'Monaspace Krypton', 'JetBrains Mono Variable', monospace",
    fontSize: 14
};