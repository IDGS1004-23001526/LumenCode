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
        out.append(h("div", { class: cx("term-row", cls)}, text ))
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