use serde::Serialize;
use std::process::Command;

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

#[tauri::command]
fn terminal_init() -> TerminalInfo {
    let cwd = std::env::current_dir()
        .or_else(|_| std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).map(Into::into))
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| if cfg!(target_os = "windows") { "C:\\".into() } else { "/".into() });

    TerminalInfo {
        os: std::env::consts::OS, // "windows" | "macos" | "linux"
        shell: default_shell(),
        cwd,
    }
}

#[tauri::command]
async fn terminal_exec(cwd: String, line: String) -> Result<TerminalOutput, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let shell = default_shell();

        #[cfg(target_os = "windows")]
        let output = {
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
                .creation_flags(CREATE_NO_WINDOW)
                .output()
                .map_err(|e| e.to_string())?
        };

        #[cfg(not(target_os = "windows"))]
        let output = {
            let script = format!(
                "{line}\n\
                 __code=$?\n\
                 printf '\\n{CWD_MARKER}\\n%s\\n' \"$PWD\"\n\
                 exit $__code"
            );
            Command::new(&shell)
                .args(["-c", &script])
                .current_dir(&cwd)
                .output()
                .map_err(|e| e.to_string())?
        };

        let raw_out = String::from_utf8_lossy(&output.stdout);
        let mut stdout: Vec<String> = raw_out.lines().map(String::from).collect();

        // Extrae el nuevo directorio de trabajo marcado al final de stdout
        let next_cwd = if let Some(pos) = stdout.iter().rposition(|l| l.trim() == CWD_MARKER) {
            let dir = stdout.get(pos + 1).cloned().unwrap_or_else(|| cwd.clone());
            stdout.truncate(pos);
            dir.trim().to_string()
        } else {
            cwd
        };

        let stderr: Vec<String> = String::from_utf8_lossy(&output.stderr)
            .lines()
            .map(String::from)
            .collect();

        Ok(TerminalOutput {
            cwd: next_cwd,
            stdout,
            stderr,
            code: output.status.code().unwrap_or(-1),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![terminal_init, terminal_exec])
        .run(tauri::generate_context!())
        .expect("error al ejecutar la aplicación Lumen");
}