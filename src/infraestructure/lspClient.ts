import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { normalizePath, parentDirOf, pathsEqual } from "../domain/path";
import { lspSpecFor, type LspServerSpec } from "../presentation/editor/languages";

export interface LspTextEdit {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  newText: string;
}

export interface LspCompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string | { kind?: string; value?: string };
  sortText?: string;
  filterText?: string;
  insertText?: string;
  textEdit?: LspTextEdit;
  additionalTextEdits?: LspTextEdit[];
  data?: unknown;
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

export interface LspLocation {
  path: string;
  line: number;
  character: number;
}

interface RawLspLocation {
  uri: string;
  range: { start: { line: number; character: number } };
}

interface RawLspLocationLink {
  targetUri: string;
  targetSelectionRange?: { start: { line: number; character: number } };
  targetRange: { start: { line: number; character: number } };
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
  const encodeSegments = (p: string) =>
    p
      .split("/")
      .map((seg, idx) => (idx === 0 && /^[A-Za-z]:$/.test(seg) ? seg : encodeURIComponent(seg)))
      .join("/");
  if (/^[A-Za-z]:\//.test(normalized)) {
    return `file:///${encodeSegments(normalized)}`;
  }
  // UNC: \\server\share\a.ts -> file://server/share/a.ts (la authority es el servidor)
  if (/^\/\/[^/]/.test(normalized)) {
    return `file://${encodeSegments(normalized.replace(/^\/+/, ""))}`;
  }
  const encoded = encodeSegments(normalized);
  return encoded.startsWith("/") ? `file://${encoded}` : `file:///${encoded}`;
}

export function uriToPath(uri: string): string {
  if (!uri.startsWith("file://")) return uri;
  let raw = uri.slice("file://".length);
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // Mantiene la cadena original si contiene secuencias % malformadas
  }
  if (/^\/[A-Za-z]:/.test(raw)) return normalizePath(raw.slice(1));
  // UNC: file://server/share/a.ts -> \\server\share\a.ts
  if (!raw.startsWith("/")) {
    return normalizePath(`\\\\${raw.replace(/\//g, "\\")}`);
  }
  return normalizePath(raw);
}

class LspClientManager {
  private sessions = new Map<string, LspSession>();
  private unavailable = new Set<string>();
  private openDocs = new Map<string, OpenDoc>();
  private openTabMeta = new Map<string, { text: string; rootPath: string | null }>();
  private docSeq = new Map<string, number>();
  private diagListeners = new Set<DiagnosticsListener>();
  private nextId = 1;
  private listenersReady: Promise<void> | null = null;
  private generation = 0;
  private stopBarrier: Promise<void> = Promise.resolve();

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
    const targetPath = uriToPath(uri);
    for (const path of this.openDocs.keys()) {
      if (pathsEqual(path, targetPath)) return path;
    }
    const targetLower = uri.toLowerCase();
    for (const [path, doc] of this.openDocs.entries()) {
      if (doc.uri.toLowerCase() === targetLower) return path;
    }
    return null;
  }

  private ensureListeners(): Promise<void> {
    if (this.listenersReady) return this.listenersReady;
    this.listenersReady = Promise.all([
      listen<{ server_key: string; payload: string }>("lsp:message", (ev) => {
        const session = this.sessions.get(ev.payload.server_key);
        if (!session) return;
        try {
          const msg = JSON.parse(ev.payload.payload) as {
            id?: number | string;
            method?: string;
            params?: { uri?: string; diagnostics?: LspDiagnostic[] };
            result?: unknown;
            error?: { message?: string };
          };
          if (msg.id !== undefined && typeof msg.method === "string") {
            // Petición servidor -> cliente (ej. workspace/configuration, client/registerCapability)
            const rawItems = (msg.params as { items?: unknown[] } | undefined)?.items;
            const result =
              msg.method === "workspace/configuration"
                ? (Array.isArray(rawItems) ? rawItems.map(() => null) : [])
                : null;
            const reply = JSON.stringify({ jsonrpc: "2.0", id: msg.id, result });
            void invoke("lsp_send", { serverKey: session.serverKey, payload: reply }).catch(() => {});
          } else if (typeof msg.id === "number") {
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
      }),
      listen<{ server_key: string }>("lsp:closed", (ev) => {
        this.cleanupSession(ev.payload.server_key);
      }),
    ]).then(() => undefined);
    return this.listenersReady;
  }

  private cleanupSession(serverKey: string) {
    const session = this.sessions.get(serverKey);
    if (session) {
      if (session.idleTimer) clearTimeout(session.idleTimer);
      for (const req of session.pending.values()) {
        clearTimeout(req.timer);
        req.reject(new Error("LSP session closed"));
      }
      session.pending.clear();
      this.sessions.delete(serverKey);
    }
    for (const [docPath, doc] of [...this.openDocs.entries()]) {
      if (doc.serverKey === serverKey) {
        if (doc.changeTimer) clearTimeout(doc.changeTimer);
        this.openDocs.delete(docPath);
      }
    }
  }

  private async getOrStartSession(spec: LspServerSpec, rootPath: string): Promise<LspSession | null> {
    const gen = this.generation;
    await this.stopBarrier;
    if (gen !== this.generation) return null;
    if (this.unavailable.has(spec.serverKey)) return null;
    await this.ensureListeners();
    if (gen !== this.generation) return null;

    const existing = this.sessions.get(spec.serverKey);
    if (existing) {
      if (existing.idleTimer) {
        clearTimeout(existing.idleTimer);
        existing.idleTimer = null;
      }
      const ok = await existing.ready;
      if (gen !== this.generation || this.sessions.get(spec.serverKey) !== existing) return null;
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
        if (gen !== this.generation || this.sessions.get(spec.serverKey) !== session) {
          if (started) void invoke("lsp_stop", { serverKey: spec.serverKey }).catch(() => {});
          return false;
        }
        if (!started) {
          this.unavailable.add(spec.serverKey);
          if (this.sessions.get(spec.serverKey) === session) {
            this.sessions.delete(spec.serverKey);
          }
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
                  documentationFormat: ["markdown", "plaintext"],
                  resolveSupport: {
                    properties: ["documentation", "detail", "additionalTextEdits"],
                  },
                },
              },
              hover: { contentFormat: ["markdown", "plaintext"] },
            },
          },
        }, 4_000);

        if (gen !== this.generation || this.sessions.get(spec.serverKey) !== session) {
          void invoke("lsp_stop", { serverKey: spec.serverKey }).catch(() => {});
          return false;
        }

        this.sendNotification(session, "initialized", {});
        session.initialized = true;
        // Re-registra pestañas que seguían abiertas si el servidor se reinició tras inactividad o caída
        for (const [tabPath, meta] of this.openTabMeta.entries()) {
          if (this.openDocs.has(tabPath)) continue;
          const tabSpec = lspSpecFor(tabPath);
          if (!tabSpec || tabSpec.serverKey !== spec.serverKey) continue;
          const tabUri = pathToUri(tabPath);
          const reopenedDoc: OpenDoc = {
            uri: tabUri,
            serverKey: tabSpec.serverKey,
            languageId: tabSpec.languageId,
            version: 1,
            changeTimer: null,
          };
          this.openDocs.set(tabPath, reopenedDoc);
          this.sendNotification(session, "textDocument/didOpen", {
            textDocument: {
              uri: tabUri,
              languageId: tabSpec.languageId,
              version: reopenedDoc.version,
              text: meta.text,
            },
          });
        }
        return true;
      } catch {
        if (this.sessions.get(spec.serverKey) === session) {
          this.cleanupSession(spec.serverKey);
        }
        return false;
      }
    })();

    this.sessions.set(spec.serverKey, session);
    const ok = await session.ready;
    if (gen !== this.generation || this.sessions.get(spec.serverKey) !== session) return null;
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

    this.openTabMeta.set(path, { text, rootPath });
    const seq = (this.docSeq.get(path) ?? 0) + 1;
    this.docSeq.set(path, seq);

    const uri = pathToUri(path);
    const cwd = rootPath ?? parentDirOf(path);
    const session = await this.getOrStartSession(spec, cwd);
    if (!session || this.docSeq.get(path) !== seq || !this.openTabMeta.has(path)) return;

    const prevDoc = this.openDocs.get(path);
    if (prevDoc && prevDoc.serverKey === spec.serverKey) {
      // Ya fue abierto durante `initialized` (reapertura automática de `openTabMeta`);
      // solo sincronizamos con `didChange` si el texto cambió mientras arrancaba el servidor.
      const latestText = this.openTabMeta.get(path)?.text ?? text;
      if (latestText !== text) {
        this.changeDocument(path, latestText);
      }
      return;
    }
    if (prevDoc?.changeTimer) clearTimeout(prevDoc.changeTimer);

    const latestText = this.openTabMeta.get(path)?.text ?? text;
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
        text: latestText,
      },
    });
  }

  changeDocument(path: string, text: string): void {
    const meta = this.openTabMeta.get(path);
    if (meta) meta.text = text;
    const doc = this.openDocs.get(path);
    if (!doc) {
      if (meta) void this.openDocument(path, text, meta.rootPath);
      return;
    }
    const session = this.sessions.get(doc.serverKey);
    if (!session || !session.initialized) return;

    if (doc.changeTimer) clearTimeout(doc.changeTimer);
    doc.changeTimer = setTimeout(() => {
      doc.changeTimer = null;
      if (this.openDocs.get(path) !== doc) return;
      const liveSession = this.sessions.get(doc.serverKey);
      if (!liveSession || !liveSession.initialized) return;
      doc.version += 1;
      this.sendNotification(liveSession, "textDocument/didChange", {
        textDocument: { uri: doc.uri, version: doc.version },
        contentChanges: [{ text }],
      });
    }, 150);
  }

  closeDocument(path: string): void {
    this.openTabMeta.delete(path);
    this.docSeq.set(path, (this.docSeq.get(path) ?? 0) + 1);
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
        if (this.sessions.get(doc.serverKey) !== session) return;
        const usedNow = [...this.openDocs.values()].some((d) => d.serverKey === doc.serverKey);
        if (usedNow) return;
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

  async resolveCompletion(path: string, item: LspCompletionItem): Promise<LspCompletionItem | null> {
    const doc = this.openDocs.get(path);
    if (!doc) return null;
    const session = this.sessions.get(doc.serverKey);
    if (!session || !session.initialized) return null;

    try {
      return await this.sendRequest<LspCompletionItem | null>(session, "completionItem/resolve", item, 800);
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

  async definition(path: string, line: number, character: number): Promise<LspLocation | null> {
    const doc = this.openDocs.get(path);
    if (!doc) return null;
    const session = this.sessions.get(doc.serverKey);
    if (!session || !session.initialized) return null;

    try {
      const res = await this.sendRequest<
        RawLspLocation | RawLspLocation[] | RawLspLocationLink[] | null
      >(session, "textDocument/definition", {
        textDocument: { uri: doc.uri },
        position: { line, character },
      });
      if (!res) return null;
      const first = Array.isArray(res) ? res[0] : res;
      if (!first) return null;

      if ("targetUri" in first) {
        const range = first.targetSelectionRange ?? first.targetRange;
        return {
          path: uriToPath(first.targetUri),
          line: range.start.line,
          character: range.start.character,
        };
      }

      return {
        path: uriToPath(first.uri),
        line: first.range.start.line,
        character: first.range.start.character,
      };
    } catch {
      return null;
    }
  }

  async stopAll(): Promise<void> {
    this.generation += 1;
    for (const doc of this.openDocs.values()) {
      if (doc.changeTimer) clearTimeout(doc.changeTimer);
    }
    this.openDocs.clear();
    this.openTabMeta.clear();
    this.unavailable.clear();
    for (const key of [...this.sessions.keys()]) {
      this.cleanupSession(key);
    }
    const op = this.stopBarrier.then(() => invoke("lsp_stop_all").catch(() => undefined)).then(() => undefined);
    this.stopBarrier = op;
    await op;
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
