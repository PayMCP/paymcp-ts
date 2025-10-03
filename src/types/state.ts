// src/types/state.ts
export interface StateStore {
  set(key: string, args: any): Promise<void>;
  get(key: string): Promise<{ args: any; ts: number } | undefined>;
  delete(key: string): Promise<void>;
}