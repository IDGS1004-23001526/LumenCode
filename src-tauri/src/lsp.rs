use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, BufWriter, Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{sync_channel, SyncSender, TrySendError};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

static NEXT_INSTANCE_ID: AtomicU64 = AtomicU64::new(1);

const MAX_LSP_FRAME_BYTES: usize = 64 * 1024 * 1024;
const MAX_HEADER_LINE_BYTES: u64 = 8 * 1024;
const LSP_STDIN_QUEUE_CAP: usize = 1024;

struct LspProcess {
    instance_id: u64,
    child: Child,
    stdin_tx: Option<SyncSender<Vec<u8>>>,
}

fn terminate_process(mut proc: LspProcess) {
    // Cierra primero el canal de escritura para que el hilo escritor termine limpiamente
    drop(proc.stdin_tx.take());
    let pid = proc.child.id();
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let _ = Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .creation_flags(CREATE_NO_WINDOW)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = Command::new("kill")
            .args(["-9", &format!("-{pid}")])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    let _ = proc.child.kill();
    let _ = proc.child.wait();
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

        #[cfg(not(target_os = "windows"))]
        {
            use std::os::unix::process::CommandExt;
            cmd.process_group(0);
        }

        match cmd.spawn() {
            Ok(child) => return Ok(child),
            Err(e) => last_err = e,
        }
    }
    Err(last_err)
}

fn cleanup_instance(
    registry: &Arc<Mutex<HashMap<String, LspProcess>>>,
    server_key: &str,
    instance_id: u64,
) -> bool {
    let removed = {
        let Ok(mut map) = registry.lock() else {
            return false;
        };
        if map.get(server_key).is_some_and(|p| p.instance_id == instance_id) {
            map.remove(server_key)
        } else {
            None
        }
    };
    if let Some(proc) = removed {
        // Espera/terminación siempre fuera del lock global para evitar deadlocks.
        terminate_process(proc);
        true
    } else {
        false
    }
}

fn read_bounded_line<R: BufRead>(reader: &mut R, buf: &mut Vec<u8>) -> std::io::Result<usize> {
    buf.clear();
    let mut limited = reader.take(MAX_HEADER_LINE_BYTES + 1);
    let n = limited.read_until(b'\n', buf)?;
    if n as u64 > MAX_HEADER_LINE_BYTES && !buf.ends_with(b"\n") {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "LSP header line exceeds maximum length",
        ));
    }
    Ok(n)
}

fn write_lsp_frames(stdin: ChildStdin, rx: std::sync::mpsc::Receiver<Vec<u8>>) {
    let mut writer = BufWriter::new(stdin);
    while let Ok(frame) = rx.recv() {
        if writer.write_all(&frame).is_err() || writer.flush().is_err() {
            break;
        }
    }
}

fn read_lsp_frames<R: Read>(
    mut reader: BufReader<R>,
    app: AppHandle,
    server_key: String,
    instance_id: u64,
    registry: Arc<Mutex<HashMap<String, LspProcess>>>,
) {
    let mut header_buf = Vec::with_capacity(256);
    loop {
        let mut content_length: Option<usize> = None;
        loop {
            match read_bounded_line(&mut reader, &mut header_buf) {
                Ok(0) | Err(_) => {
                    if cleanup_instance(&registry, &server_key, instance_id) {
                        let _ = app.emit("lsp:closed", LspClosedEvent { server_key });
                    }
                    return;
                }
                Ok(_) => {
                    let header_line = String::from_utf8_lossy(&header_buf);
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
        if len > MAX_LSP_FRAME_BYTES {
            if cleanup_instance(&registry, &server_key, instance_id) {
                let _ = app.emit("lsp:closed", LspClosedEvent { server_key });
            }
            return;
        }
        let mut buf = vec![0u8; len];
        if reader.read_exact(&mut buf).is_err() {
            if cleanup_instance(&registry, &server_key, instance_id) {
                let _ = app.emit("lsp:closed", LspClosedEvent { server_key });
            }
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
pub async fn lsp_start(
    app: AppHandle,
    state: State<'_, LspRegistry>,
    server_key: String,
    candidates: Vec<(String, Vec<String>)>,
    cwd: String,
) -> Result<bool, String> {
    let registry = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        {
            let map = registry.lock().map_err(|e| e.to_string())?;
            if map.contains_key(&server_key) {
                return Ok(true);
            }
        }

        for (program, args) in candidates {
            if let Ok(mut child) = spawn_candidate(&program, &args, &cwd) {
                let Some(stdin) = child.stdin.take() else {
                    let _ = child.kill();
                    let _ = child.wait();
                    continue;
                };
                let Some(stdout) = child.stdout.take() else {
                    drop(stdin);
                    let _ = child.kill();
                    let _ = child.wait();
                    continue;
                };

                let (stdin_tx, stdin_rx) = sync_channel::<Vec<u8>>(LSP_STDIN_QUEUE_CAP);
                let instance_id = NEXT_INSTANCE_ID.fetch_add(1, Ordering::Relaxed);
                let proc = LspProcess {
                    instance_id,
                    child,
                    stdin_tx: Some(stdin_tx),
                };

                let duplicate = {
                    let mut map = registry.lock().map_err(|e| e.to_string())?;
                    if map.contains_key(&server_key) {
                        Some(proc)
                    } else {
                        map.insert(server_key.clone(), proc);
                        None
                    }
                };

                if let Some(dup_proc) = duplicate {
                    drop(stdin);
                    drop(stdout);
                    terminate_process(dup_proc);
                    return Ok(true);
                }

                std::thread::spawn(move || {
                    write_lsp_frames(stdin, stdin_rx);
                });

                let reader_registry = registry.clone();
                let key_clone = server_key.clone();
                std::thread::spawn(move || {
                    read_lsp_frames(BufReader::new(stdout), app, key_clone, instance_id, reader_registry);
                });

                return Ok(true);
            }
        }

        Ok(false)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn lsp_send(state: State<'_, LspRegistry>, server_key: String, payload: String) -> Result<(), String> {
    let sender = {
        let map = state.0.lock().map_err(|e| e.to_string())?;
        map.get(&server_key)
            .and_then(|proc| proc.stdin_tx.clone())
            .ok_or_else(|| format!("LSP server '{server_key}' not running"))?
    };

    let mut frame = format!("Content-Length: {}\r\n\r\n", payload.len()).into_bytes();
    frame.extend_from_slice(payload.as_bytes());

    sender.try_send(frame).map_err(|e| match e {
        TrySendError::Full(_) => format!("LSP server '{server_key}' input queue is full"),
        TrySendError::Disconnected(_) => format!("LSP server '{server_key}' stdin closed"),
    })
}

#[tauri::command]
pub async fn lsp_stop(state: State<'_, LspRegistry>, server_key: String) -> Result<(), String> {
    let registry = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let removed = {
            let mut map = registry.lock().map_err(|e| e.to_string())?;
            map.remove(&server_key)
        };
        if let Some(proc) = removed {
            terminate_process(proc);
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn lsp_stop_all(state: State<'_, LspRegistry>) -> Result<(), String> {
    let registry = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let procs: Vec<LspProcess> = match registry.lock() {
            Ok(mut map) => map.drain().map(|(_, proc)| proc).collect(),
            Err(_) => Vec::new(),
        };
        for proc in procs {
            terminate_process(proc);
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

pub fn stop_all_processes(registry: &LspRegistry) {
    let procs: Vec<LspProcess> = match registry.0.lock() {
        Ok(mut map) => map.drain().map(|(_, proc)| proc).collect(),
        Err(_) => return,
    };
    for proc in procs {
        terminate_process(proc);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn read_bounded_line_accepts_valid_headers_and_rejects_oversized_lines() {
        let mut ok_reader = BufReader::new(Cursor::new(b"Content-Length: 42\r\n\r\n"));
        let mut buf = Vec::new();
        let n = read_bounded_line(&mut ok_reader, &mut buf).unwrap();
        assert!(n > 0);
        assert_eq!(String::from_utf8_lossy(&buf).trim(), "Content-Length: 42");

        let huge = vec![b'A'; (MAX_HEADER_LINE_BYTES as usize) + 100];
        let mut bad_reader = BufReader::new(Cursor::new(huge));
        assert!(read_bounded_line(&mut bad_reader, &mut buf).is_err());
    }
}
