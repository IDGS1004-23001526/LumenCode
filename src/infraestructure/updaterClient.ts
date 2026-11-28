import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import type { UpdateState } from "../domain/types";

const STARTUP_DELAY_MS = 3_500;
const RECHECK_INTERVAL_MS = 4 * 60 * 60 * 1_000; // 4 horas

class UpdaterClient {
  private pending: Update | null = null;
  private checking = false;
  private installing = false;
  private state: UpdateState = { phase: "idle", version: null, progress: 0 };
  private onState: ((s: UpdateState) => void) | null = null;
  private startupTimer: ReturnType<typeof setTimeout> | null = null;
  private intervalTimer: ReturnType<typeof setInterval> | null = null;

  private emit(next: UpdateState) {
    if (
      this.state.phase === next.phase &&
      this.state.version === next.version &&
      this.state.progress === next.progress
    ) {
      return;
    }
    this.state = next;
    this.onState?.(next);
  }

  start(onState: (s: UpdateState) => void): void {
    this.onState = onState;
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
    if (this.startupTimer) clearTimeout(this.startupTimer);
    if (this.intervalTimer) clearInterval(this.intervalTimer);

    this.startupTimer = setTimeout(() => {
      this.startupTimer = null;
      void this.checkAndDownload();
    }, STARTUP_DELAY_MS);

    this.intervalTimer = setInterval(() => {
      if (this.state.phase === "idle") {
        void this.checkAndDownload();
      }
    }, RECHECK_INTERVAL_MS);
  }

  async checkAndDownload(): Promise<void> {
    if (this.checking || this.installing || this.pending) return;
    this.checking = true;
    try {
      const update = await check();
      if (!update) return;

      this.pending = update;
      let totalBytes = 0;
      let downloadedBytes = 0;

      this.emit({ phase: "downloading", version: update.version, progress: -1 });

      await update.download((ev) => {
        if (ev.event === "Started") {
          totalBytes = ev.data.contentLength ?? 0;
          downloadedBytes = 0;
          this.emit({
            phase: "downloading",
            version: update.version,
            progress: totalBytes > 0 ? 0 : -1,
          });
        } else if (ev.event === "Progress") {
          downloadedBytes += ev.data.chunkLength;
          const pct =
            totalBytes > 0
              ? Math.min(99, Math.max(0, Math.round((downloadedBytes / totalBytes) * 100)))
              : -1;
          this.emit({ phase: "downloading", version: update.version, progress: pct });
        } else if (ev.event === "Finished") {
          // `Finished` ocurre antes de verificar la firma criptográfica; solo pasamos a `ready` al resolver `download()`.
          this.emit({ phase: "downloading", version: update.version, progress: 100 });
        }
      });

      this.emit({ phase: "ready", version: update.version, progress: 100 });
    } catch {
      // Sin conexión, sin release publicado o firma aún no configurada: falla en silencio
      const failed = this.pending;
      this.pending = null;
      if (failed) void failed.close().catch(() => {});
      this.emit({ phase: "idle", version: null, progress: 0 });
    } finally {
      this.checking = false;
    }
  }

  async installAndRestart(opts: {
    beforeInstall: () => Promise<boolean>;
    onError: (message: string) => Promise<void>;
  }): Promise<void> {
    if (!this.pending || this.installing || this.state.phase !== "ready") return;
    this.installing = true;
    let ok = false;
    try {
      ok = await opts.beforeInstall();
    } catch {
      this.installing = false;
      return;
    }
    if (!ok) {
      this.installing = false;
      return;
    }

    const target = this.pending;
    this.emit({ phase: "installing", version: target.version, progress: 100 });

    try {
      await target.install();
      await relaunch();
    } catch (err) {
      this.installing = false;
      this.emit({ phase: "ready", version: target.version, progress: 100 });
      await opts.onError(`No se pudo instalar la actualización.\n\n${String(err)}`);
    }
  }
}

export const updaterClient = new UpdaterClient();
