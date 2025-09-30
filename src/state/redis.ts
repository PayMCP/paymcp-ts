import { StateStore } from "../types/state.js";

// Minimal Redis-like client interface.
// We define this instead of importing types from "redis" to avoid adding a runtime dependency.
interface RedisLikeClient {
  set(key: string, value: string): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<unknown>;
}

export class RedisStateStore implements StateStore {
  constructor(private redis: RedisLikeClient) {}

  async set(key: string, args: any) {
    await this.redis.set(key, JSON.stringify({ args, ts: Date.now() }));
  }

  async get(key: string) {
    const raw = await this.redis.get(key);
    return raw ? JSON.parse(raw) : undefined;
  }

  async delete(key: string) {
    await this.redis.del(key);
  }
}