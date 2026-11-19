use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, BufWriter, Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

struct LspProcess {
    child: Child,
    stdin: BufWriter<ChildStdin>,
}

#[derive(Default)]
pub struct LspRegistry(Arc<Mutex<HashMap<String, LspProcess>>>);

#[derive(Serialize, Clone)]
struct LspMessageEvent {
    server_key: String,
    payload: String,
}

#[derive(Serialize, Clone)]
struct LspClosedEvent {
    server_key: String,
}

fn spawn_candidate(program: &str, args: &[String], cwd: &str) -> std::io::Result<Child> {
    let mut cmd_names = Vec::new();
    if !cwd.is_empty() {
        let local_bin = std::path::Path::new(cwd).join("node_modules").join(".bin");
        if local_bin.is_dir() {
            #[cfg(target_os = "windows")]
            if !program.contains('.') {
                cmd_names.push(local_bin.join(format!("{program}.cmd")).to_string_lossy().into_owned());
                cmd_names.push(local_bin.join(format!("{program}.exe")).to_string_lossy().into_owned());
            }
            cmd_names.push(local_bin.join(program).to_string_lossy().into_owned());
        }
    }

    cmd_names.push(program.to_string());
    #[cfg(target_os = "windows")]
    if !program.contains('.') {
        cmd_names.push(format!("{program}.cmd"));
        cmd_names.push(format!("{program}.exe"));
    }

    let mut last_err = std::io::Error::new(std::io::ErrorKind::NotFound, "not found");
    for name in cmd_names {
        let mut cmd = Command::new(&name);
        cmd.args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());

        if !cwd.is_empty() && std::path::Path::new(cwd).is_dir() {
            cmd.current_dir(cwd);
        }

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        match cmd.spawn() {
            Ok(child) => return Ok(child),
            Err(e) => last_err = e,
        }
    }
    Err(last_err)
}

fn read_lsp_frames<R: Read>(
    mut reader: BufReader<R>,
    app: AppHandle,
    server_key: String,
    registry: Arc<Mutex<HashMap<String, LspProcess>>>,
) {
    let mut header_line = String::new();
    loop {
        let mut content_length: Option<usize> = None;
        loop {
            header_line.clear();
            match reader.read_line(&mut header_line) {
                Ok(0) | Err(_) => {
                    if let Ok(mut map) = registry.lock() {
                        if let Some(mut proc) = map.remove(&server_key) {
                            let _ = proc.child.wait();
                        }
                    }
                    let _ = app.emit("lsp:closed", LspClosedEvent { server_key });
                    return;
                }
                Ok(_) => {
                    let trimmed = header_line.trim();
                    if trimmed.is_empty() {
                        break;
                    }
                    if let Some((k, v)) = trimmed.split_once(':') {
                        if k.eq_ignore_ascii_case("Content-Length") {
                            content_length = v.trim().parse::<usize>().ok();
                        }
                    }
                }
            }
        }

        let Some(len) = content_length else {
            continue;
        };
        let mut buf = vec![0u8; len];
        if reader.read_exact(&mut buf).is_err() {
            if let Ok(mut map) = registry.lock() {
                if let Some(mut proc) = map.remove(&server_key) {
                    let _ = proc.child.wait();
                }
            }
            let _ = app.emit("lsp:closed", LspClosedEvent { server_key });
            return;
        }

        if let Ok(payload) = String::from_utf8(buf) {
            let _ = app.emit(
                "lsp:message",
                LspMessageEvent {
                    server_key: server_key.clone(),
                    payload,
                },
            );
        }
    }
}

#[tauri::command]
pub fn lsp_start(
    app: AppHandle,
    state: State<'_, LspRegistry>,
    server_key: String,
    candidates: Vec<(String, Vec<String>)>,
    cwd: String,
) -> Result<bool, String> {
    {
        let map = state.0.lock().map_err(|e| e.to_string())?;
        if map.contains_key(&server_key) {
            return Ok(true);
        }
    }

    for (program, args) in candidates {
        if let Ok(mut child) = spawn_candidate(&program, &args, &cwd) {
            let Some(stdin) = child.stdin.take() else { continue };
            let Some(stdout) = child.stdout.take() else { continue };

            let proc = LspProcess {
                child,
                stdin: BufWriter::new(stdin),
            };

            {
                let mut map = state.0.lock().map_err(|e| e.to_string())?;
                map.insert(server_key.clone(), proc);
            }

            let registry = state.0.clone();
            let key_clone = server_key.clone();
            std::thread::spawn(move || {
                read_lsp_frames(BufReader::new(stdout), app, key_clone, registry);
            });

            return Ok(true);
        }
    }

    Ok(false)
}

#[tauri::command]
pub fn lsp_send(state: State<'_, LspRegistry>, server_key: String, payload: String) -> Result<(), String> {
    let mut map = state.0.lock().map_err(|e| e.to_string())?;
    let Some(proc) = map.get_mut(&server_key) else {
        return Err(format!("LSP server '{server_key}' not running"));
    };

    let header = format!("Content-Length: {}\r\n\r\n", payload.len());
    proc.stdin.write_all(header.as_bytes()).map_err(|e| e.to_string())?;
    proc.stdin.write_all(payload.as_bytes()).map_err(|e| e.to_string())?;
    proc.stdin.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn lsp_stop(state: State<'_, LspRegistry>, server_key: String) -> Result<(), String> {
    let mut map = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(mut proc) = map.remove(&server_key) {
        drop(proc.stdin);
        let _ = proc.child.kill();
        let _ = proc.child.wait();
    }
    Ok(())
}

#[tauri::command]
pub fn lsp_stop_all(state: State<'_, LspRegistry>) -> Result<(), String> {
    stop_all_processes(&state);
    Ok(())
}

pub fn stop_all_processes(registry: &LspRegistry) {
    if let Ok(mut map) = registry.0.lock() {
        for (_, mut proc) in map.drain() {
            drop(proc.stdin);
            let _ = proc.child.kill();
            let _ = proc.child.wait();
        }
    }
}
