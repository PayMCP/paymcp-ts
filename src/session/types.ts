export interface SessionData {
  args: any;
  ts: number;
  providerName?: string;
  metadata?: Record<string, any>;
}

/**
 * SessionKey implementation with automatic transport detection:
 * - HTTP with session ID: Uses mcp:{sessionId}:{paymentId} for multi-client isolation
 * - STDIO or HTTP without session: Uses {provider}:{paymentId} for single client
 *
 * Note: HTTP transport should provide Mcp-Session-Id header per MCP spec.
 * If missing, falls back to provider:paymentId (less isolation between clients).
 */
export class SessionKey {
  constructor(
    public provider: string,
    public paymentId: string,
    public mcpSessionId?: string
  ) {}

  /**
   * Generate storage key based on available identifiers:
   * - With session ID: mcp:{sessionId}:{paymentId} (proper client isolation)
   * - Without session ID: {provider}:{paymentId} (STDIO or degraded HTTP)
   */
  toString(): string {
    if (this.mcpSessionId) {
      // HTTP transport with proper MCP session ID
      return `mcp:${this.mcpSessionId}:${this.paymentId}`;
    } else {
      // STDIO transport or HTTP without session ID
      // Warning: In HTTP mode without session ID, different clients may conflict
      return `${this.provider}:${this.paymentId}`;
    }
  }
}

export interface ISessionStorage {
  set(key: SessionKey, data: SessionData, ttlSeconds?: number): Promise<void>;
  get(key: SessionKey): Promise<SessionData | undefined>;
  delete(key: SessionKey): Promise<void>;
  has(key: SessionKey): Promise<boolean>;
  clear(): Promise<void>;
  cleanup(): Promise<void>;
  destroy?(): void; // Optional method to clean up resources like intervals
}

export interface SessionStorageConfig {
  type: 'memory' | 'redis' | 'custom';
  options?: Record<string, any>;
}
