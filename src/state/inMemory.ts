import { StateStore } from "../types/state.js";

/**
 * Simple promise-based lock implementation for Node.js
 */
class AsyncLock {
  private locked = false;
  private waitQueue: Array<() => void> = [];

  async acquire(): Promise<() => void> {
    while (this.locked) {
      await new Promise<void>((resolve) => this.waitQueue.push(resolve));
    }
    this.locked = true;

    // Return release function
    return () => {
      this.locked = false;
      const next = this.waitQueue.shift();
      if (next) next();
    };
  }
}

export class InMemoryStateStore implements StateStore {
  private store = new Map<string, { args: any; ts: number; expiresAt?: number }>();
  private paymentLocks = new Map<string, AsyncLock>();
  private locksLock = new AsyncLock();
  private sweepInterval: NodeJS.Timeout;

  constructor() {
    // Run cleanup every 10 minutes
    this.sweepInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.store.entries()) {
        if (typeof entry.expiresAt === "number" && entry.expiresAt <= now) {
          this.store.delete(key);
          console.debug(`Delete from store ${key}`,this.store);
        }
      }
    }, 10 * 60 * 1000);

    // Do not keep Node.js process alive just because of the sweeper
    this.sweepInterval.unref?.();
  }

  async set(key: string, args: any, options?: { ttlSeconds?: number }) {
    const ts = Date.now();
    const ttlSeconds = options?.ttlSeconds ?? 60 * 60; // default 60 minutes
    const expiresAt = ts + ttlSeconds * 1000;
    this.store.set(key, { args, ts, expiresAt });
    console.debug(`Setting to store ${key}`,{ args, ts, expiresAt });
  }

  async get(key: string) {
    const entry = this.store.get(key);
    if (!entry) return undefined;

    if (typeof entry.expiresAt === "number" && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }

    return entry;
  }

  async delete(key: string) {
    this.store.delete(key)
  }

  /**
   * Acquire a per-payment-id lock to prevent concurrent access.
   *
   * This ensures that only one request can process a specific payment_id
   * at a time, preventing both race conditions and payment loss issues.
   *
   * @param key - The payment_id to lock
   * @param fn - The function to execute while holding the lock
   * @returns The result of the function
   */
  async lock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    // Get or create lock for this payment_id
    const locksLockRelease = await this.locksLock.acquire();
    try {
      if (!this.paymentLocks.has(key)) {
        this.paymentLocks.set(key, new AsyncLock());
      }
      const paymentLock = this.paymentLocks.get(key)!;
      locksLockRelease();

      // Acquire the payment-specific lock
      const paymentLockRelease = await paymentLock.acquire();
      try {
        return await fn();
      } finally {
        paymentLockRelease();

        // Cleanup lock after use
        const cleanupRelease = await this.locksLock.acquire();
        try {
          this.paymentLocks.delete(key);
        } finally {
          cleanupRelease();
        }
      }
    } catch (error) {
      locksLockRelease();
      throw error;
    }
  }
}
