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

  describe('locking (ENG-213, ENG-214, ENG-215 fixes)', () => {
    it('should execute function within lock', async () => {
      let executed = false;
      await store.lock('test-payment-id', async () => {
        executed = true;
      });
      expect(executed).toBe(true);
    });

    it('should return function result', async () => {
      const result = await store.lock('test-payment-id', async () => {
        return 'test-result';
      });
      expect(result).toBe('test-result');
    });

    it('should serialize concurrent access to same payment_id (ENG-215)', async () => {
      const executionOrder: number[] = [];
      const paymentId = 'payment-123';

      // Two concurrent requests for same payment_id
      const promise1 = store.lock(paymentId, async () => {
        executionOrder.push(1);
        await new Promise((resolve) => setTimeout(resolve, 50));
        executionOrder.push(2);
      });

      const promise2 = store.lock(paymentId, async () => {
        executionOrder.push(3);
        await new Promise((resolve) => setTimeout(resolve, 50));
        executionOrder.push(4);
      });

      await Promise.all([promise1, promise2]);

      // Should execute sequentially: [1, 2, 3, 4] or [3, 4, 1, 2]
      // NOT interleaved like [1, 3, 2, 4]
      expect(executionOrder).toHaveLength(4);
      const isSequential =
        (executionOrder[0] === 1 && executionOrder[1] === 2 && executionOrder[2] === 3 && executionOrder[3] === 4) ||
        (executionOrder[0] === 3 && executionOrder[1] === 4 && executionOrder[2] === 1 && executionOrder[3] === 2);
      expect(isSequential).toBe(true);
    });

    it('should allow concurrent access to different payment_ids', async () => {
      const executionOrder: string[] = [];

      const promise1 = store.lock('payment-1', async () => {
        executionOrder.push('1-start');
        await new Promise((resolve) => setTimeout(resolve, 30));
        executionOrder.push('1-end');
      });

      const promise2 = store.lock('payment-2', async () => {
        executionOrder.push('2-start');
        await new Promise((resolve) => setTimeout(resolve, 30));
        executionOrder.push('2-end');
      });

      await Promise.all([promise1, promise2]);

      // Different payment_ids should execute concurrently (interleaved)
      expect(executionOrder).toHaveLength(4);
      expect(executionOrder).toContain('1-start');
      expect(executionOrder).toContain('1-end');
      expect(executionOrder).toContain('2-start');
      expect(executionOrder).toContain('2-end');
    });

    it('should release lock on exception (ENG-214 protection)', async () => {
      const executionOrder: number[] = [];
      const paymentId = 'payment-123';

      // First request throws error
      const promise1 = store.lock(paymentId, async () => {
        executionOrder.push(1);
        throw new Error('Test error');
      }).catch(() => {
        // Ignore error
      });

      // Second request should still execute after first one fails
      const promise2 = store.lock(paymentId, async () => {
        executionOrder.push(2);
      });

      await Promise.all([promise1, promise2]);

      expect(executionOrder).toEqual([1, 2]);
    });

    it('should cleanup lock after use', async () => {
      const paymentId = 'payment-123';

      await store.lock(paymentId, async () => {
        // Do nothing
      });

      // Lock should be cleaned up and not prevent future access
      const executionOrder: number[] = [];
      await store.lock(paymentId, async () => {
        executionOrder.push(1);
      });

      expect(executionOrder).toEqual([1]);
    });

    it('should handle multiple sequential lock acquisitions', async () => {
      const paymentId = 'payment-123';
      const results: number[] = [];

      for (let i = 0; i < 5; i++) {
        await store.lock(paymentId, async () => {
          results.push(i);
        });
      }

      expect(results).toEqual([0, 1, 2, 3, 4]);
    });

    it('should prevent race condition from ENG-215 (payment_id reuse)', async () => {
      const paymentId = 'payment-123';
      await store.set(paymentId, { tool: 'test' });

      let successCount = 0;
      let failureCount = 0;

      // Two concurrent requests trying to process same payment
      const request = async () => {
        return await store.lock(paymentId, async () => {
          const stored = await store.get(paymentId);
          if (!stored) {
            failureCount++;
            throw new Error('Payment already used');
          }

          // Simulate payment check and tool execution
          await new Promise((resolve) => setTimeout(resolve, 10));

          // Delete state (single-use enforcement)
          await store.delete(paymentId);
          successCount++;
          return 'success';
        }).catch(() => {
          // Expected to fail for second request
        });
      };

      await Promise.all([request(), request()]);

      // Only ONE request should succeed (ENG-213 fix)
      expect(successCount).toBe(1);
      expect(failureCount).toBe(1);
    });

    it('should preserve state after tool execution failure (ENG-214)', async () => {
      const paymentId = 'payment-123';
      const originalState = { tool: 'test', args: { foo: 'bar' } };
      await store.set(paymentId, originalState);

      // First attempt - tool execution fails
      await store.lock(paymentId, async () => {
        const stored = await store.get(paymentId);
        expect(stored?.args).toEqual(originalState);

        // Simulate tool execution failure (state NOT deleted)
        throw new Error('Tool execution failed');
      }).catch(() => {
        // Expected to fail
      });

      // State should still exist for retry
      const stateAfterFailure = await store.get(paymentId);
      expect(stateAfterFailure).toBeDefined();
      expect(stateAfterFailure?.args).toEqual(originalState);

      // Second attempt - tool execution succeeds
      await store.lock(paymentId, async () => {
        const stored = await store.get(paymentId);
        expect(stored?.args).toEqual(originalState);

        // Simulate successful tool execution
        await new Promise((resolve) => setTimeout(resolve, 10));

        // Now delete state
        await store.delete(paymentId);
      });

      // State should be deleted after success
      const stateAfterSuccess = await store.get(paymentId);
      expect(stateAfterSuccess).toBeUndefined();
    });
  });
});
