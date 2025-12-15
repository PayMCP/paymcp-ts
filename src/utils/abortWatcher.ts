import type { Logger } from "../types/logger.js";

/**
 * Small helper to watch AbortSignal and expose a boolean flag.
 */
export class AbortWatcher {
  aborted = false;
  private onAbort?: () => void;
  private signal?: AbortSignal;
  private log?: Logger;

  constructor(signal?: AbortSignal, log?: Logger) {
    this.signal = signal;
    this.log = log;
    if (signal) {
      this.onAbort = () => {
        this.aborted = true;
        this.log?.warn?.(`[PayMCP] request aborted (reason=${String((signal as any).reason ?? "unknown")})`);
      };
      signal.addEventListener("abort", this.onAbort, { once: true });
      if (signal.aborted) {
        this.onAbort();
      }
    }
  }

  dispose() {
    if (this.signal && this.onAbort) {
      this.signal.removeEventListener("abort", this.onAbort);
    }
  }
}
