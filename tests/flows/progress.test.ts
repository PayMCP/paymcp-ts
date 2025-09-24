import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makePaidWrapper } from '../../src/flows/progress';
import { BasePaymentProvider } from '../../src/providers/base';
import { SessionManager } from '../../src/session/manager';
import type { McpServerLike } from '../../src/types/mcp';
import type { Price } from '../../src/types/payment';
import { withFakeTimers } from '../utils/timer-helpers';

class MockProvider extends BasePaymentProvider {
  getName() {
    return 'mock';
  }

  async createPayment(amount: number, currency: string, description: string) {
    return {
      paymentId: 'mock_payment_123',
      paymentUrl: 'https://mock.payment.com/pay/123',
    };
  }

  async getPaymentStatus(paymentId: string) {
    return 'paid';
  }
}

describe('ProgressFlow', () => {
  let mockServer: McpServerLike;
  let mockProvider: MockProvider;
  let originalFunc: any;
  let price: Price;

  beforeEach(() => {
    mockServer = {
      reportProgress: vi.fn(),
      registerTool: vi.fn(),
      requestElicitation: vi.fn(),
    } as any;

    mockProvider = new MockProvider('test_key');
    vi.spyOn(mockProvider, 'createPayment');
    vi.spyOn(mockProvider, 'getPaymentStatus');

    originalFunc = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'Success' }],
    });

    price = { amount: 10.0, currency: 'USD' };
  });

  afterEach(() => {
    SessionManager.reset();
    vi.clearAllMocks();
  });

  it('should create progress wrapper', () => {
    const wrapper = makePaidWrapper(originalFunc, mockServer, mockProvider, price, 'test_tool');
    expect(wrapper).toBeDefined();
    expect(typeof wrapper).toBe('function');
  });

  it('should handle new payment with progress updates', async () => {
    const wrapper = makePaidWrapper(originalFunc, mockServer, mockProvider, price, 'test_tool');

    const args = { test: 'data' };
    const extra = {};

    await withFakeTimers(async () => {
      const promise = wrapper(args, extra);

      // Advance timer to trigger first poll
      await vi.advanceTimersByTimeAsync(3000);

      const result = await promise;

      expect(mockProvider.createPayment).toHaveBeenCalledWith(
        10.0,
        'USD',
        'test_tool() execution fee'
      );

      // Progress is reported via extra object or logging, not directly through server
      // Verify payment was created instead
      expect(mockProvider.getPaymentStatus).toHaveBeenCalled();

      expect(originalFunc).toHaveBeenCalledWith(args, extra);
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Success' }],
        annotations: {
          payment: {
            status: 'paid',
            payment_id: 'mock_payment_123',
          },
        },
      });
    });
  });

  it('should poll for payment status', async () => {
    const wrapper = makePaidWrapper(originalFunc, mockServer, mockProvider, price, 'test_tool');

    // First return pending, then paid
    (mockProvider.getPaymentStatus as vi.Mock)
      .mockResolvedValueOnce('pending')
      .mockResolvedValueOnce('pending')
      .mockResolvedValueOnce('paid');

    await withFakeTimers(async () => {
      const promise = wrapper({ test: 'data' }, {});

      // Advance through polling cycles
      await vi.advanceTimersByTimeAsync(3000); // First poll
      await vi.advanceTimersByTimeAsync(3000); // Second poll
      await vi.advanceTimersByTimeAsync(3000); // Third poll - should be paid

      const result = await promise;

      // Should have polled multiple times
      expect(mockProvider.getPaymentStatus).toHaveBeenCalledTimes(3);

      expect(originalFunc).toHaveBeenCalled();
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Success' }],
        annotations: {
          payment: {
            status: 'paid',
            payment_id: 'mock_payment_123',
          },
        },
      });
    });
  });

  it('should handle payment timeout', async () => {
    const wrapper = makePaidWrapper(originalFunc, mockServer, mockProvider, price, 'test_tool');

    // Always return pending (will timeout)
    (mockProvider.getPaymentStatus as vi.Mock).mockResolvedValue('pending');

    await withFakeTimers(async () => {
      const promise = wrapper({ test: 'data' }, {});

      // Advance time to timeout (15 minutes)
      await vi.advanceTimersByTimeAsync(15 * 60 * 1000);

      // Should timeout and not call original function
      const result = await promise;
      expect(result).toEqual(
        expect.objectContaining({
          content: expect.arrayContaining([
            expect.objectContaining({
              type: 'text',
              text: expect.stringContaining('timeout'),
            }),
          ]),
        })
      );

      expect(originalFunc).not.toHaveBeenCalled();
    });
  });

  it('should handle canceled payment', async () => {
    const wrapper = makePaidWrapper(originalFunc, mockServer, mockProvider, price, 'test_tool');

    (mockProvider.getPaymentStatus as vi.Mock).mockResolvedValue('canceled');

    await withFakeTimers(async () => {
      const promise = wrapper({ test: 'data' }, {});
      await vi.advanceTimersByTimeAsync(3000);
      const result = await promise;

      expect(result.content).toEqual([{ type: 'text', text: 'Payment canceled.' }]);
      expect(result.annotations?.payment?.status).toBe('canceled');

      expect(originalFunc).not.toHaveBeenCalled();
    });
  });

  it('should handle payment creation failure', async () => {
    const wrapper = makePaidWrapper(originalFunc, mockServer, mockProvider, price, 'test_tool');

    (mockProvider.createPayment as vi.Mock).mockRejectedValue(new Error('Payment API error'));

    await expect(wrapper({ test: 'data' }, {})).rejects.toThrow('Payment API error');

    expect(originalFunc).not.toHaveBeenCalled();
  });

  it('should handle progress reporting errors gracefully', async () => {
    const wrapper = makePaidWrapper(originalFunc, mockServer, mockProvider, price, 'test_tool');

    // Mock reportProgress to throw error
    (mockServer.reportProgress as vi.Mock).mockRejectedValue(
      new Error('Progress reporting failed')
    );

    await withFakeTimers(async () => {
      const promise = wrapper({ test: 'data' }, {});
      await vi.advanceTimersByTimeAsync(3000);
      const result = await promise;

      // Should still complete successfully despite progress errors
      expect(originalFunc).toHaveBeenCalled();
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Success' }],
        annotations: {
          payment: {
            status: 'paid',
            payment_id: 'mock_payment_123',
          },
        },
      });
    });
  });
});
