import type { FileNode } from "./types";

/** Carpetas primero, luego orden alfabetico sin distinguir mayusculas, este será nuestro objetivo, vale ? */
export function sortNodes(nodes: FileNode[]): FileNode[] {
    return [...nodes].sort((a, b) =>
        a.isDir === b.isDir ? a.name.localeCompare(a.name, undefined, { sensitivity: "base" }) : a.isDir ? -1 : 1,
    );
}

/** Aquí nos va a devolver un árbol nuevo que es inmutable con los hijos de path reemplazados */
export function setChildren(nodes: FileNode[], path: string, children: FileNode[]): FileNode[] {
    return nodes.map((n) => {
        if (n.path === path) return { ...n, children };
        if (n.children) return { ...n, children: setChildren(n.children, path, children) };

        return n;
    });
}

