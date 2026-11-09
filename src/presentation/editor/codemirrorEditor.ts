import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, dropCursor, rectangularSelection, placeholder } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";

import type { EditorPort } from "../../application/ports";
// import { languageFor } from "./languages";
import { lumenHighlight, lumenTheme } from "./theme";
import { languageFor } from "../../editor";

export interface EditorCallbacks {
    onChange: (path: string) => void;
}

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
                dropCursor(),
                EditorState.allowMultipleSelections.of(true),
                indentUnit.of("     "),
                indentOnInput(),
                bracketMatching(),
                closeBrackets(),
                autocompletion(),
                rectangularSelection(),
                highlightActiveLine(),
                highlightSelectionMatches(),
                keymap.of([
                    ...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap,
                    ...historyKeymap, ...foldKeymap, ...completionKeymap, indentWithTab,
                ]),
                lumenTheme,
                syntaxHighlighting(lumenHighlight),
                languageFor(path).support,
                EditorView.updateListener.of((u) => {
                    if (u.docChanged) cb.onChange(path);
                }),
            ],
        });

    const view = new EditorView({ parent, state: empty });

    return {
        open(path, content) {
            states.set(path, build(path, content));
        },
        activate(path) {
            if (active && active !== path && states.has(active)) states.set(active, view.state); // Guarda la pestaña saliente
            active = path;
            const next = path ? states.get(path) : undefined;
            view.setState(next ?? empty);
            if (next) view.focus();
        },
        close(path) {
            states.delete(path);
            if (active === path) active = null;
        },
        getText(path) {
            const state = path === active ? view.state : states.get(path);
            return state?.doc.toString() ?? "";
        },
        focus: () => view.focus(),
        remeasure: () => view.requestMeasure(),
    };
}

