import { StateStore } from "../types/state.js";

// Minimal Redis-like client interface.
// We define this instead of importing types from "redis" to avoid adding a runtime dependency.
interface RedisLikeClient {
    set(key: string, value: string, options?: { NX?: boolean; EX?: number }): Promise<string | null>;
    get(key: string): Promise<string | null>;
    del(key: string): Promise<unknown>;
    eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<any>;
}

export class RedisStateStore implements StateStore {
    private prefix: string;
    private ttl: number;
    private lockTimeout: number;

    constructor(
        private redis: RedisLikeClient,
        options?: {
            prefix?: string;
            ttl?: number;
            lockTimeout?: number;
        }
    ) {
        this.prefix = options?.prefix ?? "paymcp:";
        this.ttl = options?.ttl ?? 3600;
        this.lockTimeout = options?.lockTimeout ?? 30;
    }

    async set(key: string, args: any) {
        await this.redis.set(`${this.prefix}${key}`, JSON.stringify({ args, ts: Date.now() }));
    }

    async get(key: string) {
        const raw = await this.redis.get(`${this.prefix}${key}`);
        if (!raw) return undefined;
        try {
            return JSON.parse(raw);
        } catch (err) {
            console.error(`Failed to parse state for key ${key}:`, err);
            return undefined;
        }
    }

    async delete(key: string) {
        await this.redis.del(`${this.prefix}${key}`);
    }

    /**
     * Acquire a distributed lock for a specific payment_id using Redis.
     *
     * This ensures that only one request across ALL server instances can
     * process a specific payment_id at a time, preventing both race
     * conditions and payment loss issues.
     *
     * @param key - The payment_id to lock
     * @param fn - The function to execute while holding the lock
     * @returns The result of the function
     */
    async lock<T>(key: string, fn: () => Promise<T>): Promise<T> {
        const lockKey = `${this.prefix}lock:${key}`;
        const lockValue = `${Date.now()}`; // Unique value for this lock acquisition

        // Try to acquire lock with exponential backoff
        let acquired = false;
        const maxAttempts = 10;
        let attempt = 0;

        while (!acquired && attempt < maxAttempts) {
            // SET NX EX: Set if Not eXists with EXpiration
            const result = await this.redis.set(lockKey, lockValue, {
                NX: true, // Only set if doesn't exist
                EX: this.lockTimeout, // Expires after timeout seconds
            });

            acquired = result === "OK" || result !== null;

            if (!acquired) {
                // Wait with exponential backoff
                const waitTime = Math.min(100 * Math.pow(2, attempt), 2000); // Max 2 seconds
                await new Promise((resolve) => setTimeout(resolve, waitTime));
                attempt++;
            }
        }

        if (!acquired) {
            throw new Error(
                `Failed to acquire lock for payment_id=${key} after ${maxAttempts} attempts. ` +
                    "Another request may be processing this payment."
            );
        }

        try {
            return await fn();
        } finally {
            // Release lock only if we still own it (check value matches)
            // Use Lua script for atomic check-and-delete
            const luaScript = `
                if redis.call("get", KEYS[1]) == ARGV[1] then
                    return redis.call("del", KEYS[1])
                else
                    return 0
                end
            `;
            await this.redis.eval(luaScript, 1, lockKey, lockValue);
        }
    }
}
