import type { AppState, FileNode } from "../../domain/types";
import { fileNameOf, parentDirOf } from "../../domain/path";
import type { AppStore } from "../../application/reducer";
import type { UseCases } from "../../application/useCases";
import { animateCaelestiaItems, animateCaelestiaItemsOut, captureTabsFlip, playTabsFlip } from "../animate";
import { cx, h, iconButton } from "../dom";
import { ICONS, iconForFile, iconForFolder } from "../icons";
import { findIconTheme } from "../../infraestructure/iconThemeRepository";
import { showContextMenu } from "../contextMenu";

export function mountExplorer(el: HTMLElement, store: AppStore, uc: UseCases) {
    const treeEl = h("div", { class: "tree", role: "tree", tabIndex: 0 });
    let selectedNode: FileNode | null = null;

    treeEl.addEventListener("keydown", (e) => {
        if (e.key === "F2" && selectedNode && selectedNode.path !== store.getState().rootPath) {
            e.preventDefault();
            void uc.renameEntry(selectedNode);
        }
    });

    function openMenuAt(x: number, y: number, targetDir?: string, fileNode?: FileNode, isRoot = false) {
        const root = store.getState().rootPath;
        const noRoot = !root;
        const dir = targetDir ?? root ?? undefined;
        const folderLabel = dir ? ` (${fileNameOf(dir)})` : "";

        showContextMenu(x, y, [
            ...(fileNode && !isRoot
                ? [
                    ...(!fileNode.isDir
                        ? [{ label: `Abrir "${fileNode.name}"`, run: () => uc.openFile(fileNode.path) }]
                        : []),
                    { label: `Renombrar "${fileNode.name}"`, shortcut: "F2", run: () => uc.renameEntry(fileNode) },
                    ...(!fileNode.isDir
                        ? [{ label: `Eliminar "${fileNode.name}"`, run: () => uc.deleteFile(fileNode) }]
                        : []),
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

    function renderNode(node: FileNode, depth: number, s: AppState, isRoot = false, parentPath?: string): HTMLElement[] {
        const open = s.expanded.has(node.path);
        const chevron = h("span", { class: cx("chevron", open && "open") });

        if (node.isDir) chevron.innerHTML = ICONS.chevron;

        const iconTheme = findIconTheme(s.settings.iconTheme);
        const icon = h("span", { class: "node-icon" });
        icon.innerHTML = node.isDir ? iconForFolder(node.name, open, iconTheme) : iconForFile(node.name, iconTheme);

        const row = h(
            "div",
            {
                class: cx("tree-row", isRoot && "root", node.isDir ? "dir" : "file", s.activePath === node.path && "active"),
                style: `--depth:${depth}`,
                title: node.path,
                role: "treeitem",
                "data-flip-id": node.path,
                "data-parent": parentPath,
                "aria-expanded": node.isDir ? String(open) : undefined,
                onclick: () => {
                    selectedNode = isRoot ? null : node;
                    void (node.isDir ? uc.toggleFolder(node) : uc.openFile(node.path));
                },
                oncontextmenu: (e: MouseEvent) => {
                    e.preventDefault();
                    e.stopPropagation();
                    selectedNode = isRoot ? null : node;
                    const targetDir = node.isDir ? node.path : parentDirOf(node.path);
                    openMenuAt(e.clientX, e.clientY, targetDir, node, isRoot);
                },
            },
            chevron, icon, h("span", { class: "label" }, node.name),
        );

        const rows = [row];
        if (node.isDir && open && node.children) {
            for (const child of node.children) rows.push(...renderNode(child, depth + 1, s, false, node.path));
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
        if (
            s.tree !== p.tree ||
            s.expanded !== p.expanded ||
            s.rootPath !== p.rootPath ||
            s.activePath !== p.activePath ||
            s.settings.iconTheme !== p.settings.iconTheme
        ) {
            const expandedChanged = s.expanded !== p.expanded && s.rootPath === p.rootPath;
            const collapsedPaths = expandedChanged
                ? [...p.expanded].filter((path) => !s.expanded.has(path))
                : [];
            const isDescendantOfCollapsed = (nodePath: string) =>
                collapsedPaths.some((cp) => nodePath.startsWith(`${cp}/`) || nodePath.startsWith(`${cp}\\`));

            const prevRows = Array.from(treeEl.children) as HTMLElement[];
            const outgoing = collapsedPaths.length > 0
                ? prevRows.filter((el) => {
                    const fp = el.dataset.flipId ?? "";
                    if (!fp || fp === s.rootPath) return false;
                    return s.expanded.size === 0 || isDescendantOfCollapsed(fp);
                })
                : [];
            const outgoingSet = new Set(outgoing);
            const flipState = expandedChanged
                ? captureTabsFlip(prevRows.filter((el) => !outgoingSet.has(el)))
                : null;
            const stayingPrevIds = new Set(
                prevRows.filter((el) => !outgoingSet.has(el)).map((el) => el.dataset.flipId ?? ""),
            );

            if (outgoing.length > 0) animateCaelestiaItemsOut(outgoing);

            render(s);
            if (s.rootPath !== p.rootPath) {
                animateCaelestiaItems(Array.from(treeEl.children) as HTMLElement[]);
            } else if (expandedChanged) {
                const nextRows = Array.from(treeEl.children) as HTMLElement[];
                const stayingNext = nextRows.filter((el) => stayingPrevIds.has(el.dataset.flipId ?? ""));
                playTabsFlip(flipState, stayingNext);

                const newlyExpanded = [...s.expanded].filter((path) => !p.expanded.has(path));
                if (newlyExpanded.length === 1) {
                    const children = nextRows.filter(
                        (el) => el.dataset.parent === newlyExpanded[0],
                    );
                    animateCaelestiaItems(children);
                }
            }
        }
    });
}