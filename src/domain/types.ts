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
export type CursorBlinking = "blink" | "smooth" | "phase" | "expand" | "solid"; 

export interface ThemeManifest {
    id: string;
    name: string;
    author: string;
    dark: boolean;
    colors: Record<string, string>;
}

export interface ExtensionManifest {
    id: string;
    name: string;
    author: string;
    version: string;
    category: "Theme" | "Productivity" | "Language";
    summary: string;
    readme: string;
    screenshots?: string[];
    theme?: ThemeManifest;
    builtin?: boolean;
}

export interface Settings {
    theme: string;
    fontFamily: string;
    fontSize: number;
    cursorSmooth: boolean;
    cursorBlinking: CursorBlinking;
    tabSize: number;
    wordWrap: boolean;
    animations: boolean;
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
    fontSize: 14,
    cursorSmooth: true,
    cursorBlinking: "expand",
    tabSize: 4,
    wordWrap: false,
    animations: true,
};