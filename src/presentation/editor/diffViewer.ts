import { buildHunkPatch, computeSideBySideRows, type DiffHunk, type DiffPayload } from "../../domain/git";
import { gitClient } from "../../infraestructure/gitClient";
import { h } from "../dom";

export interface DiffHostCallbacks {
  onMutated: (repoRoot: string, relPath: string) => Promise<void>;
  confirmRevert: (message: string, okLabel?: string) => Promise<boolean>;
  onError: (message: string) => Promise<void>;
}

export function createDiffPreviewHost(parent: HTMLElement, cb: DiffHostCallbacks) {
  const root = h("div", { class: "diff-viewer", hidden: true });
  const titleEl = h("div", { class: "diff-title" });
  const statsEl = h("div", { class: "diff-stats" });
  const bodyEl = h("div", { class: "diff-body" });

  root.append(
    h("div", { class: "diff-toolbar" }, titleEl, statsEl),
    bodyEl,
  );
  parent.append(root);

  let activeDiff: DiffPayload | null = null;

  async function runHunkPatch(hunk: DiffHunk, cached: boolean, reverse: boolean) {
    if (!activeDiff) return;
    if (reverse && !cached) {
      const ok = await cb.confirmRevert(
        `¿Revertir este bloque en "${activeDiff.relPath}"?`,
        "Revertir",
      );
      if (!ok) return;
    }
    try {
      const patch = buildHunkPatch(activeDiff.relPath, hunk);
      await gitClient.applyPatch(activeDiff.repoRoot, patch, cached, reverse);
      await cb.onMutated(activeDiff.repoRoot, activeDiff.relPath);
    } catch (e) {
      await cb.onError(`No se pudo aplicar el cambio del bloque.\n\n${String(e)}`);
    }
  }

  function render(diff: DiffPayload) {
    activeDiff = diff;
    const { rows, hunks } = computeSideBySideRows(diff.leftText, diff.rightText);

    titleEl.replaceChildren(
      h("span", { class: "diff-path" }, diff.relPath),
      h("span", { class: "diff-labels" }, `${diff.leftTitle} ↔ ${diff.rightTitle}`),
    );

    const added = hunks.reduce((acc, hk) => acc + hk.newCount, 0);
    const removed = hunks.reduce((acc, hk) => acc + hk.oldCount, 0);
    statsEl.replaceChildren(
      h("span", { class: "diff-stat-add" }, `+${added}`),
      h("span", { class: "diff-stat-del" }, `-${removed}`),
    );

    if (rows.length === 0) {
      bodyEl.replaceChildren(h("div", { class: "diff-empty-msg" }, "Sin diferencias de contenido"));
      return;
    }

    const fragment = document.createDocumentFragment();
    let lastHunkRendered: number | null = null;

    for (const row of rows) {
      if (row.hunkIndex !== null && row.hunkIndex !== lastHunkRendered && diff.mode !== "commit") {
        lastHunkRendered = row.hunkIndex;
        const hunk = hunks[row.hunkIndex];
        const actions = h("div", { class: "diff-hunk-bar" },
          h("span", { class: "diff-hunk-label" }, `Bloque #${row.hunkIndex + 1} (@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@)`),
          h("div", { class: "diff-hunk-actions" },
            ...(diff.mode === "working"
              ? [
                  h("button", { class: "btn ghost diff-btn", onclick: () => void runHunkPatch(hunk, true, false) }, "Stage Range (+)"),
                  h("button", { class: "btn ghost diff-btn", onclick: () => void runHunkPatch(hunk, false, true) }, "Revert Range (↺)"),
                ]
              : [
                  h("button", { class: "btn ghost diff-btn", onclick: () => void runHunkPatch(hunk, true, true) }, "Unstage Range (-)"),
                ]),
          ),
        );
        fragment.append(actions);
      } else if (row.hunkIndex === null) {
        lastHunkRendered = null;
      }

      fragment.append(
        h(
          "div",
          { class: "diff-row" },
          h(
            "div",
            { class: `diff-cell diff-${row.left.type}` },
            h("span", { class: "diff-ln" }, row.left.lineNumber !== null ? String(row.left.lineNumber) : ""),
            h("span", { class: "diff-code" }, row.left.text),
          ),
          h(
            "div",
            { class: `diff-cell diff-${row.right.type}` },
            h("span", { class: "diff-ln" }, row.right.lineNumber !== null ? String(row.right.lineNumber) : ""),
            h("span", { class: "diff-code" }, row.right.text),
          ),
        ),
      );
    }

    bodyEl.replaceChildren(fragment);
  }

  return {
    show(diff: DiffPayload) {
      render(diff);
      root.hidden = false;
    },
    hide() {
      activeDiff = null;
      root.hidden = true;
    },
    getActive: () => activeDiff,
  };
}
