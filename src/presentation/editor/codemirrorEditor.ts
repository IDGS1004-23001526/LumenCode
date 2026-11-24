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
import { createDiffPreviewHost } from "./diffViewer";
import { createGitConflictExtension } from "./gitConflicts";
import { closeGitPeek, createGitGutterExtension, requestGitGutterRefreshEffect } from "./gitGutter";
import { createImagePreviewHost, type ImageEntry } from "./imagePreview";

import type { EditorPort } from "../../application/ports";
// import { languageFor } from "./languages";
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

/** Un EdtorView y un EditorState por pestaña osea conserva cursor e historial */
export function createCodeMirrorEditor(parent: HTMLElement, cb: EditorCallbacks): EditorPort {
    const states = new Map<string, EditorState>();
    const fileIndents = new Map<string, DetectedIndent>();
    const scrollPositions = new Map<string, { top: number; left: number }>();
    let active: string | null = null;
    let activateGen = 0;
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
        extensions: [themeConf.of(createLumenTheme(currentDark)), EditorView.editable.of(false), 
            placeholder("Abre un archivo desde el explorador ó Ctrl + O abre una carpeta")],
    });

    const build = (path: string, doc: string) => {
        const detected = detectFileIndentation(doc, currentTabSize);
        fileIndents.set(path, detected);
        const smartSource = createSmartCompletionSource(cb.getIndex, () => path, cb.getAssetFiles);
        const lspSource = createLspCompletionSource(cb.getIndex, () => active);
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
                    isActiveTab: () => active === path,
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
                createLspHoverExtension(() => active),
                createLspDefinitionExtension({
                    getActivePath: () => active,
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
                    if (u.docChanged && active === path && states.has(path)) {
                        const text = u.state.doc.toString();
                        cb.onChange(path, text);
                        lspClient.changeDocument(path, text);
                    }
                }),
            ],
        });
    };

    const view = new EditorView({ parent, state: empty });
    const images = new Map<string, ImageEntry>();
    const imageViewer = createImagePreviewHost(parent);
    const diffs = new Map<string, DiffPayload>();
    const diffViewer = createDiffPreviewHost(parent, {
        onMutated: cb.onDiffMutated,
        confirmRevert: cb.confirmAction,
        onError: cb.onError,
    });

    lspClient.onDiagnostics((diagPath, lspDiags) => {
        if (diagPath === active && isTextBuffer(diagPath)) {
            const lumenDiags = lspDiagnosticsToLumen(view.state.doc, lspDiags);
            view.dispatch({ effects: setDiagnosticsEffect.of(lumenDiags) });
            cb.onDiagnostics?.(diagPath, lumenDiags);
        } else {
            const st = states.get(diagPath);
            if (st) {
                const lumenDiags = lspDiagnosticsToLumen(st.doc, lspDiags);
                states.set(diagPath, st.update({ effects: setDiagnosticsEffect.of(lumenDiags) }).state);
                cb.onDiagnostics?.(diagPath, lumenDiags);
            }
        }
    });

    const isTextBuffer = (path: string | null): path is string =>
        Boolean(path && states.has(path) && !images.has(path) && !diffs.has(path));

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
        activate(path) {
            closeGitPeek();
            const prevActive = active;
            if (isTextBuffer(active) && active !== path) {
                states.set(active, view.state);
                scrollPositions.set(active, {
                    top: view.scrollDOM.scrollTop,
                    left: view.scrollDOM.scrollLeft,
                });
            }
            if (prevActive && prevActive !== path) {
                const outgoing = images.has(prevActive)
                    ? (parent.querySelector(".image-viewer") as HTMLElement | null)
                    : diffs.has(prevActive)
                        ? (parent.querySelector(".diff-viewer") as HTMLElement | null)
                        : view.dom;
                if (outgoing && !outgoing.hidden) animateEditorContentOut(outgoing);
            }
            active = path;
            const gen = ++activateGen;

            const img = path ? images.get(path) : undefined;
            if (img) {
                diffViewer.hide();
                view.dom.hidden = true;
                view.setState(empty);
                imageViewer.show(img);
                const viewerEl = parent.querySelector(".image-viewer") as HTMLElement | null;
                if (viewerEl && prevActive !== path) animateEditorContentIn(viewerEl);
                return;
            }

            const diff = path ? diffs.get(path) : undefined;
            if (diff) {
                imageViewer.hide();
                view.dom.hidden = true;
                view.setState(empty);
                diffViewer.show(diff);
                const diffEl = parent.querySelector(".diff-viewer") as HTMLElement | null;
                if (diffEl && prevActive !== path) animateEditorContentIn(diffEl);
                return;
            }

            imageViewer.hide();
            diffViewer.hide();
            view.dom.hidden = false;
            const next = path ? states.get(path) : undefined;
            const savedScroll = path ? (scrollPositions.get(path) ?? { top: 0, left: 0 }) : { top: 0, left: 0 };
            view.setState(next ?? empty);
            if (path && next) {
                cb.onIndentChange?.(fileIndents.get(path)?.label ?? `Espacios: ${currentTabSize}`);
                view.dispatch({ effects: requestGitGutterRefreshEffect.of(undefined) });
            } else {
                cb.onIndentChange?.(`Espacios: ${currentTabSize}`);
            }

            const restoreScroll = () => {
                if (active !== path || activateGen !== gen) return;
                view.scrollDOM.scrollTop = savedScroll.top;
                view.scrollDOM.scrollLeft = savedScroll.left;
            };
            restoreScroll();
            if (prevActive !== path) animateEditorContentIn(view.dom);
            if (next) {
                view.contentDOM.focus({ preventScroll: true });
                requestAnimationFrame(() => {
                    restoreScroll();
                    view.requestMeasure();
                });
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

            if (active && !images.has(active) && !diffs.has(active) && states.has(active)) {
                const effs = buildEffectsFor(active);
                if (effs.length > 0) {
                    view.dispatch({ effects: effs });
                    states.set(active, view.state);
                }
            } else if (darkChanged && !active) {
                view.setState(empty);
            }
            for (const [p, st] of states) {
                if (p === active) continue;
                const effs = buildEffectsFor(p);
                if (effs.length > 0) {
                    states.set(p, st.update({ effects: effs }).state);
                }
            }

            if (tabChanged) {
                const activeLabel = active ? fileIndents.get(active)?.label : undefined;
                cb.onIndentChange?.(activeLabel ?? `Espacios: ${opts.tabSize}`);
            }
        },
        revealPosition(path, line, character) {
            if (!active || !pathsEqual(active, path) || !isTextBuffer(active)) return;
            activateGen++;
            const doc = view.state.doc;
            const lineNum = Math.max(1, Math.min(doc.lines, line + 1));
            const docLine = doc.line(lineNum);
            const pos = Math.min(docLine.to, docLine.from + Math.max(0, character));
            view.dispatch({
                selection: EditorSelection.cursor(pos),
                effects: EditorView.scrollIntoView(pos, { y: "center" }),
            });
            view.focus();
        },
        rename(oldPath, newPath) {
            const img = images.get(oldPath);
            if (img) {
                const updated: ImageEntry = { ...img, path: newPath };
                images.delete(oldPath);
                images.set(newPath, updated);
                if (active === oldPath) {
                    active = newPath;
                    imageViewer.show(updated);
                }
                return;
            }

            const isActive = active === oldPath;
            const prevState = isActive ? view.state : states.get(oldPath);
            if (!prevState) return;

            const content = prevState.doc.toString();
            const selection = prevState.selection;
            const rebuilt = build(newPath, content).update({ selection }).state;

            states.delete(oldPath);
            states.set(newPath, rebuilt);
            const indent = fileIndents.get(oldPath);
            fileIndents.delete(oldPath);
            if (indent) fileIndents.set(newPath, indent);
            const savedScroll = isActive
                ? { top: view.scrollDOM.scrollTop, left: view.scrollDOM.scrollLeft }
                : scrollPositions.get(oldPath);
            scrollPositions.delete(oldPath);
            if (savedScroll) scrollPositions.set(newPath, savedScroll);
            cb.onDiagnostics?.(oldPath, []);
            lspClient.closeDocument(oldPath);
            void lspClient.openDocument(newPath, content, cb.getRootPath());

            if (isActive) {
                active = newPath;
                view.setState(rebuilt);
                if (savedScroll) {
                    view.scrollDOM.scrollTop = savedScroll.top;
                    view.scrollDOM.scrollLeft = savedScroll.left;
                }
            }
        },
        close(path) {
            const img = images.get(path);
            if (img) {
                URL.revokeObjectURL(img.url);
                images.delete(path);
                if (active === path) {
                    active = null;
                    imageViewer.hide();
                    view.dom.hidden = false;
                }
                return;
            }
            if (diffs.has(path)) {
                diffs.delete(path);
                if (active === path) {
                    active = null;
                    diffViewer.hide();
                    view.dom.hidden = false;
                }
                return;
            }
            states.delete(path);
            fileIndents.delete(path);
            scrollPositions.delete(path);
            if (active === path) {
                active = null;
                view.setState(empty);
            }
            lspClient.closeDocument(path);
        },
        isEditable(path) {
            return isTextBuffer(path);
        },
        getText(path) {
            if (!isTextBuffer(path)) return "";
            const state = path === active ? view.state : states.get(path);
            return state?.doc.toString() ?? "";
        },
        setText(path, content) {
            if (!isTextBuffer(path)) return;
            if (path === active) {
                view.dispatch({
                    changes: { from: 0, to: view.state.doc.length, insert: content },
                });
                states.set(path, view.state);
                return;
            }
            states.set(path, build(path, content));
            lspClient.changeDocument(path, content);
        },
        focus: () => view.focus(),
        remeasure: () => view.requestMeasure(),
    };
}

