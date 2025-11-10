import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makePaidWrapper } from '../../src/flows/resubmit.js';
import type { BasePaymentProvider } from '../../src/providers/base.js';
import type { PriceConfig } from '../../src/types/config.js';
import type { McpServerLike } from '../../src/types/mcp.js';
import * as paymentUtils from '../../src/utils/payment.js';

describe('RESUBMIT Flow', () => {
  let mockProvider: BasePaymentProvider;
  let mockServer: McpServerLike;
  let mockLogger: any;
  let mockStateStore: any;
  let mockConfig: any;
  let priceInfo: PriceConfig;
  let storage: Map<string, any>;

  beforeEach(() => {
    mockProvider = {
      createPayment: vi.fn().mockResolvedValue({
        paymentId: 'payment_123',
        paymentUrl: 'https://payment.example.com/123'
      }),
      getPaymentStatus: vi.fn().mockResolvedValue('paid'),
      logger: undefined
    } as any;

    mockServer = {
      tools: new Map(),
      registerTool: vi.fn()
    } as any;

    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };

    // Mock state store with actual storage and lock support
    storage = new Map();
    const locks = new Map<string, Promise<void>>();

    mockStateStore = {
      set: vi.fn().mockImplementation(async (key: string, args: any) => {
        storage.set(key, args);
      }),
      get: vi.fn().mockImplementation(async (key: string) => {
        return storage.get(key);
      }),
      delete: vi.fn().mockImplementation(async (key: string) => {
        storage.delete(key);
      }),
      lock: vi.fn().mockImplementation(async (key: string, fn: () => Promise<any>) => {
        // Simple lock implementation for testing
        while (locks.has(key)) {
          await locks.get(key);
        }
        const release = () => locks.delete(key);
        const promise = (async () => {
          try {
            return await fn();
          } finally {
            release();
          }
        })();
        locks.set(key, promise.then(() => {}, () => {}));
        return promise;
      })
    };

    mockConfig = {};

    priceInfo = {
      amount: 25.00,
      currency: 'EUR'
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
    storage.clear();
  });

  describe('Payment Initiation (First Call)', () => {
    it('should create payment and store state on first call', async () => {
      const mockTool = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Tool result' }]
      });

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockStateStore,
        mockConfig,
        mockLogger
      );

      const toolArgs = { param1: 'value1' };
      const extra = { requestId: 'req_123' };

      try {
        await wrapper(toolArgs, extra);
      } catch (err: any) {
        // RESUBMIT flow throws error with payment info
        expect(err.code).toBe(402);
        expect(err.error).toBe('payment_required');
        expect(err.data.payment_id).toBe('payment_123');
        expect(err.data.payment_url).toBe('https://payment.example.com/123');
        expect(err.data.retry_instructions).toBeDefined();
      }

      // Verify payment was created
      expect(mockProvider.createPayment).toHaveBeenCalledWith(
        25.00,
        'EUR',
        'testTool() execution fee'
      );

      // Verify state was stored (wrapped format)
      expect(mockStateStore.set).toHaveBeenCalledWith('payment_123', { args: toolArgs });
    });

    it('should handle payment creation errors', async () => {
      mockProvider.createPayment = vi.fn().mockRejectedValue(new Error('Payment API error'));

      const mockTool = vi.fn();
      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockStateStore,
        mockConfig,
        mockLogger
      );

      await expect(wrapper({ data: 'test' }, {})).rejects.toThrow('Payment API error');
    });

    it('should store undefined args when no args provided', async () => {
      const mockTool = vi.fn();
      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockStateStore,
        mockConfig,
        mockLogger
      );

      const extra = { requestId: 'req_123' };

      try {
        await wrapper(extra);
      } catch (err: any) {
        expect(err.code).toBe(402);
      }

      // State should be stored with undefined args (wrapped format)
      expect(mockStateStore.set).toHaveBeenCalledWith('payment_123', { args: undefined });
    });
  });

  describe('Payment Confirmation (Second Call)', () => {
    it('should execute tool after successful payment confirmation', async () => {
      const mockTool = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Tool executed' }]
      });

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockStateStore,
        mockConfig,
        mockLogger
      );

      // First call: initiate payment
      const toolArgs = { param1: 'value1' };
      const extra = { requestId: 'req_123' };
      try {
        await wrapper(toolArgs, extra);
      } catch (err: any) {
        expect(err.code).toBe(402);
      }

      // Second call: confirm payment
      const result = await wrapper({ payment_id: 'payment_123' }, { requestId: 'req_confirm' });

      // Verify payment status was checked
      expect(mockProvider.getPaymentStatus).toHaveBeenCalledWith('payment_123');

      // Verify original tool was called with payment_id and confirmation extra
      expect(mockTool).toHaveBeenCalledWith({ payment_id: 'payment_123' }, { requestId: 'req_confirm' });

      // Verify state was deleted (single-use enforcement)
      expect(mockStateStore.delete).toHaveBeenCalledWith('payment_123');

      // Verify result matches original tool output
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Tool executed' }]
      });
    });

    it('should handle pending payment status', async () => {
      mockProvider.getPaymentStatus = vi.fn().mockResolvedValue('pending');

      const mockTool = vi.fn();
      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockStateStore,
        mockConfig,
        mockLogger
      );

      // Store state
      await mockStateStore.set('payment_123', { args: { data: 'test' } });

      // Attempt confirmation
      try {
        await wrapper({ payment_id: 'payment_123' }, {});
        expect.fail('Should have thrown payment_pending error');
      } catch (err: any) {
        expect(err.code).toBe(402);
        expect(err.error).toBe('payment_pending');
        expect(err.data.payment_id).toBe('payment_123');
      }

      // Original tool should NOT be called
      expect(mockTool).not.toHaveBeenCalled();

      // State should NOT be deleted (allow retry)
      expect(mockStateStore.delete).not.toHaveBeenCalled();
    });

    it('should handle failed payment status', async () => {
      mockProvider.getPaymentStatus = vi.fn().mockResolvedValue('failed');

      const mockTool = vi.fn();
      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockStateStore,
        mockConfig,
        mockLogger
      );

      await mockStateStore.set('payment_123', { args: { data: 'test' } });

      try {
        await wrapper({ payment_id: 'payment_123' }, {});
        expect.fail('Should have thrown payment_canceled error');
      } catch (err: any) {
        expect(err.code).toBe(402);
        expect(err.error).toBe('payment_canceled'); // normalizeStatus maps 'failed' to 'canceled'
      }

      expect(mockTool).not.toHaveBeenCalled();
      expect(mockStateStore.delete).not.toHaveBeenCalled();
    });

    it('should handle canceled payment status', async () => {
      mockProvider.getPaymentStatus = vi.fn().mockResolvedValue('canceled');

      const mockTool = vi.fn();
      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockStateStore,
        mockConfig,
        mockLogger
      );

      await mockStateStore.set('payment_123', { args: { data: 'test' } });

      try {
        await wrapper({ payment_id: 'payment_123' }, {});
        expect.fail('Should have thrown payment_canceled error');
      } catch (err: any) {
        expect(err.code).toBe(402);
        expect(err.error).toBe('payment_canceled');
      }

      expect(mockTool).not.toHaveBeenCalled();
    });

    it('should handle unknown payment status', async () => {
      mockProvider.getPaymentStatus = vi.fn().mockResolvedValue('unknown_status');

      const mockTool = vi.fn();
      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockStateStore,
        mockConfig,
        mockLogger
      );

      await mockStateStore.set('payment_123', { args: { data: 'test' } });

      try {
        await wrapper({ payment_id: 'payment_123' }, {});
        expect.fail('Should have thrown payment_pending error');
      } catch (err: any) {
        expect(err.code).toBe(402);
        expect(err.error).toBe('payment_pending'); // normalizeStatus maps unknown to 'pending'
      }

      expect(mockTool).not.toHaveBeenCalled();
    });

    it('should handle missing payment_id', async () => {
      const mockTool = vi.fn();
      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockStateStore,
        mockConfig,
        mockLogger
      );

      await mockStateStore.set('payment_123', { args: { data: 'test' } });

      try {
        await wrapper({ payment_id: undefined });
        expect.fail('Should have thrown payment_required error');
      } catch (err: any) {
        expect(err.code).toBe(402);
        expect(err.error).toBe('payment_required');
      }

      expect(mockTool).not.toHaveBeenCalled();
    });

    it('should handle unknown/expired payment_id', async () => {
      const mockTool = vi.fn();
      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockStateStore,
        mockConfig,
        mockLogger
      );

      try {
        await wrapper({ payment_id: 'unknown_payment' }, {});
        expect.fail('Should have thrown payment_id_not_found error');
      } catch (err: any) {
        expect(err.code).toBe(404);
        expect(err.error).toBe('payment_id_not_found');
        expect(err.data.payment_id).toBe('unknown_payment');
      }

      expect(mockTool).not.toHaveBeenCalled();
    });
  });

  describe('State Management (ENG-214 Fix)', () => {
    it('should preserve state when tool execution fails', async () => {
      const mockTool = vi.fn().mockRejectedValue(new Error('Tool execution failed'));

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockStateStore,
        mockConfig,
        mockLogger
      );

      const toolArgs = { data: 'test' };
      await mockStateStore.set('payment_123', { args: toolArgs });

      // Attempt to execute with confirmed payment
      await expect(wrapper({ payment_id: 'payment_123' }, {})).rejects.toThrow('Tool execution failed');

      // State should NOT be deleted (allows retry)
      expect(mockStateStore.delete).not.toHaveBeenCalled();

      // State should still exist (wrapped format)
      const storedState = await mockStateStore.get('payment_123');
      expect(storedState).toEqual({ args: toolArgs });
    });

    it('should delete state only after successful tool execution', async () => {
      const mockTool = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Success' }]
      });

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockStateStore,
        mockConfig,
        mockLogger
      );

      await mockStateStore.set('payment_123', { args: { data: 'test' } });

      await wrapper({ payment_id: 'payment_123' }, {});

      // Verify tool was called BEFORE state deletion
      expect(mockTool).toHaveBeenCalled();
      expect(mockStateStore.delete).toHaveBeenCalledWith('payment_123');

      // State should be deleted
      const storedState = await mockStateStore.get('payment_123');
      expect(storedState).toBeUndefined();
    });
  });

  describe('Locking (ENG-215 Fix)', () => {
    it('should use lock to prevent concurrent access', async () => {
      const mockTool = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Success' }]
      });

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockStateStore,
        mockConfig,
        mockLogger
      );

      await mockStateStore.set('payment_123', { args: { data: 'test' } });

      await wrapper({ payment_id: 'payment_123' }, {});

      // Verify lock was called
      expect(mockStateStore.lock).toHaveBeenCalledWith('payment_123', expect.any(Function));
    });

    it('should serialize concurrent requests for same payment_id', async () => {
      const executionOrder: number[] = [];

      const mockTool = vi.fn().mockImplementation(async () => {
        executionOrder.push(1);
        await new Promise(resolve => setTimeout(resolve, 50));
        executionOrder.push(2);
        return { content: [{ type: 'text', text: 'Success' }] };
      });

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockStateStore,
        mockConfig,
        mockLogger
      );

      await mockStateStore.set('payment_123', { args: { data: 'test' } });

      // Two concurrent requests
      const promise1 = wrapper({ payment_id: 'payment_123' }, {}).catch(() => {});
      const promise2 = wrapper({ payment_id: 'payment_123' }, {}).catch(() => {});

      await Promise.all([promise1, promise2]);

      // First request should execute completely before second
      // (Second will fail with payment_id_not_found because state was deleted)
      expect(executionOrder).toEqual([1, 2]); // Only first request executes
    });
  });

  describe('Error Handling', () => {
    it('should handle payment status check errors', async () => {
      mockProvider.getPaymentStatus = vi.fn().mockRejectedValue(new Error('API error'));

      const mockTool = vi.fn();
      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockStateStore,
        mockConfig,
        mockLogger
      );

      await mockStateStore.set('payment_123', { args: { data: 'test' } });

      await expect(wrapper({ payment_id: 'payment_123' }, {})).rejects.toThrow('API error');

      expect(mockTool).not.toHaveBeenCalled();
    });

    it('should throw error when StateStore not provided', () => {
      const mockTool = vi.fn();

      expect(() => {
        makePaidWrapper(
          mockTool,
          mockServer,
          mockProvider,
          priceInfo,
          'testTool',
          undefined, // No state store
          mockConfig,
          mockLogger
        );
      }).toThrow('StateStore is required for RESUBMIT flow');
    });

    it('should throw error when price info is invalid', () => {
      const mockTool = vi.fn();

      expect(() => {
        makePaidWrapper(
          mockTool,
          mockServer,
          mockProvider,
          { amount: 0, currency: '' }, // Invalid price
          'testTool',
          mockStateStore,
          mockConfig,
          mockLogger
        );
      }).toThrow('Invalid price info');
    });
  });

  describe('Argument Handling', () => {
    it('should handle tools with arguments', async () => {
      const mockTool = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Result' }]
      });

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockStateStore,
        mockConfig,
        mockLogger
      );

      const toolArgs = { param1: 'value1', param2: 42 };
      const extra = { requestId: 'req_123' };

      try {
        await wrapper(toolArgs, extra);
      } catch (err: any) {
        expect(err.code).toBe(402);
      }

      await wrapper({ payment_id: 'payment_123' }, extra);

      // Tool should be called with payment_id and confirmation extra
      expect(mockTool).toHaveBeenCalledWith({ payment_id: 'payment_123' }, extra);
    });

    it('should handle tools without arguments', async () => {
      const mockTool = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Result' }]
      });

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockStateStore,
        mockConfig,
        mockLogger
      );

      const extra = { requestId: 'req_123' };

      try {
        await wrapper(extra);
      } catch (err: any) {
        expect(err.code).toBe(402);
      }

      const confirmExtra = { requestId: 'req_456' };
      await wrapper({ payment_id: 'payment_123' }, confirmExtra);

      // Tool should be called with payment_id and confirmation extra
      expect(mockTool).toHaveBeenCalledWith({ payment_id: 'payment_123' }, confirmExtra);
    });
  });

  describe('Raw Provider Status Normalization', () => {
    it('should handle provider returning "succeeded" status', async () => {
      mockProvider.getPaymentStatus = vi.fn().mockResolvedValue('succeeded');

      const mockTool = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Success' }]
      });

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockStateStore,
        mockConfig,
        mockLogger
      );

      await mockStateStore.set('payment_123', { args: { data: 'test' } });
      await wrapper({ payment_id: 'payment_123' }, {});

      // "succeeded" normalizes to "paid", tool should execute
      expect(mockTool).toHaveBeenCalled();
    });

    it('should handle provider returning "declined" status', async () => {
      mockProvider.getPaymentStatus = vi.fn().mockResolvedValue('declined');

      const mockTool = vi.fn();

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockStateStore,
        mockConfig,
        mockLogger
      );

      await mockStateStore.set('payment_123', { args: { data: 'test' } });

      try {
        await wrapper({ payment_id: 'payment_123' }, {});
        expect.fail('Should have thrown payment_canceled error');
      } catch (err: any) {
        // "declined" normalizes to "canceled"
        expect(err.code).toBe(402);
        expect(err.error).toBe('payment_canceled');
      }

      expect(mockTool).not.toHaveBeenCalled();
    });

    it('should handle provider returning "void" status', async () => {
      mockProvider.getPaymentStatus = vi.fn().mockResolvedValue('void');

      const mockTool = vi.fn();

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockStateStore,
        mockConfig,
        mockLogger
      );

      await mockStateStore.set('payment_123', { args: { data: 'test' } });

      try {
        await wrapper({ payment_id: 'payment_123' }, {});
        expect.fail('Should have thrown payment_canceled error');
      } catch (err: any) {
        // "void" normalizes to "canceled"
        expect(err.code).toBe(402);
        expect(err.error).toBe('payment_canceled');
      }
    });

    it('should handle provider returning "error" status', async () => {
      mockProvider.getPaymentStatus = vi.fn().mockResolvedValue('error');

      const mockTool = vi.fn();

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockStateStore,
        mockConfig,
        mockLogger
      );

      await mockStateStore.set('payment_123', { args: { data: 'test' } });

      try {
        await wrapper({ payment_id: 'payment_123' }, {});
        expect.fail('Should have thrown payment_canceled error');
      } catch (err: any) {
        // "error" normalizes to "canceled"
        expect(err.code).toBe(402);
        expect(err.error).toBe('payment_canceled');
      }
    });

    it('should handle provider returning empty string status', async () => {
      mockProvider.getPaymentStatus = vi.fn().mockResolvedValue('');

      const mockTool = vi.fn();

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockStateStore,
        mockConfig,
        mockLogger
      );

      await mockStateStore.set('payment_123', { args: { data: 'test' } });

      try {
        await wrapper({ payment_id: 'payment_123' }, {});
        expect.fail('Should have thrown payment_pending error');
      } catch (err: any) {
        // Empty string normalizes to "pending"
        expect(err.code).toBe(402);
        expect(err.error).toBe('payment_pending');
      }
    });

    it('should handle provider returning null status', async () => {
      mockProvider.getPaymentStatus = vi.fn().mockResolvedValue(null);

      const mockTool = vi.fn();

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockStateStore,
        mockConfig,
        mockLogger
      );

      await mockStateStore.set('payment_123', { args: { data: 'test' } });

      try {
        await wrapper({ payment_id: 'payment_123' }, {});
        expect.fail('Should have thrown payment_pending error');
      } catch (err: any) {
        // null normalizes to "pending"
        expect(err.code).toBe(402);
        expect(err.error).toBe('payment_pending');
      }
    });

    it('should handle provider returning uppercase status', async () => {
      mockProvider.getPaymentStatus = vi.fn().mockResolvedValue('PAID');

      const mockTool = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Success' }]
      });

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockStateStore,
        mockConfig,
        mockLogger
      );

      await mockStateStore.set('payment_123', { args: { data: 'test' } });
      await wrapper({ payment_id: 'payment_123' }, {});

      // "PAID" (uppercase) normalizes to "paid", tool should execute
      expect(mockTool).toHaveBeenCalled();
    });

    it('should handle provider returning "complete" status', async () => {
      mockProvider.getPaymentStatus = vi.fn().mockResolvedValue('complete');

      const mockTool = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Success' }]
      });

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockStateStore,
        mockConfig,
        mockLogger
      );

      await mockStateStore.set('payment_123', { args: { data: 'test' } });
      await wrapper({ payment_id: 'payment_123' }, {});

      // "complete" normalizes to "paid", tool should execute
      expect(mockTool).toHaveBeenCalled();
    });
  });

  describe('Defensive Code Coverage', () => {
    it('should handle truly unknown status (defensive code path)', async () => {
      // Mock normalizeStatus to return an unexpected value
      const normalizeStatusSpy = vi.spyOn(paymentUtils, 'normalizeStatus');
      normalizeStatusSpy.mockReturnValue('processing' as any);

      mockProvider.getPaymentStatus = vi.fn().mockResolvedValue('processing');

      const mockTool = vi.fn();

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockStateStore,
        mockConfig,
        mockLogger
      );

      await mockStateStore.set('payment_123', { args: { data: 'test' } });

      try {
        await wrapper({ payment_id: 'payment_123' }, {});
        expect.fail('Should have thrown payment_unknown error');
      } catch (err: any) {
        // This tests the defensive third if block (lines 69-78)
        expect(err.code).toBe(402);
        expect(err.error).toBe('payment_unknown');
        expect(err.data.payment_id).toBe('payment_123');
      }

      expect(mockTool).not.toHaveBeenCalled();

      // Restore original implementation
      normalizeStatusSpy.mockRestore();
    });
  });

  describe('Edge Cases', () => {
    it('should handle payment_id that looks like number', async () => {
      const mockTool = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Success' }]
      });

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockStateStore,
        mockConfig,
        mockLogger
      );

      // Store with string ID (as would happen in real flow)
      await mockStateStore.set('123456', { args: { data: 'test' } });

      // Call with string payment_id that looks like a number
      await wrapper({ payment_id: '123456' }, {});

      expect(mockProvider.getPaymentStatus).toHaveBeenCalledWith('123456');
      expect(mockTool).toHaveBeenCalled();
    });

    it('should handle very long payment_id', async () => {
      const longPaymentId = 'payment_' + 'x'.repeat(1000);

      const mockTool = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Success' }]
      });

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockStateStore,
        mockConfig,
        mockLogger
      );

      await mockStateStore.set(longPaymentId, { args: { data: 'test' } });
      await wrapper({ payment_id: longPaymentId }, {});

      expect(mockProvider.getPaymentStatus).toHaveBeenCalledWith(longPaymentId);
      expect(mockTool).toHaveBeenCalled();
    });

    it('should handle payment_id with special characters', async () => {
      const specialPaymentId = 'payment-123_test.abc';

      const mockTool = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Success' }]
      });

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockStateStore,
        mockConfig,
        mockLogger
      );

      await mockStateStore.set(specialPaymentId, { args: { data: 'test' } });
      await wrapper({ payment_id: specialPaymentId }, {});

      expect(mockProvider.getPaymentStatus).toHaveBeenCalledWith(specialPaymentId);
      expect(mockTool).toHaveBeenCalled();
    });

    it('should handle complex nested toolArgs', async () => {
      const complexArgs = {
        level1: {
          level2: {
            level3: {
              value: 'deep',
              array: [1, 2, { nested: true }]
            }
          }
        },
        topLevel: 'test'
      };

      const mockTool = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Success' }]
      });

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockStateStore,
        mockConfig,
        mockLogger
      );

      // First call: create payment
      try {
        await wrapper(complexArgs, {});
      } catch (err: any) {
        expect(err.code).toBe(402);
      }

      // Second call: confirm and execute
      await wrapper({ payment_id: 'payment_123' }, {});

      // Verify tool was called with payment_id
      expect(mockTool).toHaveBeenCalledWith({ payment_id: 'payment_123' }, {});
    });

    it('should handle toolArgs with null values', async () => {
      const argsWithNull = { value: null, other: 'test' };

      const mockTool = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Success' }]
      });

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockStateStore,
        mockConfig,
        mockLogger
      );

      try {
        await wrapper(argsWithNull, {});
      } catch (err: any) {
        expect(err.code).toBe(402);
      }

      await wrapper({ payment_id: 'payment_123' }, {});

      expect(mockTool).toHaveBeenCalledWith({ payment_id: 'payment_123' }, {});
    });
  });

  describe('Logger Integration', () => {
    it('should use provider logger when no logger provided', async () => {
      const providerLogger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn()
      };
      mockProvider.logger = providerLogger;

      const mockTool = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Result' }]
      });

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockStateStore,
        undefined, // No config
        undefined  // No logger
      );

      await mockStateStore.set('payment_123', { args: { data: 'test' } });
      await wrapper({ payment_id: 'payment_123' }, {});

      expect(providerLogger.info).toHaveBeenCalled();
    });

    it('should log payment lifecycle events', async () => {
      const mockTool = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Result' }]
      });

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockStateStore,
        mockConfig,
        mockLogger
      );

      await mockStateStore.set('payment_123', { args: { data: 'test' } });
      await wrapper({ payment_id: 'payment_123' }, {});

      // Verify logging
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('payment confirmed')
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('state deleted')
      );
    });
  });
});
