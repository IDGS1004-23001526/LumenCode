export type GitStatusCode = "M" | "U" | "A" | "D" | "R" | "C";

export interface GitFileStatus {
  path: string;
  orig_path: string | null;
  index_status: string;
  worktree_status: string;
  status: GitStatusCode;
  staged: boolean;
  unstaged: boolean;
  conflicted: boolean;
}

export interface GitStatus {
  installed: boolean;
  is_repo: boolean;
  root: string;
  branch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  detached: boolean;
  op_state: string | null;
  entries: GitFileStatus[];
}

export interface GitBranches {
  current: string;
  local: string[];
  remote: string[];
}

export interface GitStashEntry {
  index: number;
  ref_name: string;
  message: string;
}

export interface GitCommitInfo {
  hash: string;
  short_hash: string;
  author: string;
  date: string;
  message: string;
}

export interface GitCommitFile {
  status: string;
  path: string;
  old_path: string | null;
}

export type DiffHunkKind = "add" | "modify" | "delete";

export interface DiffHunk {
  kind: DiffHunkKind;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  oldLines: string[];
  newLines: string[];
}

export interface DiffSideLine {
  type: "context" | "add" | "del" | "empty";
  lineNumber: number | null;
  text: string;
}

export interface DiffRow {
  left: DiffSideLine;
  right: DiffSideLine;
  hunkIndex: number | null;
}

export interface DiffPayload {
  id: string;
  title: string;
  relPath: string;
  repoRoot: string;
  leftTitle: string;
  rightTitle: string;
  leftText: string;
  rightText: string;
  mode: "working" | "staged" | "commit";
}

function splitLines(text: string): string[] {
  if (!text) return [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

interface RawOp {
  type: "eq" | "del" | "add";
  oldIdx: number;
  newIdx: number;
  text: string;
}

function computeOps(a: string[], b: string[]): RawOp[] {
  const n = a.length;
  const m = b.length;

  // Para archivos muy grandes evita matriz cuadrática
  if (n * m > 1_200_000) {
    const ops: RawOp[] = [];
    const min = Math.min(n, m);
    let prefix = 0;
    while (prefix < min && a[prefix] === b[prefix]) {
      ops.push({ type: "eq", oldIdx: prefix, newIdx: prefix, text: a[prefix] });
      prefix++;
    }
    let suffix = 0;
    while (suffix < min - prefix && a[n - 1 - suffix] === b[m - 1 - suffix]) {
      suffix++;
    }
    for (let i = prefix; i < n - suffix; i++) {
      ops.push({ type: "del", oldIdx: i, newIdx: prefix, text: a[i] });
    }
    for (let j = prefix; j < m - suffix; j++) {
      ops.push({ type: "add", oldIdx: n - suffix, newIdx: j, text: b[j] });
    }
    for (let k = 0; k < suffix; k++) {
      ops.push({ type: "eq", oldIdx: n - suffix + k, newIdx: m - suffix + k, text: a[n - suffix + k] });
    }
    return ops;
  }

  const dp = new Int32Array((n + 1) * (m + 1));
  const w = m + 1;
  for (let i = n - 1; i >= 0; i--) {
    const row = i * w;
    const nextRow = (i + 1) * w;
    for (let j = m - 1; j >= 0; j--) {
      dp[row + j] = a[i] === b[j]
        ? dp[nextRow + j + 1] + 1
        : Math.max(dp[nextRow + j], dp[row + j + 1]);
    }
  }

  const ops: RawOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: "eq", oldIdx: i, newIdx: j, text: a[i] });
      i++;
      j++;
    } else if (dp[(i + 1) * w + j] >= dp[i * w + (j + 1)]) {
      ops.push({ type: "del", oldIdx: i, newIdx: j, text: a[i] });
      i++;
    } else {
      ops.push({ type: "add", oldIdx: i, newIdx: j, text: b[j] });
      j++;
    }
  }
  while (i < n) {
    ops.push({ type: "del", oldIdx: i, newIdx: j, text: a[i] });
    i++;
  }
  while (j < m) {
    ops.push({ type: "add", oldIdx: i, newIdx: j, text: b[j] });
    j++;
  }
  return ops;
}

export function computeDiffHunks(originalText: string, modifiedText: string): DiffHunk[] {
  const a = splitLines(originalText);
  const b = splitLines(modifiedText);
  const ops = computeOps(a, b);
  const hunks: DiffHunk[] = [];

  let i = 0;
  while (i < ops.length) {
    if (ops[i].type === "eq") {
      i++;
      continue;
    }

    const oldLines: string[] = [];
    const newLines: string[] = [];
    const firstOld = ops[i].oldIdx;
    const firstNew = ops[i].newIdx;

    while (i < ops.length && ops[i].type !== "eq") {
      if (ops[i].type === "del") oldLines.push(ops[i].text);
      else newLines.push(ops[i].text);
      i++;
    }

    const kind: DiffHunkKind =
      oldLines.length > 0 && newLines.length > 0
        ? "modify"
        : newLines.length > 0
          ? "add"
          : "delete";

    hunks.push({
      kind,
      oldStart: oldLines.length > 0 ? firstOld + 1 : firstOld,
      oldCount: oldLines.length,
      newStart: newLines.length > 0 ? firstNew + 1 : firstNew,
      newCount: newLines.length,
      oldLines,
      newLines,
    });
  }

  return hunks;
}

export function computeSideBySideRows(originalText: string, modifiedText: string): {
  rows: DiffRow[];
  hunks: DiffHunk[];
} {
  const a = splitLines(originalText);
  const b = splitLines(modifiedText);
  const ops = computeOps(a, b);
  const rows: DiffRow[] = [];
  const hunks: DiffHunk[] = [];

  let i = 0;
  while (i < ops.length) {
    if (ops[i].type === "eq") {
      rows.push({
        left: { type: "context", lineNumber: ops[i].oldIdx + 1, text: ops[i].text },
        right: { type: "context", lineNumber: ops[i].newIdx + 1, text: ops[i].text },
        hunkIndex: null,
      });
      i++;
      continue;
    }

    const hunkIndex = hunks.length;
    const firstOld = ops[i].oldIdx;
    const firstNew = ops[i].newIdx;
    const dels: { line: number; text: string }[] = [];
    const adds: { line: number; text: string }[] = [];

    while (i < ops.length && ops[i].type !== "eq") {
      if (ops[i].type === "del") dels.push({ line: ops[i].oldIdx + 1, text: ops[i].text });
      else adds.push({ line: ops[i].newIdx + 1, text: ops[i].text });
      i++;
    }

    hunks.push({
      kind: dels.length > 0 && adds.length > 0 ? "modify" : adds.length > 0 ? "add" : "delete",
      oldStart: dels.length > 0 ? firstOld + 1 : firstOld,
      oldCount: dels.length,
      newStart: adds.length > 0 ? firstNew + 1 : firstNew,
      newCount: adds.length,
      oldLines: dels.map((d) => d.text),
      newLines: adds.map((ad) => ad.text),
    });

    const maxLen = Math.max(dels.length, adds.length);
    for (let k = 0; k < maxLen; k++) {
      const d = dels[k];
      const ad = adds[k];
      rows.push({
        left: d ? { type: "del", lineNumber: d.line, text: d.text } : { type: "empty", lineNumber: null, text: "" },
        right: ad ? { type: "add", lineNumber: ad.line, text: ad.text } : { type: "empty", lineNumber: null, text: "" },
        hunkIndex,
      });
    }
  }

  return { rows, hunks };
}

export function buildHunkPatch(relPath: string, hunk: DiffHunk): string {
  const cleanPath = relPath.replace(/\\/g, "/");
  const lines = [
    `--- a/${cleanPath}`,
    `+++ b/${cleanPath}`,
    `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`,
    ...hunk.oldLines.map((l) => `-${l}`),
    ...hunk.newLines.map((l) => `+${l}`),
  ];
  return lines.join("\n") + "\n";
}
