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
  // Per-key lock plus a count of everyone holding or waiting for it, so the
  // entry is only discarded once nobody is left on it.
  private paymentLocks = new Map<string, { lock: AsyncLock; users: number }>();
  private locksLock = new AsyncLock();
  private sweepInterval: NodeJS.Timeout;

  constructor() {
    // Run cleanup every 10 minutes
    this.sweepInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.store.entries()) {
        if (typeof entry.expiresAt === "number" && entry.expiresAt <= now) {
          this.store.delete(key);
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
    // Get or create the lock for this payment_id, and register as a user of it
    // before releasing the registry lock - otherwise the current holder could
    // finish and discard the entry while this caller is still queueing on it,
    // and the next arrival would build a second lock for the same key and run
    // concurrently with whoever is queued on the first.
    const locksLockRelease = await this.locksLock.acquire();
    let entry: { lock: AsyncLock; users: number };
    try {
      const existing = this.paymentLocks.get(key);
      entry = existing ?? { lock: new AsyncLock(), users: 0 };
      if (!existing) this.paymentLocks.set(key, entry);
      entry.users++;
    } finally {
      // Exactly once: releasing this twice would let a second caller past the
      // registry lock while the first still believes it holds it.
      locksLockRelease();
    }

    const paymentLockRelease = await entry.lock.acquire();
    try {
      return await fn();
    } finally {
      paymentLockRelease();

      const cleanupRelease = await this.locksLock.acquire();
      try {
        entry.users--;
        // Only drop the entry when no one else is on it, and only if it is
        // still the entry this call was using.
        if (entry.users === 0 && this.paymentLocks.get(key) === entry) {
          this.paymentLocks.delete(key);
        }
      } finally {
        cleanupRelease();
      }
    }
  }
}
