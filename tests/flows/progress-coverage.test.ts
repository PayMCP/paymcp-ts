import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makePaidWrapper } from '../../src/flows/progress';
import { BasePaymentProvider } from '../../src/providers/base';
import { SessionManager } from '../../src/session/manager';
import type { Price } from '../../src/types/payment';
import { withFakeTimers } from '../utils/timer-helpers';

class MockProvider extends BasePaymentProvider {
  getName() {
    return 'mock';
  }

  async createPayment(amount: number, currency: string, description: string) {
    return {
      paymentId: 'test_payment',
      paymentUrl: 'https://test.com/pay',
    };
  }

  async getPaymentStatus(paymentId: string) {
    return 'paid';
  }
}

describe('ProgressFlow - Coverage Tests', () => {
  let mockProvider: MockProvider;
  let originalFunc: any;
  let price: Price;
  let mockServer: any;

  beforeEach(() => {
    SessionManager.reset();
    vi.clearAllMocks();

    mockServer = {
      requestElicitation: vi.fn(),
      registerTool: vi.fn(),
      reportProgress: vi.fn(),
    };

    mockProvider = new MockProvider('test_key');
    vi.spyOn(mockProvider, 'createPayment');
    vi.spyOn(mockProvider, 'getPaymentStatus');

    originalFunc = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'Success' }],
    });

    price = { amount: 10.0, currency: 'USD' };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should handle client abort via signal', async () => {
    const wrapper = makePaidWrapper(originalFunc, mockServer, mockProvider, price, 'test_tool');

    // Create an abort signal that triggers after first poll
    let pollCount = 0;
    (mockProvider.getPaymentStatus as vi.Mock).mockImplementation(async () => {
      pollCount++;
      if (pollCount === 1) {
        // After first poll, set aborted to true
        extra.signal.aborted = true;
      }
      return 'pending';
    });

    const extra = {
      signal: { aborted: false },
      reportProgress: vi.fn(),
    };

    await withFakeTimers(async () => {
      const promise = wrapper({ test: 'data' }, extra);
      await vi.advanceTimersByTimeAsync(3000);
      const result = await promise;

      expect(result.status).toBe('canceled');
      expect(result.message).toBe('Payment aborted by client');
      expect(originalFunc).not.toHaveBeenCalled();
    });
  });

  it('should handle tool result without content field', async () => {
    // Mock original function to return non-standard result
    originalFunc.mockResolvedValueOnce({ data: 'some data', success: true });

    const wrapper = makePaidWrapper(originalFunc, mockServer, mockProvider, price, 'test_tool');

    const extra = {
      reportProgress: vi.fn(),
    };

    await withFakeTimers(async () => {
      const promise = wrapper({ test: 'data' }, extra);
      await vi.advanceTimersByTimeAsync(3000);
      const result = await promise;

      expect(originalFunc).toHaveBeenCalled();
      expect(result.content).toEqual([{ type: 'text', text: 'Tool completed after payment.' }]);
      expect(result.raw).toEqual({ data: 'some data', success: true });
      expect(result.annotations?.payment?.status).toBe('paid');
    });
  });

  it('should handle tool result with null content', async () => {
    originalFunc.mockResolvedValueOnce({ content: null });

    const wrapper = makePaidWrapper(originalFunc, mockServer, mockProvider, price, 'test_tool');

    const extra = {
      reportProgress: vi.fn(),
    };

    await withFakeTimers(async () => {
      const promise = wrapper({ test: 'data' }, extra);
      await vi.advanceTimersByTimeAsync(3000);
      const result = await promise;

      expect(originalFunc).toHaveBeenCalled();
      expect(result.content).toEqual([{ type: 'text', text: 'Tool completed after payment.' }]);
      expect(result.annotations?.payment?.status).toBe('paid');
    });
  });

  it('should handle annotation error gracefully', async () => {
    // Create a result object that throws when trying to add annotations
    const resultWithError = {
      content: [{ type: 'text', text: 'Success' }],
      get annotations() {
        throw new Error('Cannot modify annotations');
      },
      set annotations(val) {
        throw new Error('Cannot modify annotations');
      }
    };

    originalFunc.mockResolvedValueOnce(resultWithError);

    const wrapper = makePaidWrapper(originalFunc, mockServer, mockProvider, price, 'test_tool');

    const extra = {
      reportProgress: vi.fn(),
    };

    await withFakeTimers(async () => {
      const promise = wrapper({ test: 'data' }, extra);
      await vi.advanceTimersByTimeAsync(3000);
      const result = await promise;

      // Should still return the result even if annotation fails
      expect(originalFunc).toHaveBeenCalled();
      expect(result.content).toEqual([{ type: 'text', text: 'Success' }]);
    });
  });

  it('should handle reportProgress failures gracefully', async () => {
    const wrapper = makePaidWrapper(originalFunc, mockServer, mockProvider, price, 'test_tool');

    const extra = {
      reportProgress: vi.fn().mockRejectedValue(new Error('Progress reporting failed')),
    };

    await withFakeTimers(async () => {
      const promise = wrapper({ test: 'data' }, extra);
      await vi.advanceTimersByTimeAsync(3000);
      const result = await promise;

      // Should continue despite progress reporting failures - reportProgress not called in new flow
      // expect(extra.reportProgress).toHaveBeenCalled();
      expect(originalFunc).toHaveBeenCalled();
      expect(result.annotations?.payment?.status).toBe('paid');
    });
  });

  it('should handle missing reportProgress function', async () => {
    const wrapper = makePaidWrapper(originalFunc, mockServer, mockProvider, price, 'test_tool');

    const extra = {}; // No reportProgress function

    await withFakeTimers(async () => {
      const promise = wrapper({ test: 'data' }, extra);
      await vi.advanceTimersByTimeAsync(3000);
      const result = await promise;

      // Should work without reportProgress
      expect(originalFunc).toHaveBeenCalled();
      expect(result.annotations?.payment?.status).toBe('paid');
    });
  });

  it('should handle payment status transition from pending to paid', async () => {
    vi.useFakeTimers();

    const wrapper = makePaidWrapper(originalFunc, mockServer, mockProvider, price, 'test_tool');

    // Mock status sequence: pending -> pending -> paid
    let callCount = 0;
    (mockProvider.getPaymentStatus as vi.Mock).mockImplementation(async () => {
      callCount++;
      return callCount <= 2 ? 'pending' : 'paid';
    });

    const extra = {
      reportProgress: vi.fn(),
    };

    // Start the wrapper call but don't await yet
    const resultPromise = wrapper({ test: 'data' }, extra);

    // Advance timers to trigger polls
    await vi.runAllTimersAsync();

    const result = await resultPromise;

    vi.useRealTimers();

    expect(mockProvider.getPaymentStatus).toHaveBeenCalledTimes(3);
    expect(originalFunc).toHaveBeenCalled();
    expect(result.annotations?.payment?.status).toBe('paid');
  });

  it('should calculate progress percentage correctly during polling', async () => {
    const wrapper = makePaidWrapper(originalFunc, mockServer, mockProvider, price, 'test_tool');

    // Mock to return paid immediately
    (mockProvider.getPaymentStatus as vi.Mock).mockResolvedValueOnce('paid');

    const progressCalls: number[] = [];
    const extra = {
      _meta: {
        progressToken: 'test-token'
      },
      sendNotification: vi.fn().mockImplementation((notification) => {
        if (notification.params?.progress !== undefined) {
          progressCalls.push(notification.params.progress);
        }
        return Promise.resolve();
      }),
    };

    await withFakeTimers(async () => {
      const promise = wrapper({ test: 'data' }, extra);
      await vi.advanceTimersByTimeAsync(3000);
      const result = await promise;

      // Should have at least initial (0) and final (100) progress
      expect(progressCalls).toContain(0); // Initial
      expect(progressCalls).toContain(100); // Final
      expect(extra.sendNotification).toHaveBeenCalled();
      expect(result.annotations?.payment?.status).toBe('paid');
    });
  });

  it('should handle session storage errors gracefully', async () => {
    const wrapper = makePaidWrapper(originalFunc, mockServer, mockProvider, price, 'test_tool');

    // Mock session storage to throw errors
    const originalSet = SessionManager.set;
    SessionManager.set = vi.fn().mockRejectedValue(new Error('Storage error'));

    const extra = {
      reportProgress: vi.fn(),
    };

    await withFakeTimers(async () => {
      const promise = wrapper({ test: 'data' }, extra);
      await vi.advanceTimersByTimeAsync(3000);
      const result = await promise;

      // Should continue despite storage errors
      expect(originalFunc).toHaveBeenCalled();
      expect(result.annotations?.payment?.status).toBe('paid');

      // Restore original
      SessionManager.set = originalSet;
    });
  });

  it('should handle empty tool arguments', async () => {
    const wrapper = makePaidWrapper(originalFunc, mockServer, mockProvider, price, 'test_tool');

    const extra = {
      reportProgress: vi.fn(),
    };

    // Call without arguments (only extra)
    await withFakeTimers(async () => {
      const promise = wrapper(extra);
      await vi.advanceTimersByTimeAsync(3000);
      const result = await promise;

      expect(mockProvider.createPayment).toHaveBeenCalled();
      expect(originalFunc).toHaveBeenCalledWith(extra);
      expect(result.annotations?.payment?.status).toBe('paid');
    });
  });

  it('should handle complex tool results with existing annotations', async () => {
    const complexResult = {
      content: [{ type: 'text', text: 'Success' }],
      annotations: {
        existing: 'annotation',
        nested: { value: 123 }
      },
      metadata: { foo: 'bar' }
    };

    originalFunc.mockResolvedValueOnce(complexResult);

    const wrapper = makePaidWrapper(originalFunc, mockServer, mockProvider, price, 'test_tool');

    const extra = {
      reportProgress: vi.fn(),
    };

    await withFakeTimers(async () => {
      const promise = wrapper({ test: 'data' }, extra);
      await vi.advanceTimersByTimeAsync(3000);
      const result = await promise;

      // Should preserve existing annotations and add payment annotation
      expect(result.annotations.existing).toBe('annotation');
      expect(result.annotations.nested).toEqual({ value: 123 });
      expect(result.annotations.payment).toEqual({
        status: 'paid',
        payment_id: 'test_payment'
      });
      expect(result.metadata).toEqual({ foo: 'bar' });
    });
  });
});