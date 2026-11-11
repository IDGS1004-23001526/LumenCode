import type { AppState, FileNode } from "../../domain/types";
import { fileNameOf, parentDirOf } from "../../domain/path";
import type { AppStore } from "../../application/reducer";
import type { UseCases } from "../../application/useCases";
import { cx, h, iconButton } from "../dom";
import { ICONS } from "../icons";
import { showContextMenu } from "../contextMenu";

export function mountExplorer(el: HTMLElement, store: AppStore, uc: UseCases) {
    const treeEl = h("div", { class: "tree", role: "tree" });

    function openMenuAt(x: number, y: number, targetDir?: string, fileNode?: FileNode) {
        const root = store.getState().rootPath;
        const noRoot = !root;
        const dir = targetDir ?? root ?? undefined;
        const folderLabel = dir ? ` (${fileNameOf(dir)})` : "";

        showContextMenu(x, y, [
            ...(fileNode && !fileNode.isDir
                ? [
                    { label: `Abrir "${fileNode.name}"`, run: () => uc.openFile(fileNode.path) },
                    { label: `Eliminar "${fileNode.name}"`, run: () => uc.deleteFile(fileNode) },
                    "separator" as const,
                  ]
                : []),
            { label: `Nuevo archivo${folderLabel}`, disabled: noRoot, run: () => uc.createEntry("file", dir) },
            { label: `Nueva carpeta${folderLabel}`, disabled: noRoot, run: () => uc.createEntry("folder", dir) },
            "separator",
            { label: "Abrir carpeta...", shortcut: "Ctrl+O", run: uc.openFolder },
            { label: "Actualizar", disabled: noRoot, run: uc.refresh },
            { label: "Colapsar todo", disabled: noRoot, run: uc.collapseAll },
        ]);
    }

    const menuBtn = iconButton(ICONS.dots, "Más acciones", () => {
        const r = menuBtn.getBoundingClientRect();
        openMenuAt(r.left, r.bottom + 4);
    });

    // Clic derecho en cualquier zona libre del panel lateral
    el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        openMenuAt(e.clientX, e.clientY);
    });

    el.append(
        h("div", { class: "sidebar-header" }, h("span", { class: "sidebar-title" }, "Explorer Files"), menuBtn),
        treeEl,
    );

    function renderNode(node: FileNode, depth: number, s: AppState, isRoot = false): HTMLElement[] {
        const open = s.expanded.has(node.path);
        const chevron = h("span", { class: cx("chevron", open && "open") });

        if (node.isDir) chevron.innerHTML = ICONS.chevron;

        const icon = h("span", { class: "node-icon" });
        icon.innerHTML = node.isDir ? ICONS.folder : ICONS.file;

        const row = h(
            "div",
            {
                class: cx("tree-row", isRoot && "root", node.isDir ? "dir" : "file", s.activePath === node.path && "active"),
                style: `--depth:${depth}`,
                title: node.path,
                role: "treeitem",
                "aria-expanded": node.isDir ? String(open) : undefined,
                onclick: () => void (node.isDir ? uc.toggleFolder(node) : uc.openFile(node.path)),
                oncontextmenu: (e: MouseEvent) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const targetDir = node.isDir ? node.path : parentDirOf(node.path);
                    openMenuAt(e.clientX, e.clientY, targetDir, node);
                },
            },
            chevron, icon, h("span", { class: "label" }, node.name),
        );

        const rows = [row];
        if (node.isDir && open && node.children) {
            for (const child of node.children) rows.push(...renderNode(child, depth + 1, s));
        }
        return rows;
    }

    function render(s: AppState) {
        if (!s.rootPath) {
            treeEl.replaceChildren(
                h("div", { class: "tree-empty" },
                    h("p", {}, "No hay ninguna carpeta abierta"),
                    h("button", { class: "btn primary", onclick: () => void uc.openFolder() }, "Abrir carpeta"),
                ),
            );
            return;
        }

        const root: FileNode = { path: s.rootPath, name: fileNameOf(s.rootPath), isDir: true, children: s.tree };
        treeEl.replaceChildren(...renderNode(root, 0, s, true));
    }

    render(store.getState());
    store.subscribe((s, p) => {
        if (s.tree !== p.tree || s.expanded !== p.expanded || s.rootPath !== p.rootPath || s.activePath !== p.activePath) render(s);
    });
}