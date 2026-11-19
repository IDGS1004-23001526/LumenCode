import type { FileSystemPort } from "./ports";
import { joinPath } from "../domain/path";
import {
  buildPackageSymbols,
  createEmptyIndex,
  extractFileSymbols,
  type PackageExport,
  type ProjectIndex,
} from "../domain/symbolIndex";

const IGNORED_DIRS = new Set([
  "node_modules", ".git", "target", "dist", "build", ".next", ".nuxt", ".svelte-kit",
  ".astro", ".turbo", ".cache", "out", "coverage", "vendor", "bin", "obj",
  "__pycache__", ".venv", "venv", ".gradle", ".dart_tool", "Pods",
]);

const CODE_EXT = new Set([
  "ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs",
  "py", "pyw", "rs", "c", "h", "cpp", "hpp", "cc", "cxx",
  "java", "cs", "go", "php", "kt", "kts", "swift", "dart", "rb", "lua",
  "sql", "sh", "bash", "zsh", "ps1",
]);

const ASSET_IMPORT_EXT = new Set([
  "css", "scss", "less", "svg", "json",
]);

const MAX_SCAN_DEPTH = 10;
const READ_BATCH_SIZE = 12;
const MAX_PKG_DTS_BYTES = 240_000;

export class WorkspaceIndexer {
  readonly index: ProjectIndex = createEmptyIndex();
  readonly assetFiles = new Set<string>();
  private scanGen = 0;

  constructor(private readonly fs: FileSystemPort) {}

  /** Escanea dependencias y archivos de codigo del proyecto. */
  async scanWorkspace(rootPath: string): Promise<void> {
    const gen = ++this.scanGen;
    this.index.files.clear();
    this.index.packages = [];
    this.index.packageSymbols = [];
    this.assetFiles.clear();

    const discoveredPkgExports: PackageExport[] = [];
    await Promise.all([
      this.scanPackages(rootPath, gen, discoveredPkgExports),
      this.walkDir(rootPath, 0, gen),
    ]);

    if (gen !== this.scanGen) return;
    this.index.packageSymbols = buildPackageSymbols(this.index.packages, discoveredPkgExports);
  }

  /** Escanea rapidamente un directorio concreto (fallback si aun no termino el escaneo global). */
  async scanDirectory(dirPath: string): Promise<void> {
    await this.walkDir(dirPath, MAX_SCAN_DEPTH, this.scanGen);
  }

  /** Actualiza en memoria los simbolos de un unico archivo (al abrirlo o editarlo). */
  updateFile(filePath: string, content: string): void {
    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
    if (ASSET_IMPORT_EXT.has(ext)) {
      this.assetFiles.add(filePath);
      return;
    }
    if (!CODE_EXT.has(ext)) return;
    this.index.files.set(filePath, extractFileSymbols(filePath, content));
  }

  removeFile(filePath: string): void {
    this.index.files.delete(filePath);
    this.assetFiles.delete(filePath);
  }

  private async walkDir(dir: string, depth: number, gen: number): Promise<void> {
    if (depth > MAX_SCAN_DEPTH || gen !== this.scanGen) return;
    let entries;
    try {
      entries = await this.fs.readDir(dir);
    } catch {
      return;
    }

    const subDirs: string[] = [];
    const codeFiles: string[] = [];

    for (const entry of entries) {
      if (entry.isDir) {
        if (!IGNORED_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
          subDirs.push(entry.path);
        }
      } else {
        const ext = entry.name.split(".").pop()?.toLowerCase() ?? "";
        if (CODE_EXT.has(ext)) {
          codeFiles.push(entry.path);
        } else if (ASSET_IMPORT_EXT.has(ext)) {
          this.assetFiles.add(entry.path);
        }
      }
    }

    for (let i = 0; i < codeFiles.length; i += READ_BATCH_SIZE) {
      if (gen !== this.scanGen) return;
      const batch = codeFiles.slice(i, i + READ_BATCH_SIZE);
      await Promise.all(
        batch.map(async (filePath) => {
          try {
            const text = await this.fs.readText(filePath);
            if (gen === this.scanGen) {
              this.index.files.set(filePath, extractFileSymbols(filePath, text));
            }
          } catch {
            // ignora archivos que no se puedan leer
          }
        }),
      );
    }

    for (const sub of subDirs) {
      if (gen !== this.scanGen) return;
      await this.walkDir(sub, depth + 1, gen);
    }
  }

  private async scanPackages(
    root: string,
    gen: number,
    discoveredExports: PackageExport[],
  ): Promise<void> {
    const pkgRoots = [root];
    try {
      const top = await this.fs.readDir(root);
      for (const e of top) {
        if (e.isDir && !IGNORED_DIRS.has(e.name) && !e.name.startsWith(".")) {
          pkgRoots.push(e.path);
        }
      }
    } catch {}

    const seenPkgs = new Set<string>();
    const addPkg = (name: string, ecosystem: "npm" | "cargo" | "pip") => {
      const key = `${ecosystem}:${name}`;
      if (seenPkgs.has(key)) return;
      seenPkgs.add(key);
      this.index.packages.push({ name, ecosystem });
    };

    for (const base of pkgRoots) {
      if (gen !== this.scanGen) return;

      // 1. npm / pnpm / yarn (package.json)
      try {
        const pkgJson = JSON.parse(await this.fs.readText(joinPath(base, "package.json")));
        const deps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };
        const depNames = Object.keys(deps);
        for (const name of depNames) addPkg(name, "npm");

        // Indexa exports de tipos/entrada de dependencias instaladas en node_modules
        await Promise.all(
          depNames.slice(0, 30).map((depName) =>
            this.scanInstalledNpmPackage(base, depName, discoveredExports),
          ),
        );
      } catch {}

      // 2. Rust (Cargo.toml)
      try {
        const cargo = await this.fs.readText(joinPath(base, "Cargo.toml"));
        const depSection = cargo.split(/\[dependencies\]/i)[1]?.split(/^\[/m)[0] ?? "";
        for (const line of depSection.split(/\r?\n/)) {
          const m = /^([A-Za-z0-9_-]+)\s*=/.exec(line.trim());
          if (m) addPkg(m[1], "cargo");
        }
      } catch {}

      // 3. Python (requirements.txt y pyproject.toml)
      try {
        const reqs = await this.fs.readText(joinPath(base, "requirements.txt"));
        for (const line of reqs.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const m = /^([A-Za-z0-9_.-]+)/.exec(trimmed);
          if (m) addPkg(m[1], "pip");
        }
      } catch {}

      try {
        const pyproj = await this.fs.readText(joinPath(base, "pyproject.toml"));
        const depMatches = pyproj.matchAll(/["']([A-Za-z0-9_.-]+)(?:[<>=!~[;].*)?["']/g);
        for (const dm of depMatches) addPkg(dm[1], "pip");
      } catch {}
    }
  }

  private async scanInstalledNpmPackage(
    projectDir: string,
    pkgName: string,
    out: PackageExport[],
  ): Promise<void> {
    let pkgDir = joinPath(projectDir, "node_modules");
    for (const part of pkgName.split("/")) pkgDir = joinPath(pkgDir, part);
    try {
      const meta = JSON.parse(await this.fs.readText(joinPath(pkgDir, "package.json")));
      const entryRel =
        (typeof meta.types === "string" && meta.types) ||
        (typeof meta.typings === "string" && meta.typings) ||
        (typeof meta.module === "string" && meta.module) ||
        (typeof meta.main === "string" && meta.main) ||
        "index.d.ts";
      const cleanRel = entryRel.replace(/^\.\//, "");
      const text = await this.fs.readText(joinPath(pkgDir, cleanRel));
      if (!text || text.length > MAX_PKG_DTS_BYTES) return;

      const syms = extractFileSymbols(cleanRel.endsWith(".ts") || cleanRel.endsWith(".d.ts") ? cleanRel : `${pkgName}.js`, text);
      for (const s of syms) {
        if (s.kind === "module" || s.name.length < 2) continue;
        out.push({
          symbol: s.name,
          pkg: pkgName,
          isDefault: Boolean(s.isDefault),
          ecosystem: "npm",
          kind: s.kind,
        });
      }
    } catch {
      // ignora paquetes sin package.json o entry legible
    }
  }
}
