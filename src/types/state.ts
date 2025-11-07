// src/types/state.ts
export interface StateStore {
  set(key: string, args: any): Promise<void>;
  get(key: string): Promise<{ args: any; ts: number } | undefined>;
  delete(key: string): Promise<void>;
  /**
   * Acquire a per-payment-id lock to prevent concurrent access.
   *
   * This ensures that only one request can process a specific payment_id
   * at a time, preventing both race conditions and payment loss issues.
   *
   * @param key - The payment_id to lock
   * @returns A function to release the lock
   *
   * @example
   * ```typescript
   * await stateStore.lock(paymentId, async () => {
   *   // Critical section - only one request at a time
   *   const stored = await stateStore.get(paymentId);
   *   // ... process payment ...
   *   await stateStore.delete(paymentId);
   * });
   * ```
   */
  lock<T>(key: string, fn: () => Promise<T>): Promise<T>;
}