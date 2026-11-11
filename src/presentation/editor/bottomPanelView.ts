import type { AppState, PanelView } from "../../domain/types";
import type { AppStore } from "../../application/reducer";
import type { TerminalPort } from "../../application/ports";
import { cx, h } from "../dom";

const VIEWS: { id: PanelView; label: string } [] = [
    { id: "problems", label: "Problems" },
    { id: "output", label: "Output" },
    { id: "debug", label: "Debug Console" },
    { id: "terminal", label: "Terminal" },
];

// Paleta estándar de 16 colores ANSI calibrada para el tema claro de LumenCode
const ANSI_FG: Record<number, string> = {
    30: "#3E4A5B", 90: "#8C9BAE", // Negro / Gris
    31: "#D95360", 91: "#E06C75", // Rojo
    32: "#2E9E6B", 92: "#38B27A", // Verde 
    33: "#C58616", 93: "#D99B26", // Amarillo / Ámbar (warnings, pnpm)
    34: "#3B7DD8", 94: "#5D9CEC", // Azul
    35: "#7A63C9", 95: "#82A0D8", // Magenta / Violeta 
    36: "#1F8A9C", 96: "#2AA1B3", // Cian (URLs http://localhost:5173/)
    37: "#64748B", 97: "#3E4A5B", // Blanco adaptado a fondo claro
};
const ANSI_BG: Record<number, string> = {
    40: "#3E4A5B", 100: "#8C9BAE",
    41: "#FADBD8", 101: "#F5A6AD",
    42: "#D4EFDF", 102: "#88C5A1",
    43: "#FCF3CF", 103: "#F9E79F",
    44: "#D6EAF8", 104: "#82A0D8",
    45: "#E8DAEF", 105: "#D2B4DE",
    46: "#D1F2EB", 106: "#A3E4D7",
    47: "#F0F4F8", 107: "#FFFFFF",
};

/** Convierte un indice ANSI de 256 colores (0..255) a CSS */
function ansi256ToCss(n: number, isBg = false): string {
    if (n < 8) return (isBg ? ANSI_BG : ANSI_FG)[(isBg ? 40 : 30) + n] ?? "#3E4A5B";
    if (n < 16) return (isBg ? ANSI_BG : ANSI_FG)[(isBg ? 100 : 90) + (n - 8)] ?? "#3E4A5B";
    if (n >= 232) {
        const g = 8 + (n - 232) * 10;
        return `rgb(${g}, ${g}, ${g})`;
    }

    const idx = n -16;
    const r = Math.floor(idx / 36) * 51;
    const g = (Math.floor(idx / 6) % 6) * 51;
    const b = (idx % 6) * 51;
    return `rgb(${r}, ${g}, ${b})`;
}

/** Convierte secuencias ANSI (\x1b[...m) de 16, 256 y TrueColor RGB en spans con estilo. */
function renderAnsi(raw: string): DocumentFragment {
    const frag = document.createDocumentFragment();
    // Limpia códigos de control de cursor/pantalla (NOTA: sin 'm' para no borrar los colores)
    const cleaned = raw
        .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "") // secuencias OSC
        .replace(/\x1b\[[0-9;?]*[A-HJKSTfisu]/g, "");      // movimiento de cursor
    // Acepta tanto \x1b[32m como corchetes huérfanos [32m si algún proceso omitió ESC
    const regex = /(?:\x1b\[|\[)([0-9;]*)m/g;
    let fg: string | null = null;
    let bg: string | null = null;
    let bold = false;
    let dim = false;
    let italic = false;
    let underline = false;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    const pushChunk = (chunk: string) => {
        if (!chunk) return;
        if (!fg && !bg && !bold && !dim && !italic && !underline) {
            frag.append(chunk);
            return;
        }
        const span = document.createElement("span");
        if (fg) span.style.color = fg;
        if (bg) {
            span.style.backgroundColor = bg;
            span.style.padding = "0 3px";
            span.style.borderRadius = "3px";
        }
        if (bold) span.style.fontWeight = "700";
        if (dim) span.style.opacity = "0.65";
        if (italic) span.style.fontStyle = "italic";
        if (underline) span.style.textDecoration = "underline";
        span.textContent = chunk;
        frag.append(span);
    };
    while ((match = regex.exec(cleaned)) !== null) {
        pushChunk(cleaned.slice(lastIndex, match.index));
        lastIndex = regex.lastIndex;
        const parts = (match[1] || "0").split(";").map(Number);
        for (let i = 0; i < parts.length; i++) {
            const c = parts[i];
            if (c === 0) { fg = null; bg = null; bold = false; dim = false; italic = false; underline = false; }
            else if (c === 1) bold = true;
            else if (c === 2) dim = true;
            else if (c === 3) italic = true;
            else if (c === 4) underline = true;
            else if (c === 22) { bold = false; dim = false; }
            else if (c === 23) italic = false;
            else if (c === 24) underline = false;
            else if (c === 39) fg = null;
            else if (c === 49) bg = null;
            else if (ANSI_FG[c]) fg = ANSI_FG[c];
            else if (ANSI_BG[c]) bg = ANSI_BG[c];
            else if ((c === 38 || c === 48) && parts[i + 1] === 5 && parts[i + 2] !== undefined) {
                const css = ansi256ToCss(parts[i + 2], c === 48);
                if (c === 38) fg = css; else bg = css;
                i += 2;
            } else if ((c === 38 || c === 48) && parts[i + 1] === 2 && parts[i + 4] !== undefined) {
                const css = `rgb(${parts[i + 2]}, ${parts[i + 3]}, ${parts[i + 4]})`;
                if (c === 38) fg = css; else bg = css;
                i += 4;
            }
        }
    }
    pushChunk(cleaned.slice(lastIndex));
    return frag;
}

function createTerminalView(term: TerminalPort) {
    const out = h("div", { class: "term-output" });
    const promptEl = h("span", { class: "term-prompt" });
    const input = h("input", { class: "term-input", spellcheck: "false", autocomplete: "off", "aria-label": "Terminal" }) as HTMLInputElement;

    const root = h("div", { class: "panel-view terminal", onclick: () => input.focus() },
        out, h("div", { class: "term-line" }, h("span", { class: "term-dot" }, "•"), promptEl, input)
    );

    const history: string[] = [];
    let hIndex = 0;
    let busy = false;

    const prompt = () => term.formatPrompt();
    const refreshPrompt = () => { promptEl.textContent = busy ? "[ejecutando... Ctrl + C para detener]" : prompt(); }
    const print = (text: string, cls?: string) => {
        out.append(h("div", { class: cx("term-row", cls)}, renderAnsi(text) ));
        root.scrollTop = root.scrollHeight;
    };

    // Recibe salida en tiempo real
    term.onOutput((line, isErr) => print(line, isErr ? "error" : undefined));

    input.addEventListener("keydown", async (e) => {
        if (e.ctrlKey && e.key.toLowerCase() === "c" && busy) {
            e.preventDefault();
            print("^C", "error");
            await term.kill();
            return;
        }

        if (busy) {
            e.preventDefault();
            return;
        }

        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            hIndex = Math.max(0, Math.min(history.length, hIndex + (e.key === "ArrowUp" ? -1 : 1)));
            input.value = history[hIndex] ?? "";
            return;
        }

        if (e.key !== "Enter") return;
        const cmd = input.value;
        input.value = "";
        print(`${prompt()} ${cmd}`, "echo");
        if (cmd.trim()) history.push(cmd);
        hIndex = history.length;

        if (/^(clear|cls)$/i.test(cmd.trim())) {
            out.replaceChildren();
        } else {
            busy = true;
            refreshPrompt();

            try {
                const res = await term.run(cmd);
                for (const line of res.stdout) print(line);
                for (const errLine of res.stderr) print(errLine, "error");
            } catch (err) {
                print(String(err), "error");
            } finally {
                busy = false;
            }
        }

        refreshPrompt();
        root.scrollTop = root.scrollHeight;
        input.focus();
    });

    void term.init().then(refreshPrompt);
    refreshPrompt();
    return { root, refreshPrompt, focus: () => input.focus() };
}

export function mountBottomPanel(el: HTMLElement, store: AppStore, terminal: TerminalPort) {
    const header = h("div", { class: "panel-tabs", role: "tab-list" });
    const body = h("div", { class: "panel-body" });
    const termView = createTerminalView(terminal);

    const views: Record<PanelView, HTMLElement> = {
        problems: h("div", { class: "panel-view placeholder" }, "No se han detectado problemas en el área de trabajo"),
        output: h("div", { class: "panel-view placeholder" }, "Sin salida"),
        debug: h("div", { class: "panel-view placeholder" }, "Inicia una sesión de depuración para usar la consola"),
        terminal: termView.root,
    };
    body.append(...Object.values(views));

    const buttons = VIEWS.map((v) => {
        const b = h("button", { class: "panel-tab", role: "tab", onclick: () => store.dispatch({ type: "panel/show", view: v.id }) }, v.label);
        header.append(b);
        return { id: v.id, b };
    });

    el.append(header, body);

    function render(s: AppState) {
        el.hidden = !s.panelVisible;
        for (const { id, b } of buttons) b.classList.toggle("active", id === s.panelView);
        for (const id of Object.keys(views) as PanelView[]) views[id].hidden = id !== s.panelView;
    }

    render(store.getState());
    store.subscribe((s, p) => {
        if (s.panelVisible !== p.panelVisible || s.panelView !== p.panelView) {
            render(s);
            if (s.panelVisible && s.panelView === "terminal") termView.focus();
        }

        if (s.rootPath !== p.rootPath) termView.refreshPrompt();
    });
}