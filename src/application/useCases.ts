import type { FileNode } from "../domain/types";
import { hasFileExtension, isTextFile, isValidName, joinPath } from "../domain/path";
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
    if (!isTextFile(path)) return dialogs.error("Este tipo de archivo no se puede abrir en el editor.");
    try {
      const text = await fs.readText(path);
      editor.open(path, await fs.readText(path));
      indexer.updateFile(path, text);
      store.dispatch({ type: "tab/open", path });
    } catch (e) {
      await dialogs.error(`No se pudo abrir el archivo.\n\n${String(e)}`);
    }
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

  return {
    openFolder,
    refresh,
    toggleFolder,
    openFile,
    closeTab,
    saveActive,
    createEntry,
    deleteFile,
    collapseAll: () => store.dispatch({ type: "tree/collapseAll" }),
  };
}