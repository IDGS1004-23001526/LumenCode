import type { FileNode, Settings } from "../domain/types";

export interface FileSystemPort {
  readDir(path: string): Promise<FileNode[]>;
  readText(path: string): Promise<string>;
  writeText(path: string, content: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  remove(path: string): Promise<void>;
}

export interface DialogPort {
  pickFolder(): Promise<string | null>;
  confirm(message: string, okLabel?: string): Promise<boolean>;
  error(message: string): Promise<void>;
  prompt(label: string): Promise<string | null>;
}

export interface EditorPort {
  open(path: string, content: string): void;
  activate(path: string | null): void;
  close(path: string): void;
  getText(path: string): string;
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