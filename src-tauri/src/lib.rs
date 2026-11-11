use serde::Serialize;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
struct RunningPid(Arc<Mutex<Option<u32>>>);

#[derive(Serialize)]
pub struct TerminalInfo {
    pub os: &'static str,
    pub shell: String,
    pub cwd: String,
}

#[derive(Serialize)]
pub struct TerminalOutput {
    pub cwd: String,
    pub stdout: Vec<String>,
    pub stderr: Vec<String>,
    pub code: i32,
}

#[derive(Serialize, Clone)]
struct StreamLine {
    text: String,
    is_err: bool,
}

const CWD_MARKER: &str = "__LUMEN_CWD__";

fn default_shell() -> String {
    #[cfg(target_os = "windows")]
    {
        "powershell.exe".to_string()
    }
    #[cfg(target_os = "macos")]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
    }
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
    }
}

/** Limpia el prefijo `\\?\` que `canonicalize` agrega en Windows. */
fn clean_win_path(p: PathBuf) -> String {
    let s = p.to_string_lossy().to_string();
    s.strip_prefix(r"\\?\").unwrap_or(&s).to_string()
}

/** Resuelve `cd` y `pwd` nativamente en Rust (< 1 ms, sin abrir subproceso). */
fn try_fast_builtin(cwd: &str, line: &str) -> Option<Result<TerminalOutput, String>> {
    let trimmed = line.trim();
    if trimmed.eq_ignore_ascii_case("pwd") {
        return Some(Ok(TerminalOutput {
            cwd: cwd.to_string(),
            stdout: vec![cwd.to_string()],
            stderr: vec![],
            code: 0,
        }));
    }

    // Solo intercepta `cd` simples (sin `&&`, `;` ni `|`)
    if trimmed.contains("&&") || trimmed.contains(';') || trimmed.contains('|') {
        return None;
    }

    let rest = if trimmed.eq_ignore_ascii_case("cd") {
        ""
    } else if trimmed.len() > 3 && trimmed[..3].eq_ignore_ascii_case("cd ") {
        trimmed[3..].trim()
    } else if trimmed.eq_ignore_ascii_case("cd..") {
        ".."
    } else {
        return None;
    };

    let target = rest.trim_matches(|c| c == '"' || c == '\'');
    let next_path = if target.is_empty() || target == "~" {
        std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from(cwd))
    } else {
        Path::new(cwd).join(target)
    };

    match std::fs::canonicalize(&next_path) {
        Ok(canon) if canon.is_dir() => Some(Ok(TerminalOutput {
            cwd: clean_win_path(canon),
            stdout: vec![],
            stderr: vec![],
            code: 0,
        })),
        Ok(_) => Some(Ok(TerminalOutput {
            cwd: cwd.to_string(),
            stdout: vec![],
            stderr: vec![format!("cd: no es un directorio: {target}")],
            code: 1,
        })),
        Err(e) => Some(Ok(TerminalOutput {
            cwd: cwd.to_string(),
            stdout: vec![],
            stderr: vec![format!("cd: no se puede acceder a '{target}': {e}")],
            code: 1,
        })),
    }
}

#[tauri::command]
fn terminal_init() -> TerminalInfo {
    let cwd = std::env::current_dir()
        .or_else(|_| std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).map(Into::into))
        .map(clean_win_path)
        .unwrap_or_else(|_| if cfg!(target_os = "windows") { "C:\\".into() } else { "/".into() });

    TerminalInfo {
        os: std::env::consts::OS,
        shell: default_shell(),
        cwd,
    }
}

#[tauri::command]
fn terminal_kill(running: State<'_, RunningPid>) -> Result<(), String> {
    if let Some(pid) = running.0.lock().unwrap().take() {
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            let _ = Command::new("taskkill")
                .args(["/F", "/T", "/PID", &pid.to_string()])
                .creation_flags(CREATE_NO_WINDOW)
                .status();
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = Command::new("kill").args(["-9", &pid.to_string()]).status();
        }
    }
    Ok(())
}

#[tauri::command]
async fn terminal_exec(
    app: AppHandle,
    running: State<'_, RunningPid>,
    cwd: String,
    line: String,
) -> Result<TerminalOutput, String> {
    // 1. Vía rápida instantánea (< 1 ms) para `cd` y `pwd`
    if let Some(fast) = try_fast_builtin(&cwd, &line) {
        return fast;
    }

    let pid_holder = running.0.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let shell = default_shell();

        #[cfg(target_os = "windows")]
        let mut child = {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            let script = format!(
                "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; \
                 {line}; \
                 $__code = if ($?) {{ 0 }} else {{ 1 }}; \
                 Write-Output '{CWD_MARKER}'; \
                 Write-Output (Get-Location).Path; \
                 exit $__code"
            );
            Command::new(&shell)
                .args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", &script])
                .current_dir(&cwd)
                .env("FORCE_COLOR", "3")
                .env("CLICOLOR_FORCE", "1")
                .env("COLORTERM", "truecolor")
                .env("TERM", "xterm-256color")
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
                .map_err(|e| e.to_string())?
        };

        #[cfg(not(target_os = "windows"))]
        let mut child = {
            let script = format!(
                "{line}\n\
                 __code=$?\n\
                 printf '\\n{CWD_MARKER}\\n%s\\n' \"$PWD\"\n\
                 exit $__code"
            );
            Command::new(&shell)
                .args(["-c", &script])
                .current_dir(&cwd)
                .env("FORCE_COLOR", "3")
                .env("CLICOLOR_FORCE", "1")
                .env("COLORTERM", "truecolor")
                .env("TERM", "xterm-256color")
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|e| e.to_string())?
        };

        *pid_holder.lock().unwrap() = Some(child.id());

        let out_pipe = child.stdout.take().unwrap();
        let err_pipe = child.stderr.take().unwrap();

        let app_err = app.clone();
        let err_handle = std::thread::spawn(move || {
            let reader = BufReader::new(err_pipe);
            for l in reader.lines().map_while(Result::ok) {
                let _ = app_err.emit("terminal:line", StreamLine { text: l, is_err: true });
            }
        });

        let next_cwd = Arc::new(Mutex::new(cwd.clone()));
        let cwd_clone = next_cwd.clone();
        let app_out = app.clone();

        let out_handle = std::thread::spawn(move || {
            let reader = BufReader::new(out_pipe);
            let mut awaiting_cwd = false;
            for l in reader.lines().map_while(Result::ok) {
                if l.trim() == CWD_MARKER {
                    awaiting_cwd = true;
                    continue;
                }
                if awaiting_cwd {
                    *cwd_clone.lock().unwrap() = l.trim().to_string();
                    awaiting_cwd = false;
                    continue;
                }
                let _ = app_out.emit("terminal:line", StreamLine { text: l, is_err: false });
            }
        });

        let status = child.wait().map_err(|e| e.to_string())?;
        *pid_holder.lock().unwrap() = None;
        let _ = out_handle.join();
        let _ = err_handle.join();

        let final_cwd = next_cwd.lock().unwrap().clone();
        Ok(TerminalOutput {
            cwd: final_cwd,
            stdout: vec![], // ya fueron enviadas en tiempo real por "terminal:line"
            stderr: vec![],
            code: status.code().unwrap_or(-1),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(RunningPid::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![terminal_init, terminal_exec, terminal_kill])
        .run(tauri::generate_context!())
        .expect("error al ejecutar la aplicación Lumen");
}