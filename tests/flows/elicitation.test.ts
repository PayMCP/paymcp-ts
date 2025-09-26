import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { makePaidWrapper } from '../../src/flows/elicitation.js';
import type { BasePaymentProvider } from '../../src/providers/base.js';
import type { PriceConfig, ToolExtraLike } from '../../src/types/config.js';
import type { McpServerLike } from '../../src/types/mcp.js';

describe('Elicitation Flow', () => {
  let mockProvider: BasePaymentProvider;
  let mockServer: McpServerLike;
  let mockLogger: any;
  let priceInfo: PriceConfig;
  let mockExtra: ToolExtraLike;

  beforeEach(() => {
    mockProvider = {
      createPayment: vi.fn().mockResolvedValue({
        paymentId: 'payment_123',
        paymentUrl: 'https://payment.example.com/123'
      }),
      getPaymentStatus: vi.fn().mockResolvedValue('paid'),
      logger: undefined
    } as any;

    mockServer = {} as McpServerLike;

    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };

    priceInfo = {
      amount: 10.50,
      currency: 'USD'
    };

    mockExtra = {
      sendRequest: vi.fn().mockResolvedValue({ action: 'accept' })
    } as any;
  });

  describe('makePaidWrapper', () => {
    it('should create a wrapper function', () => {
      const mockTool = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Tool result' }]
      });

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockLogger
      );

      expect(wrapper).toBeInstanceOf(Function);
    });

    it('should handle successful payment flow with args', async () => {
      const mockTool = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Tool executed successfully' }]
      });

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockLogger
      );

      const args = { param1: 'value1' };
      const result = await wrapper(args, mockExtra);

      expect(mockProvider.createPayment).toHaveBeenCalledWith(
        10.50,
        'USD',
        'testTool() execution fee'
      );
      expect(mockExtra.sendRequest).toHaveBeenCalled();
      expect(mockTool).toHaveBeenCalledWith(args, mockExtra);
      expect(result.content).toEqual([{ type: 'text', text: 'Tool executed successfully' }]);
      expect(result.annotations?.payment).toEqual({
        status: 'paid',
        payment_id: 'payment_123'
      });
    });

    it('should handle successful payment flow without args', async () => {
      const mockTool = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Tool executed' }]
      });

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockLogger
      );

      const result = await wrapper(mockExtra);

      expect(mockTool).toHaveBeenCalledWith(mockExtra);
      expect(result.content).toEqual([{ type: 'text', text: 'Tool executed' }]);
    });

    it('should handle client without sendRequest support', async () => {
      const mockTool = vi.fn();
      const extraWithoutSendRequest = {} as ToolExtraLike;

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockLogger
      );

      const result = await wrapper(extraWithoutSendRequest);

      expect(result.status).toBe('error');
      expect(result.annotations?.payment?.reason).toBe('elicitation_not_supported');
      expect(mockTool).not.toHaveBeenCalled();
    });

    it('should handle payment canceled by user', async () => {
      const mockTool = vi.fn();
      mockProvider.getPaymentStatus = vi.fn().mockResolvedValue('canceled');
      mockExtra.sendRequest = vi.fn().mockResolvedValue({ action: 'cancel' });

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockLogger
      );

      const result = await wrapper(mockExtra);

      expect(result.status).toBe('canceled');
      expect(result.annotations?.payment?.status).toBe('canceled');
      expect(result.payment_url).toBe('https://payment.example.com/123');
      expect(mockTool).not.toHaveBeenCalled();
    });

    it('should handle payment declined by user', async () => {
      const mockTool = vi.fn();
      mockExtra.sendRequest = vi.fn().mockResolvedValue({ action: 'decline' });
      mockProvider.getPaymentStatus = vi.fn().mockResolvedValue('pending'); // Not paid

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockLogger
      );

      const result = await wrapper(mockExtra);

      expect(result.status).toBe('canceled');
      expect(result.annotations?.payment?.status).toBe('canceled');
      expect(mockTool).not.toHaveBeenCalled();
    });

    it('should handle pending payment status', async () => {
      const mockTool = vi.fn();
      mockProvider.getPaymentStatus = vi.fn().mockResolvedValue('pending');
      mockExtra.sendRequest = vi.fn().mockResolvedValue({ action: 'unknown' });

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockLogger
      );

      const result = await wrapper(mockExtra);

      expect(result.status).toBe('pending');
      expect(result.annotations?.payment?.status).toBe('pending');
      expect(result.payment_id).toBe('payment_123');
      expect(result.next_step).toBe('testTool');
      expect(mockTool).not.toHaveBeenCalled();
    });

    it('should handle elicitation loop errors', async () => {
      const mockTool = vi.fn();
      mockExtra.sendRequest = vi.fn().mockRejectedValue(new Error('Network error'));
      mockProvider.getPaymentStatus = vi.fn().mockResolvedValue('pending');

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockLogger
      );

      const result = await wrapper(mockExtra);

      expect(result.status).toBe('canceled'); // normalizeStatus("error") returns "canceled"
      expect(mockLogger.warn).toHaveBeenCalled();
      expect(mockTool).not.toHaveBeenCalled();
    });

    it('should handle method not found error', async () => {
      const mockTool = vi.fn();
      const methodNotFoundError = new Error('Method not found');
      (methodNotFoundError as any).code = -32601;
      mockExtra.sendRequest = vi.fn().mockRejectedValue(methodNotFoundError);

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockLogger
      );

      const result = await wrapper(mockExtra);

      expect(result.status).toBe('error');
      expect(result.annotations?.payment?.reason).toBe('elicitation_not_supported');
      expect(mockTool).not.toHaveBeenCalled();
    });

    it('should handle payment status check failure', async () => {
      const mockTool = vi.fn();
      mockProvider.getPaymentStatus = vi.fn().mockRejectedValue(new Error('Status check failed'));
      mockExtra.sendRequest = vi.fn().mockResolvedValue({ action: 'unknown' });

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockLogger
      );

      const result = await wrapper(mockExtra);

      expect(result.status).toBe('pending');
      expect(mockTool).not.toHaveBeenCalled();
    });

    it('should handle tool result without content field', async () => {
      const mockTool = vi.fn().mockResolvedValue('simple string result');

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockLogger
      );

      const result = await wrapper(mockExtra);

      expect(result.content).toEqual([{ type: 'text', text: 'Tool completed after payment.' }]);
      expect(result.annotations?.payment?.status).toBe('paid');
      expect(result.raw).toBe('simple string result');
    });

    it('should handle null/empty payment status', async () => {
      const mockTool = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Tool result' }]
      });

      mockExtra.sendRequest = vi.fn().mockResolvedValue({ action: 'unknown' });
      // First call returns null, second call returns paid
      mockProvider.getPaymentStatus = vi.fn()
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('paid');

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockLogger
      );

      const result = await wrapper(mockExtra);

      expect(mockProvider.getPaymentStatus).toHaveBeenCalledTimes(2);
      expect(mockTool).toHaveBeenCalled();
      expect(result.annotations?.payment?.status).toBe('paid');
    });

    it('should handle multiple elicitation attempts before payment', async () => {
      const mockTool = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Tool result' }]
      });

      // Mock sequence: first 3 attempts pending, 4th attempt paid
      mockProvider.getPaymentStatus = vi.fn()
        .mockResolvedValueOnce('pending')
        .mockResolvedValueOnce('pending')
        .mockResolvedValueOnce('pending')
        .mockResolvedValueOnce('paid');

      mockExtra.sendRequest = vi.fn()
        .mockResolvedValueOnce({ action: 'unknown' })
        .mockResolvedValueOnce({ action: 'unknown' })
        .mockResolvedValueOnce({ action: 'unknown' })
        .mockResolvedValueOnce({ action: 'accept' });

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockLogger
      );

      const result = await wrapper(mockExtra);

      expect(mockExtra.sendRequest).toHaveBeenCalledTimes(4);
      expect(mockProvider.getPaymentStatus).toHaveBeenCalledTimes(4);
      expect(mockTool).toHaveBeenCalled();
      expect(result.annotations?.payment?.status).toBe('paid');
    });

    it('should handle elicitation response with nested action', async () => {
      const mockTool = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Tool result' }]
      });

      mockExtra.sendRequest = vi.fn().mockResolvedValue({
        result: { action: 'accept' }
      });

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockLogger
      );

      const result = await wrapper(mockExtra);

      expect(mockTool).toHaveBeenCalled();
      expect(result.annotations?.payment?.status).toBe('paid');
    });

    it('should use provider logger when no logger provided', async () => {
      const providerLogger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn()
      };
      mockProvider.logger = providerLogger;

      const mockTool = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Tool result' }]
      });

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool'
      );

      await wrapper(mockExtra);

      expect(providerLogger.debug).toHaveBeenCalled();
    });

    it('should handle status unsupported from provider', async () => {
      const mockTool = vi.fn();
      // Make sendRequest throw method not found error to trigger unsupported status
      const methodNotFoundError = new Error('Method not found');
      (methodNotFoundError as any).code = -32601;
      mockExtra.sendRequest = vi.fn().mockRejectedValue(methodNotFoundError);

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockLogger
      );

      const result = await wrapper(mockExtra);

      expect(result.status).toBe('error');
      expect(result.annotations?.payment?.reason).toBe('elicitation_not_supported');
      expect(mockTool).not.toHaveBeenCalled();
    });

    it('should handle exhausted elicitation attempts', async () => {
      const mockTool = vi.fn();

      // Always return pending status
      mockProvider.getPaymentStatus = vi.fn().mockResolvedValue('pending');
      mockExtra.sendRequest = vi.fn().mockResolvedValue({ action: 'unknown' });

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockLogger
      );

      const result = await wrapper(mockExtra);

      // Should attempt 5 times (max attempts)
      expect(mockExtra.sendRequest).toHaveBeenCalledTimes(5);
      expect(result.status).toBe('pending');
      expect(mockTool).not.toHaveBeenCalled();
    });

    it('should handle tool result annotation error gracefully', async () => {
      const mockTool = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Tool result' }],
        get annotations() {
          throw new Error('Cannot set annotations');
        }
      });

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProvider,
        priceInfo,
        'testTool',
        mockLogger
      );

      // Should not throw error
      const result = await wrapper(mockExtra);

      expect(result.content).toEqual([{ type: 'text', text: 'Tool result' }]);
    });
  });
});