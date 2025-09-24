/**
 * Utilities for extracting MCP session ID from context.
 */

/**
 * Extract MCP session ID from the context object.
 *
 * For HTTP transport, the session ID comes from Mcp-Session-Id header.
 * For STDIO transport, there is no session ID (returns undefined).
 *
 * @param extra The MCP context object (e.g., FastMCP Context)
 * @param logger Optional logger for warnings
 * @returns The session ID if available, undefined otherwise
 */
export function extractSessionId(extra: any, logger?: any): string | undefined {
  if (!extra) {
    return undefined;
  }

  // Try different ways to get session ID based on the MCP implementation

  // 1. Check if extra has headers with Mcp-Session-Id
  if (extra.headers) {
    const headers = extra.headers;
    if (typeof headers === 'object') {
      // Check for Mcp-Session-Id header (case-insensitive)
      for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === 'mcp-session-id') {
          return value as string;
        }
      }
    }
  }

  // 2. Check if extra has a request object with headers
  if (extra.request?.headers) {
    const headers = extra.request.headers;
    if (typeof headers === 'object') {
      for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === 'mcp-session-id') {
          return value as string;
        }
      }
    }
  }

  // 3. Check if extra has _meta with headers (some MCP implementations)
  if (extra._meta?.headers) {
    const headers = extra._meta.headers;
    if (typeof headers === 'object') {
      for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === 'mcp-session-id') {
          return value as string;
        }
      }
    }
  }

  // No session ID found
  // Check if this looks like HTTP context (has headers)
  if (extra?.headers || extra?.request?.headers || extra?._meta?.headers) {
    // HTTP context but no session ID - log warning
    if (logger?.warn) {
      logger.warn(
        'MCP session ID not found in HTTP context. ' +
        'This may cause issues with multi-client scenarios. ' +
        'Ensure your MCP server provides Mcp-Session-Id header.'
      );
    }
  }
  // STDIO transport or HTTP without session
  return undefined;
}