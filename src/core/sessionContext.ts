/**
 * Session context for LIST_CHANGE per-session tool filtering.
 *
 * WHY: MCP SDK provides sessionId to tool handlers but NOT to list_tools().
 * LIST_CHANGE needs per-session filtering to hide/show tools independently per user.
 *
 * SOLUTION: AsyncLocalStorage propagates sessionId through async call chain.
 * Wrap transport.handleRequest() in runWithSession() to enable per-session filtering.
 *
 * Usage: await runWithSession(req.headers['mcp-session-id'], () => transport.handleRequest(...));
 */
import { AsyncLocalStorage } from 'async_hooks';

const sessionStorage = new AsyncLocalStorage<string>();

export function getCurrentSession(): string | undefined {
  return sessionStorage.getStore();
}

export function runWithSession<T>(sessionId: string | undefined, fn: () => T | Promise<T>): T | Promise<T> {
  return sessionId ? sessionStorage.run(sessionId, fn) : fn();
}

export const setCurrentSession = runWithSession;