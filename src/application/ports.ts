import type { DiffPayload } from "../domain/git";
import type { FileNode, Settings } from "../domain/types";

export interface FileSystemPort {
  readDir(path: string): Promise<FileNode[]>;
  readText(path: string): Promise<string>;
  readBinary(path: string): Promise<Uint8Array>;
  writeText(path: string, content: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  remove(path: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
}

export interface DialogPort {
  pickFolder(): Promise<string | null>;
  pickFile(): Promise<string | null>;
  saveFile(defaultPath?: string): Promise<string | null>;
  confirm(message: string, okLabel?: string): Promise<boolean>;
  error(message: string): Promise<void>;
  prompt(label: string, options?: { initialValue?: string; confirmLabel?: string }): Promise<string | null>;
  withBusy<T>(label: string, task: () => Promise<T>): Promise<T>;
}

export interface EditorPort {
  open(path: string, content: string): void;
  openImage(path: string, url: string, byteSize: number): void;
  openDiff(diff: DiffPayload): void;
  mountGroup(groupId: string, bodyEl: HTMLElement): void;
  unmountGroup(groupId: string): void;
  syncGroup(groupId: string, path: string | null, focused: boolean, forceFocus?: boolean): void;
  setActiveGroup(groupId: string): void;
  refreshPath(path: string): void;
  revealPosition(path: string, line: number, character: number): void;
  rename(oldPath: string, newPath: string): void;
  close(path: string): void;
  isEditable(path: string): boolean;
  getText(path: string): string;
  setText(path: string, content: string): void;
  configure(opts: { tabSize: number; wordWrap: boolean; dark?: boolean }): void;
  focus(): void;
  remeasure(): void;
}

export interface TerminalResult {
  stdout: string[];
  stderr: string[];
  code: number;
}

export interface TerminalPort {
  readonly cwd: string;
  readonly os: "windows" | "macos" | "linux";
  readonly shell: string;
  init(): Promise<void>;
  setCwd(path: string): void;
  /** Formatea el prompt según la shell real del SO (`PS C:\ruta>`, `carpeta %` o `carpeta $`). */
  formatPrompt(): string;
  onOutput(cb: (line: string, isErr: boolean) => void): void;
  kill(): Promise<void>;
  run(line: string): Promise<TerminalResult>;
}

export interface SettingsRepository {
  load(): Partial<Settings> | null;
  save(settings: Settings): void;
}