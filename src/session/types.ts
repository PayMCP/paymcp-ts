export interface SessionData {
  args: any;
  ts: number;
  providerName?: string;
  metadata?: Record<string, any>;
}

export interface SessionKey {
  provider: string;
  paymentId: string;
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
