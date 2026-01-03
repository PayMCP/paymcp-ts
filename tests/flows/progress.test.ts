import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makePaidWrapper, DEFAULT_POLL_MS, MAX_WAIT_MS } from '../../src/flows/progress.js';
import type { BasePaymentProvider } from '../../src/providers/base.js';
import type { ProviderInstances } from '../../src/providers/index.js';
import type { PriceConfig, ToolExtraLike } from '../../src/types/config.js';
import type { McpServerLike } from '../../src/types/mcp.js';

describe('Progress Flow', () => {
  let mockProvider: BasePaymentProvider;
  let mockProviders: ProviderInstances;
  let mockServer: McpServerLike;
  let mockLogger: any;
  let mockStateStore: any;
  let mockConfig: any;
  let priceInfo: PriceConfig;
  let mockExtra: ToolExtraLike;
  const clientInfo = () => ({ name: 'test', capabilities: {} });

  beforeEach(() => {
    vi.useFakeTimers();

    mockProvider = {
      createPayment: vi.fn().mockResolvedValue({
        paymentId: 'payment_123',
        paymentUrl: 'https://payment.example.com/123'
      }),
      getPaymentStatus: vi.fn().mockResolvedValue('paid'),
      logger: undefined
    } as any;
    mockProviders = { mock: mockProvider };

    mockServer = {} as McpServerLike;

    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };

    // Mock state store (progress flow doesn't use it, but it's required in signature)
    mockStateStore = {
      set: vi.fn(),
      get: vi.fn(),
      delete: vi.fn()
    };

    // Mock config object (can include _meta if needed)
    mockConfig = {};

    priceInfo = {
      amount: 20.00,
      currency: 'GBP'
    };

    mockExtra = {
      sendNotification: vi.fn().mockResolvedValue(undefined),
      _meta: { progressToken: 'progress_token_123' }
    } as any;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('makePaidWrapper', () => {
    it('should create a wrapper function', () => {
      const mockTool = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Tool result' }]
      });

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProviders,
        priceInfo,
        'testTool',
        mockStateStore,
        mockConfig,
        clientInfo,
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
        mockProviders,
        priceInfo,
        'testTool',
        mockStateStore,
        mockConfig,
        clientInfo,
        mockLogger
      );

      // Setup payment to be paid immediately
      mockProvider.getPaymentStatus = vi.fn().mockResolvedValue('paid');

      const args = { param1: 'value1' };
      const promiseResult = wrapper(args, mockExtra);

      // Advance timers past the first delay
      await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS);

      const result = await promiseResult;

      expect(mockProvider.createPayment).toHaveBeenCalledWith(
        20.00,
        'GBP',
        'testTool() execution fee'
      );
      expect(mockExtra.sendNotification).toHaveBeenCalledTimes(2); // 0% and 100%
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
        mockProviders,
        priceInfo,
        'testTool',
        mockStateStore,
        mockConfig,
        clientInfo,
        mockLogger
      );

      mockProvider.getPaymentStatus = vi.fn().mockResolvedValue('paid');

      const promiseResult = wrapper(mockExtra);
      await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS);
      const result = await promiseResult;

      expect(mockTool).toHaveBeenCalledWith(mockExtra);
      expect(result.content).toEqual([{ type: 'text', text: 'Tool executed' }]);
    });

    it('should handle payment canceled by provider', async () => {
      const mockTool = vi.fn();

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProviders,
        priceInfo,
        'testTool',
        mockStateStore,
        mockConfig,
        clientInfo,
        mockLogger
      );

      mockProvider.getPaymentStatus = vi.fn().mockResolvedValue('canceled');

      const promiseResult = wrapper(mockExtra);
      await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS);
      const result = await promiseResult;

      expect(result.status).toBe('canceled');
      expect(result.annotations?.payment?.status).toBe('canceled');
      expect(result.payment_url).toBe('https://payment.example.com/123');
      expect(mockTool).not.toHaveBeenCalled();
    });

    it('should handle client abort signal', async () => {
      const mockTool = vi.fn();
      const abortController = new AbortController();
      const extraWithSignal = {
        ...mockExtra,
        signal: abortController.signal
      };

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProviders,
        priceInfo,
        'testTool',
        mockStateStore,
        mockConfig,
        clientInfo,
        mockLogger
      );

      mockProvider.getPaymentStatus = vi.fn().mockResolvedValue('pending');

      // Abort the signal
      abortController.abort();

      const promiseResult = wrapper(extraWithSignal);
      await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS);
      const result = await promiseResult;

      expect(result.status).toBe('pending');
      expect(result.message).toBe('Payment aborted. Call the tool again to continue.');
      expect(mockTool).not.toHaveBeenCalled();
    });

    it('should handle payment timeout', async () => {
      const mockTool = vi.fn();

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProviders,
        priceInfo,
        'testTool',
        mockStateStore,
        mockConfig,
        clientInfo,
        mockLogger
      );

      mockProvider.getPaymentStatus = vi.fn().mockResolvedValue('pending');

      const promiseResult = wrapper(mockExtra);

      // Advance timers to exceed MAX_WAIT_MS
      await vi.advanceTimersByTimeAsync(MAX_WAIT_MS + 1000);

      const result = await promiseResult;

      expect(result.status).toBe('error');
      expect(result.annotations?.payment?.reason).toBe('timeout');
      expect(result.message).toBe('Payment timeout reached; aborting');
      expect(mockTool).not.toHaveBeenCalled();
    });

    it('should poll multiple times while payment is pending', async () => {
      const mockTool = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Tool result' }]
      });

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProviders,
        priceInfo,
        'testTool',
        mockStateStore,
        mockConfig,
        clientInfo,
        mockLogger
      );

      // Mock pending for first 2 calls, then paid
      mockProvider.getPaymentStatus = vi.fn()
        .mockResolvedValueOnce('pending')
        .mockResolvedValueOnce('pending')
        .mockResolvedValueOnce('paid');

      const promiseResult = wrapper(mockExtra);

      // Advance through multiple polling cycles
      await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS); // First poll - pending
      await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS); // Second poll - pending
      await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS); // Third poll - paid

      const result = await promiseResult;

      expect(mockProvider.getPaymentStatus).toHaveBeenCalledTimes(3);
      expect(mockTool).toHaveBeenCalled();
      expect(result.annotations?.payment?.status).toBe('paid');
    });

    it('should handle tool result without content field', async () => {
      const mockTool = vi.fn().mockResolvedValue('simple string result');

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProviders,
        priceInfo,
        'testTool',
        mockStateStore,
        mockConfig,
        clientInfo,
        mockLogger
      );

      mockProvider.getPaymentStatus = vi.fn().mockResolvedValue('paid');

      const promiseResult = wrapper(mockExtra);
      await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS);
      const result = await promiseResult;

      expect(result).toBe('simple string result');
    });

    it('should handle annotation error gracefully', async () => {
      const mockTool = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Tool result' }],
        get annotations() {
          throw new Error('Cannot set annotations');
        }
      });

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProviders,
        priceInfo,
        'testTool',
        mockStateStore,
        mockConfig,
        clientInfo,
        mockLogger
      );

      mockProvider.getPaymentStatus = vi.fn().mockResolvedValue('paid');

      const promiseResult = wrapper(mockExtra);
      await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS);
      const result = await promiseResult;

      // Should not throw error
      expect(result.content).toEqual([{ type: 'text', text: 'Tool result' }]);
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
        mockProviders,
        priceInfo,
        'testTool'
      );

      mockProvider.getPaymentStatus = vi.fn().mockResolvedValue('paid');

      const promiseResult = wrapper(mockExtra);
      await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS);
      await promiseResult;

      expect(providerLogger.debug).toHaveBeenCalled();
    });

    it('should use console logger when no logger provided and provider has no logger', async () => {
      const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

      const mockTool = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Tool result' }]
      });

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProviders,
        priceInfo,
        'testTool'
      );

      mockProvider.getPaymentStatus = vi.fn().mockResolvedValue('paid');

      const promiseResult = wrapper(mockExtra);
      await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS);
      await promiseResult;

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('safeReportProgress', () => {
    it('should send progress notification when sendNotification and token available', async () => {
      const wrapper = makePaidWrapper(
        vi.fn(),
        mockServer,
        mockProviders,
        priceInfo,
        'testTool',
        mockStateStore,
        mockConfig,
        clientInfo,
        mockLogger
      );

      mockProvider.getPaymentStatus = vi.fn().mockResolvedValue('paid');

      const promiseResult = wrapper(mockExtra);
      await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS);
      await promiseResult;

      expect(mockExtra.sendNotification).toHaveBeenCalledWith({
        method: 'notifications/progress',
        params: {
          progressToken: 'progress_token_123',
          progress: 0,
          total: 100,
          message: expect.stringContaining('payment.example.com')
        }
      });
    });

    it('should fall back to debug logging when sendNotification fails', async () => {
      mockExtra.sendNotification = vi.fn().mockRejectedValue(new Error('Network error'));

      const wrapper = makePaidWrapper(
        vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'result' }] }),
        mockServer,
        mockProviders,
        priceInfo,
        'testTool',
        mockStateStore,
        mockConfig,
        clientInfo,
        mockLogger
      );

      mockProvider.getPaymentStatus = vi.fn().mockResolvedValue('paid');

      const promiseResult = wrapper(mockExtra);
      await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS);
      await promiseResult;

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('progress-token notify failed')
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('progress 0/100')
      );
    });

    it('should use debug logging when no sendNotification function', async () => {
      const extraWithoutSendNotification = {
        _meta: { progressToken: 'token_123' }
      } as ToolExtraLike;

      const wrapper = makePaidWrapper(
        vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'result' }] }),
        mockServer,
        mockProviders,
        priceInfo,
        'testTool',
        mockStateStore,
        mockConfig,
        clientInfo,
        mockLogger
      );

      mockProvider.getPaymentStatus = vi.fn().mockResolvedValue('paid');

      const promiseResult = wrapper(extraWithoutSendNotification);
      await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS);
      await promiseResult;

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('progress 0/100')
      );
    });

    it('should use debug logging when no progress token', async () => {
      const extraWithoutToken = {
        sendNotification: vi.fn()
      } as any;

      const wrapper = makePaidWrapper(
        vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'result' }] }),
        mockServer,
        mockProviders,
        priceInfo,
        'testTool',
        mockStateStore,
        mockConfig,
        clientInfo,
        mockLogger
      );

      mockProvider.getPaymentStatus = vi.fn().mockResolvedValue('paid');

      const promiseResult = wrapper(extraWithoutToken);
      await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS);
      await promiseResult;

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('progress 0/100')
      );
    });

    it('should handle alternative progress token location', async () => {
      const extraWithDirectToken = {
        sendNotification: vi.fn().mockResolvedValue(undefined),
        progressToken: 'direct_token_456'
      } as any;

      const wrapper = makePaidWrapper(
        vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'result' }] }),
        mockServer,
        mockProviders,
        priceInfo,
        'testTool',
        mockStateStore,
        mockConfig,
        clientInfo,
        mockLogger
      );

      mockProvider.getPaymentStatus = vi.fn().mockResolvedValue('paid');

      const promiseResult = wrapper(extraWithDirectToken);
      await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS);
      await promiseResult;

      expect(extraWithDirectToken.sendNotification).toHaveBeenCalledWith({
        method: 'notifications/progress',
        params: {
          progressToken: 'direct_token_456',
          progress: 0,
          total: 100,
          message: expect.stringContaining('payment.example.com')
        }
      });
    });
  });

  describe('edge cases', () => {
    it('should calculate progress percentage correctly during polling', async () => {
      const mockTool = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Tool result' }]
      });

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProviders,
        priceInfo,
        'testTool',
        mockStateStore,
        mockConfig,
        clientInfo,
        mockLogger
      );

      // Mock pending for multiple calls to test progress calculation
      mockProvider.getPaymentStatus = vi.fn()
        .mockResolvedValueOnce('pending')
        .mockResolvedValueOnce('pending')
        .mockResolvedValueOnce('paid');

      const promiseResult = wrapper(mockExtra);

      // Advance through polling cycles
      await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS); // First poll
      await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS); // Second poll
      await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS); // Third poll - paid

      await promiseResult;

      // Check that progress updates were sent with increasing percentages
      const notificationCalls = (mockExtra.sendNotification as any).mock.calls;
      expect(notificationCalls.length).toBeGreaterThan(2);

      // Initial progress should be 0
      expect(notificationCalls[0][0].params.progress).toBe(0);

      // Final progress should be 100
      const finalCall = notificationCalls[notificationCalls.length - 1];
      expect(finalCall[0].params.progress).toBe(100);
    });

    it('should handle payment status normalization', async () => {
      const mockTool = vi.fn();

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProviders,
        priceInfo,
        'testTool',
        mockStateStore,
        mockConfig,
        clientInfo,
        mockLogger
      );

      // Test different raw statuses that normalize to "canceled"
      mockProvider.getPaymentStatus = vi.fn().mockResolvedValue('CANCELLED'); // uppercase

      const promiseResult = wrapper(mockExtra);
      await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS);
      const result = await promiseResult;

      expect(result.status).toBe('canceled');
      expect(mockTool).not.toHaveBeenCalled();
    });

    it('should handle multiple rapid status changes', async () => {
      const mockTool = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Tool result' }]
      });

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProviders,
        priceInfo,
        'testTool',
        mockStateStore,
        mockConfig,
        clientInfo,
        mockLogger
      );

      // Simulate rapid status changes
      mockProvider.getPaymentStatus = vi.fn()
        .mockResolvedValueOnce('processing')
        .mockResolvedValueOnce('validating')
        .mockResolvedValueOnce('pending')
        .mockResolvedValueOnce('paid');

      const promiseResult = wrapper(mockExtra);

      // Advance through multiple quick polls
      for (let i = 0; i < 4; i++) {
        await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS);
      }

      const result = await promiseResult;

      expect(mockProvider.getPaymentStatus).toHaveBeenCalledTimes(4);
      expect(result.annotations?.payment?.status).toBe('paid');
    });
  });
});
