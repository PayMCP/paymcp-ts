import { vi } from 'vitest';

/**
 * Helper function to run tests with fake timers properly
 * Ensures timers are set before async operations start
 */
export async function withFakeTimers(
  fn: () => Promise<void> | void,
  options?: {
    autoAdvance?: boolean;
    maxAdvanceTime?: number;
  }
) {
  const { autoAdvance = false, maxAdvanceTime = 15 * 60 * 1000 } = options || {};
  
  vi.useFakeTimers();
  try {
    if (autoAdvance) {
      const promise = Promise.resolve(fn());
      await vi.advanceTimersByTimeAsync(maxAdvanceTime);
      await promise;
    } else {
      await fn();
    }
  } finally {
    vi.useRealTimers();
  }
}

/**
 * Helper to advance timers in steps and check conditions
 */
export async function advanceTimersInSteps(
  stepMs: number,
  maxSteps: number,
  checkCondition?: () => boolean
) {
  for (let i = 0; i < maxSteps; i++) {
    await vi.advanceTimersByTimeAsync(stepMs);
    if (checkCondition && checkCondition()) {
      break;
    }
  }
}

/**
 * Helper to run pending timers without advancing time
 */
export async function runPendingTimers() {
  await vi.runOnlyPendingTimersAsync();
}

/**
 * Helper to run all timers until no more are queued
 */
export async function runAllTimers() {
  await vi.runAllTimersAsync();
}