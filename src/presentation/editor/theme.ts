import { EditorView } from "@codemirror/view";
import { HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

export const lumenTheme = EditorView.theme (
    {
        "&": { height: "100%", color: "var(--fg)", backgroundColor: "var(--bg)", fontSize: "var(--editor-font-size)" },
        "&.cm-focused": { outline: "none" },
        ".cm-scroller": { 
            fontFamily: "var(--editor-font)", 
            lineHeight: "1.65",
            overflow: "auto",
            overscrollBehavior: "contain",
        },
                ".cm-content": { caretColor: "transparent", padding: "0 0 40px" },
        ".cm-cursorLayer": { animation: "none !important" },
        ".cm-cursor, .cm-dropCursor": {
            borderLeftColor: "var(--accent)",
            borderLeftWidth: "2.2px",
            borderRadius: "1px",
            transformOrigin: "center center",
            animation: "var(--cursor-animation, none) !important",
            willChange: "transform, opacity",
        },
        ".cm-gutters": { backgroundColor: "var(--bg)", color: "var(--fg-faint)", border: "none" },
        ".cm-lineNumbers .cm-gutterElement": { padding: "0 14px 0 4px", minWidth: "28px", textAlign: "left" },
        ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--fg-muted)" },
        ".cm-activeLine": { backgroundColor: "rgba(93, 156, 236, 0.06)" },
        "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
        backgroundColor: "rgba(93, 156, 236, 0.20) !important",
        },
        ".cm-matchingBracket": { backgroundColor: "rgba(130, 160, 216, 0.25)", outline: "none" },
        ".cm-placeholder": { color: "var(--fg-faint)" },
        ".cm-tooltip": { backgroundColor: "var(--bg)", border: "1px solid var(--border)", borderRadius: "8px" },
        ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "var(--surface)", color: "var(--fg)" },
        ".cm-panels": { backgroundColor: "var(--surface)", color: "var(--fg)" },
   },
   { dark: false },
);

export const lumenHighlight = HighlightStyle.define([
    { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.definitionKeyword, t.moduleKeyword, t.modifier, t.self],
    color: "var(--syn-keyword)" },
    { tag: [t.function(t.variableName), t.function(t.propertyName), t.className, t.typeName, t.namespace, t.macroName],
        color: "var(--syn-function)" },
    { tag: [t.string, t.special(t.string), t.regexp], color: "var(--syn-string)" },
    { tag: [t.number, t.bool, t.null, t.atom], color: "var(--syn-number)" },
    { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: "var(--syn-comment)", fontStyle: "italic" },
    { tag: [t.operator, t.punctuation, t.bracket], color: "var(--fg-muted)" },
]);

