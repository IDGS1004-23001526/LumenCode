import { invoke } from "@tauri-apps/api/core";
import type {
  GitBranches,
  GitCommitFile,
  GitCommitInfo,
  GitStashEntry,
  GitStatus,
} from "../domain/git";

export function toRelativeRepoPath(repoRoot: string, fullPath: string): string | null {
  const normRoot = repoRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  const normFile = fullPath.replace(/\\/g, "/");
  const prefix = `${normRoot}/`;
  const isWin = /^[A-Za-z]:/.test(normRoot);
  if (isWin ? normFile.toLowerCase().startsWith(prefix.toLowerCase()) : normFile.startsWith(prefix)) {
    return normFile.slice(prefix.length);
  }
  return null;
}

class GitClient {
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  status(rootPath: string): Promise<GitStatus> {
    return invoke<GitStatus>("git_status", { rootPath });
  }

  scheduleRefresh(rootPath: string, onResult: (st: GitStatus) => void, delayMs = 220): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.status(rootPath).then(onResult).catch(() => {});
    }, delayMs);
  }

  cancelScheduledRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  init(rootPath: string): Promise<void> {
    return invoke("git_init", { rootPath });
  }

  stage(rootPath: string, paths: string[]): Promise<void> {
    return invoke("git_stage", { rootPath, paths });
  }

  unstage(rootPath: string, paths: string[]): Promise<void> {
    return invoke("git_unstage", { rootPath, paths });
  }

  discard(rootPath: string, paths: string[], untracked: boolean): Promise<void> {
    return invoke("git_discard", { rootPath, paths, untracked });
  }

  commit(rootPath: string, message: string, amend = false): Promise<void> {
    return invoke("git_commit", { rootPath, message, amend });
  }

  undoLastCommit(rootPath: string): Promise<void> {
    return invoke("git_undo_last_commit", { rootPath });
  }

  branches(rootPath: string): Promise<GitBranches> {
    return invoke<GitBranches>("git_branches", { rootPath });
  }

  checkout(rootPath: string, branch: string, create = false): Promise<void> {
    return invoke("git_checkout", { rootPath, branch, create });
  }

  renameBranch(rootPath: string, oldName: string, newName: string): Promise<void> {
    return invoke("git_rename_branch", { rootPath, oldName, newName });
  }

  deleteBranch(rootPath: string, name: string, force = false): Promise<void> {
    return invoke("git_delete_branch", { rootPath, name, force });
  }

  remoteOp(
    rootPath: string,
    op: "fetch" | "pull" | "pull-rebase" | "push" | "publish" | "sync" | "abort-merge" | "abort-rebase",
    branch?: string,
  ): Promise<string> {
    return invoke<string>("git_remote_op", { rootPath, op, branch: branch ?? null });
  }

  showFile(rootPath: string, rev: string, relPath: string): Promise<string> {
    return invoke<string>("git_show_file", { rootPath, rev, relPath });
  }

  applyPatch(rootPath: string, patch: string, cached: boolean, reverse: boolean): Promise<void> {
    return invoke("git_apply_patch", { rootPath, patch, cached, reverse });
  }

  stashList(rootPath: string): Promise<GitStashEntry[]> {
    return invoke<GitStashEntry[]>("git_stash_list", { rootPath });
  }

  stashPush(rootPath: string, message?: string, includeUntracked = true): Promise<void> {
    return invoke("git_stash_push", { rootPath, message: message ?? null, includeUntracked });
  }

  stashOp(rootPath: string, op: "apply" | "pop" | "drop", refName: string): Promise<void> {
    return invoke("git_stash_op", { rootPath, op, refName });
  }

  log(rootPath: string, relPath?: string, limit = 30): Promise<GitCommitInfo[]> {
    return invoke<GitCommitInfo[]>("git_log", { rootPath, relPath: relPath ?? null, limit });
  }

  commitFiles(rootPath: string, hash: string): Promise<GitCommitFile[]> {
    return invoke<GitCommitFile[]>("git_commit_files", { rootPath, hash });
  }

  addGitignore(rootPath: string, pattern: string): Promise<void> {
    return invoke("git_add_gitignore", { rootPath, pattern });
  }
}

export const gitClient = new GitClient();
