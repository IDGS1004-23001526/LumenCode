import { getIndentation, indentString } from "@codemirror/language";
import { EditorSelection, EditorState, type Extension } from "@codemirror/state";

const INDENT_SENSITIVE_EXTS = new Set([
  "py", "pyw", "yaml", "yml", "toml", "sass", "pug", "jade", "coffee", "nim",
]);

function isIndentSensitivePath(path: string | null): boolean {
  if (!path) return false;
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return INDENT_SENSITIVE_EXTS.has(ext);
}

function leadingWhitespace(text: string): string {
  return /^\s*/.exec(text)?.[0] ?? "";
}

function countColumns(ws: string, tabSize: number): number {
  let cols = 0;
  for (const ch of ws) {
    cols += ch === "\t" ? tabSize - (cols % tabSize) : 1;
  }
  return cols;
}

/**
 * Para lenguajes sensibles a la indentación (Python, YAML, etc.), alinea el bloque
 * pegado con la indentación esperada del padre y conserva la jerarquía relativa
 * entre líneas padre e hijo dentro del bloque pegado.
 */
function reindentRelativeBlock(
  postState: EditorState,
  startLineNum: number,
  endLineNum: number,
  pasteStartsAtLineIndent: boolean,
): EditorState {
  const tabSize = postState.tabSize;
  const firstLine = postState.doc.line(startLineNum);
  const firstLineWs = leadingWhitespace(firstLine.text);

  let targetCols = countColumns(firstLineWs, tabSize);
  if (pasteStartsAtLineIndent) {
    const expected = getIndentation(postState, firstLine.from);
    if (expected !== null && expected >= 0) {
      targetCols = expected;
    }
  }

  const firstContentLine = pasteStartsAtLineIndent ? startLineNum : startLineNum + 1;
  let minCols = Infinity;

  for (let i = firstContentLine; i <= endLineNum; i++) {
    const line = postState.doc.line(i);
    if (!line.text.trim()) continue;
    const cols = countColumns(leadingWhitespace(line.text), tabSize);
    if (cols < minCols) minCols = cols;
  }

  if (!Number.isFinite(minCols)) return postState;

  let work = postState;
  for (let i = firstContentLine; i <= endLineNum; i++) {
    const line = work.doc.line(i);
    const currentWs = leadingWhitespace(line.text);
    if (!line.text.trim()) {
      if (currentWs.length > 0) {
        work = work.update({
          changes: { from: line.from, to: line.from + currentWs.length, insert: "" },
        }).state;
      }
      continue;
    }

    const lineCols = countColumns(currentWs, tabSize);
    const desiredCols = Math.max(0, targetCols + (lineCols - minCols));
    const desiredWs = indentString(work, desiredCols);
    if (currentWs !== desiredWs) {
      work = work.update({
        changes: { from: line.from, to: line.from + currentWs.length, insert: desiredWs },
      }).state;
    }
  }

  return work;
}

/**
 * Para lenguajes con delimitadores sintácticos ({ }, <tag>, etc.), reindenta
 * secuencialmente línea por línea usando el árbol sintáctico del lenguaje para
 * que cada hijo herede la indentación actualizada de su padre.
 */
function reindentSyntaxBlock(
  postState: EditorState,
  startLineNum: number,
  endLineNum: number,
  pasteStartsAtLineIndent: boolean,
): EditorState {
  let work = postState;
  const firstToIndent = pasteStartsAtLineIndent ? startLineNum : startLineNum + 1;

  for (let i = firstToIndent; i <= endLineNum; i++) {
    const line = work.doc.line(i);
    const currentWs = leadingWhitespace(line.text);

    if (!line.text.trim()) {
      if (currentWs.length > 0) {
        work = work.update({
          changes: { from: line.from, to: line.from + currentWs.length, insert: "" },
        }).state;
      }
      continue;
    }

    const targetCols = getIndentation(work, line.from);
    if (targetCols === null || targetCols < 0) continue;

    const desiredWs = indentString(work, targetCols);
    if (currentWs !== desiredWs) {
      work = work.update({
        changes: { from: line.from, to: line.from + currentWs.length, insert: desiredWs },
      }).state;
    }
  }

  return work;
}

export function createPasteIndentExtension(getActivePath: () => string | null): Extension {
  return EditorState.transactionFilter.of((tr) => {
    if (!tr.isUserEvent("input.paste") || !tr.docChanged) return tr;
    if (tr.startState.selection.ranges.length !== 1) return tr;

    let pasteFromA = -1;
    let pasteToA = -1;
    let pasteFromB = -1;
    let pasteToB = -1;
    let insertedText = "";
    let changeCount = 0;

    tr.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
      changeCount++;
      pasteFromA = fromA;
      pasteToA = toA;
      pasteFromB = fromB;
      pasteToB = toB;
      insertedText = inserted.toString();
    });

    if (changeCount !== 1 || !insertedText.trim()) return tr;

    const startLine = tr.startState.doc.lineAt(pasteFromA);
    const prefixBeforeCursor = startLine.text.slice(0, pasteFromA - startLine.from);
    const pasteStartsAtLineIndent = prefixBeforeCursor.trim().length === 0;
    const isMultiLine = insertedText.includes("\n");

    // Si es una sola línea pegada en medio de código existente, no tocar indentación
    if (!isMultiLine && !pasteStartsAtLineIndent) return tr;

    const postState = tr.state;
    const startLineNum = postState.doc.lineAt(pasteFromB).number;
    const endLineNum = postState.doc.lineAt(pasteToB).number;

    const workState = isIndentSensitivePath(getActivePath())
      ? reindentRelativeBlock(postState, startLineNum, endLineNum, pasteStartsAtLineIndent)
      : reindentSyntaxBlock(postState, startLineNum, endLineNum, pasteStartsAtLineIndent);

    const origReplaceFrom = startLine.from;
    const origEndLine = tr.startState.doc.lineAt(pasteToA);
    const origReplaceTo = origEndLine.to;

    const newStartLine = workState.doc.line(startLineNum);
    const newEndLine = workState.doc.line(endLineNum);
    const formattedBlock = workState.doc.sliceString(newStartLine.from, newEndLine.to);
    const postBlock = postState.doc.sliceString(
      postState.doc.line(startLineNum).from,
      postState.doc.line(endLineNum).to,
    );

    if (formattedBlock === postBlock) return tr;

    // Ubica el cursor al final del contenido pegado (antes del sufijo de la última línea)
    const trailingSuffixLen = origEndLine.to - pasteToA;
    const newCursorPos = Math.max(
      origReplaceFrom,
      origReplaceFrom + formattedBlock.length - trailingSuffixLen,
    );

    return {
      changes: { from: origReplaceFrom, to: origReplaceTo, insert: formattedBlock },
      selection: EditorSelection.cursor(newCursorPos),
      scrollIntoView: tr.scrollIntoView,
      userEvent: "input.paste",
    };
  });
}
