import { invoke } from "@tauri-apps/api/core";
import type { TerminalPort, TerminalResult } from "../application/ports";
import { fileNameOf } from "../domain/path";

interface RustTerminalInfo {
    os: "windows" | "macos" | "linux";
    shell: string;
    cwd: string;
}

interface RustTerminalOutput {
    cwd: string;
    stdout: string[];
    stderr: string[];
    code: number;
}

function guessOn(): "windows" | "macos" | "linux" {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes("win")) return "windows";
    if (ua.includes("mac")) return "macos";
    return "linux";
}

export class NativeTerminal implements TerminalPort {
    cwd: string;
    os: "windows" | "macos" | "linux";
    shell: string;

    constructor() {
        this.os = guessOn();
        this.cwd = this.os === "windows" ? "C:\\" : "/";
        this.shell = this.os === "windows" ? "powershell.exe" : this.os === "macos" ? "/bin/zsh" : "/bin/bash";
    }

    async init(): Promise<void> {
        const info = await invoke<RustTerminalInfo>("terminal_init");
        this.os = info.os;
        this.shell = info.shell;
        this.cwd = info.cwd;
    }

    setCwd(path: string): void {
        this.cwd = path;
    }

    formatPrompt(): string {
        if (this.os === "windows") return `PS ${this.cwd}`;
        const folder = fileNameOf(this.cwd) || "/";
        const isZsh = this.shell.endsWith("zsh") || this.os === "macos";
        return isZsh ? `${folder} %` : `${folder} $`;
    }

    async run(line: string): Promise<TerminalResult> {
        if (!line.trim()) return { stdout: [], stderr: [], code: 0 };
        const res = await invoke<RustTerminalOutput>("terminal_exec", {
            cwd: this.cwd,
            line,
        });

        this.cwd = res.cwd;

        return {
            stdout: res.stdout,
            stderr: res.stderr,
            code: res.code,
        };
    }
}
