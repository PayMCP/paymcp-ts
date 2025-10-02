import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryStateStore } from '../../src/state/inMemory.js';

describe('InMemoryStateStore', () => {
  let store: InMemoryStateStore;

  beforeEach(() => {
    store = new InMemoryStateStore();
  });

  describe('set', () => {
    it('should store data with timestamp', async () => {
      const args = { param1: 'value1', param2: 42 };
      await store.set('key1', args);

      const result = await store.get('key1');
      expect(result).toBeDefined();
      expect(result?.args).toEqual(args);
      expect(result?.ts).toBeTypeOf('number');
      expect(result?.ts).toBeGreaterThan(0);
    });

    it('should overwrite existing data', async () => {
      await store.set('key1', { old: 'data' });
      await store.set('key1', { new: 'data' });

      const result = await store.get('key1');
      expect(result?.args).toEqual({ new: 'data' });
    });

    it('should handle undefined args', async () => {
      await store.set('key1', undefined);

      const result = await store.get('key1');
      expect(result).toBeDefined();
      expect(result?.args).toBeUndefined();
    });

    it('should handle null args', async () => {
      await store.set('key1', null);

      const result = await store.get('key1');
      expect(result).toBeDefined();
      expect(result?.args).toBeNull();
    });
  });

  describe('get', () => {
    it('should return undefined for non-existent key', async () => {
      const result = await store.get('non-existent');
      expect(result).toBeUndefined();
    });

    it('should retrieve previously stored data', async () => {
      const args = { test: 'data' };
      await store.set('key1', args);

      const result = await store.get('key1');
      expect(result?.args).toEqual(args);
    });

    it('should handle multiple keys independently', async () => {
      await store.set('key1', { value: 1 });
      await store.set('key2', { value: 2 });

      const result1 = await store.get('key1');
      const result2 = await store.get('key2');

      expect(result1?.args).toEqual({ value: 1 });
      expect(result2?.args).toEqual({ value: 2 });
    });
  });

  describe('delete', () => {
    it('should remove stored data', async () => {
      await store.set('key1', { test: 'data' });
      await store.delete('key1');

      const result = await store.get('key1');
      expect(result).toBeUndefined();
    });

    it('should not throw error when deleting non-existent key', async () => {
      await expect(store.delete('non-existent')).resolves.not.toThrow();
    });

    it('should only delete specified key', async () => {
      await store.set('key1', { value: 1 });
      await store.set('key2', { value: 2 });

      await store.delete('key1');

      const result1 = await store.get('key1');
      const result2 = await store.get('key2');

      expect(result1).toBeUndefined();
      expect(result2?.args).toEqual({ value: 2 });
    });
  });

  describe('timestamp behavior', () => {
    it('should update timestamp on each set', async () => {
      await store.set('key1', { value: 1 });
      const result1 = await store.get('key1');
      const ts1 = result1?.ts;

      // Small delay to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 10));

      await store.set('key1', { value: 2 });
      const result2 = await store.get('key1');
      const ts2 = result2?.ts;

      expect(ts2).toBeGreaterThan(ts1!);
    });
  });

  describe('complex data types', () => {
    it('should handle nested objects', async () => {
      const args = {
        nested: {
          deep: {
            value: 'test'
          }
        },
        array: [1, 2, 3]
      };

      await store.set('key1', args);
      const result = await store.get('key1');

      expect(result?.args).toEqual(args);
    });

    it('should handle arrays', async () => {
      const args = [1, 'two', { three: 3 }];

      await store.set('key1', args);
      const result = await store.get('key1');

      expect(result?.args).toEqual(args);
    });
  });
});
