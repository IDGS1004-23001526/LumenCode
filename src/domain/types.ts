import type { GitStatus } from "./git";

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
export type SplitDirection = "vertical" | "horizontal";
export type DropZone = "left" | "right" | "top" | "bottom" | "center";
export type UpdatePhase = "idle" | "downloading" | "ready" | "installing";

export interface UpdateState {
    phase: UpdatePhase;
    version: string | null;
    /** 0..100 para progreso determinístico; -1 si no se conoce el tamaño total. */
    progress: number;
}

export interface EditorGroupNode {
    kind: "group";
    id: string;
    tabs: string[];
    activePath: string | null;
}

export interface SplitContainerNode {
    kind: "split";
    id: string;
    direction: SplitDirection;
    ratio: number;
    first: LayoutNode;
    second: LayoutNode;
}

export type LayoutNode = EditorGroupNode | SplitContainerNode;

export interface ThemeManifest {
    id: string;
    name: string;
    author: string;
    dark: boolean;
    colors: Record<string, string>;
}

export interface IconSpec {
    color: string;
    badge?: string;
    svg?: string;
}

export interface IconThemeManifest {
    id: string;
    name: string;
    author: string;
    description?: string;
    vars?: Record<string, string>;
    defaultFile: IconSpec;
    defaultFolder: IconSpec;
    defaultFolderOpen?: IconSpec;
    fileNames: Record<string, IconSpec>;
    fileExtensions: Record<string, IconSpec>;
    folderNames: Record<string, IconSpec>;
}

export interface ExtensionManifest {
    id: string;
    name: string;
    author: string;
    version: string;
    category: "Theme" | "IconTheme" | "Productivity" | "Language";
    summary: string;
    readme: string;
    screenshots?: string[];
    theme?: ThemeManifest;
    iconTheme?: IconThemeManifest;
    builtin?: boolean;
}

export interface Settings {
    theme: string;
    iconTheme: string;
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
    editorLayout: LayoutNode;
    activeGroupId: string;
    sidebarVisible: boolean;
    gitOpen: boolean;
    panelVisible: boolean;
    panelView: PanelView;
    settingsOpen: boolean;
    settings: Settings;
    git: GitStatus | null;
    update: UpdateState;
}

export const DEFAULT_SETTINGS: Settings = {
    theme: "lumen-light",
    iconTheme: "lumen-icons",
    fontFamily: "'Monaspace Krypton', 'JetBrains Mono Variable', monospace",
    fontSize: 14,
    cursorSmooth: true,
    cursorBlinking: "expand",
    tabSize: 4,
    wordWrap: false,
    animations: true,
};