import { exists, mkdir, readDir, readTextFile, remove, writeTextFile } from "@tauri-apps/plugin-fs";
import type { FileSystemPort } from "../application/ports";
import { sortNodes } from "../domain/fileTree";
import { joinPath } from "../domain/path";

export function createTauriFileSystem(): FileSystemPort {
    return {
        async readDir(path) {
            const entries = await readDir(path);
            return sortNodes(entries.map((e) => ({ name: e.name, path: joinPath(path, e.name), isDir: e.isDirectory })));
        },
        readText: (p) => readTextFile(p),
        writeText: (p, c) => writeTextFile(p, c),
        mkdir: (p) => mkdir(p),
        exists: (p) => exists(p),
        remove: (p) => remove(p), 
    };
}