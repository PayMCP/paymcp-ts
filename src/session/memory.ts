import { ISessionStorage, SessionData } from './types.js';
import { SessionKey } from './types.js';

interface StoredSession {
  data: SessionData;
  expiresAt?: number;
}

export class InMemorySessionStorage implements ISessionStorage {
  private storage = new Map<string, StoredSession>();
  private cleanupInterval: ReturnType<typeof setInterval> | undefined;

  constructor() {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60000);
  }

  private makeKey(key: SessionKey): string {
    return key.toString();
  }

  async set(key: SessionKey, data: SessionData, ttlSeconds?: number): Promise<void> {
    const compositeKey = this.makeKey(key);
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined;

    this.storage.set(compositeKey, {
      data,
      expiresAt,
    });
  }

  async get(key: SessionKey): Promise<SessionData | undefined> {
    const compositeKey = this.makeKey(key);
    const stored = this.storage.get(compositeKey);

    if (!stored) {
      return undefined;
    }

    if (stored.expiresAt && Date.now() > stored.expiresAt) {
      this.storage.delete(compositeKey);
      return undefined;
    }

    return stored.data;
  }

  async delete(key: SessionKey): Promise<void> {
    const compositeKey = this.makeKey(key);
    this.storage.delete(compositeKey);
  }

  async has(key: SessionKey): Promise<boolean> {
    const data = await this.get(key);
    return data !== undefined;
  }

  async clear(): Promise<void> {
    this.storage.clear();
  }

  async cleanup(): Promise<void> {
    const now = Date.now();
    for (const [key, stored] of this.storage.entries()) {
      if (stored.expiresAt && now > stored.expiresAt) {
        this.storage.delete(key);
      }
    }
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
    this.storage.clear();
  }
}
