import type { DiffPayload, GitCommitFile, GitFileStatus } from "../domain/git";
import type { FileNode } from "../domain/types";
import { hasFileExtension, imageMimeFor, isImageFile, isTextFile, isValidName, joinPath, normalizePath, parentDirOf, pathsEqual } from "../domain/path";
import { gitClient } from "../infraestructure/gitClient";
import type { AppStore } from "./reducer";
import type { DialogPort, EditorPort, FileSystemPort, TerminalPort } from "./ports";
import type { WorkspaceIndexer } from "./workspaceIndexer";

interface Deps {
  store: AppStore;
  fs: FileSystemPort;
  dialogs: DialogPort;
  editor: EditorPort;
  terminal: TerminalPort;
  indexer: WorkspaceIndexer;
}

export type UseCases = ReturnType<typeof createUseCases>;

export function createUseCases({ store, fs, dialogs, editor, terminal, indexer }: Deps) {
  const st = () => store.getState();
  const isDiffPath = (path: string) => path.startsWith("git-diff://") || path.startsWith("conflict:");
  const findOpenTab = (path: string) => st().tabs.find((t) => pathsEqual(t.path, path));
  let workspaceLoadGen = 0;
  let gitRefreshGen = 0;
  const inFlightOpens = new Map<string, Promise<string | null>>();

  async function loadChildren(path: string): Promise<boolean> {
    try {
      store.dispatch({ type: "tree/children", path, children: await fs.readDir(path) });
      return true;
    } catch {
      return false;
    }
  }

  async function loadWorkspace(root: string) {
    const gen = ++workspaceLoadGen;
    let tree: FileNode[];
    try {
      tree = await fs.readDir(root);
    } catch (e) {
      return dialogs.error(`No se pudo leer la carpeta.\n\n${String(e)}`);
    }
    if (gen !== workspaceLoadGen) return;
    terminal.setCwd(root); // antes del dispatch para que el prompt se actualice
    store.dispatch({ type: "workspace/loaded", root, tree });
    // Recarga subcarpetas que estaban abiertas (padres antes que hijos).
    const open = [...st().expanded].filter((p) => p !== root).sort((a, b) => a.length - b.length);
    for (const p of open) {
      if (gen !== workspaceLoadGen) return;
      await loadChildren(p);
    }
    if (gen !== workspaceLoadGen) return;
    void indexer.scanWorkspace(root, getOpenDirtyBuffers);
    void refreshGit();
  }

  async function openFolder() {
    const root = await dialogs.pickFolder();
    if (root) await loadWorkspace(root);
  }

  async function openFileDialog() {
    const path = await dialogs.pickFile();
    if (path) await openFile(path);
  }

  async function reloadOpenTabsFromDisk() {
    const tabs = [...st().tabs];
    for (const tab of tabs) {
      if (isDiffPath(tab.path) || isImageFile(tab.path) || !editor.isEditable(tab.path)) continue;
      if (tab.dirty) continue;
      try {
        const exists = await fs.exists(tab.path);
        const afterExists = st().tabs.find((t) => t.path === tab.path);
        if (!afterExists || afterExists.dirty) continue;
        if (!exists) {
          editor.close(tab.path);
          store.dispatch({ type: "tab/close", path: tab.path });
          continue;
        }
        const disk = await fs.readText(tab.path);
        const afterRead = st().tabs.find((t) => t.path === tab.path);
        if (!afterRead || afterRead.dirty || !editor.isEditable(tab.path)) continue;
        if (disk !== editor.getText(tab.path)) {
          editor.setText(tab.path, disk);
          indexer.updateFile(tab.path, disk);
          store.dispatch({ type: "tab/dirty", path: tab.path, dirty: false });
        }
      } catch {
        // Ignora errores transitorios de lectura en pestañas externas
      }
    }
  }

  async function refresh() {
    const root = st().rootPath;
    if (root) {
      await loadWorkspace(root);
      await reloadOpenTabsFromDisk();
    }
  }

  async function toggleFolder(node: FileNode) {
    const isOpen = st().expanded.has(node.path);
    if (!isOpen && !node.children && node.path !== st().rootPath) {
      if (!(await loadChildren(node.path))) return dialogs.error("No se pudo leer la carpeta.");
    }
    store.dispatch({ type: "tree/setExpanded", path: node.path, expanded: !isOpen });
  }

  async function openFile(path: string): Promise<string | null> {
    const existing = findOpenTab(path);
    if (existing) {
      store.dispatch({ type: "tab/activate", path: existing.path }); // ya abierto → foco
      return existing.path;
    }
    const norm = normalizePath(path);
    const lockKey = /^[A-Z]:\\/.test(norm) ? norm.toLowerCase() : norm;
    const pending = inFlightOpens.get(lockKey);
    if (pending) return pending;

    const op = (async (): Promise<string | null> => {
      const recheck = findOpenTab(path);
      if (recheck) {
        store.dispatch({ type: "tab/activate", path: recheck.path });
        return recheck.path;
      }
      if (isImageFile(path)) {
        try {
          const bytes = await fs.readBinary(path);
          const blob = new Blob([new Uint8Array(bytes)], { type: imageMimeFor(path) });
          const url = URL.createObjectURL(blob);
          editor.openImage(path, url, bytes.byteLength);
          store.dispatch({ type: "tab/open", path });
          return path;
        } catch (e) {
          await dialogs.error(`No se pudo abrir la imagen.\n\n${String(e)}`);
          return null;
        }
      }
      if (!isTextFile(path)) {
        await dialogs.error("Este tipo de archivo no se puede abrir en el editor.");
        return null;
      }
      try {
        const text = await fs.readText(path);
        editor.open(path, text);
        indexer.updateFile(path, text);
        if (indexer.index.files.size <= 1) {
          void indexer.scanDirectory(parentDirOf(path));
        }
        store.dispatch({ type: "tab/open", path });
        return path;
      } catch (e) {
        await dialogs.error(`No se pudo abrir el archivo.\n\n${String(e)}`);
        return null;
      }
    })();

    inFlightOpens.set(lockKey, op);
    try {
      return await op;
    } finally {
      inFlightOpens.delete(lockKey);
    }
  }

  async function openFileAt(path: string, line: number, character: number) {
    const openedPath = await openFile(path);
    if (openedPath) {
      editor.revealPosition(openedPath, line, character);
    }
  }

  async function closeTab(path: string) {
    const tab = st().tabs.find((t) => t.path === path);
    if (!tab) return;
    if (tab.dirty && !(await dialogs.confirm(`"${tab.name}" tiene cambios sin guardar. ¿Cerrar y descartarlos?`))) return;
    editor.close(path);
    store.dispatch({ type: "tab/close", path });
    if (tab.dirty) scheduleIndexRefresh();
  }

  async function saveActive() {
    const path = st().activePath;
    if (!path || isDiffPath(path) || isImageFile(path) || !editor.isEditable(path)) return;
    try {
      const content = editor.getText(path);
      await fs.writeText(path, content);
      indexer.updateFile(path, content);
      store.dispatch({ type: "tab/dirty", path, dirty: false });
      scheduleGitRefresh();
    } catch (e) {
      await dialogs.error(`No se pudo guardar.\n\n${String(e)}`);
    }
  }

  async function saveActiveAs() {
    const path = st().activePath;
    if (!path || isDiffPath(path) || isImageFile(path) || !editor.isEditable(path)) return;
    try {
      const content = editor.getText(path);
      const target = await dialogs.saveFile(path);
      if (!target) return;
      if (pathsEqual(target, path)) {
        await saveActive();
        return;
      }

      const existingTarget = findOpenTab(target);
      if (
        existingTarget?.dirty &&
        !(await dialogs.confirm(
          `"${existingTarget.name}" tiene cambios sin guardar en esa ruta. ¿Sobrescribirlos?`,
          "Sobrescribir",
        ))
      ) {
        return;
      }

      await fs.writeText(target, content);

      const oldTab = st().tabs.find((t) => t.path === path);
      // Cierra la pestaña original sin preguntar: su contenido ya se guardó en la nueva ruta.
      editor.close(path);
      store.dispatch({ type: "tab/close", path });

      if (existingTarget) {
        editor.setText(existingTarget.path, content);
        indexer.updateFile(existingTarget.path, content);
        store.dispatch({ type: "tab/dirty", path: existingTarget.path, dirty: false });
        store.dispatch({ type: "tab/activate", path: existingTarget.path });
      } else {
        editor.open(target, content);
        indexer.updateFile(target, content);
        store.dispatch({ type: "tab/open", path: target });
      }

      // La ruta anterior sigue en disco: se reindexa para descartar el buffer antiguo.
      if (oldTab?.dirty) scheduleIndexRefresh();
      scheduleGitRefresh();
    } catch (e) {
      await dialogs.error(`No se pudo guardar como.\n\n${String(e)}`);
    }
  }

  async function createEntry(kind: "file" | "folder", targetDir?: string) {
    const baseDir = targetDir ?? st().rootPath;
    if (!baseDir) return openFolder();

    const name = await dialogs.prompt(
      kind === "file"
      ? "Nombre y extensión del nuevo archivo"
      : "Nombre de la nueva carpeta",
    );

    if (!name) return;
    if (!isValidName(name)) {
      return dialogs.error("El nombre contiene caracteres no válidos");
    }

    if (kind === "file" && !hasFileExtension(name)){
      return dialogs.error("Debe incluir nombre y extensión del archivo")
    }

    const path = joinPath(baseDir, name.trim());

    try {
      if (await fs.exists(path)) return dialogs.error(`"${name}" ya existe en esta ubicación`);
      if (kind === "file") await fs.writeText(path, "");
      else await fs.mkdir(path);
    } catch (e) {
      return dialogs.error(`No se pudo crear \n\n${String(e)}`);
    }

    // Asegurar que la carpeta donde se creó quede expandida y actualizada
    store.dispatch({ type: "tree/setExpanded", path: baseDir, expanded: true });
    await refresh();
    if (kind === "file") await openFile(path);
  }

  async function deleteFile(node: FileNode) {
    if (node.isDir) return;

    const ok = await dialogs.confirm(`¿Estás seguro de que deseas eliminarlo? "${node.name}"?`, "Eliminar");

    if (!ok) return;

    try {
      await fs.remove(node.path);
      indexer.removeFile(node.path);
    } catch (e) {
      return dialogs.error(`No se pudo eliminar el archivo \n\n${String(e)}`);
    }

    // Si el archivo eliminado estaba abierto en una pestaña, la cerramos
    if (st().tabs.some((t) => t.path === node.path)) {
      editor.close(node.path);
      store.dispatch({ type: "tab/close", path: node.path });
    }

    await refresh();
  }

  async function renameEntry(node: FileNode) {
    if (node.path === st().rootPath) return;

    const raw = await dialogs.prompt(
      node.isDir ? "Nuevo nombre de la carpeta" : "Nuevo nombre del archivo",
      { initialValue: node.name, confirmLabel: "Renombrar" },
    );

    if (!raw) return;
    const nextName = raw.trim();
    if (!nextName || nextName === node.name) return;

    if (!isValidName(nextName)) {
      return dialogs.error("El nombre contiene caracteres no válidos");
    }

    const parent = parentDirOf(node.path);
    const newPath = joinPath(parent, nextName);

    try {
      const isCaseOnlyRename = newPath.toLowerCase() === node.path.toLowerCase();
      if (isCaseOnlyRename) {
        const siblings = await fs.readDir(parent).catch(() => []);
        if (siblings.some((s) => s.name === nextName)) {
          return dialogs.error(`"${nextName}" ya existe en esta ubicación`);
        }
      } else if (await fs.exists(newPath)) {
        return dialogs.error(`"${nextName}" ya existe en esta ubicación`);
      }
      await fs.rename(node.path, newPath);
    } catch (e) {
      return dialogs.error(`No se pudo renombrar.\n\n${String(e)}`);
    }

    const remap = (p: string): string => {
      if (p === node.path) return newPath;
      if (node.isDir && (p.startsWith(`${node.path}/`) || p.startsWith(`${node.path}\\`))) {
        return newPath + p.slice(node.path.length);
      }
      return p;
    };

    for (const tab of st().tabs) {
      const mapped = remap(tab.path);
      if (mapped !== tab.path) {
        editor.rename(tab.path, mapped);
      }
    }

    if (!node.isDir) {
      indexer.removeFile(node.path);
    }

    store.dispatch({ type: "entry/renamed", oldPath: node.path, newPath, isDir: node.isDir });
    await refresh();
  }

  async function refreshGit() {
    gitClient.cancelScheduledRefresh();
    const gen = ++gitRefreshGen;
    const root = st().rootPath;
    if (!root) {
      store.dispatch({ type: "git/status", status: null });
      return;
    }
    try {
      const status = await gitClient.status(root);
      if (gen === gitRefreshGen && st().rootPath === root) {
        store.dispatch({ type: "git/status", status });
      }
    } catch {
      // Ignorar errores transitorios en background
    }
  }

  function getOpenDirtyBuffers(): Map<string, string> {
    const out = new Map<string, string>();
    for (const tab of st().tabs) {
      if (tab.dirty) out.set(tab.path, editor.getText(tab.path));
    }
    return out;
  }

  function scheduleIndexRefresh() {
    const root = st().rootPath;
    if (!root) return;
    indexer.scheduleRefresh(root, getOpenDirtyBuffers);
  }

  function scheduleGitRefresh() {
    const root = st().rootPath;
    if (!root) return;
    const gen = ++gitRefreshGen;
    gitClient.scheduleRefresh(root, (status) => {
      if (gen === gitRefreshGen && st().rootPath === root) {
        store.dispatch({ type: "git/status", status });
      }
    });
  }

  function repoRoot(): string | null {
    const g = st().git;
    if (g?.is_repo && g.root) return g.root;
    return st().rootPath;
  }

  async function gitInit() {
    const root = st().rootPath;
    if (!root) return;
    try {
      await gitClient.init(root);
      await refreshGit();
    } catch (e) {
      await dialogs.error(`No se pudo inicializar el repositorio.\n\n${String(e)}`);
    }
  }

  async function gitStage(paths: string[]) {
    const root = repoRoot();
    if (!root) return;
    try {
      await gitClient.stage(root, paths);
      await refreshGit();
    } catch (e) {
      await dialogs.error(`No se pudo hacer stage.\n\n${String(e)}`);
    }
  }

  async function gitUnstage(paths: string[]) {
    const root = repoRoot();
    if (!root) return;
    try {
      await gitClient.unstage(root, paths);
      await refreshGit();
    } catch (e) {
      await dialogs.error(`No se pudo hacer unstage.\n\n${String(e)}`);
    }
  }

  async function gitDiscard(entry: GitFileStatus) {
    const root = repoRoot();
    if (!root) return;
    const isUntracked = entry.status === "U";
    const ok = await dialogs.confirm(
      isUntracked
        ? `¿Eliminar el archivo sin seguimiento "${entry.path}"? Esta acción no se puede deshacer.`
        : `¿Descartar los cambios en "${entry.path}"?`,
      isUntracked ? "Eliminar" : "Descartar",
    );
    if (!ok) return;

    try {
      await gitClient.discard(root, [entry.path], isUntracked);
      const fullPath = joinPath(root, entry.path);
      const openTab = findOpenTab(fullPath);
      if (openTab) {
        if (isUntracked || !(await fs.exists(openTab.path))) {
          editor.close(openTab.path);
          store.dispatch({ type: "tab/close", path: openTab.path });
        } else if (isImageFile(openTab.path)) {
          try {
            const bytes = await fs.readBinary(openTab.path);
            const blob = new Blob([new Uint8Array(bytes)], { type: imageMimeFor(openTab.path) });
            const url = URL.createObjectURL(blob);
            editor.openImage(openTab.path, url, bytes.byteLength);
            if (st().activePath === openTab.path) editor.activate(openTab.path);
          } catch {
            // Mantiene la vista previa actual ante fallos transitorios de lectura
          }
        } else if (editor.isEditable(openTab.path)) {
          try {
            const text = await fs.readText(openTab.path);
            editor.setText(openTab.path, text);
            store.dispatch({ type: "tab/dirty", path: openTab.path, dirty: false });
          } catch {
            // Mantiene el buffer intacto ante fallos transitorios de lectura
          }
        }
      }
      await refresh();
    } catch (e) {
      await dialogs.error(`No se pudieron descartar los cambios.\n\n${String(e)}`);
    }
  }

  async function gitCommit(message: string, amend = false, pushAfter = false): Promise<boolean> {
    const root = repoRoot();
    const g = st().git;
    if (!root || !g) return false;

    const cleanMsg = message.trim();
    if (!cleanMsg) {
      await dialogs.error("Escribe un mensaje para el commit.");
      return false;
    }

    const hasStaged = g.entries.some((e) => e.staged);
    const hasUnstaged = g.entries.some((e) => e.unstaged);
    if (!hasStaged && !amend) {
      if (!hasUnstaged) {
        await dialogs.error("No hay cambios para confirmar.");
        return false;
      }
      const ok = await dialogs.confirm(
        "No hay cambios en stage. ¿Quieres hacer Stage All y confirmar el commit?",
        "Stage All y Commit",
      );
      if (!ok) return false;
    }

    try {
      await dialogs.withBusy(
        pushAfter ? "Subiendo cambios a Git..." : "Confirmando commit...",
        async () => {
          if (!hasStaged && !amend) {
            await gitClient.stage(root, []);
          }
          await gitClient.commit(root, cleanMsg, amend);
          if (pushAfter) {
            if (g.upstream) {
              await gitClient.remoteOp(root, "push");
            } else if (g.detached) {
              throw new Error("No se puede publicar en estado HEAD desacoplado. Crea o cambia a una rama primero.");
            } else {
              await gitClient.remoteOp(root, "publish", g.branch);
            }
          }
          await refreshGit();
        },
      );
      return true;
    } catch (e) {
      await dialogs.error(`No se pudo completar el commit.\n\n${String(e)}`);
      await refreshGit();
      return false;
    }
  }

  async function gitUndoLastCommit() {
    const root = repoRoot();
    if (!root) return;
    const ok = await dialogs.confirm(
      "¿Deshacer el último commit (git reset --soft HEAD~1)? Los cambios volverán a Staged Changes.",
      "Deshacer commit",
    );
    if (!ok) return;
    try {
      await gitClient.undoLastCommit(root);
      await refreshGit();
    } catch (e) {
      await dialogs.error(`No se pudo deshacer el último commit.\n\n${String(e)}`);
    }
  }

  async function gitRemoteOp(
    op: "fetch" | "pull" | "pull-rebase" | "push" | "publish" | "sync" | "abort-merge" | "abort-rebase",
  ) {
    const root = repoRoot();
    const g = st().git;
    if (!root || !g) return;
    if (op === "publish" && g.detached) {
      await dialogs.error("No se puede publicar en estado HEAD desacoplado. Crea o cambia a una rama primero.");
      return;
    }
    const labels: Record<string, string> = {
      fetch: "Obteniendo cambios remotos (Fetch)...",
      pull: "Descargando cambios (Pull)...",
      "pull-rebase": "Descargando cambios (Pull Rebase)...",
      push: "Subiendo cambios a Git (Push)...",
      publish: "Publicando rama en Git...",
      sync: "Sincronizando cambios con Git...",
      "abort-merge": "Abortando merge...",
      "abort-rebase": "Abortando rebase...",
    };
    try {
      await dialogs.withBusy(labels[op] ?? "Ejecutando operación Git...", async () => {
        await gitClient.remoteOp(root, op, g.branch);
        await refresh();
      });
    } catch (e) {
      await dialogs.error(`Error en operación Git (${op}).\n\n${String(e)}`);
      await refreshGit();
    }
  }

  async function gitOpenDiff(entry: GitFileStatus, mode: "working" | "staged") {
    const root = repoRoot();
    if (!root) return;
    const fullPath = joinPath(root, entry.path);
    const openTab = findOpenTab(fullPath);
    const leftRef = mode === "staged" ? "HEAD" : ":0";
    const leftText = await gitClient.showFile(root, leftRef, entry.path).catch(() => "");
    let rightText = "";
    if (mode === "staged") {
      rightText = await gitClient.showFile(root, ":0", entry.path).catch(() => "");
    } else {
      rightText = openTab && editor.isEditable(openTab.path)
        ? editor.getText(openTab.path)
        : await fs.readText(fullPath).catch(() => "");
    }

    const diff: DiffPayload = {
      id: `git-diff://${mode}/${entry.path}`,
      title: `${entry.path} (${mode === "staged" ? "Staged" : "Working Tree"})`,
      relPath: entry.path,
      repoRoot: root,
      leftTitle: mode === "staged" ? "HEAD" : "Index",
      rightTitle: mode === "staged" ? "Index (Staged)" : "Working Tree",
      leftText,
      rightText,
      mode,
    };
    openDiffTab(diff);
  }

  async function gitOpenCommitDiff(hash: string, file: GitCommitFile) {
    const root = repoRoot();
    if (!root) return;
    const leftPath = file.old_path ?? file.path;
    const leftText = await gitClient.showFile(root, `${hash}^`, leftPath).catch(() => "");
    const rightText = await gitClient.showFile(root, hash, file.path).catch(() => "");

    openDiffTab({
      id: `git-diff://commit/${hash}/${file.path}`,
      title: `${file.path} (${hash.slice(0, 7)})`,
      relPath: file.path,
      repoRoot: root,
      leftTitle: `${hash.slice(0, 7)}^`,
      rightTitle: hash.slice(0, 7),
      leftText,
      rightText,
      mode: "commit",
    });
  }

  function openDiffTab(diff: DiffPayload) {
    editor.openDiff(diff);
    const alreadyActive = st().activePath === diff.id;
    store.dispatch({ type: "tab/open", path: diff.id });
    if (alreadyActive) editor.activate(diff.id);
  }

  async function gitAddToGitignore(relPath: string) {
    const root = repoRoot();
    if (!root) return;
    try {
      await gitClient.addGitignore(root, relPath);
      await refreshGit();
    } catch (e) {
      await dialogs.error(`No se pudo actualizar .gitignore.\n\n${String(e)}`);
    }
  }

  async function gitReloadAfterDiffMutation(repoPath: string, relPath: string, touchedDisk = true) {
    const fullPath = joinPath(repoPath, relPath);
    const openTab = findOpenTab(fullPath);
    if (touchedDisk && openTab && editor.isEditable(openTab.path)) {
      if (!(await fs.exists(openTab.path))) {
        editor.close(openTab.path);
        store.dispatch({ type: "tab/close", path: openTab.path });
      } else {
        try {
          const disk = await fs.readText(openTab.path);
          editor.setText(openTab.path, disk);
          store.dispatch({ type: "tab/dirty", path: openTab.path, dirty: false });
        } catch {
          // Mantiene el buffer intacto ante fallos transitorios de lectura
        }
      }
    }
    const active = st().activePath;
    const expectedWorking = `git-diff://working/${relPath}`;
    const expectedStaged = `git-diff://staged/${relPath}`;
    if (active === expectedWorking || active === expectedStaged) {
      const mode = active === expectedStaged ? "staged" : "working";
      const leftRef = mode === "staged" ? "HEAD" : ":0";
      const leftText = await gitClient.showFile(repoPath, leftRef, relPath).catch(() => "");
      const rightText = mode === "staged"
        ? await gitClient.showFile(repoPath, ":0", relPath).catch(() => "")
        : openTab && editor.isEditable(openTab.path)
          ? editor.getText(openTab.path)
          : await fs.readText(fullPath).catch(() => "");
      editor.openDiff({
        id: active,
        title: `${relPath} (${mode === "staged" ? "Staged" : "Working Tree"})`,
        relPath,
        repoRoot: repoPath,
        leftTitle: mode === "staged" ? "HEAD" : "Index",
        rightTitle: mode === "staged" ? "Index (Staged)" : "Working Tree",
        leftText,
        rightText,
        mode,
      });
      editor.activate(active);
    }
    await refreshGit();
  }

  return {
    openFolder,
    openFileDialog,
    refresh,
    toggleFolder,
    openFile,
    openFileAt,
    closeTab,
    saveActive,
    saveActiveAs,
    createEntry,
    deleteFile,
    renameEntry,
    refreshGit,
    scheduleGitRefresh,
    scheduleIndexRefresh,
    gitInit,
    gitStage,
    gitUnstage,
    gitDiscard,
    gitCommit,
    gitUndoLastCommit,
    gitRemoteOp,
    gitOpenDiff,
    gitOpenCommitDiff,
    openDiffTab,
    gitAddToGitignore,
    gitReloadAfterDiffMutation,
    collapseAll: () => store.dispatch({ type: "tree/collapseAll" }),
  };
}