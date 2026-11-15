import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, dropCursor, rectangularSelection, placeholder, ViewPlugin, ViewUpdate, scrollPastEnd } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { acceptCompletion, autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";

import type { ProjectIndex } from "../../domain/symbolIndex";
import { lspClient } from "../../infraestructure/lspClient";
import { createHtmlEmmetCompletionSource, expandHtmlEmmetAtCursor } from "./htmlEmmetCompletion";
import { createLspCompletionSource, createLspHoverExtension } from "./lspExtension";
import { createPasteIndentExtension } from "./pasteIndent";
import { errorLensExtension, lspDiagnosticsToLumen, setDiagnosticsEffect } from "./errorLens";
import { createImagePreviewHost, type ImageEntry } from "./imagePreview";

import type { EditorPort } from "../../application/ports";
// import { languageFor } from "./languages";
import { lumenHighlight, lumenTheme } from "./theme";
import { languageFor } from "./languages";

export interface EditorCallbacks {
    onChange: (path: string, content: string) => void;
    getIndex: () => ProjectIndex;
    getRootPath: () => string | null;
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
    let active: string | null = null;

    const empty = EditorState.create({
        extensions: [lumenTheme, EditorView.editable.of(false), 
            placeholder("Abre un archivo desde el explorador ó Ctrl + O abre una carpeta")],
    });

    const build = (path: string, doc: string) =>
        EditorState.create({
            doc,
            extensions: [
                lineNumbers(),
                highlightActiveLineGutter(),
                foldGutter({ openText: "⌄", closedText: "›" }),
                history(),
                drawSelection(),
                smoothCaret,
                scrollPastEnd(),
                elasticOverscroll,
                dropCursor(),
                EditorState.allowMultipleSelections.of(true),
                indentUnit.of("     "),
                indentOnInput(),
                createPasteIndentExtension(() => path),
                bracketMatching(),
                closeBrackets(),
                autocompletion({
                    activateOnTyping: true,
                    activateOnTypingDelay: 35,
                    maxRenderedOptions: 25,
                    defaultKeymap: true,
                }),
                EditorState.languageData.of(() => [
                    { autocomplete: createLspCompletionSource(cb.getIndex, () => path) },
                    { autocomplete: createHtmlEmmetCompletionSource(() => path) },
                ]),
                createLspHoverExtension(() => path),
                errorLensExtension(() => path),
                rectangularSelection(),
                highlightActiveLine(),
                highlightSelectionMatches(),
                keymap.of([
                    ...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap,
                    ...historyKeymap, ...foldKeymap, ...completionKeymap,
                    { key: "Tab", run: (v) => acceptCompletion(v) || expandHtmlEmmetAtCursor(v, path) },
                    indentWithTab,
                ]),
                lumenTheme,
                syntaxHighlighting(lumenHighlight),
                languageFor(path).support,
                EditorView.updateListener.of((u) => {
                    if (u.docChanged) {
                        const text = u.state.doc.toString();
                        cb.onChange(path, text);
                        lspClient.changeDocument(path, text);
                    }
                }),
            ],
        });

    const view = new EditorView({ parent, state: empty });
    const images = new Map<string, ImageEntry>();
    const imageViewer = createImagePreviewHost(parent);

    lspClient.onDiagnostics((diagPath, lspDiags) => {
        if (diagPath === active) {
            const lumenDiags = lspDiagnosticsToLumen(view.state.doc, lspDiags);
            view.dispatch({ effects: setDiagnosticsEffect.of(lumenDiags) });
        } else {
            const st = states.get(diagPath);
            if (st) {
                const lumenDiags = lspDiagnosticsToLumen(st.doc, lspDiags);
                states.set(diagPath, st.update({ effects: setDiagnosticsEffect.of(lumenDiags) }).state);
            }
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
        activate(path) {
            if (active && active !== path && states.has(active)) states.set(active, view.state); // Guarda la pestaña saliente
            active = path;

            const img = path ? images.get(path) : undefined;
            if (img) {
                view.dom.hidden = true;
                imageViewer.show(img);
                return;
            }

            imageViewer.hide();
            view.dom.hidden = false;
            const next = path ? states.get(path) : undefined;
            view.setState(next ?? empty);
            if (next) view.focus();
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
            lspClient.closeDocument(oldPath);
            void lspClient.openDocument(newPath, content, cb.getRootPath());

            if (isActive) {
                active = newPath;
                view.setState(rebuilt);
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
            states.delete(path);
            if (active === path) active = null;
            lspClient.closeDocument(path);
        },
        getText(path) {
            const state = path === active ? view.state : states.get(path);
            return state?.doc.toString() ?? "";
        },
        focus: () => view.focus(),
        remeasure: () => view.requestMeasure(),
    };
}

