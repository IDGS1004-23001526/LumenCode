import type { AppStore } from "../../application/reducer";
import type { UseCases } from "../../application/useCases";
import type { GitCommitFile, GitCommitInfo, GitFileStatus, GitStashEntry } from "../../domain/git";
import { fileNameOf, joinPath } from "../../domain/path";
import type { AppState } from "../../domain/types";
import { gitClient } from "../../infraestructure/gitClient";
import { animateGitPopoverIn, animateGitPopoverOut } from "../animate";
import { cx, h } from "../dom";

export function mountSourceControl(
  store: AppStore,
  uc: UseCases,
  onError: (msg: string) => Promise<void>,
) {
  let commitMessage = "";
  let amend = false;
  let stashMessage = "";
  let stashOpen = false;
  let historyOpen = false;
  let stashes: GitStashEntry[] = [];
  let commits: GitCommitInfo[] = [];
  const expandedCommits = new Map<string, GitCommitFile[]>();

  const el = h("aside", { class: "git-popover", hidden: true, role: "dialog", "aria-label": "Source Control" });
  const headerActions = h("div", { class: "sc-head-actions" });
  const bodyEl = h("div", { class: "sc-body" });
  el.append(
    h("div", { class: "sidebar-header" }, h("span", { class: "sidebar-title" }, "Source Control"), headerActions),
    bodyEl,
  );
  document.body.append(el);

  const getAnchor = () => document.querySelector<HTMLElement>("[data-git-trigger]");

  function positionPopover() {
    const anchor = getAnchor();
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    el.style.top = `${Math.round(rect.bottom + 6)}px`;
    el.style.right = `${Math.max(8, Math.round(window.innerWidth - rect.right))}px`;
  }

  document.addEventListener("pointerdown", (e) => {
    if (!store.getState().gitOpen) return;
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (el.contains(target) || target.closest("[data-git-trigger]") || target.closest("dialog[open]")) return;
    store.dispatch({ type: "git/open", open: false });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && store.getState().gitOpen && !document.querySelector("dialog[open]")) {
      store.dispatch({ type: "git/open", open: false });
    }
  });

  async function loadExtras(root: string) {
    let nextStashes = stashes;
    let nextCommits = commits;
    if (stashOpen) {
      nextStashes = await gitClient.stashList(root).catch(() => []);
    }
    if (historyOpen) {
      nextCommits = await gitClient.log(root, undefined, 25).catch(() => []);
    }
    if (store.getState().git?.root !== root) return;
    stashes = nextStashes;
    commits = nextCommits;
    render(store.getState());
  }

  function renderFileRow(entry: GitFileStatus, section: "merge" | "staged" | "changes", root: string) {
    const fullPath = joinPath(root, entry.path);
    const name = fileNameOf(entry.path);
    const dir = entry.path.includes("/") ? entry.path.slice(0, entry.path.lastIndexOf("/")) : "";

    const actions: HTMLElement[] = [];
    if (section === "merge") {
      actions.push(
        h("button", { class: "sc-act", title: "Abrir archivo", onclick: (e: MouseEvent) => { e.stopPropagation(); void uc.openFile(fullPath); } }, "✎"),
        h("button", { class: "sc-act", title: "Marcar resuelto (Stage)", onclick: (e: MouseEvent) => { e.stopPropagation(); void uc.gitStage([entry.path]); } }, "+"),
      );
    } else if (section === "staged") {
      actions.push(
        h("button", { class: "sc-act", title: "Unstage", onclick: (e: MouseEvent) => { e.stopPropagation(); void uc.gitUnstage([entry.path]); } }, "−"),
      );
    } else {
      if (entry.status === "U") {
        actions.push(
          h("button", { class: "sc-act", title: "Add to .gitignore", onclick: (e: MouseEvent) => { e.stopPropagation(); void uc.gitAddToGitignore(entry.path); } }, "∅"),
        );
      }
      actions.push(
        h("button", { class: "sc-act", title: "Descartar cambios", onclick: (e: MouseEvent) => { e.stopPropagation(); void uc.gitDiscard(entry); } }, "↺"),
        h("button", { class: "sc-act", title: "Stage", onclick: (e: MouseEvent) => { e.stopPropagation(); void uc.gitStage([entry.path]); } }, "+"),
      );
    }

    return h(
      "div",
      {
        class: "sc-file-row",
        title: entry.path,
        onclick: () => {
          if (section === "merge") void uc.openFile(fullPath);
          else void uc.gitOpenDiff(entry, section === "staged" ? "staged" : "working");
        },
      },
      h("span", { class: "sc-file-name" }, name),
      dir ? h("span", { class: "sc-file-dir" }, dir) : null,
      h("span", { class: "sc-file-actions" }, ...actions),
      h("span", { class: `git-badge git-${entry.status}` }, entry.status),
    );
  }

  function render(s: AppState) {
    const g = s.git;
    headerActions.replaceChildren();

    if (!s.rootPath) {
      bodyEl.replaceChildren(h("div", { class: "sc-empty" }, "Abre una carpeta para usar Git."));
      return;
    }

    if (g && !g.installed) {
      bodyEl.replaceChildren(
        h(
          "div",
          { class: "sc-empty" },
          h("p", {}, "Git no está instalado o no se encuentra en el PATH del sistema."),
          h("p", { class: "muted" }, "Instala Git para habilitar el control de versiones."),
        ),
      );
      return;
    }

    if (!g || !g.is_repo) {
      bodyEl.replaceChildren(
        h(
          "div",
          { class: "sc-empty" },
          h("p", {}, "Esta carpeta aún no es un repositorio Git."),
          h("button", { class: "btn primary", onclick: () => void uc.gitInit() }, "Initialize Repository"),
        ),
      );
      return;
    }

    headerActions.append(
      h("button", { class: "sc-head-btn", title: "Fetch", onclick: () => void uc.gitRemoteOp("fetch") }, "⟳"),
      h("button", { class: "sc-head-btn", title: "Pull", onclick: () => void uc.gitRemoteOp("pull") }, "↓"),
      h("button", { class: "sc-head-btn", title: "Pull (Rebase)", onclick: () => void uc.gitRemoteOp("pull-rebase") }, "⇣"),
      h("button", {
        class: "sc-head-btn",
        disabled: g.detached && !g.upstream,
        title: g.detached && !g.upstream
          ? "HEAD desacoplado: cambia o crea una rama para publicar"
          : g.upstream ? "Push" : "Publicar rama",
        onclick: () => void uc.gitRemoteOp(g.upstream ? "push" : "publish"),
      }, "↑"),
      h("button", { class: "sc-head-btn", title: "Undo Last Commit (HEAD~1)", onclick: () => void uc.gitUndoLastCommit() }, "↶"),
    );

    const nodes: HTMLElement[] = [];

    if (g.op_state === "MERGING" || g.op_state === "REBASING") {
      nodes.push(
        h(
          "div",
          { class: "sc-op-banner" },
          h("span", {}, `${g.op_state} en curso`),
          h(
            "button",
            {
              class: "btn ghost sc-mini-btn",
              onclick: () => void uc.gitRemoteOp(g.op_state === "MERGING" ? "abort-merge" : "abort-rebase"),
            },
            "Abortar",
          ),
        ),
      );
    }

    const msgInput = h("textarea", {
      class: "field sc-commit-input",
      placeholder: `Mensaje de commit (${g.branch})... Ctrl+Enter`,
      rows: "2",
      value: commitMessage,
    }) as HTMLTextAreaElement;
    msgInput.value = commitMessage;
    msgInput.addEventListener("input", () => { commitMessage = msgInput.value; });

    const doCommit = async (pushAfter: boolean) => {
      const ok = await uc.gitCommit(commitMessage, amend, pushAfter);
      if (ok) {
        commitMessage = "";
        amend = false;
        render(store.getState());
      }
    };

    msgInput.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        void doCommit(false);
      }
    });

    const amendCheck = h("input", { type: "checkbox", checked: amend }) as HTMLInputElement;
    amendCheck.checked = amend;
    amendCheck.addEventListener("change", () => { amend = amendCheck.checked; });

    nodes.push(
      h(
        "div",
        { class: "sc-commit-box" },
        msgInput,
        h(
          "label",
          { class: "sc-amend-row" },
          amendCheck,
          h("span", {}, "Commit (Amend)"),
        ),
        h(
          "div",
          { class: "sc-commit-btns" },
          h("button", { class: "btn primary sc-commit-main", onclick: () => void doCommit(false) }, "Commit"),
          h("button", { class: "btn ghost", title: "Commit y Push", onclick: () => void doCommit(true) }, "Commit & Push"),
        ),
      ),
    );

    const mergeEntries = g.entries.filter((e) => e.conflicted);
    const stagedEntries = g.entries.filter((e) => !e.conflicted && e.staged);
    const changeEntries = g.entries.filter((e) => !e.conflicted && e.unstaged);

    if (mergeEntries.length > 0) {
      nodes.push(
        h(
          "div",
          { class: "sc-section" },
          h("div", { class: "sc-section-head" }, h("span", {}, `Merge Changes (${mergeEntries.length})`)),
          ...mergeEntries.map((e) => renderFileRow(e, "merge", g.root)),
        ),
      );
    }

    if (stagedEntries.length > 0) {
      nodes.push(
        h(
          "div",
          { class: "sc-section" },
          h(
            "div",
            { class: "sc-section-head" },
            h("span", {}, `Staged Changes (${stagedEntries.length})`),
            h("button", { class: "sc-act", title: "Unstage All", onclick: () => void uc.gitUnstage([]) }, "−"),
          ),
          ...stagedEntries.map((e) => renderFileRow(e, "staged", g.root)),
        ),
      );
    }

    nodes.push(
      h(
        "div",
        { class: "sc-section" },
        h(
          "div",
          { class: "sc-section-head" },
          h("span", {}, `Changes (${changeEntries.length})`),
          changeEntries.length > 0
            ? h("button", { class: "sc-act", title: "Stage All", onclick: () => void uc.gitStage([]) }, "+")
            : null,
        ),
        ...(changeEntries.length > 0
          ? changeEntries.map((e) => renderFileRow(e, "changes", g.root))
          : [h("div", { class: "sc-none" }, "Sin cambios pendientes")]),
      ),
    );

    const stashInput = h("input", {
      class: "field sc-stash-input",
      placeholder: "Mensaje de stash (opcional)...",
      value: stashMessage,
    }) as HTMLInputElement;
    stashInput.value = stashMessage;
    stashInput.addEventListener("input", () => { stashMessage = stashInput.value; });

    const runStashPush = async () => {
      try {
        await gitClient.stashPush(g.root, stashMessage, true);
        stashMessage = "";
        await uc.refresh();
        await loadExtras(g.root);
      } catch (e) {
        await onError(`No se pudo crear el stash.\n\n${String(e)}`);
      }
    };

    const runStashOp = async (op: "apply" | "pop" | "drop", refName: string) => {
      try {
        await gitClient.stashOp(g.root, op, refName);
        await uc.refresh();
        await loadExtras(g.root);
      } catch (e) {
        await onError(`No se pudo ejecutar stash ${op}.\n\n${String(e)}`);
      }
    };

    nodes.push(
      h(
        "div",
        { class: "sc-section" },
        h(
          "button",
          {
            class: "sc-section-toggle",
            onclick: () => {
              stashOpen = !stashOpen;
              if (stashOpen) void loadExtras(g.root);
              else render(store.getState());
            },
          },
          h("span", {}, `${stashOpen ? "▾" : "▸"} Stashes`),
        ),
        ...(stashOpen
          ? [
              h(
                "div",
                { class: "sc-stash-create" },
                stashInput,
                h("button", { class: "btn ghost sc-mini-btn", onclick: () => void runStashPush() }, "Stash"),
              ),
              ...(stashes.length > 0
                ? stashes.map((st) =>
                    h(
                      "div",
                      { class: "sc-stash-row", title: st.message },
                      h("span", { class: "sc-stash-msg" }, st.message || st.ref_name),
                      h(
                        "div",
                        { class: "sc-file-actions" },
                        h("button", { class: "sc-act", title: "Apply", onclick: () => void runStashOp("apply", st.ref_name) }, "▶"),
                        h("button", { class: "sc-act", title: "Pop", onclick: () => void runStashOp("pop", st.ref_name) }, "↥"),
                        h("button", { class: "sc-act", title: "Drop", onclick: () => void runStashOp("drop", st.ref_name) }, "×"),
                      ),
                    ),
                  )
                : [h("div", { class: "sc-none" }, "Sin stashes guardados")]),
            ]
          : []),
      ),
    );

    nodes.push(
      h(
        "div",
        { class: "sc-section" },
        h(
          "button",
          {
            class: "sc-section-toggle",
            onclick: () => {
              historyOpen = !historyOpen;
              if (historyOpen) void loadExtras(g.root);
              else render(store.getState());
            },
          },
          h("span", {}, `${historyOpen ? "▾" : "▸"} Historial de commits`),
        ),
        ...(historyOpen
          ? commits.length > 0
            ? commits.map((c) => {
                const files = expandedCommits.get(c.hash);
                return h(
                  "div",
                  { class: "sc-commit-item" },
                  h(
                    "button",
                    {
                      class: cx("sc-commit-row", Boolean(files) && "open"),
                      onclick: async () => {
                        if (expandedCommits.has(c.hash)) {
                          expandedCommits.delete(c.hash);
                        } else {
                          const list = await gitClient.commitFiles(g.root, c.hash).catch(() => []);
                          if (store.getState().git?.root !== g.root) return;
                          expandedCommits.set(c.hash, list);
                        }
                        render(store.getState());
                      },
                    },
                    h("span", { class: "sc-commit-msg" }, c.message),
                    h("span", { class: "sc-commit-meta" }, `${c.short_hash} · ${c.author} · ${c.date}`),
                  ),
                  ...(files
                    ? files.map((f) =>
                        h(
                          "button",
                          {
                            class: "sc-commit-file",
                            onclick: () => void uc.gitOpenCommitDiff(c.hash, f),
                          },
                          h("span", { class: "sc-file-name" }, f.path),
                          h("span", { class: `git-badge git-${f.status}` }, f.status),
                        ),
                      )
                    : []),
                );
              })
            : [h("div", { class: "sc-none" }, "Sin commits registrados")]
          : []),
      ),
    );

    const activeEl = document.activeElement;
    const focusedSelector =
      activeEl instanceof HTMLTextAreaElement && activeEl.classList.contains("sc-commit-input")
        ? ".sc-commit-input"
        : activeEl instanceof HTMLInputElement && activeEl.classList.contains("sc-stash-input")
          ? ".sc-stash-input"
          : null;
    const selStart = focusedSelector && (activeEl as HTMLInputElement | HTMLTextAreaElement).selectionStart;
    const selEnd = focusedSelector && (activeEl as HTMLInputElement | HTMLTextAreaElement).selectionEnd;

    bodyEl.replaceChildren(...nodes);

    if (focusedSelector) {
      const nextInput = bodyEl.querySelector<HTMLInputElement | HTMLTextAreaElement>(focusedSelector);
      if (nextInput) {
        nextInput.focus({ preventScroll: true });
        if (typeof selStart === "number" && typeof selEnd === "number") {
          nextInput.setSelectionRange(selStart, selEnd);
        }
      }
    }
  }

  render(store.getState());
  store.subscribe((s, p) => {
    if (s.rootPath !== p.rootPath) {
      commitMessage = "";
      amend = false;
      stashMessage = "";
      stashes = [];
      commits = [];
      expandedCommits.clear();
    }
    if (s.gitOpen !== p.gitOpen) {
      const anchor = getAnchor();
      if (s.gitOpen) {
        render(s);
        el.hidden = false;
        positionPopover();
        animateGitPopoverIn(el, anchor);
      } else {
        animateGitPopoverOut(el, anchor, () => {
          if (!store.getState().gitOpen) el.hidden = true;
        });
      }
    }
    if (s.git !== p.git || s.rootPath !== p.rootPath) {
      render(s);
      if (s.git?.is_repo && (stashOpen || historyOpen)) {
        void loadExtras(s.git.root);
      }
    }
  });
}
