import { StateStore } from "../types/state.js";

export class InMemoryStateStore implements StateStore {
  private store = new Map<string, { args: any; ts: number }>();

  async set(key: string, args: any) {
    this.store.set(key, { args, ts: Date.now() });
  }

  async get(key: string) {
    return this.store.get(key);
  }

  async delete(key: string) {
    this.store.delete(key);
  }
}