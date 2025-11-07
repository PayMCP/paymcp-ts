import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RedisStateStore } from '../../src/state/redis.js';

describe('RedisStateStore', () => {
  let mockRedis: any;
  let store: RedisStateStore;

  beforeEach(() => {
    mockRedis = {
      set: vi.fn().mockResolvedValue('OK'),
      get: vi.fn().mockResolvedValue(null),
      del: vi.fn().mockResolvedValue(1),
      eval: vi.fn().mockResolvedValue(1)
    };
    // Use empty prefix for tests to match old behavior
    store = new RedisStateStore(mockRedis, { prefix: '' });
  });

  describe('set', () => {
    it('should store data with timestamp as JSON string', async () => {
      const args = { param1: 'value1', param2: 42 };
      await store.set('key1', args);

      expect(mockRedis.set).toHaveBeenCalledWith(
        'key1',
        expect.stringContaining('"param1":"value1"')
      );
      expect(mockRedis.set).toHaveBeenCalledWith(
        'key1',
        expect.stringContaining('"param2":42')
      );
      expect(mockRedis.set).toHaveBeenCalledWith(
        'key1',
        expect.stringContaining('"ts"')
      );
    });

    it('should handle undefined args', async () => {
      await store.set('key1', undefined);

      expect(mockRedis.set).toHaveBeenCalledWith(
        'key1',
        expect.stringContaining('"ts"')
      );
      const setCall = mockRedis.set.mock.calls[0];
      const storedJson = setCall[1];
      const parsed = JSON.parse(storedJson);
      expect(parsed).toHaveProperty('ts');
    });

    it('should handle null args', async () => {
      await store.set('key1', null);

      expect(mockRedis.set).toHaveBeenCalledWith(
        'key1',
        expect.stringContaining('"args":null')
      );
    });

    it('should handle complex nested objects', async () => {
      const args = {
        nested: {
          deep: {
            value: 'test'
          }
        },
        array: [1, 2, 3]
      };
      await store.set('key1', args);

      expect(mockRedis.set).toHaveBeenCalledWith(
        'key1',
        expect.stringContaining('"nested"')
      );
    });
  });

  describe('get', () => {
    it('should return undefined for non-existent key', async () => {
      mockRedis.get.mockResolvedValue(null);

      const result = await store.get('non-existent');
      expect(result).toBeUndefined();
      expect(mockRedis.get).toHaveBeenCalledWith('non-existent');
    });

    it('should retrieve and parse previously stored data', async () => {
      const args = { test: 'data' };
      const stored = { args, ts: Date.now() };
      mockRedis.get.mockResolvedValue(JSON.stringify(stored));

      const result = await store.get('key1');
      expect(result).toEqual(stored);
      expect(result?.args).toEqual(args);
    });

    it('should handle stored data with undefined args', async () => {
      const stored = { args: undefined, ts: Date.now() };
      mockRedis.get.mockResolvedValue(JSON.stringify(stored));

      const result = await store.get('key1');
      expect(result).toEqual(stored);
      expect(result?.args).toBeUndefined();
    });

    it('should handle stored data with null args', async () => {
      const stored = { args: null, ts: Date.now() };
      mockRedis.get.mockResolvedValue(JSON.stringify(stored));

      const result = await store.get('key1');
      expect(result).toEqual(stored);
      expect(result?.args).toBeNull();
    });

    it('should handle complex nested objects', async () => {
      const args = {
        nested: {
          deep: {
            value: 'test'
          }
        },
        array: [1, 2, 3]
      };
      const stored = { args, ts: Date.now() };
      mockRedis.get.mockResolvedValue(JSON.stringify(stored));

      const result = await store.get('key1');
      expect(result?.args).toEqual(args);
    });
  });

  describe('delete', () => {
    it('should remove stored data', async () => {
      await store.delete('key1');

      expect(mockRedis.del).toHaveBeenCalledWith('key1');
    });

    it('should handle deleting non-existent key', async () => {
      mockRedis.del.mockResolvedValue(0);

      await store.delete('non-existent');

      expect(mockRedis.del).toHaveBeenCalledWith('non-existent');
    });
  });

  describe('error handling', () => {
    it('should handle JSON parse errors in get()', async () => {
      mockRedis.get.mockResolvedValue('invalid json{{{');

      const result = await store.get('corrupt-key');

      expect(result).toBeUndefined();
      expect(mockRedis.get).toHaveBeenCalledWith('corrupt-key');
    });
  });

  describe('lock', () => {
    it('should acquire lock, execute function, and release lock', async () => {
      // Mock successful lock acquisition
      mockRedis.set.mockResolvedValue('OK');

      const mockFn = vi.fn().mockResolvedValue('result');

      const result = await store.lock('payment_123', mockFn);

      // Verify lock was acquired with correct parameters
      expect(mockRedis.set).toHaveBeenCalledWith(
        'lock:payment_123',
        expect.any(String), // lockValue is timestamp
        { NX: true, EX: 30 } // Default lockTimeout is 30 seconds
      );

      // Verify function was executed
      expect(mockFn).toHaveBeenCalled();
      expect(result).toBe('result');

      // Verify lock was released using Lua script
      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.stringContaining('redis.call("get"'),
        1,
        'lock:payment_123',
        expect.any(String) // lockValue
      );
    });

    it('should release lock even if function throws error', async () => {
      mockRedis.set.mockResolvedValue('OK');

      const mockFn = vi.fn().mockRejectedValue(new Error('Function error'));

      await expect(store.lock('payment_123', mockFn)).rejects.toThrow('Function error');

      // Verify lock was released despite error
      expect(mockRedis.eval).toHaveBeenCalled();
    });

    it('should return function result', async () => {
      mockRedis.set.mockResolvedValue('OK');

      const mockFn = vi.fn().mockResolvedValue({ data: 'test', count: 42 });

      const result = await store.lock('payment_123', mockFn);

      expect(result).toEqual({ data: 'test', count: 42 });
    });

    it('should retry with exponential backoff when lock is contended', async () => {
      // First 3 attempts fail, 4th succeeds
      mockRedis.set
        .mockResolvedValueOnce(null) // 1st attempt fails
        .mockResolvedValueOnce(null) // 2nd attempt fails
        .mockResolvedValueOnce(null) // 3rd attempt fails
        .mockResolvedValueOnce('OK'); // 4th attempt succeeds

      const mockFn = vi.fn().mockResolvedValue('result');

      const result = await store.lock('payment_123', mockFn);

      // Verify it tried 4 times
      expect(mockRedis.set).toHaveBeenCalledTimes(4);
      expect(mockFn).toHaveBeenCalled();
      expect(result).toBe('result');
    });

    it('should throw error after max attempts exceeded', async () => {
      // All 10 attempts fail
      mockRedis.set.mockResolvedValue(null);

      const mockFn = vi.fn().mockResolvedValue('result');

      await expect(store.lock('payment_123', mockFn)).rejects.toThrow(
        'Failed to acquire lock for payment_id=payment_123 after 10 attempts'
      );

      // Verify it tried 10 times
      expect(mockRedis.set).toHaveBeenCalledTimes(10);

      // Function should NOT have been called
      expect(mockFn).not.toHaveBeenCalled();

      // Lock should NOT be released (since it was never acquired)
      expect(mockRedis.eval).not.toHaveBeenCalled();
    }, 15000); // 15 second timeout for exponential backoff test

    it('should use Lua script for atomic lock release', async () => {
      mockRedis.set.mockResolvedValue('OK');

      const mockFn = vi.fn().mockResolvedValue('result');

      await store.lock('payment_123', mockFn);

      // Verify Lua script contains atomic check-and-delete
      const evalCall = mockRedis.eval.mock.calls[0];
      const luaScript = evalCall[0];

      expect(luaScript).toContain('redis.call("get", KEYS[1])');
      expect(luaScript).toContain('redis.call("del", KEYS[1])');
      expect(luaScript).toContain('ARGV[1]'); // Check value matches
    });

    it('should handle lock release when not owned (Lua script returns 0)', async () => {
      mockRedis.set.mockResolvedValue('OK');
      mockRedis.eval.mockResolvedValue(0); // Lock wasn't owned (already expired/released)

      const mockFn = vi.fn().mockResolvedValue('result');

      const result = await store.lock('payment_123', mockFn);

      // Should still complete successfully
      expect(result).toBe('result');
      expect(mockRedis.eval).toHaveBeenCalled();
    });

    it('should use custom prefix for lock keys', async () => {
      const prefixedStore = new RedisStateStore(mockRedis, {
        prefix: 'paymcp:',
        lockTimeout: 30
      });

      mockRedis.set.mockResolvedValue('OK');

      const mockFn = vi.fn().mockResolvedValue('result');

      await prefixedStore.lock('payment_123', mockFn);

      // Verify lock key uses prefix
      expect(mockRedis.set).toHaveBeenCalledWith(
        'paymcp:lock:payment_123',
        expect.any(String),
        { NX: true, EX: 30 }
      );
    });

    it('should use custom lockTimeout', async () => {
      const customStore = new RedisStateStore(mockRedis, {
        prefix: '',
        lockTimeout: 60 // 60 seconds
      });

      mockRedis.set.mockResolvedValue('OK');

      const mockFn = vi.fn().mockResolvedValue('result');

      await customStore.lock('payment_123', mockFn);

      // Verify lock timeout is 60 seconds
      expect(mockRedis.set).toHaveBeenCalledWith(
        'lock:payment_123',
        expect.any(String),
        { NX: true, EX: 60 }
      );
    });
  });

  describe('integration scenarios', () => {
    it('should handle set-get-delete cycle', async () => {
      const args = { value: 'test' };
      const stored = { args, ts: Date.now() };

      // Set
      await store.set('key1', args);
      const setCall = mockRedis.set.mock.calls[0];
      const storedJson = setCall[1];

      // Get
      mockRedis.get.mockResolvedValue(storedJson);
      const retrieved = await store.get('key1');
      expect(retrieved?.args).toEqual(args);

      // Delete
      await store.delete('key1');
      expect(mockRedis.del).toHaveBeenCalledWith('key1');

      // Get after delete
      mockRedis.get.mockResolvedValue(null);
      const afterDelete = await store.get('key1');
      expect(afterDelete).toBeUndefined();
    });

    it('should handle multiple keys independently', async () => {
      await store.set('key1', { value: 1 });
      await store.set('key2', { value: 2 });

      const stored1 = { args: { value: 1 }, ts: Date.now() };
      const stored2 = { args: { value: 2 }, ts: Date.now() };

      mockRedis.get.mockResolvedValueOnce(JSON.stringify(stored1));
      mockRedis.get.mockResolvedValueOnce(JSON.stringify(stored2));

      const result1 = await store.get('key1');
      const result2 = await store.get('key2');

      expect(result1?.args).toEqual({ value: 1 });
      expect(result2?.args).toEqual({ value: 2 });
    });

    it('should overwrite existing data on set', async () => {
      await store.set('key1', { old: 'data' });
      await store.set('key1', { new: 'data' });

      expect(mockRedis.set).toHaveBeenCalledTimes(2);
      const lastCall = mockRedis.set.mock.calls[1];
      expect(lastCall[1]).toContain('"new":"data"');
    });
  });
});
