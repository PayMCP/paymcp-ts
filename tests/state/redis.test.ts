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
