import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makePaidWrapper } from '../../src/flows/two_step.js';
import type { BasePaymentProvider } from '../../src/providers/base.js';
import type { PriceConfig } from '../../src/types/config.js';
import type { McpServerLike } from '../../src/types/mcp.js';

describe('Two-Step Flow', () => {
  let mockProvider: BasePaymentProvider;
  let mockServer: McpServerLike;
  let mockLogger: any;
  let mockStateStore: any;
  let priceInfo: PriceConfig;

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

    // Mock state store with actual storage
    const storage = new Map();
    mockStateStore = {
      set: vi.fn().mockImplementation(async (key: string, args: any) => {
        storage.set(key, { args, ts: Date.now() });
      }),
      get: vi.fn().mockImplementation(async (key: string) => {
        return storage.get(key);
      }),
      delete: vi.fn().mockImplementation(async (key: string) => {
        storage.delete(key);
      })
    };

    priceInfo = {
      amount: 25.00,
      currency: 'EUR'
    };
  });

  afterEach(() => {
    // Clear any pending args between tests
    const PENDING_ARGS = (global as any).PENDING_ARGS;
    if (PENDING_ARGS) {
      PENDING_ARGS.clear();
    }
  });

  describe('makePaidWrapper', () => {
    it('should create a wrapper and register confirm tool', () => {
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
        mockLogger
      );

      expect(wrapper).toBeInstanceOf(Function);
      expect(mockServer.registerTool).toHaveBeenCalledWith(
        'confirm_testTool_payment',
        expect.objectContaining({
          title: 'Confirm payment for testTool',
          description: 'Confirm payment and execute testTool()',
          inputSchema: expect.objectContaining({
            payment_id: expect.any(Object)
          })
        }),
        expect.any(Function)
      );
    });

    it('should not re-register confirm tool if already exists', () => {
      const mockTool = vi.fn();
      const existingToolsMap = new Map();
      existingToolsMap.set('confirm_testTool_payment', {
        config: {},
        handler: vi.fn()
      });
      mockServer.tools = existingToolsMap;

      makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockLogger
      );

      expect(mockServer.registerTool).not.toHaveBeenCalled();
    });

    it('should handle payment initiation with args', async () => {
      const mockTool = vi.fn();

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockStateStore,
        mockLogger
      );

      const args = { param1: 'value1' };
      const extra = { requestId: 'req_123' };
      const result = await wrapper(args, extra);

      expect(mockProvider.createPayment).toHaveBeenCalledWith(
        25.00,
        'EUR',
        'testTool() execution fee'
      );

      expect(result.structured_content).toEqual({
        payment_url: 'https://payment.example.com/123',
        payment_id: 'payment_123',
        next_step: 'confirm_testTool_payment',
        status: 'payment_required',
        amount: 25.00,
        currency: 'EUR'
      });

      expect(result.data).toEqual(result.structured_content);
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content[0].type).toBe('text');
    });

    it('should handle payment initiation without args', async () => {
      const mockTool = vi.fn();

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockStateStore,
        mockLogger
      );

      const extra = { requestId: 'req_123' };
      const result = await wrapper(extra);

      expect(result.structured_content.payment_id).toBe('payment_123');
      expect(result.structured_content.next_step).toBe('confirm_testTool_payment');
    });

    it('should use provider logger when no logger provided', async () => {
      const providerLogger = {
        debug: vi.fn(),
        info: vi.fn()
      };
      mockProvider.logger = providerLogger;

      const mockTool = vi.fn();
      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockStateStore
      );

      await wrapper({ requestId: 'req_123' });

      expect(providerLogger.debug).toHaveBeenCalled();
    });
  });

  describe('confirm tool handler', () => {
    let confirmHandler: any;
    let mockTool: any;

    beforeEach(() => {
      mockTool = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Original tool executed' }]
      });

      // Create wrapper to register confirm tool
      makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockStateStore,
        mockLogger
      );

      // Extract the confirm handler from the registerTool call
      const registerCall = (mockServer.registerTool as any).mock.calls[0];
      confirmHandler = registerCall[2];
    });

    it('should execute original tool on successful payment confirmation with args', async () => {
      // First, initiate payment to store args
      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockStateStore,
        mockLogger
      );

      const originalArgs = { param1: 'value1' };
      const originalExtra = { requestId: 'req_123' };
      await wrapper(originalArgs, originalExtra);

      // Now test confirm handler
      const confirmResult = await confirmHandler(
        { payment_id: 'payment_123' },
        { requestId: 'confirm_req' }
      );

      expect(mockProvider.getPaymentStatus).toHaveBeenCalledWith('payment_123');
      // The confirm handler passes the stored args with the params from confirm call
      expect(mockTool).toHaveBeenCalledWith(originalArgs, { payment_id: 'payment_123' });
      expect(confirmResult.content).toEqual([
        { type: 'text', text: 'Original tool executed' }
      ]);
    });

    it('should execute original tool on successful payment confirmation without args', async () => {
      // First, initiate payment to store args
      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockStateStore,
        mockLogger
      );

      const originalExtra = { requestId: 'req_123' };
      await wrapper(originalExtra);

      // Now test confirm handler
      const confirmResult = await confirmHandler({
        payment_id: 'payment_123',
        requestId: 'confirm_req'
      });

      expect(mockTool).toHaveBeenCalledWith({ payment_id: 'payment_123', requestId: 'confirm_req' });
      expect(confirmResult.content).toEqual([
        { type: 'text', text: 'Original tool executed' }
      ]);
    });

    it('should handle missing payment_id', async () => {
      const result = await confirmHandler(
        {},
        { requestId: 'confirm_req' }
      );

      expect(result.status).toBe('error');
      expect(result.message).toBe('Missing payment_id');
      expect(result.content[0].text).toBe('Missing payment_id.');
      expect(mockTool).not.toHaveBeenCalled();
    });

    it('should handle unknown payment_id', async () => {
      const result = await confirmHandler(
        { payment_id: 'unknown_payment' },
        { requestId: 'confirm_req' }
      );

      expect(result.status).toBe('error');
      expect(result.message).toBe('Unknown or expired payment_id');
      expect(result.payment_id).toBe('unknown_payment');
      expect(mockTool).not.toHaveBeenCalled();
    });

    it('should handle payment status check failure', async () => {
      // First, initiate payment
      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockStateStore,
        mockLogger
      );
      await wrapper({ requestId: 'req_123' });

      // Mock provider to throw error
      mockProvider.getPaymentStatus = vi.fn().mockRejectedValue(
        new Error('Network timeout')
      );

      const result = await confirmHandler(
        { payment_id: 'payment_123' },
        { requestId: 'confirm_req' }
      );

      expect(result.status).toBe('error');
      expect(result.message).toBe('Failed to check payment status');
      expect(result.content[0].text).toBe('Failed to check payment status: Network timeout');
      expect(result.payment_id).toBe('payment_123');
      expect(mockTool).not.toHaveBeenCalled();
    });

    it('should handle unpaid payment status', async () => {
      // First, initiate payment
      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockStateStore,
        mockLogger
      );
      await wrapper({ requestId: 'req_123' });

      // Mock provider to return pending status
      mockProvider.getPaymentStatus = vi.fn().mockResolvedValue('pending');

      const result = await confirmHandler(
        { payment_id: 'payment_123' },
        { requestId: 'confirm_req' }
      );

      expect(result.status).toBe('error');
      expect(result.message).toBe('Payment status is pending, expected \'paid\'');
      expect(result.content[0].text).toBe('Payment status is pending, expected \'paid\'.');
      expect(result.payment_id).toBe('payment_123');
      expect(mockTool).not.toHaveBeenCalled();
    });

    it('should handle payment status case insensitively', async () => {
      // First, initiate payment
      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockStateStore,
        mockLogger
      );
      await wrapper({ requestId: 'req_123' });

      // Mock provider to return uppercase PAID
      mockProvider.getPaymentStatus = vi.fn().mockResolvedValue('PAID');

      const result = await confirmHandler(
        { payment_id: 'payment_123' },
        { requestId: 'confirm_req' }
      );

      expect(mockTool).toHaveBeenCalled();
      expect(result.content).toEqual([
        { type: 'text', text: 'Original tool executed' }
      ]);
    });

    it('should remove payment from pending args after successful confirmation', async () => {
      // First, initiate payment
      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockStateStore,
        mockLogger
      );
      await wrapper({ requestId: 'req_123' });

      // Confirm payment
      await confirmHandler(
        { payment_id: 'payment_123' },
        { requestId: 'confirm_req' }
      );

      // Try to confirm again - should fail with unknown payment_id
      const result = await confirmHandler(
        { payment_id: 'payment_123' },
        { requestId: 'confirm_req2' }
      );

      expect(result.status).toBe('error');
      expect(result.message).toBe('Unknown or expired payment_id');
    });

    it('should handle tool result without content field', async () => {
      mockTool = vi.fn().mockResolvedValue('simple string result');

      // Recreate wrapper with new mock tool
      makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool2',
        mockStateStore,
        mockLogger
      );

      // Get the new confirm handler
      const registerCalls = (mockServer.registerTool as any).mock.calls;
      const newConfirmHandler = registerCalls[registerCalls.length - 1][2];

      // Initiate payment
      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool2',
        mockStateStore,
        mockLogger
      );
      await wrapper({ requestId: 'req_123' });

      const result = await newConfirmHandler(
        { payment_id: 'payment_123' },
        { requestId: 'confirm_req' }
      );

      expect(result.content).toEqual([
        { type: 'text', text: 'Tool completed after confirmed payment.' }
      ]);
      expect(result.raw).toBe('simple string result');
    });

    it('should handle payment_id from extra when no args provided', async () => {
      // First, initiate payment
      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockStateStore,
        mockLogger
      );
      await wrapper({ requestId: 'req_123' });

      // Call confirm handler with payment_id in extra (single argument)
      const result = await confirmHandler({
        payment_id: 'payment_123',
        requestId: 'confirm_req'
      });

      expect(mockTool).toHaveBeenCalled();
      expect(result.content).toEqual([
        { type: 'text', text: 'Original tool executed' }
      ]);
    });

    it('should log debug information about pending args', async () => {
      // First, initiate payment
      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockStateStore,
        mockLogger
      );
      await wrapper({ requestId: 'req_123' });

      await confirmHandler(
        { payment_id: 'payment_123' },
        { requestId: 'confirm_req' }
      );

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('restoring args=')
      );
    });
  });

  describe('edge cases', () => {
    it('should handle server without tools map', () => {
      const mockTool = vi.fn();
      const serverWithoutTools = {
        registerTool: vi.fn()
      } as any;

      const wrapper = makePaidWrapper(
        mockTool,
        serverWithoutTools,
        mockProvider,
        priceInfo,
        'testTool',
        mockLogger
      );

      expect(wrapper).toBeInstanceOf(Function);
      expect(serverWithoutTools.registerTool).toHaveBeenCalled();
    });

    it('should use console logger when no logger provided and provider has no logger', async () => {
      const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

      const mockTool = vi.fn();
      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockStateStore
      );

      await wrapper({ requestId: 'req_123' });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should handle multiple payment initiations', async () => {
      const mockTool = vi.fn();
      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockStateStore,
        mockLogger
      );

      // Create multiple payments
      mockProvider.createPayment = vi.fn()
        .mockResolvedValueOnce({
          paymentId: 'payment_1',
          paymentUrl: 'https://payment.example.com/1'
        })
        .mockResolvedValueOnce({
          paymentId: 'payment_2',
          paymentUrl: 'https://payment.example.com/2'
        });

      const result1 = await wrapper({ param: 'value1' });
      const result2 = await wrapper({ param: 'value2' });

      expect(result1.structured_content.payment_id).toBe('payment_1');
      expect(result2.structured_content.payment_id).toBe('payment_2');
    });
  });
});