import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { InMemorySessionStorage } from '../../src/session/memory';
import { SessionKey, SessionData } from '../../src/session/types';

describe('InMemorySessionStorage', () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  let storage: InMemorySessionStorage;

  beforeEach(() => {
    storage = new InMemorySessionStorage();
    vi.useFakeTimers();
  });

  afterEach(() => {
    storage.destroy();
    vi.useRealTimers();
  });

  describe('set and get', () => {
    it('should store and retrieve session data', async () => {
      const key: SessionKey = { provider: 'stripe', paymentId: 'pay_123' };
      const data: SessionData = {
        args: { amount: 100, currency: 'USD' },
        ts: Date.now(),
        providerName: 'stripe',
        metadata: { tool: 'test' },
      };

      await storage.set(key, data);
      const retrieved = await storage.get(key);

      expect(retrieved).toEqual(data);
    });

    it('should return undefined for non-existent key', async () => {
      const key: SessionKey = { provider: 'stripe', paymentId: 'non_existent' };
      const retrieved = await storage.get(key);

      expect(retrieved).toBeUndefined();
    });

    it('should handle different providers with same payment ID', async () => {
      const stripeKey: SessionKey = {
        provider: 'stripe',
        paymentId: 'pay_123',
      };
      const paypalKey: SessionKey = {
        provider: 'paypal',
        paymentId: 'pay_123',
      };

      const stripeData: SessionData = {
        args: { provider: 'stripe' },
        ts: Date.now(),
      };

      const paypalData: SessionData = {
        args: { provider: 'paypal' },
        ts: Date.now(),
      };

      await storage.set(stripeKey, stripeData);
      await storage.set(paypalKey, paypalData);

      const retrievedStripe = await storage.get(stripeKey);
      const retrievedPaypal = await storage.get(paypalKey);

      expect(retrievedStripe?.args.provider).toBe('stripe');
      expect(retrievedPaypal?.args.provider).toBe('paypal');
    });
  });

  describe('TTL functionality', () => {
    it('should expire sessions after TTL', async () => {
      const key: SessionKey = { provider: 'stripe', paymentId: 'pay_123' };
      const data: SessionData = {
        args: { test: true },
        ts: Date.now(),
      };

      // Set with 5 second TTL
      await storage.set(key, data, 5);

      // Should exist immediately
      let retrieved = await storage.get(key);
      expect(retrieved).toEqual(data);

      // Advance time by 6 seconds
      vi.advanceTimersByTime(6000);

      // Should be expired
      retrieved = await storage.get(key);
      expect(retrieved).toBeUndefined();
    });

    it('should not expire sessions without TTL', async () => {
      const key: SessionKey = { provider: 'stripe', paymentId: 'pay_123' };
      const data: SessionData = {
        args: { test: true },
        ts: Date.now(),
      };

      // Set without TTL
      await storage.set(key, data);

      // Advance time significantly
      vi.advanceTimersByTime(3600000); // 1 hour

      // Should still exist
      const retrieved = await storage.get(key);
      expect(retrieved).toEqual(data);
    });
  });

  describe('delete', () => {
    it('should delete existing session', async () => {
      const key: SessionKey = { provider: 'stripe', paymentId: 'pay_123' };
      const data: SessionData = {
        args: { test: true },
        ts: Date.now(),
      };

      await storage.set(key, data);
      await storage.delete(key);

      const retrieved = await storage.get(key);
      expect(retrieved).toBeUndefined();
    });

    it('should handle deleting non-existent key gracefully', async () => {
      const key: SessionKey = { provider: 'stripe', paymentId: 'non_existent' };

      // Should not throw
      await expect(storage.delete(key)).resolves.toBeUndefined();
    });
  });

  describe('has', () => {
    it('should return true for existing session', async () => {
      const key: SessionKey = { provider: 'stripe', paymentId: 'pay_123' };
      const data: SessionData = {
        args: { test: true },
        ts: Date.now(),
      };

      await storage.set(key, data);
      const exists = await storage.has(key);

      expect(exists).toBe(true);
    });

    it('should return false for non-existent session', async () => {
      const key: SessionKey = { provider: 'stripe', paymentId: 'non_existent' };
      const exists = await storage.has(key);

      expect(exists).toBe(false);
    });

    it('should return false for expired session', async () => {
      const key: SessionKey = { provider: 'stripe', paymentId: 'pay_123' };
      const data: SessionData = {
        args: { test: true },
        ts: Date.now(),
      };

      await storage.set(key, data, 1); // 1 second TTL
      vi.advanceTimersByTime(2000);

      const exists = await storage.has(key);
      expect(exists).toBe(false);
    });
  });

  describe('clear', () => {
    it('should remove all sessions', async () => {
      const key1: SessionKey = { provider: 'stripe', paymentId: 'pay_1' };
      const key2: SessionKey = { provider: 'paypal', paymentId: 'pay_2' };
      const data: SessionData = {
        args: { test: true },
        ts: Date.now(),
      };

      await storage.set(key1, data);
      await storage.set(key2, data);
      await storage.clear();

      expect(await storage.has(key1)).toBe(false);
      expect(await storage.has(key2)).toBe(false);
    });
  });

  describe('cleanup', () => {
    it('should be called automatically by interval', () => {
      vi.useFakeTimers();
      const storage = new InMemorySessionStorage();
      const cleanupSpy = vi.spyOn(storage, 'cleanup');

      // Advance time to trigger interval
      vi.advanceTimersByTime(60000);

      expect(cleanupSpy).toHaveBeenCalled();

      storage.destroy();
    });

    it('should remove expired sessions but keep valid ones', async () => {
      const expiredKey: SessionKey = {
        provider: 'stripe',
        paymentId: 'expired',
      };
      const validKey: SessionKey = { provider: 'stripe', paymentId: 'valid' };
      const permanentKey: SessionKey = {
        provider: 'stripe',
        paymentId: 'permanent',
      };

      const data: SessionData = {
        args: { test: true },
        ts: Date.now(),
      };

      await storage.set(expiredKey, data, 1); // 1 second TTL
      await storage.set(validKey, data, 100); // 100 seconds TTL
      await storage.set(permanentKey, data); // No TTL

      // Advance time by 2 seconds
      vi.advanceTimersByTime(2000);

      await storage.cleanup();

      expect(await storage.has(expiredKey)).toBe(false);
      expect(await storage.has(validKey)).toBe(true);
      expect(await storage.has(permanentKey)).toBe(true);
    });

    it('cleanup interval should be set up', () => {
      // Simply verify that the cleanup mechanism is initialized
      // The actual cleanup functionality is tested separately above
      expect(storage).toBeDefined();
      expect((storage as any).cleanupInterval).toBeDefined();
    });
  });

  describe('edge cases', () => {
    it('should handle concurrent operations correctly', async () => {
      const key: SessionKey = { provider: 'stripe', paymentId: 'concurrent' };
      const data1: SessionData = { args: { value: 1 }, ts: Date.now() };
      const data2: SessionData = { args: { value: 2 }, ts: Date.now() };

      // Concurrent sets
      await Promise.all([storage.set(key, data1), storage.set(key, data2)]);

      // Last write wins
      const retrieved = await storage.get(key);
      expect(retrieved?.args.value).toBe(2);
    });

    it('should handle special characters in keys', async () => {
      const key: SessionKey = {
        provider: 'stripe-test:special',
        paymentId: 'pay:123:test/special',
      };
      const data: SessionData = {
        args: { test: true },
        ts: Date.now(),
      };

      await storage.set(key, data);
      const retrieved = await storage.get(key);

      expect(retrieved).toEqual(data);
    });
  });
});
