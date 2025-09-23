import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionManager } from '../../src/session/manager';
import { InMemorySessionStorage } from '../../src/session/memory';
import { ISessionStorage, SessionStorageConfig } from '../../src/session/types';

describe('SessionManager', () => {
  beforeEach(() => {
    SessionManager.reset();
  });

  afterEach(() => {
    SessionManager.reset();
  });

  describe('getStorage', () => {
    it('should return singleton instance', () => {
      const storage1 = SessionManager.getStorage();
      const storage2 = SessionManager.getStorage();

      expect(storage1).toBe(storage2);
    });

    it('should create memory storage by default', () => {
      const storage = SessionManager.getStorage();

      expect(storage).toBeInstanceOf(InMemorySessionStorage);
    });

    it('should create memory storage when explicitly configured', () => {
      const config: SessionStorageConfig = { type: 'memory' };
      const storage = SessionManager.getStorage(config);

      expect(storage).toBeInstanceOf(InMemorySessionStorage);
    });
  });

  describe('createStorage', () => {
    it('should create memory storage', () => {
      const config: SessionStorageConfig = { type: 'memory' };
      const storage = SessionManager.createStorage(config);

      expect(storage).toBeInstanceOf(InMemorySessionStorage);
    });

    it('should throw error for redis storage (not yet implemented)', () => {
      const config: SessionStorageConfig = { type: 'redis' };

      expect(() => SessionManager.createStorage(config)).toThrow(
        'Redis storage not yet implemented'
      );
    });

    it('should create custom storage when provided', () => {
      const mockStorage: ISessionStorage = {
        set: vi.fn(),
        get: vi.fn(),
        delete: vi.fn(),
        has: vi.fn(),
        clear: vi.fn(),
        cleanup: vi.fn(),
      } as any;

      const config: SessionStorageConfig = {
        type: 'custom',
        options: { implementation: mockStorage },
      };

      const storage = SessionManager.createStorage(config);

      expect(storage).toBe(mockStorage);
    });

    it('should throw error for custom storage without implementation', () => {
      const config: SessionStorageConfig = {
        type: 'custom',
        options: {},
      };

      expect(() => SessionManager.createStorage(config)).toThrow(
        'Custom storage requires an implementation'
      );
    });

    it('should throw error for unknown storage type', () => {
      const config = { type: 'unknown' } as any;

      expect(() => SessionManager.createStorage(config)).toThrow('Unknown storage type: unknown');
    });
  });

  describe('reset', () => {
    it('should reset singleton instance', () => {
      const storage1 = SessionManager.getStorage();
      SessionManager.reset();
      const storage2 = SessionManager.getStorage();

      expect(storage1).not.toBe(storage2);
    });

    it('should handle multiple resets gracefully', () => {
      SessionManager.reset();
      SessionManager.reset();

      // Should not throw
      expect(() => SessionManager.getStorage()).not.toThrow();
    });
  });
});
