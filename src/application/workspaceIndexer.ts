import type { FileSystemPort } from "./ports";
import { joinPath } from "../domain/path";
import { buildPackageSymbols, createEmptyIndex, extractFileSymbols, type ProjectIndex } from "../domain/symbolIndex";

const IGNORED_DIRS = new Set([
  "node_modules", ".git", "target", "dist", "build", ".next", ".astro", "__pycache__", ".venv", "venv",
]);

const CODE_EXT = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "rs", "c", "h", "cpp", "hpp", "cc",
  "java", "cs", "go", "php", "kt", "kts", "swift", "dart", "rb", "lua",
]);

export class WorkspaceIndexer {
  readonly index: ProjectIndex = createEmptyIndex();

  constructor(private readonly fs: FileSystemPort) {}

  /** Escanea dependencias y archivos de código del proyecto. */
  async scanWorkspace(rootPath: string): Promise<void> {
    this.index.files.clear();
    this.index.packages = [];
    this.index.packageSymbols = [];

    await Promise.all([
      this.scanPackages(rootPath),
      this.walkDir(rootPath, 0),
    ]);
    this.index.packageSymbols = buildPackageSymbols(this.index.packages);
  }

  /** Actualiza en memoria los símbolos de un único archivo (al abrirlo o editarlo). */
  updateFile(filePath: string, content: string): void {
    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
    if (!CODE_EXT.has(ext)) return;
    this.index.files.set(filePath, extractFileSymbols(filePath, content));
  }

  removeFile(filePath: string): void {
    this.index.files.delete(filePath);
  }

  private async walkDir(dir: string, depth: number): Promise<void> {
    if (depth > 5) return;
    let entries;
    try {
      entries = await this.fs.readDir(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDir) {
        if (!IGNORED_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
          await this.walkDir(entry.path, depth + 1);
        }
      } else {
        const ext = entry.name.split(".").pop()?.toLowerCase() ?? "";
        if (CODE_EXT.has(ext)) {
          try {
            const text = await this.fs.readText(entry.path);
            this.index.files.set(entry.path, extractFileSymbols(entry.path, text));
          } catch {
            // ignora archivos que no se puedan leer
          }
        }
      }
    }
  }

  private async scanPackages(root: string): Promise<void> {
    // 1. npm / pnpm / yarn (package.json)
    try {
      const pkgJson = JSON.parse(await this.fs.readText(joinPath(root, "package.json")));
      const deps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };
      for (const name of Object.keys(deps)) {
        this.index.packages.push({ name, ecosystem: "npm" });
      }
    } catch {}

    // 2. Rust (Cargo.toml)
    try {
      const cargo = await this.fs.readText(joinPath(root, "Cargo.toml"));
      const depSection = cargo.split(/\[dependencies\]/i)[1]?.split(/^\[/m)[0] ?? "";
      for (const line of depSection.split(/\r?\n/)) {
        const m = /^([A-Za-z0-9_-]+)\s*=/.exec(line.trim());
        if (m) this.index.packages.push({ name: m[1], ecosystem: "cargo" });
      }
    } catch {}

    // 3. Python (requirements.txt)
    try {
      const reqs = await this.fs.readText(joinPath(root, "requirements.txt"));
      for (const line of reqs.split(/\r?\n/)) {
        const m = /^([A-Za-z0-9_.-]+)/.exec(line.trim());
        if (m && !line.trim().startsWith("#")) {
          this.index.packages.push({ name: m[1], ecosystem: "pip" });
        }
      }
    } catch {}
  }
}