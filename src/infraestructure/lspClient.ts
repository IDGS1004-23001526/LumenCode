import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { lspSpecFor, type LspServerSpec } from "../presentation/editor/languages";

export interface LspCompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string | { kind?: string; value?: string };
  sortText?: string;
  filterText?: string;
  insertText?: string;
  textEdit?: {
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
    newText: string;
  };
}

export interface LspHoverResult {
  contents: string | { kind?: string; value?: string } | Array<string | { language?: string; value?: string }>;
}

export interface LspDiagnostic {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  severity?: number; // 1=Error, 2=Warning, 3=Info, 4=Hint
  message: string;
  source?: string;
}

type DiagnosticsListener = (path: string, diagnostics: LspDiagnostic[]) => void;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface LspSession {
  serverKey: string;
  rootPath: string;
  ready: Promise<boolean>;
  initialized: boolean;
  pending: Map<number, PendingRequest>;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

interface OpenDoc {
  uri: string;
  serverKey: string;
  languageId: string;
  version: number;
  changeTimer: ReturnType<typeof setTimeout> | null;
}

const IDLE_SHUTDOWN_MS = 15_000;
const REQUEST_TIMEOUT_MS = 1_200;

export function pathToUri(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  if (/^[A-Za-z]:\//.test(normalized)) {
    return `file:///${normalized}`;
  }
  return normalized.startsWith("/") ? `file://${normalized}` : `file:///${normalized}`;
}

class LspClientManager {
  private sessions = new Map<string, LspSession>();
  private unavailable = new Set<string>();
  private openDocs = new Map<string, OpenDoc>();
  private diagListeners = new Set<DiagnosticsListener>();
  private nextId = 1;
  private listenersAttached = false;

  onDiagnostics(cb: DiagnosticsListener): () => void {
    this.diagListeners.add(cb);
    return () => this.diagListeners.delete(cb);
  }

  hasActiveServerFor(path: string): boolean {
    const doc = this.openDocs.get(path);
    if (!doc) return false;
    return Boolean(this.sessions.get(doc.serverKey)?.initialized);
  }

  private findPathByUri(uri: string): string | null {
    const target = uri.toLowerCase();
    for (const [path, doc] of this.openDocs.entries()) {
      if (doc.uri.toLowerCase() === target) return path;
    }
    return null;
  }

  private ensureListeners() {
    if (this.listenersAttached) return;
    this.listenersAttached = true;

    void listen<{ server_key: string; payload: string }>("lsp:message", (ev) => {
      const session = this.sessions.get(ev.payload.server_key);
      if (!session) return;
      try {
        const msg = JSON.parse(ev.payload.payload) as {
          id?: number;
          method?: string;
          params?: { uri?: string; diagnostics?: LspDiagnostic[] };
          result?: unknown;
          error?: { message?: string };
        };
        if (typeof msg.id === "number") {
          const req = session.pending.get(msg.id);
          if (req) {
            clearTimeout(req.timer);
            session.pending.delete(msg.id);
            if (msg.error) req.reject(new Error(msg.error.message ?? "LSP error"));
            else req.resolve(msg.result);
          }
        } else if (msg.method === "textDocument/publishDiagnostics" && msg.params?.uri) {
          const filePath = this.findPathByUri(msg.params.uri);
          if (filePath) {
            const diags = msg.params.diagnostics ?? [];
            for (const cb of this.diagListeners) cb(filePath, diags);
          }
        }
      } catch {
        // Ignorar frames JSON malformados
      }
    });

    void listen<{ server_key: string }>("lsp:closed", (ev) => {
      this.cleanupSession(ev.payload.server_key);
    });
  }

  private cleanupSession(serverKey: string) {
    const session = this.sessions.get(serverKey);
    if (!session) return;
    if (session.idleTimer) clearTimeout(session.idleTimer);
    for (const req of session.pending.values()) {
      clearTimeout(req.timer);
      req.reject(new Error("LSP session closed"));
    }
    session.pending.clear();
    this.sessions.delete(serverKey);
  }

  private async getOrStartSession(spec: LspServerSpec, rootPath: string): Promise<LspSession | null> {
    if (this.unavailable.has(spec.serverKey)) return null;
    this.ensureListeners();

    const existing = this.sessions.get(spec.serverKey);
    if (existing) {
      if (existing.idleTimer) {
        clearTimeout(existing.idleTimer);
        existing.idleTimer = null;
      }
      const ok = await existing.ready;
      return ok ? existing : null;
    }

    const session: LspSession = {
      serverKey: spec.serverKey,
      rootPath,
      initialized: false,
      pending: new Map(),
      idleTimer: null,
      ready: Promise.resolve(false),
    };

    session.ready = (async () => {
      try {
        const started = await invoke<boolean>("lsp_start", {
          serverKey: spec.serverKey,
          candidates: spec.candidates,
          cwd: rootPath,
        });
        if (!started) {
          this.unavailable.add(spec.serverKey);
          this.sessions.delete(spec.serverKey);
          return false;
        }

        const rootUri = rootPath ? pathToUri(rootPath) : null;
        await this.sendRequest(session, "initialize", {
          processId: null,
          rootUri,
          capabilities: {
            textDocument: {
              synchronization: { dynamicRegistration: false, didSave: true },
              completion: {
                completionItem: {
                  snippetSupport: false,
                  documentationFormat: ["plaintext", "markdown"],
                },
              },
              hover: { contentFormat: ["markdown", "plaintext"] },
            },
          },
        }, 4_000);

        this.sendNotification(session, "initialized", {});
        session.initialized = true;
        return true;
      } catch {
        this.cleanupSession(spec.serverKey);
        return false;
      }
    })();

    this.sessions.set(spec.serverKey, session);
    const ok = await session.ready;
    return ok ? session : null;
  }

  private sendNotification(session: LspSession, method: string, params: unknown) {
    const payload = JSON.stringify({ jsonrpc: "2.0", method, params });
    void invoke("lsp_send", { serverKey: session.serverKey, payload }).catch(() => {});
  }

  private sendRequest<T>(
    session: LspSession,
    method: string,
    params: unknown,
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<T> {
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        session.pending.delete(id);
        reject(new Error(`LSP timeout: ${method}`));
      }, timeoutMs);

      session.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      });

      invoke("lsp_send", { serverKey: session.serverKey, payload }).catch((err) => {
        clearTimeout(timer);
        session.pending.delete(id);
        reject(err);
      });
    });
  }

  async openDocument(path: string, text: string, rootPath: string | null): Promise<void> {
    const spec = lspSpecFor(path);
    if (!spec) return;

    const uri = pathToUri(path);
    const cwd = rootPath ?? path.replace(/[\\/][^\\/]+$/, "");
    const session = await this.getOrStartSession(spec, cwd);
    if (!session) return;

    const doc: OpenDoc = {
      uri,
      serverKey: spec.serverKey,
      languageId: spec.languageId,
      version: 1,
      changeTimer: null,
    };
    this.openDocs.set(path, doc);

    this.sendNotification(session, "textDocument/didOpen", {
      textDocument: {
        uri,
        languageId: spec.languageId,
        version: doc.version,
        text,
      },
    });
  }

  changeDocument(path: string, text: string): void {
    const doc = this.openDocs.get(path);
    if (!doc) return;
    const session = this.sessions.get(doc.serverKey);
    if (!session || !session.initialized) return;

    if (doc.changeTimer) clearTimeout(doc.changeTimer);
    doc.changeTimer = setTimeout(() => {
      doc.changeTimer = null;
      doc.version += 1;
      this.sendNotification(session, "textDocument/didChange", {
        textDocument: { uri: doc.uri, version: doc.version },
        contentChanges: [{ text }],
      });
    }, 150);
  }

  closeDocument(path: string): void {
    const doc = this.openDocs.get(path);
    if (!doc) return;
    if (doc.changeTimer) clearTimeout(doc.changeTimer);
    this.openDocs.delete(path);

    const session = this.sessions.get(doc.serverKey);
    if (!session) return;

    if (session.initialized) {
      this.sendNotification(session, "textDocument/didClose", {
        textDocument: { uri: doc.uri },
      });
    }

    // Si no quedan pestañas abiertas para este lenguaje, libera su RAM tras 15s
    const stillUsed = [...this.openDocs.values()].some((d) => d.serverKey === doc.serverKey);
    if (!stillUsed) {
      if (session.idleTimer) clearTimeout(session.idleTimer);
      session.idleTimer = setTimeout(() => {
        this.cleanupSession(doc.serverKey);
        void invoke("lsp_stop", { serverKey: doc.serverKey }).catch(() => {});
      }, IDLE_SHUTDOWN_MS);
    }
  }

  async complete(
    path: string,
    line: number,
    character: number,
    triggerCharacter?: string,
  ): Promise<LspCompletionItem[] | null> {
    const doc = this.openDocs.get(path);
    if (!doc) return null;
    const session = this.sessions.get(doc.serverKey);
    if (!session || !session.initialized) return null;

    try {
      const res = await this.sendRequest<LspCompletionItem[] | { items: LspCompletionItem[] } | null>(
        session,
        "textDocument/completion",
        {
          textDocument: { uri: doc.uri },
          position: { line, character },
          context: triggerCharacter
            ? { triggerKind: 2, triggerCharacter }
            : { triggerKind: 1 },
        },
      );
      if (!res) return null;
      return Array.isArray(res) ? res : res.items ?? [];
    } catch {
      return null;
    }
  }

  async hover(path: string, line: number, character: number): Promise<string | null> {
    const doc = this.openDocs.get(path);
    if (!doc) return null;
    const session = this.sessions.get(doc.serverKey);
    if (!session || !session.initialized) return null;

    try {
      const res = await this.sendRequest<LspHoverResult | null>(session, "textDocument/hover", {
        textDocument: { uri: doc.uri },
        position: { line, character },
      });
      if (!res || !res.contents) return null;
      return formatHoverContents(res.contents);
    } catch {
      return null;
    }
  }

  async stopAll(): Promise<void> {
    for (const doc of this.openDocs.values()) {
      if (doc.changeTimer) clearTimeout(doc.changeTimer);
    }
    this.openDocs.clear();
    for (const key of [...this.sessions.keys()]) {
      this.cleanupSession(key);
    }
    await invoke("lsp_stop_all").catch(() => {});
  }
}

function formatHoverContents(contents: LspHoverResult["contents"]): string | null {
  if (typeof contents === "string") return contents.trim() || null;
  if (Array.isArray(contents)) {
    const parts = contents
      .map((c) => (typeof c === "string" ? c : c.value ?? ""))
      .filter(Boolean);
    return parts.join("\n\n").trim() || null;
  }
  return contents.value?.trim() || null;
}

export const lspClient = new LspClientManager();
