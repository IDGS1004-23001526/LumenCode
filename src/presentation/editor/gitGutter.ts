import { RangeSetBuilder, StateEffect, StateField, type Extension } from "@codemirror/state";
import { EditorView, GutterMarker, gutter } from "@codemirror/view";
import { buildHunkPatch, computeDiffHunks, type DiffHunk } from "../../domain/git";
import { gitClient, toRelativeRepoPath } from "../../infraestructure/gitClient";
import { h } from "../dom";

export const setGitHunksEffect = StateEffect.define<DiffHunk[]>();
export const requestGitGutterRefreshEffect = StateEffect.define<void>();

class GitGutterMarker extends GutterMarker {
  constructor(
    readonly kind: DiffHunk["kind"],
    readonly hunkIndex: number,
  ) {
    super();
  }

  eq(other: GitGutterMarker) {
    return other.kind === this.kind && other.hunkIndex === this.hunkIndex;
  }

  toDOM() {
    const dom = document.createElement("div");
    dom.className = `cm-git-bar cm-git-bar-${this.kind}`;
    dom.dataset.hunkIndex = String(this.hunkIndex);
    dom.title = "Clic para ver Peek Diff";
    return dom;
  }
}

const gitHunksField = StateField.define<DiffHunk[]>({
  create: () => [],
  update(hunks, tr) {
    for (const e of tr.effects) {
      if (e.is(setGitHunksEffect)) return e.value;
    }
    return hunks;
  },
});

let activePeek: HTMLElement | null = null;
let activeOutsideCleanup: (() => void) | null = null;

export function closeGitPeek() {
  activeOutsideCleanup?.();
  activeOutsideCleanup = null;
  activePeek?.remove();
  activePeek = null;
}

export interface GitGutterDeps {
  getPath: () => string | null;
  getRepoRoot: () => string | null;
  isActiveTab: () => boolean;
  onGitMutated: () => void;
}

export function createGitGutterExtension(deps: GitGutterDeps): Extension {
  let cachedHeadText: string | null = null;
  let lastLoadedKey = "";
  let recalcTimer: ReturnType<typeof setTimeout> | null = null;
  let fetchGen = 0;

  async function refreshFromHead(view: EditorView, forceHeadFetch = false) {
    if (!deps.isActiveTab()) return;
    const filePath = deps.getPath();
    const repoRoot = deps.getRepoRoot();
    if (!filePath || !repoRoot) {
      view.dispatch({ effects: setGitHunksEffect.of([]) });
      return;
    }

    const relPath = toRelativeRepoPath(repoRoot, filePath);
    if (!relPath) return;

    const gen = ++fetchGen;
    const key = `${repoRoot}|${relPath}`;
    if (forceHeadFetch || key !== lastLoadedKey || cachedHeadText === null) {
      lastLoadedKey = key;
      try {
        cachedHeadText = await gitClient.showFile(repoRoot, "HEAD", relPath);
      } catch {
        cachedHeadText = "";
      }
    }

    if (gen !== fetchGen || !deps.isActiveTab()) return;

    const hunks = computeDiffHunks(cachedHeadText, view.state.doc.toString());
    view.dispatch({ effects: setGitHunksEffect.of(hunks) });
  }

  function openPeekAt(view: EditorView, lineFrom: number, hunk: DiffHunk) {
    closeGitPeek();
    if (!deps.isActiveTab()) return;
    const coords = view.coordsAtPos(lineFrom);
    if (!coords) return;

    const filePath = deps.getPath();
    const repoRoot = deps.getRepoRoot();
    const relPath = filePath && repoRoot ? toRelativeRepoPath(repoRoot, filePath) : null;

    const revertBlock = () => {
      closeGitPeek();
      if (!deps.isActiveTab()) return;
      const doc = view.state.doc;
      if (hunk.kind === "add") {
        const startNum = Math.max(1, Math.min(doc.lines, hunk.newStart));
        const endNum = Math.max(startNum, Math.min(doc.lines, hunk.newStart + hunk.newCount - 1));
        const fromLine = doc.line(startNum);
        const toLine = doc.line(endNum);
        const delFrom = fromLine.from > 0 ? fromLine.from - 1 : 0;
        const delTo = fromLine.from > 0 ? toLine.to : Math.min(doc.length, toLine.to + 1);
        view.dispatch({ changes: { from: delFrom, to: delTo, insert: "" } });
      } else if (hunk.kind === "modify") {
        const startNum = Math.max(1, Math.min(doc.lines, hunk.newStart));
        const endNum = Math.max(startNum, Math.min(doc.lines, hunk.newStart + hunk.newCount - 1));
        const fromLine = doc.line(startNum);
        const toLine = doc.line(endNum);
        view.dispatch({
          changes: { from: fromLine.from, to: toLine.to, insert: hunk.oldLines.join("\n") },
        });
      } else {
        const anchorLine = doc.line(Math.min(doc.lines, Math.max(1, hunk.newStart)));
        const insertText = hunk.oldLines.join("\n");
        const insert = hunk.newStart === 0 ? `${insertText}\n` : `\n${insertText}`;
        const pos = hunk.newStart === 0 ? 0 : anchorLine.to;
        view.dispatch({ changes: { from: pos, to: pos, insert } });
      }
    };

    const stageBlock = async () => {
      if (!repoRoot || !relPath) return;
      closeGitPeek();
      try {
        const patch = buildHunkPatch(relPath, hunk, {
          isNewFile: (cachedHeadText ?? "").length === 0,
          isDeletedFile: view.state.doc.length === 0,
        });
        await gitClient.applyPatch(repoRoot, patch, true, false);
        deps.onGitMutated();
      } catch {
        // Si falla el patch parcial, no rompe el editor
      }
    };

    const peek = h(
      "div",
      { class: "git-peek" },
      h(
        "div",
        { class: "git-peek-head" },
        h("span", { class: "git-peek-title" }, `Peek Diff · ${hunk.kind.toUpperCase()}`),
        h(
          "div",
          { class: "git-peek-actions" },
          relPath ? h("button", { class: "btn ghost git-peek-btn", onclick: () => void stageBlock() }, "Stage") : null,
          h("button", { class: "btn ghost git-peek-btn", onclick: revertBlock }, "Revertir"),
          h("button", { class: "btn ghost git-peek-btn", onclick: closeGitPeek }, "×"),
        ),
      ),
      h(
        "div",
        { class: "git-peek-body" },
        ...hunk.oldLines.map((l) => h("div", { class: "git-peek-line del" }, `- ${l}`)),
        ...hunk.newLines.map((l) => h("div", { class: "git-peek-line add" }, `+ ${l}`)),
      ),
    );

    document.body.append(peek);
    const rect = peek.getBoundingClientRect();
    peek.style.left = `${Math.max(12, Math.min(coords.left + 20, window.innerWidth - rect.width - 12))}px`;
    peek.style.top = `${Math.max(12, Math.min(coords.bottom + 4, window.innerHeight - rect.height - 12))}px`;
    activePeek = peek;

    const onOutside = (ev: MouseEvent) => {
      if (activePeek && !activePeek.contains(ev.target as Node)) {
        closeGitPeek();
      }
    };
    const timer = setTimeout(() => document.addEventListener("mousedown", onOutside));
    activeOutsideCleanup = () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", onOutside);
    };
  }

  return [
    gitHunksField,
    gutter({
      class: "cm-git-gutter",
      markers(view) {
        const hunks = view.state.field(gitHunksField);
        const builder = new RangeSetBuilder<GutterMarker>();
        const doc = view.state.doc;

        const entries: { pos: number; marker: GitGutterMarker }[] = [];
        for (let idx = 0; idx < hunks.length; idx++) {
          const hk = hunks[idx];
          if (hk.kind === "delete") {
            const lineNum = Math.min(doc.lines, Math.max(1, hk.newStart || 1));
            entries.push({ pos: doc.line(lineNum).from, marker: new GitGutterMarker("delete", idx) });
          } else {
            const start = Math.max(1, hk.newStart);
            const end = Math.min(doc.lines, hk.newStart + hk.newCount - 1);
            for (let ln = start; ln <= end; ln++) {
              entries.push({ pos: doc.line(ln).from, marker: new GitGutterMarker(hk.kind, idx) });
            }
          }
        }
        entries.sort((a, b) => a.pos - b.pos);
        let lastPos = -1;
        for (const e of entries) {
          if (e.pos === lastPos) continue;
          lastPos = e.pos;
          builder.add(e.pos, e.pos, e.marker);
        }
        return builder.finish();
      },
      domEventHandlers: {
        mousedown(view, line, event) {
          const target = event.target as HTMLElement | null;
          const idxStr = target?.closest<HTMLElement>("[data-hunk-index]")?.dataset.hunkIndex;
          if (idxStr === undefined) return false;
          const hunks = view.state.field(gitHunksField);
          const hunk = hunks[Number(idxStr)];
          if (!hunk) return false;
          event.preventDefault();
          openPeekAt(view, line.from, hunk);
          return true;
        },
      },
    }),
    EditorView.updateListener.of((u) => {
      if (!deps.isActiveTab()) return;
      const requestedRefresh = u.transactions.some((tr) =>
        tr.effects.some((e) => e.is(requestGitGutterRefreshEffect)),
      );
      if (requestedRefresh) {
        void refreshFromHead(u.view, true);
        return;
      }
      if (u.docChanged) {
        if (recalcTimer) clearTimeout(recalcTimer);
        recalcTimer = setTimeout(() => {
          recalcTimer = null;
          if (deps.isActiveTab()) void refreshFromHead(u.view, false);
        }, 180);
      } else if (u.startState.doc.length === 0 && u.state.doc.length > 0) {
        void refreshFromHead(u.view, true);
      }
    }),
    {
      extension: [],
    },
    EditorView.domEventHandlers({
      focus(_e, view) {
        void refreshFromHead(view, true);
      },
    }),
  ];
}
