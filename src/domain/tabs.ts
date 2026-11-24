import type { Tab } from "./types";

/** Al cerrar la pestaña activa, se activa la vecina como aquí en vs code */
export function nextActiveAfterClose(tabs: Tab[], closing: string, active: string | null): string | null {
    if (active !== closing) return active;

    const index = tabs.findIndex((t) => t.path === closing);
    const rest = tabs.filter((t) => t.path !== closing);

    if (rest.length === 0) return null;

    const safeIdx = index < 0 ? 0 : Math.min(index, rest.length - 1);
    return rest[safeIdx].path;
}