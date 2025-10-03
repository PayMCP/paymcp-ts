import { StateStore } from "../types/state.js";

// Minimal Redis-like client interface.
// We define this instead of importing types from "redis" to avoid adding a runtime dependency.
interface RedisLikeClient {
    set(key: string, value: string): Promise<unknown>;
    get(key: string): Promise<string | null>;
    del(key: string): Promise<unknown>;
}

export class RedisStateStore implements StateStore {
    constructor(private redis: RedisLikeClient) { }

    async set(key: string, args: any) {
        await this.redis.set(key, JSON.stringify({ args, ts: Date.now() }));
    }

    async get(key: string) {
        const raw = await this.redis.get(key);
        if (!raw) return undefined;
        try {
            return JSON.parse(raw);
        } catch (err) {
            console.error(`Failed to parse state for key ${key}:`, err);
            return undefined;
        }
    }

    async delete(key: string) {
        await this.redis.del(key);
    }
}
