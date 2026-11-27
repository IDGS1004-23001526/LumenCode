import { Compartment, EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, dropCursor, rectangularSelection, placeholder, ViewPlugin, ViewUpdate, scrollPastEnd } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { acceptCompletion, autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";

import type { DiffPayload } from "../../domain/git";
import { pathsEqual } from "../../domain/path";
import type { ProjectIndex } from "../../domain/symbolIndex";
import { lspClient } from "../../infraestructure/lspClient";
import { createHtmlEmmetCompletionSource, expandHtmlEmmetAtCursor } from "./htmlEmmetCompletion";
import { createLspCompletionSource, createLspDefinitionExtension, createLspHoverExtension } from "./lspExtension";
import { createSmartCompletionSource } from "./smartCompletion";
import { createPasteIndentExtension } from "./pasteIndent";
import { errorLensExtension, lspDiagnosticsToLumen, setDiagnosticsEffect, type LumenDiagnostic } from "./errorLens";
import { animateEditorContentIn, animateEditorContentOut } from "../animate";
import { h } from "../dom";
import { createDiffPreviewHost } from "./diffViewer";
import { createGitConflictExtension } from "./gitConflicts";
import { closeGitPeek, createGitGutterExtension, requestGitGutterRefreshEffect } from "./gitGutter";
import { createImagePreviewHost, type ImageEntry } from "./imagePreview";

import type { EditorPort } from "../../application/ports";
import { createLumenTheme, lumenHighlight } from "./theme";
import { languageFor } from "./languages";

export interface EditorCallbacks {
    onChange: (path: string, content: string) => void;
    getIndex: () => ProjectIndex;
    getAssetFiles?: () => Set<string>;
    getRootPath: () => string | null;
    getGitRoot?: () => string | null;
    readText: (path: string) => Promise<string>;
    onNavigate: (path: string, line: number, character: number) => void;
    onGitMutated: () => void;
    onOpenDiff: (diff: DiffPayload) => void;
    onDiffMutated: (repoRoot: string, relPath: string, touchedDisk: boolean) => Promise<void>;
    confirmAction: (message: string, okLabel?: string) => Promise<boolean>;
    onError: (message: string) => Promise<void>;
    onDiagnostics?: (path: string, diags: LumenDiagnostic[]) => void;
    onIndentChange?: (label: string) => void;
}

interface DetectedIndent {
    unit: string;
    tabSize: number;
    label: string;
    fromFile: boolean;
}

/**
 * Detecta la indentacion real de un archivo (tabs o espacios de 2/4/8) al estilo VS Code.
 * Si no hay suficientes lineas indentadas, usa el `defaultTabSize` configurado.
 */
function detectFileIndentation(content: string, defaultTabSize: number): DetectedIndent {
    const lines = content.split(/\r?\n/, 150);
    let tabLines = 0;
    let spaceLines = 0;
    let odd2Lines = 0;
    let diff2 = 0;
    let diff4 = 0;
    let prevSpaces = 0;

    for (const line of lines) {
        if (!line.trim()) continue;
        if (line.startsWith("\t")) {
            tabLines++;
            prevSpaces = 0;
            continue;
        }
        const m = /^( +)/.exec(line);
        const spaces = m ? m[1].length : 0;
        if (spaces > 0) {
            spaceLines++;
            if (spaces % 2 === 0 && spaces % 4 !== 0) odd2Lines++;
        }
        const delta = Math.abs(spaces - prevSpaces);
        if (delta === 2) diff2++;
        else if (delta === 4) diff4++;
        prevSpaces = spaces;
    }

    if (tabLines > spaceLines && tabLines >= 2) {
        return { unit: "\t", tabSize: defaultTabSize, label: `Tabulación: ${defaultTabSize}`, fromFile: true };
    }

    if (spaceLines >= 2) {
        let detected = defaultTabSize;
        if (diff2 > diff4 || (odd2Lines >= 2 && diff2 >= diff4)) {
            detected = 2;
        } else if (diff4 > 0) {
            detected = 4;
        }
        return {
            unit: " ".repeat(detected),
            tabSize: detected,
            label: `Espacios: ${detected}`,
            fromFile: true,
        };
    }

    return {
        unit: " ".repeat(defaultTabSize),
        tabSize: defaultTabSize,
        label: `Espacios: ${defaultTabSize}`,
        fromFile: false,
    };
}

const smoothCaret = ViewPlugin.fromClass(
    class {
        private lastLeft: number | null = null;
        private lastTop: number | null = null;

        update(u: ViewUpdate) {
            if (!u.selectionSet && !u.docChanged && !u.focusChanged) return;

            requestAnimationFrame(() => {
                const cursor = u.view.dom.querySelector<HTMLElement>(".cm-cursor-primary");

                if (!cursor) return;

                const left = parseFloat(cursor.style.left);
                const top = parseFloat(cursor.style.top);
                if (Number.isNaN(left) || Number.isNaN(top)) return;

                const smoothEnabled = document.documentElement.style.getPropertyValue("--cursor-transition") !== "none";

                if (smoothEnabled && this.lastLeft !== null && this.lastTop !== null) {
                    const dx = this.lastLeft - left;
                    const dy = this.lastTop - top;

                    // Si hubo movimiento real, desliza suavemente desde la posición anterior
                    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
                        cursor.animate(
                            [
                                { translate: `${dx}px ${dy}px`  },
                                { translate: "0px 0px" }
                            ],
                            {
                                duration: 95,
                                easing: "cubic-bezier(0.22, 1, 0.36, 1)",
                            },
                        );
                    }
                }

                this.lastLeft = left;
                this.lastTop = top;
            });
        }
    },
);

/** Efecto rebote elastico  */
const elasticOverscroll = ViewPlugin.fromClass(
    class {
        private ox = 0;
        private oy = 0;
        private raf = 0;
        private scroller: HTMLElement;
        private target: HTMLElement;

        constructor(view: EditorView) {
            this.scroller = view.scrollDOM;
            this.target = view.contentDOM.parentElement ?? view.contentDOM;
            this.scroller.addEventListener("wheel", this.onWheel, { passive: false });
        }

        private onWheel = (e: WheelEvent) => {
            const { scrollTop, scrollLeft, scrollHeight, scrollWidth, clientHeight, clientWidth } = this.scroller;
            const maxTop = Math.max(0, scrollHeight - clientHeight);
            const maxLeft = Math.max(0, scrollWidth - clientWidth);

            const atTop = scrollTop <= 0 && e.deltaY < 0;
            const atBottom = scrollTop >= maxTop - 1 && e.deltaY > 0;
            const atLeft = scrollLeft <= 0 && e.deltaX < 0;
            const atRight = scrollLeft >= maxLeft - 1 && e.deltaX > 0;

            let hooked = false;

            // Eje vertical (arriba / abajo) o cuando ya está estirado
            if (atTop || atBottom || Math.abs(this.oy) > 0.5) {
                const resistance = 1 / (1 + Math.abs(this.oy) / 85);
                this.oy = Math.max(-90, Math.min(90, this.oy - e.deltaY * 0.35 * resistance));
                hooked = true;
            }

            // Eje horizontal (izquierda / derecha) o cuando ya está estirado
            if (atLeft || atRight || Math.abs(this.ox) > 0.5) {
                const resistance = 1 / (1 + Math.abs(this.ox) / 85);
                this.ox = Math.max(-70, Math.min(70, this.ox - e.deltaX * 0.35 * resistance));
                hooked = true;
            }

            if (hooked) {
                // Si no hay más recorrido real, evitamos que el evento se pierda
                if ((atTop || atBottom) && (atLeft || atRight || e.deltaX === 0)) {
                    e.preventDefault();
                }
                this.applyTransform();
                if (!this.raf) this.raf = requestAnimationFrame(this.springBack);
            }
        };

        private springBack = () => {
            // Física de resorte suave de regreso a (0, 0)
            this.ox *= 0.82;
            this.oy *= 0.82;

            if (Math.abs(this.ox) < 0.4 && Math.abs(this.oy) < 0.4) {
                this.ox = 0;
                this.oy = 0;
                this.target.style.transform = "";
                this.raf = 0;
                return;
            }

            this.applyTransform();
            this.raf = requestAnimationFrame(this.springBack);
        };

        private applyTransform() {
            this.target.style.transform = `translate3d(${this.ox.toFixed(2)}px, ${this.oy.toFixed(2)}px, 0)`;
        }

        destroy() {
            this.scroller.removeEventListener("wheel", this.onWheel);
            if (this.raf) cancelAnimationFrame(this.raf);
            this.target.style.transform = "";
        }
    },
);

/** Pool dinámico de instancias EditorView por EditorGroupId, con un EditorState por archivo y sincronización en vivo */
export function createCodeMirrorEditor(cb: EditorCallbacks): EditorPort {
    const states = new Map<string, EditorState>();
    const fileIndents = new Map<string, DetectedIndent>();
    const scrollPositions = new Map<string, { top: number; left: number }>();
    const images = new Map<string, ImageEntry>();
    const diffs = new Map<string, DiffPayload>();

    interface PaneCtx {
        groupId: string;
        host: HTMLElement;
        view: EditorView;
        imageViewer: ReturnType<typeof createImagePreviewHost>;
        diffViewer: ReturnType<typeof createDiffPreviewHost>;
        path: string | null;
        activateGen: number;
    }

    const panes = new Map<string, PaneCtx>();
    let activeGroupId = "group-1";
    let isSyncing = false;
    let currentTabSize = 4;
    let currentWordWrap = false;
    let currentDark = false;
    let lastConfiguredTabSize: number | null = null;
    let lastConfiguredWordWrap: boolean | null = null;
    let lastConfiguredDark: boolean | null = null;

    const tabSizeConf = new Compartment();
    const indentUnitConf = new Compartment();
    const wordWrapConf = new Compartment();
    const themeConf = new Compartment();

    let empty = EditorState.create({
        extensions: [
            themeConf.of(createLumenTheme(currentDark)),
            EditorView.editable.of(false),
            placeholder("Abre un archivo desde el explorador ó Ctrl + O abre una carpeta"),
        ],
    });

    const scrollKey = (groupId: string, path: string) => `${groupId}::${path}`;
    const isTextBuffer = (path: string | null): path is string =>
        Boolean(path && states.has(path) && !images.has(path) && !diffs.has(path));

    const isVisiblePath = (path: string) => {
        for (const p of panes.values()) {
            if (p.path === path) return true;
        }
        return false;
    };

    const findPaneByView = (view: EditorView): PaneCtx | null => {
        for (const p of panes.values()) {
            if (p.view === view) return p;
        }
        return null;
    };

    const findOtherPaneWithPath = (excludeGroupId: string, path: string): PaneCtx | null => {
        for (const p of panes.values()) {
            if (p.groupId !== excludeGroupId && p.path === path) return p;
        }
        return null;
    };

    const build = (path: string, doc: string) => {
        const detected = detectFileIndentation(doc, currentTabSize);
        fileIndents.set(path, detected);
        const smartSource = createSmartCompletionSource(cb.getIndex, () => path, cb.getAssetFiles);
        const lspSource = createLspCompletionSource(cb.getIndex, () => path);
        const emmetSource = createHtmlEmmetCompletionSource(() => path);

        // Fuente local sincrona (< 1 ms): nunca espera al LSP para mostrar auto-imports ni Emmet
        const fastLocalSource = (ctx: CompletionContext): CompletionResult | null => {
            try {
                const emmet = emmetSource(ctx);
                if (emmet && emmet.options.length > 0) return emmet;

                const smart = smartSource(ctx);
                if (smart) return smart;

                const nativeSources = ctx.state.languageDataAt<((c: CompletionContext) => CompletionResult | Promise<CompletionResult | null> | null)>("autocomplete", ctx.pos);
                for (const src of nativeSources) {
                    if (typeof src !== "function") continue;
                    const res = src(ctx);
                    if (res && !("then" in res) && res.options.length > 0) return res;
                }
                return null;
            } catch {
                return null;
            }
        };

        // Fuente LSP asincrona separada: solo consulta cuando hay servidor activo
        const asyncLspSource = async (ctx: CompletionContext): Promise<CompletionResult | null> => {
            if (!lspClient.hasActiveServerFor(path)) return null;
            try {
                return await lspSource(ctx);
            } catch {
                return null;
            }
        };

        return EditorState.create({
            doc,
            extensions: [
                lineNumbers(),
                createGitGutterExtension({
                    getPath: () => path,
                    getRepoRoot: () => cb.getGitRoot?.() ?? cb.getRootPath(),
                    isActiveTab: () => isVisiblePath(path),
                    onGitMutated: cb.onGitMutated,
                }),
                createGitConflictExtension(() => path, cb.onOpenDiff),
                highlightActiveLineGutter(),
                foldGutter({ openText: "⌄", closedText: "›" }),
                history(),
                drawSelection(),
                smoothCaret,
                scrollPastEnd(),
                elasticOverscroll,
                dropCursor(),
                EditorState.allowMultipleSelections.of(true),
                tabSizeConf.of(EditorState.tabSize.of(detected.tabSize)),
                indentUnitConf.of(indentUnit.of(detected.unit)),
                wordWrapConf.of(currentWordWrap ? EditorView.lineWrapping : []),
                indentOnInput(),
                createPasteIndentExtension(() => path),
                bracketMatching(),
                closeBrackets(),
                autocompletion({
                    activateOnTyping: true,
                    activateOnTypingDelay: 20,
                    maxRenderedOptions: 40,
                    defaultKeymap: true,
                    override: [fastLocalSource, asyncLspSource],
                }),
                createLspHoverExtension(() => path),
                createLspDefinitionExtension({
                    getActivePath: () => path,
                    getIndex: cb.getIndex,
                    readText: cb.readText,
                    onNavigate: cb.onNavigate,
                }),
                errorLensExtension(() => path, cb.onDiagnostics),
                rectangularSelection(),
                highlightActiveLine(),
                highlightSelectionMatches(),
                keymap.of([
                    ...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap,
                    ...historyKeymap, ...foldKeymap, ...completionKeymap,
                    { key: "Tab", run: (v) => acceptCompletion(v) || expandHtmlEmmetAtCursor(v, path) },
                    indentWithTab,
                ]),
                themeConf.of(createLumenTheme(currentDark)),
                syntaxHighlighting(lumenHighlight),
                languageFor(path).support,
                EditorView.updateListener.of((u) => {
                    if (!u.docChanged || isSyncing) return;
                    const owner = findPaneByView(u.view);
                    if (!owner || owner.path !== path || !states.has(path)) return;
                    states.set(path, u.state);
                    const text = u.state.doc.toString();
                    cb.onChange(path, text);
                    lspClient.changeDocument(path, text);

                    // Sincroniza cambios hacia todos los demás grupos que tengan el mismo archivo abierto
                    for (const other of panes.values()) {
                        if (other === owner || other.path !== path || !isTextBuffer(path)) continue;
                        isSyncing = true;
                        try {
                            other.view.dispatch({ changes: u.changes });
                        } finally {
                            isSyncing = false;
                        }
                    }
                }),
            ],
        });
    };

    const savePaneState = (pane: PaneCtx) => {
        if (isTextBuffer(pane.path)) {
            states.set(pane.path, pane.view.state);
            scrollPositions.set(scrollKey(pane.groupId, pane.path), {
                top: pane.view.scrollDOM.scrollTop,
                left: pane.view.scrollDOM.scrollLeft,
            });
        }
    };

    const animatePaneOutgoing = (pane: PaneCtx, path: string | null) => {
        if (!path || !pane.host.isConnected) return;
        const outgoing = images.has(path)
            ? (pane.host.querySelector(".image-viewer") as HTMLElement | null)
            : diffs.has(path)
                ? (pane.host.querySelector(".diff-viewer") as HTMLElement | null)
                : pane.view.dom;
        if (outgoing && !outgoing.hidden) animateEditorContentOut(outgoing);
    };

    const showInPane = (pane: PaneCtx, path: string | null, shouldFocus: boolean, forceRefresh = false) => {
        const prevPath = pane.path;
        if (prevPath === path && !forceRefresh) {
            if (shouldFocus && isTextBuffer(path) && !pane.host.contains(document.activeElement)) {
                pane.view.contentDOM.focus({ preventScroll: true });
            }
            return;
        }

        if (prevPath !== path) {
            closeGitPeek();
            savePaneState(pane);
            animatePaneOutgoing(pane, prevPath);
        }

        pane.path = path;
        const gen = ++pane.activateGen;

        const img = path ? images.get(path) : undefined;
        if (img) {
            pane.diffViewer.hide();
            pane.view.dom.hidden = true;
            pane.view.setState(empty);
            pane.imageViewer.show(img);
            const viewerEl = pane.host.querySelector(".image-viewer") as HTMLElement | null;
            if (viewerEl && prevPath !== path) animateEditorContentIn(viewerEl);
            return;
        }

        const diff = path ? diffs.get(path) : undefined;
        if (diff) {
            pane.imageViewer.hide();
            pane.view.dom.hidden = true;
            pane.view.setState(empty);
            pane.diffViewer.show(diff);
            const diffEl = pane.host.querySelector(".diff-viewer") as HTMLElement | null;
            if (diffEl && prevPath !== path) animateEditorContentIn(diffEl);
            return;
        }

        pane.imageViewer.hide();
        pane.diffViewer.hide();
        pane.view.dom.hidden = false;

        let next: EditorState | undefined;
        if (path && states.has(path)) {
            const other = findOtherPaneWithPath(pane.groupId, path);
            if (other && isTextBuffer(path)) {
                // Mismo archivo abierto en otro grupo: estado independiente sincronizado en vivo
                next = build(path, other.view.state.doc.toString());
            } else {
                next = states.get(path);
            }
        }

        const savedScroll = path
            ? (scrollPositions.get(scrollKey(pane.groupId, path)) ?? { top: 0, left: 0 })
            : { top: 0, left: 0 };

        pane.view.setState(next ?? empty);
        if (path && next) {
            pane.view.dispatch({ effects: requestGitGutterRefreshEffect.of(undefined) });
        }

        const restoreScroll = () => {
            if (pane.path !== path || pane.activateGen !== gen) return;
            pane.view.scrollDOM.scrollTop = savedScroll.top;
            pane.view.scrollDOM.scrollLeft = savedScroll.left;
        };
        restoreScroll();
        if (prevPath !== path) animateEditorContentIn(pane.view.dom);
        if (next) {
            if (shouldFocus && !pane.host.contains(document.activeElement)) {
                pane.view.contentDOM.focus({ preventScroll: true });
            }
            requestAnimationFrame(() => {
                restoreScroll();
                pane.view.requestMeasure();
            });
        }
    };

    const updateIndentForFocused = () => {
        const fp = panes.get(activeGroupId)?.path ?? null;
        if (fp && isTextBuffer(fp)) {
            cb.onIndentChange?.(fileIndents.get(fp)?.label ?? `Espacios: ${currentTabSize}`);
        } else {
            cb.onIndentChange?.(`Espacios: ${currentTabSize}`);
        }
    };

    lspClient.onDiagnostics((diagPath, lspDiags) => {
        if (!isTextBuffer(diagPath)) return;
        let dispatched = false;
        let lastLumenDiags: LumenDiagnostic[] | null = null;
        for (const pane of panes.values()) {
            if (pane.path === diagPath) {
                const lumenDiags = lspDiagnosticsToLumen(pane.view.state.doc, lspDiags);
                pane.view.dispatch({ effects: setDiagnosticsEffect.of(lumenDiags) });
                states.set(diagPath, pane.view.state);
                lastLumenDiags = lumenDiags;
                dispatched = true;
            }
        }
        if (dispatched && lastLumenDiags) {
            cb.onDiagnostics?.(diagPath, lastLumenDiags);
            return;
        }
        const st = states.get(diagPath);
        if (st) {
            const lumenDiags = lspDiagnosticsToLumen(st.doc, lspDiags);
            states.set(diagPath, st.update({ effects: setDiagnosticsEffect.of(lumenDiags) }).state);
            cb.onDiagnostics?.(diagPath, lumenDiags);
        }
    });

    return {
        open(path, content) {
            states.set(path, build(path, content));
            void lspClient.openDocument(path, content, cb.getRootPath());
        },
        openImage(path, url, byteSize) {
            const prev = images.get(path);
            if (prev) URL.revokeObjectURL(prev.url);
            images.set(path, { path, url, byteSize, zoom: 0 });
        },
        openDiff(diff) {
            diffs.set(diff.id, diff);
        },
        mountGroup(groupId, bodyEl) {
            const existing = panes.get(groupId);
            if (existing) {
                if (existing.host.parentElement !== bodyEl) {
                    bodyEl.appendChild(existing.host);
                    requestAnimationFrame(() => existing.view.requestMeasure());
                }
                return;
            }
            const host = h("div", { class: "pane-surface" });
            const view = new EditorView({ parent: host, state: empty });
            const imageViewer = createImagePreviewHost(host);
            const diffViewer = createDiffPreviewHost(host, {
                onMutated: cb.onDiffMutated,
                confirmRevert: cb.confirmAction,
                onError: cb.onError,
            });
            bodyEl.appendChild(host);
            panes.set(groupId, {
                groupId,
                host,
                view,
                imageViewer,
                diffViewer,
                path: null,
                activateGen: 0,
            });
        },
        unmountGroup(groupId) {
            const pane = panes.get(groupId);
            if (!pane) return;
            animatePaneOutgoing(pane, pane.path);
            savePaneState(pane);
            pane.view.destroy();
            pane.host.remove();
            panes.delete(groupId);
            for (const key of [...scrollPositions.keys()]) {
                if (key.startsWith(`${groupId}::`)) scrollPositions.delete(key);
            }
        },
        syncGroup(groupId, path, focused, forceFocus = false) {
            const pane = panes.get(groupId);
            if (!pane) return;
            showInPane(pane, path, focused && forceFocus, false);
            if (focused) {
                activeGroupId = groupId;
                updateIndentForFocused();
            }
        },
        setActiveGroup(groupId) {
            activeGroupId = groupId;
            updateIndentForFocused();
        },
        refreshPath(path) {
            for (const pane of panes.values()) {
                if (pane.path === path) {
                    showInPane(pane, path, false, true);
                }
            }
        },
        configure(opts) {
            const tabChanged = opts.tabSize !== lastConfiguredTabSize;
            const wrapChanged = opts.wordWrap !== lastConfiguredWordWrap;
            const darkChanged = opts.dark !== undefined && opts.dark !== lastConfiguredDark;
            if (!tabChanged && !wrapChanged && !darkChanged) return;

            currentTabSize = opts.tabSize;
            currentWordWrap = opts.wordWrap;
            if (opts.dark !== undefined) currentDark = opts.dark;
            lastConfiguredTabSize = opts.tabSize;
            lastConfiguredWordWrap = opts.wordWrap;
            if (opts.dark !== undefined) lastConfiguredDark = opts.dark;

            const buildEffectsFor = (filePath: string) => {
                const effs = [];
                if (tabChanged) {
                    const prev = fileIndents.get(filePath);
                    if (prev?.unit === "\t") {
                        const updated: DetectedIndent = { ...prev, tabSize: opts.tabSize, label: `Tabulación: ${opts.tabSize}` };
                        fileIndents.set(filePath, updated);
                        effs.push(tabSizeConf.reconfigure(EditorState.tabSize.of(opts.tabSize)));
                    } else if (!prev?.fromFile) {
                        const updated: DetectedIndent = {
                            unit: " ".repeat(opts.tabSize),
                            tabSize: opts.tabSize,
                            label: `Espacios: ${opts.tabSize}`,
                            fromFile: false,
                        };
                        fileIndents.set(filePath, updated);
                        effs.push(
                            tabSizeConf.reconfigure(EditorState.tabSize.of(opts.tabSize)),
                            indentUnitConf.reconfigure(indentUnit.of(updated.unit)),
                        );
                    }
                }
                if (wrapChanged) {
                    effs.push(wordWrapConf.reconfigure(opts.wordWrap ? EditorView.lineWrapping : []));
                }
                if (darkChanged) {
                    effs.push(themeConf.reconfigure(createLumenTheme(currentDark)));
                }
                return effs;
            };

            if (darkChanged) {
                empty = empty.update({ effects: themeConf.reconfigure(createLumenTheme(currentDark)) }).state;
            }

            const updatedPaths = new Set<string>();
            for (const pane of panes.values()) {
                if (isTextBuffer(pane.path)) {
                    const effs = buildEffectsFor(pane.path);
                    if (effs.length > 0) {
                        pane.view.dispatch({ effects: effs });
                        states.set(pane.path, pane.view.state);
                    }
                    updatedPaths.add(pane.path);
                } else if (darkChanged && !pane.path) {
                    pane.view.setState(empty);
                }
            }

            for (const [p, st] of states) {
                if (updatedPaths.has(p)) continue;
                const effs = buildEffectsFor(p);
                if (effs.length > 0) {
                    states.set(p, st.update({ effects: effs }).state);
                }
            }

            if (tabChanged) updateIndentForFocused();
        },
        revealPosition(path, line, character) {
            const activePane = panes.get(activeGroupId);
            const candidates: PaneCtx[] = activePane
                ? [activePane, ...[...panes.values()].filter((p) => p !== activePane)]
                : [...panes.values()];
            const pane = candidates.find((p) => p.path && pathsEqual(p.path, path) && isTextBuffer(p.path));
            if (!pane) return;
            pane.activateGen++;
            const doc = pane.view.state.doc;
            const lineNum = Math.max(1, Math.min(doc.lines, line + 1));
            const docLine = doc.line(lineNum);
            const pos = Math.min(docLine.to, docLine.from + Math.max(0, character));
            pane.view.dispatch({
                selection: EditorSelection.cursor(pos),
                effects: EditorView.scrollIntoView(pos, { y: "center" }),
            });
            pane.view.focus();
        },
        rename(oldPath, newPath) {
            const img = images.get(oldPath);
            if (img) {
                const updated: ImageEntry = { ...img, path: newPath };
                images.delete(oldPath);
                images.set(newPath, updated);
                for (const pane of panes.values()) {
                    if (pane.path === oldPath) {
                        pane.path = newPath;
                        pane.imageViewer.show(updated);
                    }
                }
                return;
            }

            const activeHolder =
                (panes.get(activeGroupId)?.path === oldPath ? panes.get(activeGroupId) : null) ??
                [...panes.values()].find((p) => p.path === oldPath);
            const prevState = activeHolder ? activeHolder.view.state : states.get(oldPath);
            if (!prevState) return;

            const content = prevState.doc.toString();
            const selection = prevState.selection;
            const rebuilt = build(newPath, content).update({ selection }).state;

            states.delete(oldPath);
            states.set(newPath, rebuilt);
            const indent = fileIndents.get(oldPath);
            fileIndents.delete(oldPath);
            if (indent) fileIndents.set(newPath, indent);

            for (const pane of panes.values()) {
                const oldKey = scrollKey(pane.groupId, oldPath);
                const newKey = scrollKey(pane.groupId, newPath);
                const saved = pane.path === oldPath
                    ? { top: pane.view.scrollDOM.scrollTop, left: pane.view.scrollDOM.scrollLeft }
                    : scrollPositions.get(oldKey);
                scrollPositions.delete(oldKey);
                if (saved) scrollPositions.set(newKey, saved);
            }

            cb.onDiagnostics?.(oldPath, []);
            lspClient.closeDocument(oldPath);
            void lspClient.openDocument(newPath, content, cb.getRootPath());

            for (const pane of panes.values()) {
                if (pane.path !== oldPath) continue;
                pane.path = newPath;
                const paneSel = pane.view.state.selection;
                const nextState = pane === activeHolder
                    ? rebuilt
                    : build(newPath, content).update({ selection: paneSel }).state;
                pane.view.setState(nextState);
                const saved = scrollPositions.get(scrollKey(pane.groupId, newPath));
                if (saved) {
                    pane.view.scrollDOM.scrollTop = saved.top;
                    pane.view.scrollDOM.scrollLeft = saved.left;
                }
            }
        },
        close(path) {
            const img = images.get(path);
            if (img) {
                let animated = false;
                for (const pane of panes.values()) {
                    if (pane.path === path) {
                        animatePaneOutgoing(pane, path);
                        animated = true;
                        pane.path = null;
                        pane.imageViewer.hide();
                        pane.view.dom.hidden = false;
                    }
                }
                images.delete(path);
                if (animated) setTimeout(() => URL.revokeObjectURL(img.url), 350);
                else URL.revokeObjectURL(img.url);
                return;
            }
            if (diffs.has(path)) {
                for (const pane of panes.values()) {
                    if (pane.path === path) {
                        animatePaneOutgoing(pane, path);
                        pane.path = null;
                        pane.diffViewer.hide();
                        pane.view.dom.hidden = false;
                    }
                }
                diffs.delete(path);
                return;
            }
            for (const pane of panes.values()) {
                if (pane.path === path) {
                    animatePaneOutgoing(pane, path);
                    pane.path = null;
                    pane.view.setState(empty);
                }
            }
            states.delete(path);
            fileIndents.delete(path);
            for (const key of [...scrollPositions.keys()]) {
                if (key.endsWith(`::${path}`)) scrollPositions.delete(key);
            }
            lspClient.closeDocument(path);
        },
        isEditable(path) {
            return isTextBuffer(path);
        },
        getText(path) {
            if (!isTextBuffer(path)) return "";
            const activePane = panes.get(activeGroupId);
            if (activePane?.path === path) return activePane.view.state.doc.toString();
            for (const pane of panes.values()) {
                if (pane.path === path) return pane.view.state.doc.toString();
            }
            return states.get(path)?.doc.toString() ?? "";
        },
        setText(path, content) {
            if (!isTextBuffer(path)) return;
            let updatedVisible = false;
            isSyncing = true;
            try {
                for (const pane of panes.values()) {
                    if (pane.path === path) {
                        pane.view.dispatch({
                            changes: { from: 0, to: pane.view.state.doc.length, insert: content },
                        });
                        states.set(path, pane.view.state);
                        updatedVisible = true;
                    }
                }
            } finally {
                isSyncing = false;
            }
            if (!updatedVisible) {
                states.set(path, build(path, content));
            }
            lspClient.changeDocument(path, content);
        },
        focus: () => {
            const target = panes.get(activeGroupId) ?? panes.values().next().value;
            target?.view.focus();
        },
        remeasure: () => {
            for (const pane of panes.values()) pane.view.requestMeasure();
        },
    };
}

