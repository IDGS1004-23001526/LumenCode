import type { FileSystemPort } from "./ports";
import { fileExtensionOf, joinPath, pathsEqual } from "../domain/path";
import {
  buildPackageSymbols,
  createEmptyIndex,
  extractFileSymbols,
  type PackageExport,
  type ProjectIndex,
} from "../domain/symbolIndex";
import { analyzeFileDiagnostics, type LumenDiagnostic } from "../presentation/editor/errorLens";

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
const PKG_BATCH_SIZE = 10;
const MAX_PKG_DTS_BYTES = 240_000;
const MAX_WORKSPACE_DIAG_FILES = 300;
const DIAG_CHUNK_SIZE = 12;

export class WorkspaceIndexer {
  readonly index: ProjectIndex = createEmptyIndex();
  readonly assetFiles = new Set<string>();
  private scanGen = 0;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private lastScanAt = 0;
  private diagListener: ((diagsByFile: Map<string, LumenDiagnostic[]>) => void) | null = null;

  constructor(private readonly fs: FileSystemPort) {}

  setDiagnosticsListener(cb: (diagsByFile: Map<string, LumenDiagnostic[]>) => void): void {
    this.diagListener = cb;
  }

  /** Escanea dependencias, simbolos y diagnosticos de todo el proyecto sin vaciar el indice mientras escanea. */
  async scanWorkspace(
    rootPath: string,
    getOpenBuffers?: () => Map<string, string>,
  ): Promise<void> {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    const gen = ++this.scanGen;
    const nextFiles = new Map<string, ReturnType<typeof extractFileSymbols>>();
    const nextAssets = new Set<string>();
    const nextPackages: { name: string; ecosystem: "npm" | "cargo" | "pip" }[] = [];
    const discoveredPkgExports: PackageExport[] = [];
    const diagCandidates: { path: string; text: string }[] = [];
    const openDiags = new Map<string, LumenDiagnostic[]>();

    await Promise.all([
      this.scanPackages(rootPath, gen, nextPackages, discoveredPkgExports),
      this.walkDir(rootPath, 0, gen, nextFiles, nextAssets, diagCandidates),
    ]);

    if (gen !== this.scanGen) return;

    // Captura los buffers sucios después del escaneo en disco para no perder ediciones recientes
    const openBuffers = getOpenBuffers?.() ?? new Map<string, string>();
    if (getOpenBuffers) {
      const resolveExistingKey = <T>(map: Map<string, T>, target: string): string => {
        for (const k of map.keys()) {
          if (pathsEqual(k, target)) return k;
        }
        return target;
      };
      for (const [openPath, content] of openBuffers) {
        const ext = fileExtensionOf(openPath);
        if (CODE_EXT.has(ext)) {
          const symKey = resolveExistingKey(nextFiles, openPath);
          nextFiles.set(symKey, extractFileSymbols(symKey, content));
        }
        const diags = analyzeFileDiagnostics(openPath, content);
        if (diags.length > 0) openDiags.set(openPath, diags);
      }
    }

    this.index.files.clear();
    for (const [k, v] of nextFiles) this.index.files.set(k, v);
    this.assetFiles.clear();
    for (const a of nextAssets) this.assetFiles.add(a);
    this.index.packages = nextPackages;
    this.index.packageSymbols = buildPackageSymbols(nextPackages, discoveredPkgExports);
    this.lastScanAt = Date.now();
    // Los diagnósticos se procesan por lotes en tiempo de inactividad para no bloquear la UI.
    void this.publishDiagnostics(gen, diagCandidates, openBuffers, openDiags).catch(() => {});
  }

  private async publishDiagnostics(
    gen: number,
    candidates: { path: string; text: string }[],
    openBuffers: Map<string, string>,
    openDiags: Map<string, LumenDiagnostic[]>,
  ): Promise<void> {
    const diags = new Map<string, LumenDiagnostic[]>();
    const openPaths = [...openBuffers.keys()];
    for (let i = 0; i < candidates.length; i += DIAG_CHUNK_SIZE) {
      if (gen !== this.scanGen) return;
      const chunk = candidates.slice(i, i + DIAG_CHUNK_SIZE);
      for (const candidate of chunk) {
        // Los buffers abiertos ya se analizaron con su contenido sin guardar.
        if (openPaths.some((p) => pathsEqual(p, candidate.path))) continue;
        const found = analyzeFileDiagnostics(candidate.path, candidate.text);
        if (found.length > 0) diags.set(candidate.path, found);
      }
      if (i + DIAG_CHUNK_SIZE < candidates.length) await this.yieldToMain();
    }
    if (gen !== this.scanGen) return;
    for (const [path, found] of openDiags) diags.set(path, found);
    this.diagListener?.(diags);
  }

  private yieldToMain(): Promise<void> {
    return new Promise((resolve) => {
      if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(() => resolve(), { timeout: 400 });
        return;
      }
      setTimeout(resolve, 0);
    });
  }

  /** Programa un reescaneo ligero en segundo plano (tras comandos de terminal o foco de ventana). */
  scheduleRefresh(
    rootPath: string,
    getOpenBuffers?: () => Map<string, string>,
    minIntervalMs = 3_000,
  ): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    const wait = Math.max(300, minIntervalMs - (Date.now() - this.lastScanAt));
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.scanWorkspace(rootPath, getOpenBuffers);
    }, wait);
  }

  /** Escanea rapidamente un directorio concreto (fallback si aun no termino el escaneo global). */
  async scanDirectory(dirPath: string): Promise<void> {
    await this.walkDir(dirPath, MAX_SCAN_DEPTH, this.scanGen, this.index.files, this.assetFiles);
  }

  /** Actualiza en memoria los simbolos de un unico archivo (al abrirlo o editarlo). */
  updateFile(filePath: string, content: string): void {
    const ext = fileExtensionOf(filePath);
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

  private async walkDir(
    dir: string,
    depth: number,
    gen: number,
    targetFiles: Map<string, ReturnType<typeof extractFileSymbols>>,
    targetAssets: Set<string>,
    targetDiags?: { path: string; text: string }[],
  ): Promise<void> {
    if (depth > MAX_SCAN_DEPTH || gen !== this.scanGen) return;
    let entries;
    try {
      entries = await this.fs.readDir(dir);
    } catch {
      return;
    }

    const subDirs: string[] = [];
    const codeFiles: string[] = [];
    const jsonFiles: string[] = [];

    for (const entry of entries) {
      if (entry.isDir) {
        if (!IGNORED_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
          subDirs.push(entry.path);
        }
      } else {
        const lowerName = entry.name.toLowerCase();
        const ext = fileExtensionOf(entry.name);
        if (CODE_EXT.has(ext)) {
          codeFiles.push(entry.path);
        } else if (ASSET_IMPORT_EXT.has(ext)) {
          targetAssets.add(entry.path);
          if (ext === "json" && lowerName !== "package-lock.json") {
            jsonFiles.push(entry.path);
          }
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
            if (gen !== this.scanGen) return;
            targetFiles.set(filePath, extractFileSymbols(filePath, text));
            if (targetDiags && targetDiags.length < MAX_WORKSPACE_DIAG_FILES) {
              targetDiags.push({ path: filePath, text });
            }
          } catch {
            // ignora archivos que no se puedan leer
          }
        }),
      );
    }

    if (targetDiags && jsonFiles.length > 0 && targetDiags.length < MAX_WORKSPACE_DIAG_FILES) {
      for (let i = 0; i < jsonFiles.length; i += READ_BATCH_SIZE) {
        if (gen !== this.scanGen) return;
        const batch = jsonFiles.slice(i, i + READ_BATCH_SIZE);
        await Promise.all(
          batch.map(async (filePath) => {
            try {
              const text = await this.fs.readText(filePath);
              if (gen !== this.scanGen) return;
              if (targetDiags.length < MAX_WORKSPACE_DIAG_FILES) {
                targetDiags.push({ path: filePath, text });
              }
            } catch {}
          }),
        );
      }
    }

    for (const sub of subDirs) {
      if (gen !== this.scanGen) return;
      await this.walkDir(sub, depth + 1, gen, targetFiles, targetAssets, targetDiags);
    }
  }

  private async scanPackages(
    root: string,
    gen: number,
    targetPackages: { name: string; ecosystem: "npm" | "cargo" | "pip" }[],
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
      targetPackages.push({ name, ecosystem });
    };

    for (const base of pkgRoots) {
      if (gen !== this.scanGen) return;

      // 1. npm / pnpm / yarn (package.json)
      try {
        const pkgJson = JSON.parse(await this.fs.readText(joinPath(base, "package.json")));
        const prodDeps = Object.keys(pkgJson.dependencies ?? {});
        const devDeps = Object.keys(pkgJson.devDependencies ?? {});
        const depNames = [...new Set([...prodDeps, ...devDeps])];
        for (const name of depNames) addPkg(name, "npm");

        // Indexa exports de TODAS las dependencias instaladas en node_modules por lotes controlados
        for (let i = 0; i < depNames.length; i += PKG_BATCH_SIZE) {
          if (gen !== this.scanGen) return;
          const batch = depNames.slice(i, i + PKG_BATCH_SIZE);
          await Promise.all(
            batch.map((depName) =>
              this.scanInstalledNpmPackage(base, depName, discoveredExports),
            ),
          );
        }
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
        // 1. PEP 621: `dependencies = [ "pkg>=1.0", ... ]`
        const pep621Blocks = pyproj.matchAll(/\bdependencies\s*=\s*\[([\s\S]*?)\]/g);
        for (const block of pep621Blocks) {
          for (const dm of block[1].matchAll(/["']([A-Za-z0-9_.-]+)(?:[<>=!~[;][^"'\r\n]*)?["']/g)) {
            addPkg(dm[1], "pip");
          }
        }
        // 2. Poetry: `[tool.poetry.dependencies]`
        const poetrySection = pyproj.split(/\[tool\.poetry\.dependencies\]/i)[1]?.split(/^\[/m)[0] ?? "";
        for (const line of poetrySection.split(/\r?\n/)) {
          const pm = /^([A-Za-z0-9_.-]+)\s*=/.exec(line.trim());
          if (pm && pm[1].toLowerCase() !== "python") addPkg(pm[1], "pip");
        }
      } catch {}
    }
  }

  private async scanInstalledNpmPackage(
    projectDir: string,
    pkgName: string,
    out: PackageExport[],
  ): Promise<void> {
    if (pkgName.startsWith("@types/")) return;
    let pkgDir = joinPath(projectDir, "node_modules");
    for (const part of pkgName.split("/")) pkgDir = joinPath(pkgDir, part);

    const tryReadEntry = async (dir: string, entryRel: string): Promise<{ rel: string; text: string } | null> => {
      try {
        const cleanRel = entryRel.replace(/^\.\//, "");
        const text = await this.fs.readText(joinPath(dir, cleanRel));
        if (!text || text.length > MAX_PKG_DTS_BYTES) return null;
        return { rel: cleanRel, text };
      } catch {
        return null;
      }
    };

    let found: { rel: string; text: string } | null = null;
    try {
      const meta = JSON.parse(await this.fs.readText(joinPath(pkgDir, "package.json")));
      const entryRel =
        (typeof meta.types === "string" && meta.types) ||
        (typeof meta.typings === "string" && meta.typings) ||
        (typeof meta.module === "string" && meta.module) ||
        (typeof meta.main === "string" && meta.main) ||
        "index.d.ts";
      found = await tryReadEntry(pkgDir, entryRel);
    } catch {}

    // Fallback a `node_modules/@types/<pkg>/index.d.ts` si el paquete no incluye sus propios tipos
    if (!found) {
      const typesName = pkgName.startsWith("@")
        ? pkgName.slice(1).replace(/\//g, "__")
        : pkgName;
      const typesDir = joinPath(joinPath(joinPath(projectDir, "node_modules"), "@types"), typesName);
      found = await tryReadEntry(typesDir, "index.d.ts");
    }

    if (!found) return;
    const isTsFile = found.rel.endsWith(".ts") || found.rel.endsWith(".d.ts");
    const syms = extractFileSymbols(isTsFile ? found.rel : `${pkgName}.js`, found.text);
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
  }
}
