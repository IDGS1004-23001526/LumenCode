use serde::Serialize;
use std::collections::BTreeSet;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[derive(Serialize, Clone)]
pub struct GitFileStatus {
    pub path: String,
    pub orig_path: Option<String>,
    pub index_status: String,
    pub worktree_status: String,
    pub status: String,
    pub staged: bool,
    pub unstaged: bool,
    pub conflicted: bool,
}

#[derive(Serialize, Clone)]
pub struct GitStatusResult {
    pub installed: bool,
    pub is_repo: bool,
    pub root: String,
    pub branch: String,
    pub upstream: Option<String>,
    pub ahead: i32,
    pub behind: i32,
    pub detached: bool,
    pub op_state: Option<String>,
    pub entries: Vec<GitFileStatus>,
}

#[derive(Serialize)]
pub struct GitBranchesResult {
    pub current: String,
    pub local: Vec<String>,
    pub remote: Vec<String>,
}

#[derive(Serialize)]
pub struct GitStashEntry {
    pub index: usize,
    pub ref_name: String,
    pub message: String,
}

#[derive(Serialize)]
pub struct GitCommitInfo {
    pub hash: String,
    pub short_hash: String,
    pub author: String,
    pub date: String,
    pub message: String,
}

#[derive(Serialize)]
pub struct GitCommitFile {
    pub status: String,
    pub path: String,
    pub old_path: Option<String>,
}

fn git_cmd(cwd: &str) -> Command {
    let mut cmd = Command::new("git");
    cmd.current_dir(cwd)
        .args(["-c", "core.quotepath=false"])
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "never")
        .env("LC_ALL", "C");
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(0x08000000);
    }
    cmd
}

fn run_git(cwd: &str, args: &[&str]) -> Result<String, String> {
    let out = git_cmd(cwd)
        .args(args)
        .output()
        .map_err(|e| format!("No se pudo ejecutar git: {}", e))?;

    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    } else {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
        Err(if !err.is_empty() { err } else { stdout })
    }
}

fn is_git_installed() -> bool {
    let mut cmd = Command::new("git");
    cmd.arg("--version");
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(0x08000000);
    }
    cmd.output().map(|o| o.status.success()).unwrap_or(false)
}

fn detect_op_state(repo_root: &str) -> Option<String> {
    let git_dir_out = run_git(repo_root, &["rev-parse", "--git-dir"]).ok()?;
    let git_dir_trimmed = git_dir_out.trim();
    let git_dir = if Path::new(git_dir_trimmed).is_absolute() {
        Path::new(git_dir_trimmed).to_path_buf()
    } else {
        Path::new(repo_root).join(git_dir_trimmed)
    };

    if git_dir.join("rebase-merge").exists() || git_dir.join("rebase-apply").exists() {
        return Some("REBASING".to_string());
    }
    if git_dir.join("MERGE_HEAD").exists() {
        return Some("MERGING".to_string());
    }
    if git_dir.join("CHERRY_PICK_HEAD").exists() {
        return Some("CHERRY-PICKING".to_string());
    }
    if git_dir.join("REVERT_HEAD").exists() {
        return Some("REVERTING".to_string());
    }
    if git_dir.join("BISECT_LOG").exists() {
        return Some("BISECTING".to_string());
    }
    None
}

fn classify_code(x: char, y: char, conflicted: bool) -> String {
    if conflicted {
        return "C".to_string();
    }
    if x == '?' && y == '?' {
        return "U".to_string();
    }
    if x == 'R' || y == 'R' {
        return "R".to_string();
    }
    if x == 'D' || y == 'D' {
        return "D".to_string();
    }
    if x == 'A' {
        return "A".to_string();
    }
    if x == 'M' || y == 'M' || x == 'T' || y == 'T' {
        return "M".to_string();
    }
    "M".to_string()
}

fn parse_porcelain_v2(raw: &str, repo_root: &str) -> GitStatusResult {
    let mut branch = "HEAD".to_string();
    let mut upstream: Option<String> = None;
    let mut ahead = 0;
    let mut behind = 0;
    let mut detached = false;
    let mut entries: Vec<GitFileStatus> = Vec::new();

    for line in raw.lines() {
        if let Some(rest) = line.strip_prefix("# branch.head ") {
            if rest == "(detached)" {
                detached = true;
                branch = "HEAD (detached)".to_string();
            } else {
                branch = rest.to_string();
            }
        } else if let Some(rest) = line.strip_prefix("# branch.upstream ") {
            upstream = Some(rest.to_string());
        } else if let Some(rest) = line.strip_prefix("# branch.ab ") {
            for part in rest.split_whitespace() {
                if let Some(a) = part.strip_prefix('+') {
                    ahead = a.parse::<i32>().unwrap_or(0);
                } else if let Some(b) = part.strip_prefix('-') {
                    behind = b.parse::<i32>().unwrap_or(0);
                }
            }
        } else if let Some(rest) = line.strip_prefix("1 ") {
            let parts: Vec<&str> = rest.splitn(8, ' ').collect();
            if parts.len() == 8 {
                let xy: Vec<char> = parts[0].chars().collect();
                let x = *xy.first().unwrap_or(&'.');
                let y = *xy.get(1).unwrap_or(&'.');
                let path = parts[7].to_string();
                entries.push(GitFileStatus {
                    path,
                    orig_path: None,
                    index_status: x.to_string(),
                    worktree_status: y.to_string(),
                    status: classify_code(x, y, false),
                    staged: x != '.',
                    unstaged: y != '.',
                    conflicted: false,
                });
            }
        } else if let Some(rest) = line.strip_prefix("2 ") {
            let parts: Vec<&str> = rest.splitn(9, ' ').collect();
            if parts.len() == 9 {
                let xy: Vec<char> = parts[0].chars().collect();
                let x = *xy.first().unwrap_or(&'.');
                let y = *xy.get(1).unwrap_or(&'.');
                let mut paths = parts[8].split('\t');
                let path = paths.next().unwrap_or("").to_string();
                let orig = paths.next().map(|s| s.to_string());
                entries.push(GitFileStatus {
                    path,
                    orig_path: orig,
                    index_status: x.to_string(),
                    worktree_status: y.to_string(),
                    status: classify_code(x, y, false),
                    staged: x != '.',
                    unstaged: y != '.',
                    conflicted: false,
                });
            }
        } else if let Some(rest) = line.strip_prefix("u ") {
            let parts: Vec<&str> = rest.splitn(10, ' ').collect();
            if parts.len() == 10 {
                let xy: Vec<char> = parts[0].chars().collect();
                let x = *xy.first().unwrap_or(&'U');
                let y = *xy.get(1).unwrap_or(&'U');
                entries.push(GitFileStatus {
                    path: parts[9].to_string(),
                    orig_path: None,
                    index_status: x.to_string(),
                    worktree_status: y.to_string(),
                    status: "C".to_string(),
                    staged: false,
                    unstaged: true,
                    conflicted: true,
                });
            }
        } else if let Some(path) = line.strip_prefix("? ") {
            entries.push(GitFileStatus {
                path: path.to_string(),
                orig_path: None,
                index_status: "?".to_string(),
                worktree_status: "?".to_string(),
                status: "U".to_string(),
                staged: false,
                unstaged: true,
                conflicted: false,
            });
        }
    }

    if detached {
        if let Ok(sha) = run_git(repo_root, &["rev-parse", "--short", "HEAD"]) {
            let s = sha.trim();
            if !s.is_empty() {
                branch = format!("HEAD ({})", s);
            }
        }
    }

    GitStatusResult {
        installed: true,
        is_repo: true,
        root: repo_root.to_string(),
        branch,
        upstream,
        ahead,
        behind,
        detached,
        op_state: detect_op_state(repo_root),
        entries,
    }
}

#[tauri::command]
pub async fn git_status(root_path: String) -> Result<GitStatusResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !is_git_installed() {
            return Ok(GitStatusResult {
                installed: false,
                is_repo: false,
                root: root_path,
                branch: String::new(),
                upstream: None,
                ahead: 0,
                behind: 0,
                detached: false,
                op_state: None,
                entries: Vec::new(),
            });
        }

        let top = match run_git(&root_path, &["rev-parse", "--show-toplevel"]) {
            Ok(p) => {
                let trimmed = p.trim();
                #[cfg(target_os = "windows")]
                let normalized = {
                    let mut s = trimmed.replace('/', "\\");
                    if s.len() >= 2 && s.as_bytes()[1] == b':' {
                        let first = (s.as_bytes()[0] as char).to_ascii_uppercase();
                        s.replace_range(0..1, &first.to_string());
                    }
                    s
                };
                #[cfg(not(target_os = "windows"))]
                let normalized = trimmed.to_string();
                normalized
            }
            Err(_) => {
                return Ok(GitStatusResult {
                    installed: true,
                    is_repo: false,
                    root: root_path,
                    branch: String::new(),
                    upstream: None,
                    ahead: 0,
                    behind: 0,
                    detached: false,
                    op_state: None,
                    entries: Vec::new(),
                });
            }
        };

        let raw = run_git(&top, &["status", "--porcelain=v2", "--branch", "-uall"])?;
        Ok(parse_porcelain_v2(&raw, &top))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_init(root_path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        run_git(&root_path, &["init"])?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/** Valida que una ruta sea estrictamente relativa al repositorio (sin `..`, `.`, prefijos de unidad ni `/` inicial). */
pub(crate) fn validate_repo_rel_path(rel: &str) -> Result<PathBuf, String> {
    if rel.is_empty() || rel.chars().any(|c| c.is_control()) {
        return Err("Ruta de archivo inválida".to_string());
    }
    if rel.starts_with('-') || rel.starts_with('/') || rel.starts_with('\\') {
        return Err(format!("Ruta relativa no permitida: {rel}"));
    }
    let normalized = rel.replace('\\', "/");
    let mut clean = PathBuf::new();
    let mut count = 0usize;
    for comp in Path::new(&normalized).components() {
        match comp {
            std::path::Component::Normal(part) if !part.is_empty() => {
                clean.push(part);
                count += 1;
            }
            _ => return Err(format!("Ruta fuera del repositorio o no válida: {rel}")),
        }
    }
    if count == 0 {
        return Err("Ruta vacía".to_string());
    }
    Ok(clean)
}

/** Valida nombres de rama, revisiones, hashes y referencias de stash contra inyección de flags (`-...`) o caracteres de control. */
pub(crate) fn validate_git_ref_arg<'a>(val: &'a str, label: &str) -> Result<&'a str, String> {
    let trimmed = val.trim();
    if trimmed.is_empty() {
        return Err(format!("El valor de {label} no puede estar vacío"));
    }
    if trimmed.starts_with('-') || trimmed.contains("..") || trimmed.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err(format!("Valor de {label} no permitido: {trimmed}"));
    }
    Ok(trimmed)
}

#[tauri::command]
pub async fn git_stage(root_path: String, paths: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if paths.is_empty() {
            run_git(&root_path, &["add", "-A"])?;
            return Ok(());
        }
        for p in &paths {
            validate_repo_rel_path(p)?;
        }
        let mut args = vec!["add", "--"];
        let refs: Vec<&str> = paths.iter().map(|s| s.as_str()).collect();
        args.extend(refs);
        run_git(&root_path, &args)?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_unstage(root_path: String, paths: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let has_head = run_git(&root_path, &["rev-parse", "--verify", "HEAD"]).is_ok();
        if paths.is_empty() {
            if has_head {
                run_git(&root_path, &["reset", "HEAD"])?;
            } else {
                run_git(&root_path, &["rm", "-r", "-f", "--cached", "--", "."])?;
            }
            return Ok(());
        }
        for p in &paths {
            validate_repo_rel_path(p)?;
        }
        let mut args = if has_head {
            vec!["reset", "HEAD", "--"]
        } else {
            vec!["rm", "-f", "--cached", "--"]
        };
        let refs: Vec<&str> = paths.iter().map(|s| s.as_str()).collect();
        args.extend(refs);
        run_git(&root_path, &args)?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_discard(root_path: String, paths: Vec<String>, untracked: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if paths.is_empty() {
            return Ok(());
        }
        if untracked {
            let root_canon = fs::canonicalize(&root_path).map_err(|e| e.to_string())?;
            for rel in &paths {
                let clean_rel = validate_repo_rel_path(rel)?;
                // Verifica que ningún directorio padre intermedio sea un symlink que escape del repo
                let mut cur = root_canon.clone();
                let comps: Vec<_> = clean_rel.components().collect();
                for parent_comp in &comps[..comps.len().saturating_sub(1)] {
                    cur.push(parent_comp);
                    if let Ok(m) = fs::symlink_metadata(&cur) {
                        if m.file_type().is_symlink() {
                            return Err(format!("No se permite atravesar enlaces simbólicos: {rel}"));
                        }
                    }
                }
                let target = root_canon.join(&clean_rel);
                let Ok(meta) = fs::symlink_metadata(&target) else {
                    continue;
                };
                if meta.file_type().is_symlink() {
                    #[cfg(target_os = "windows")]
                    {
                        fs::remove_file(&target)
                            .or_else(|_| fs::remove_dir(&target))
                            .map_err(|e| e.to_string())?;
                    }
                    #[cfg(not(target_os = "windows"))]
                    {
                        fs::remove_file(&target).map_err(|e| e.to_string())?;
                    }
                } else if meta.is_dir() {
                    let target_canon = fs::canonicalize(&target).map_err(|e| e.to_string())?;
                    if !target_canon.starts_with(&root_canon) || target_canon == root_canon {
                        return Err(format!("Ruta fuera del repositorio: {rel}"));
                    }
                    fs::remove_dir_all(&target_canon).map_err(|e| e.to_string())?;
                } else {
                    fs::remove_file(&target).map_err(|e| e.to_string())?;
                }
            }
            return Ok(());
        }
        for p in &paths {
            validate_repo_rel_path(p)?;
        }
        let mut args = vec!["checkout", "--"];
        let refs: Vec<&str> = paths.iter().map(|s| s.as_str()).collect();
        args.extend(refs);
        run_git(&root_path, &args)?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_commit(root_path: String, message: String, amend: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut args = vec!["commit", "-m", message.as_str()];
        if amend {
            args.push("--amend");
        }
        run_git(&root_path, &args)?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_undo_last_commit(root_path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        run_git(&root_path, &["reset", "--soft", "HEAD~1"])?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_branches(root_path: String) -> Result<GitBranchesResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let current = run_git(&root_path, &["branch", "--show-current"])
            .unwrap_or_default()
            .trim()
            .to_string();
        let local_raw = run_git(&root_path, &["for-each-ref", "--format=%(refname:short)", "refs/heads"]).unwrap_or_default();
        let remote_raw = run_git(&root_path, &["branch", "-r", "--format=%(refname:short)"]).unwrap_or_default();

        let local: Vec<String> = local_raw
            .lines()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty() && !s.starts_with('('))
            .collect();
        let mut remote_set = BTreeSet::new();
        for line in remote_raw.lines() {
            let trimmed = line.trim();
            if !trimmed.is_empty() && !trimmed.ends_with("/HEAD") {
                remote_set.insert(trimmed.to_string());
            }
        }

        Ok(GitBranchesResult {
            current,
            local,
            remote: remote_set.into_iter().collect(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_checkout(root_path: String, branch: String, create: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let b = validate_git_ref_arg(&branch, "rama")?;
        if create {
            run_git(&root_path, &["checkout", "-b", b])?;
        } else {
            run_git(&root_path, &["checkout", b])?;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_rename_branch(root_path: String, old_name: String, new_name: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let old_b = validate_git_ref_arg(&old_name, "rama actual")?;
        let new_b = validate_git_ref_arg(&new_name, "nueva rama")?;
        run_git(&root_path, &["branch", "-m", old_b, new_b])?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_delete_branch(root_path: String, name: String, force: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let b = validate_git_ref_arg(&name, "rama")?;
        let flag = if force { "-D" } else { "-d" };
        run_git(&root_path, &["branch", flag, b])?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_remote_op(root_path: String, op: String, branch: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || match op.as_str() {
        "fetch" => run_git(&root_path, &["fetch", "--all", "--prune"]),
        "pull" => run_git(&root_path, &["pull"]),
        "pull-rebase" => run_git(&root_path, &["pull", "--rebase"]),
        "push" => run_git(&root_path, &["push"]),
        "publish" => {
            let raw_b = branch.unwrap_or_default();
            if raw_b.trim().is_empty() {
                return Err("No hay rama activa para publicar".to_string());
            }
            let b = validate_git_ref_arg(&raw_b, "rama")?;
            run_git(&root_path, &["push", "-u", "origin", "--", b])
        }
        "sync" => {
            run_git(&root_path, &["pull"])?;
            run_git(&root_path, &["push"])
        }
        "abort-merge" => run_git(&root_path, &["merge", "--abort"]),
        "abort-rebase" => run_git(&root_path, &["rebase", "--abort"]),
        _ => Err(format!("Operación desconocida: {}", op)),
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_show_file(root_path: String, rev: String, rel_path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let r = validate_git_ref_arg(&rev, "revisión")?;
        validate_repo_rel_path(&rel_path)?;
        let spec = format!("{}:{}", r, rel_path.replace('\\', "/"));
        Ok(run_git(&root_path, &["show", &spec]).unwrap_or_default())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_apply_patch(
    root_path: String,
    patch: String,
    cached: bool,
    reverse: bool,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = git_cmd(&root_path);
        cmd.arg("apply").arg("--unidiff-zero");
        if cached {
            cmd.arg("--cached");
        }
        if reverse {
            cmd.arg("--reverse");
        }
        let mut child = cmd
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| e.to_string())?;

        if let Some(mut stdin) = child.stdin.take() {
            // No abortar en BrokenPipe: esperar al proceso hijo para recoger el stderr real de `git apply`.
            let _ = stdin.write_all(patch.as_bytes());
        }
        let out = child.wait_with_output().map_err(|e| e.to_string())?;
        if out.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_stash_list(root_path: String) -> Result<Vec<GitStashEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let raw = run_git(&root_path, &["stash", "list", "--format=%gd%x09%s"]).unwrap_or_default();
        let mut out = Vec::new();
        for (idx, line) in raw.lines().enumerate() {
            let mut parts = line.splitn(2, '\t');
            let ref_name = parts.next().unwrap_or("").to_string();
            let message = parts.next().unwrap_or("").to_string();
            if !ref_name.is_empty() {
                out.push(GitStashEntry {
                    index: idx,
                    ref_name,
                    message,
                });
            }
        }
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_stash_push(
    root_path: String,
    message: Option<String>,
    include_untracked: bool,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut args = vec!["stash", "push"];
        if include_untracked {
            args.push("-u");
        }
        let msg = message.unwrap_or_default().trim().to_string();
        if !msg.is_empty() {
            args.push("-m");
            args.push(&msg);
        }
        run_git(&root_path, &args)?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_stash_op(root_path: String, op: String, ref_name: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let action = match op.as_str() {
            "apply" => "apply",
            "pop" => "pop",
            "drop" => "drop",
            _ => return Err("Acción de stash inválida".to_string()),
        };
        let r = validate_git_ref_arg(&ref_name, "stash")?;
        if !r.starts_with("stash@{") || !r.ends_with('}') {
            return Err(format!("Referencia de stash inválida: {r}"));
        }
        run_git(&root_path, &["stash", action, r])?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_log(
    root_path: String,
    rel_path: Option<String>,
    limit: usize,
) -> Result<Vec<GitCommitInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let n = limit.clamp(1, 100).to_string();
        let mut args = vec![
            "log".to_string(),
            "-n".to_string(),
            n,
            "--format=%H%x09%h%x09%an%x09%ar%x09%s".to_string(),
        ];
        if let Some(p) = rel_path {
            let trimmed = p.trim();
            if !trimmed.is_empty() {
                validate_repo_rel_path(trimmed)?;
                args.push("--".to_string());
                args.push(trimmed.to_string());
            }
        }
        let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let raw = run_git(&root_path, &arg_refs).unwrap_or_default();
        let mut out = Vec::new();
        for line in raw.lines() {
            let cols: Vec<&str> = line.splitn(5, '\t').collect();
            if cols.len() == 5 {
                out.push(GitCommitInfo {
                    hash: cols[0].to_string(),
                    short_hash: cols[1].to_string(),
                    author: cols[2].to_string(),
                    date: cols[3].to_string(),
                    message: cols[4].to_string(),
                });
            }
        }
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_commit_files(root_path: String, hash: String) -> Result<Vec<GitCommitFile>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let h = validate_git_ref_arg(&hash, "commit")?;
        let raw = run_git(
            &root_path,
            &["diff-tree", "--no-commit-id", "--name-status", "-r", "-m", "--first-parent", "--root", h, "--"],
        )?;
        let mut out = Vec::new();
        for line in raw.lines() {
            let cols: Vec<&str> = line.split('\t').collect();
            if cols.len() >= 2 {
                let status = cols[0].chars().next().unwrap_or('M').to_string();
                if cols.len() >= 3 && (status == "R" || status == "C") {
                    out.push(GitCommitFile {
                        status,
                        old_path: Some(cols[1].to_string()),
                        path: cols[2].to_string(),
                    });
                } else {
                    out.push(GitCommitFile {
                        status,
                        path: cols[1].to_string(),
                        old_path: None,
                    });
                }
            }
        }
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_add_gitignore(root_path: String, pattern: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let clean = pattern.replace('\\', "/").trim().to_string();
        if clean.is_empty() || clean.chars().any(|c| c == '\r' || c == '\n' || c.is_control()) {
            return Err("Patrón .gitignore inválido".to_string());
        }
        let gi_path = Path::new(&root_path).join(".gitignore");
        let mut bytes = match fs::read(&gi_path) {
            Ok(b) => b,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(e) => return Err(format!("No se pudo leer .gitignore: {e}")),
        };
        if bytes.starts_with(&[0xFF, 0xFE]) || bytes.starts_with(&[0xFE, 0xFF]) {
            return Err("El archivo .gitignore está codificado en UTF-16; conviértelo a UTF-8 primero.".to_string());
        }
        let lossy = String::from_utf8_lossy(&bytes);
        if lossy.lines().any(|l| l.trim() == clean) {
            return Ok(());
        }
        if !bytes.is_empty() && !bytes.ends_with(b"\n") {
            bytes.push(b'\n');
        }
        bytes.extend_from_slice(clean.as_bytes());
        bytes.push(b'\n');
        fs::write(&gi_path, bytes).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_repo_rel_path_blocks_traversal_and_flags() {
        assert!(validate_repo_rel_path("src/main.ts").is_ok());
        assert!(validate_repo_rel_path("src\\nested\\file.rs").is_ok());
        assert!(validate_repo_rel_path("").is_err());
        assert!(validate_repo_rel_path(".").is_err());
        assert!(validate_repo_rel_path("..").is_err());
        assert!(validate_repo_rel_path("../secret.txt").is_err());
        assert!(validate_repo_rel_path("src/../../outside.txt").is_err());
        assert!(validate_repo_rel_path("/etc/passwd").is_err());
        assert!(validate_repo_rel_path("C:\\Windows\\System32").is_err());
        assert!(validate_repo_rel_path("-rf").is_err());
        assert!(validate_repo_rel_path("--orphan").is_err());
    }

    #[test]
    fn validate_git_ref_arg_blocks_option_injection() {
        assert!(validate_git_ref_arg("main", "rama").is_ok());
        assert!(validate_git_ref_arg("feature/login-v2", "rama").is_ok());
        assert!(validate_git_ref_arg("HEAD~1", "rev").is_ok());
        assert!(validate_git_ref_arg(":0", "rev").is_ok());
        assert!(validate_git_ref_arg("stash@{0}", "stash").is_ok());
        assert!(validate_git_ref_arg("--orphan", "rama").is_err());
        assert!(validate_git_ref_arg("-D", "rama").is_err());
        assert!(validate_git_ref_arg("a..b", "rama").is_err());
        assert!(validate_git_ref_arg("bad branch", "rama").is_err());
        assert!(validate_git_ref_arg("bad\nbranch", "rama").is_err());
    }
}
