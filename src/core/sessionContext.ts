/**
 * Session context management for PayMCP using AsyncLocalStorage.
 *
 * This provides a clean API for server-level session management without
 * depending on MCP SDK internals. The server extracts session ID from
 * HTTP headers and provides it to PayMCP via runWithSession().
 *
 * Usage:
 *
 * Server side (e.g., Express):
 * ```typescript
 * import { runWithSession } from 'paymcp';
 *
 * app.post('/mcp', async (req, res) => {
 *   const sessionId = req.headers['mcp-session-id'] || randomUUID();
 *
 *   await runWithSession(sessionId, async () => {
 *     await transport.handleRequest(req, res, req.body);
 *   });
 * });
 * ```
 *
 * Library side (PayMCP internals):
 * ```typescript
 * import { getCurrentSession } from './session.js';
 *
 * const sessionId = getCurrentSession() || randomUUID();
 * ```
 */

import { AsyncLocalStorage } from 'async_hooks';

/**
 * AsyncLocalStorage instance for tracking current session ID.
 * Uses Node.js async_hooks to propagate session context across async operations.
 */
const sessionContext = new AsyncLocalStorage<string>();

/**
 * Run a function with a specific session context.
 * All PayMCP operations within the function will have access to this session ID.
 *
 * @param sessionId - The session ID to set for this execution context
 * @param fn - The async function to execute with session context
 * @returns The result of the function
 *
 * @example
 * ```typescript
 * await runWithSession('user-123-session', async () => {
 *   // All PayMCP operations here will use session ID 'user-123-session'
 *   await transport.handleRequest(req, res, req.body);
 * });
 * ```
 */
export function runWithSession<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  return sessionContext.run(sessionId, fn);
}

/**
 * Get the current session ID from async context.
 * Returns undefined if not running within a runWithSession() context.
 *
 * @returns The current session ID, or undefined if no session context is set
 *
 * @example
 * ```typescript
 * const sessionId = getCurrentSession() || 'default-session';
 * console.log(`Processing request for session: ${sessionId}`);
 * ```
 */
export function getCurrentSession(): string | undefined {
  return sessionContext.getStore();
}
