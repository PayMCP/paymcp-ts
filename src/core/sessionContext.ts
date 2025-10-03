/**
 * Session Context Management using AsyncLocalStorage.
 *
 * WHY THIS EXISTS:
 * The MCP SDK provides session IDs to tool handlers via `extra.sessionId`, but does NOT
 * provide session context to server methods like `list_tools()`. The LIST_CHANGE flow
 * requires per-session tool filtering during `list_tools()` to hide/show different tools
 * for each concurrent user.
 *
 * SOLUTION:
 * AsyncLocalStorage (Node.js async_hooks) provides request-scoped context that propagates
 * through all async operations. By wrapping `transport.handleRequest()` in `runWithSession()`,
 * we make the session ID available to PayMCP's tool filtering logic via `getCurrentSession()`.
 *
 * MULTI-USER ISOLATION:
 * Without this, all users would share the same HIDDEN_TOOLS state, breaking LIST_CHANGE flow.
 * With AsyncLocalStorage, each user maintains independent tool visibility.
 *
 * Usage in demo apps:
 * ```typescript
 * import { runWithSession } from 'paymcp';
 *
 * app.post('/mcp', async (req, res) => {
 *   const sessionId = req.headers['mcp-session-id'];
 *
 *   // CRITICAL: Wrap transport handling to set session context
 *   await runWithSession(sessionId, async () => {
 *     await transport.handleRequest(req, res, req.body);
 *   });
 * });
 * ```
 */

import { AsyncLocalStorage } from 'async_hooks';

// AsyncLocalStorage instance for tracking current session
const sessionStorage = new AsyncLocalStorage<string>();

/**
 * Get the current session ID from async context.
 * Returns undefined if no session is set (falls back to global mode).
 */
export function getCurrentSession(): string | undefined {
  return sessionStorage.getStore();
}

/**
 * Run a function with a specific session ID set in async context.
 *
 * CRITICAL: This function properly handles both sync and async callbacks.
 * For async functions, it returns Promise<T> and properly awaits completion.
 *
 * @param sessionId - Session identifier (e.g., from mcp-session-id header)
 * @param fn - Sync or async function to execute within this session context
 * @returns Result of the function (Promise if fn is async, value if fn is sync)
 */
export function runWithSession<T>(sessionId: string | undefined, fn: () => T | Promise<T>): T | Promise<T> {
  if (sessionId) {
    return sessionStorage.run(sessionId, fn);
  }
  return fn();
}

/**
 * Convenience function to set session context and execute a callback.
 * Alias for runWithSession for backwards compatibility.
 */
export const setCurrentSession = runWithSession;