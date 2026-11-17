import type { DiffPayload, GitCommitFile, GitFileStatus } from "../domain/git";
import type { FileNode } from "../domain/types";
import { hasFileExtension, imageMimeFor, isImageFile, isTextFile, isValidName, joinPath, parentDirOf } from "../domain/path";
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

  async function loadChildren(path: string): Promise<boolean> {
    try {
      store.dispatch({ type: "tree/children", path, children: await fs.readDir(path) });
      return true;
    } catch {
      return false;
    }
  }

  async function loadWorkspace(root: string) {
    let tree: FileNode[];
    try {
      tree = await fs.readDir(root);
    } catch (e) {
      return dialogs.error(`No se pudo leer la carpeta.\n\n${String(e)}`);
    }
    terminal.setCwd(root); // antes del dispatch para que el prompt se actualice
    store.dispatch({ type: "workspace/loaded", root, tree });
    // Recarga subcarpetas que estaban abiertas (padres antes que hijos).
    const open = [...st().expanded].filter((p) => p !== root).sort((a, b) => a.length - b.length);
    for (const p of open) await loadChildren(p);
    void indexer.scanWorkspace(root);
    void refreshGit();
  }

  async function openFolder() {
    const root = await dialogs.pickFolder();
    if (root) await loadWorkspace(root);
  }

  async function refresh() {
    const root = st().rootPath;
    if (root) await loadWorkspace(root);
  }

  async function toggleFolder(node: FileNode) {
    const isOpen = st().expanded.has(node.path);
    if (!isOpen && !node.children && node.path !== st().rootPath) {
      if (!(await loadChildren(node.path))) return dialogs.error("No se pudo leer la carpeta.");
    }
    store.dispatch({ type: "tree/setExpanded", path: node.path, expanded: !isOpen });
  }

  async function openFile(path: string) {
    if (st().tabs.some((t) => t.path === path)) {
      store.dispatch({ type: "tab/activate", path }); // ya abierto → foco
      return;
    }
    if (isImageFile(path)) {
      try {
        const bytes = await fs.readBinary(path);
        const blob = new Blob([new Uint8Array(bytes)], { type: imageMimeFor(path) });
        const url = URL.createObjectURL(blob);
        editor.openImage(path, url, bytes.byteLength);
        store.dispatch({ type: "tab/open", path });
      } catch (e) {
        await dialogs.error(`No se pudo abrir la imagen.\n\n${String(e)}`);
      }
      return;
    }
    if (!isTextFile(path)) return dialogs.error("Este tipo de archivo no se puede abrir en el editor.");
    try {
      const text = await fs.readText(path);
      editor.open(path, text);
      indexer.updateFile(path, text);
      store.dispatch({ type: "tab/open", path });
    } catch (e) {
      await dialogs.error(`No se pudo abrir el archivo.\n\n${String(e)}`);
    }
  }

  async function openFileAt(path: string, line: number, character: number) {
    await openFile(path);
    editor.revealPosition(path, line, character);
  }

  async function closeTab(path: string) {
    const tab = st().tabs.find((t) => t.path === path);
    if (!tab) return;
    if (tab.dirty && !(await dialogs.confirm(`"${tab.name}" tiene cambios sin guardar. ¿Cerrar y descartarlos?`))) return;
    editor.close(path);
    store.dispatch({ type: "tab/close", path });
  }

  async function saveActive() {
    const path = st().activePath;
    if (!path) return;
    try {
      await fs.writeText(path, editor.getText(path));
      store.dispatch({ type: "tab/dirty", path, dirty: false });
      scheduleGitRefresh();
    } catch (e) {
      await dialogs.error(`No se pudo guardar.\n\n${String(e)}`);
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
      if (newPath.toLowerCase() !== node.path.toLowerCase() && (await fs.exists(newPath))) {
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
    const root = st().rootPath;
    if (!root) {
      store.dispatch({ type: "git/status", status: null });
      return;
    }
    try {
      const status = await gitClient.status(root);
      if (st().rootPath === root) {
        store.dispatch({ type: "git/status", status });
      }
    } catch {
      // Ignorar errores transitorios en background
    }
  }

  function scheduleGitRefresh() {
    const root = st().rootPath;
    if (!root) return;
    gitClient.scheduleRefresh(root, (status) => {
      if (st().rootPath === root) {
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
      if (st().tabs.some((t) => t.path === fullPath)) {
        if (isUntracked) {
          editor.close(fullPath);
          store.dispatch({ type: "tab/close", path: fullPath });
        } else {
          const text = await fs.readText(fullPath).catch(() => "");
          editor.setText(fullPath, text);
          store.dispatch({ type: "tab/dirty", path: fullPath, dirty: false });
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
      await gitClient.stage(root, []);
    }

    try {
      await gitClient.commit(root, cleanMsg, amend);
      if (pushAfter) {
        if (g.upstream) {
          await gitClient.remoteOp(root, "push");
        } else {
          await gitClient.remoteOp(root, "publish", g.branch);
        }
      }
      await refreshGit();
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
    try {
      await gitClient.remoteOp(root, op, g.branch);
      await refresh();
    } catch (e) {
      await dialogs.error(`Error en operación Git (${op}).\n\n${String(e)}`);
      await refreshGit();
    }
  }

  async function gitOpenDiff(entry: GitFileStatus, mode: "working" | "staged") {
    const root = repoRoot();
    if (!root) return;
    const fullPath = joinPath(root, entry.path);
    const leftText = await gitClient.showFile(root, "HEAD", entry.path).catch(() => "");
    let rightText = "";
    if (mode === "staged") {
      rightText = await gitClient.showFile(root, ":0", entry.path).catch(() => "");
    } else {
      rightText = st().tabs.some((t) => t.path === fullPath)
        ? editor.getText(fullPath)
        : await fs.readText(fullPath).catch(() => "");
    }

    const diff: DiffPayload = {
      id: `git-diff://${mode}/${entry.path}`,
      title: `${entry.path} (${mode === "staged" ? "Staged" : "Working Tree"})`,
      relPath: entry.path,
      repoRoot: root,
      leftTitle: "HEAD",
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
    store.dispatch({ type: "tab/open", path: diff.id });
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

  async function gitReloadAfterDiffMutation(repoPath: string, relPath: string) {
    const fullPath = joinPath(repoPath, relPath);
    if (st().tabs.some((t) => t.path === fullPath)) {
      const disk = await fs.readText(fullPath).catch(() => "");
      editor.setText(fullPath, disk);
      store.dispatch({ type: "tab/dirty", path: fullPath, dirty: false });
    }
    const active = st().activePath;
    if (active?.startsWith("git-diff://")) {
      const mode = active.startsWith("git-diff://staged/") ? "staged" : "working";
      const leftText = await gitClient.showFile(repoPath, "HEAD", relPath).catch(() => "");
      const rightText = mode === "staged"
        ? await gitClient.showFile(repoPath, ":0", relPath).catch(() => "")
        : await fs.readText(fullPath).catch(() => "");
      editor.openDiff({
        id: active,
        title: `${relPath} (${mode === "staged" ? "Staged" : "Working Tree"})`,
        relPath,
        repoRoot: repoPath,
        leftTitle: "HEAD",
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
    refresh,
    toggleFolder,
    openFile,
    openFileAt,
    closeTab,
    saveActive,
    createEntry,
    deleteFile,
    renameEntry,
    refreshGit,
    scheduleGitRefresh,
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