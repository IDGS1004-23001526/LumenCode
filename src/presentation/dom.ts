type Child = Node | string | null | undefined | false;
type Attrs = Record<string, string | number | boolean | ((e: any) => void) | undefined>;

export function h(tag: string, attrs: Attrs = {}, ...children: Child[]): HTMLElement {
    const el = document.createElement(tag);

    for (const [k, v] of Object.entries(attrs)) {
        if (v === undefined || v === false) continue;
        if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
        else el.setAttribute(k, v === true ? "": String(v));
    }

    for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
    return el;
}

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function iconButton(svg: string, title: string, onClick: () => void): HTMLElement {
    const b = h("button", { class: "icon-btn", title, "aria-label": title, onclick: onClick });
    b.innerHTML = svg;
    return b;
}