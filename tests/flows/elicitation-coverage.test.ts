import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makePaidWrapper } from '../../src/flows/elicitation';
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

describe('ElicitationFlow - Coverage Tests', () => {
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

  it('should handle elicitation method not found error (code -32601)', async () => {
    const wrapper = makePaidWrapper(originalFunc, mockServer, mockProvider, price, 'test_tool');

    const extra = {
      sendRequest: vi.fn().mockRejectedValue({
        code: -32601,
        message: 'Method not found',
      }),
    };

    const result = await wrapper({ test: 'data' }, extra);

    expect(mockProvider.createPayment).toHaveBeenCalled();
    expect(result.status).toBe('error');
    expect(result.message).toContain('Client does not support the selected payment flow');
  });

  it('should handle elicitation method not found error (text match)', async () => {
    const wrapper = makePaidWrapper(originalFunc, mockServer, mockProvider, price, 'test_tool');

    const extra = {
      sendRequest: vi.fn().mockRejectedValue(new Error('Method not found: elicitation/create')),
    };

    const result = await wrapper({ test: 'data' }, extra);

    expect(mockProvider.createPayment).toHaveBeenCalled();
    expect(result.status).toBe('error');
  });

  it('should handle elicitation response with result.action structure', async () => {
    const wrapper = makePaidWrapper(originalFunc, mockServer, mockProvider, price, 'test_tool');

    const extra = {
      sendRequest: vi.fn().mockResolvedValue({
        result: {
          action: 'accept',
        },
      }),
    };

    const result = await wrapper({ test: 'data' }, extra);

    expect(originalFunc).toHaveBeenCalled();
    expect(result.annotations?.payment?.status).toBe('paid');
  });

  it('should handle payment status returns failed', async () => {
    const wrapper = makePaidWrapper(originalFunc, mockServer, mockProvider, price, 'test_tool');

    (mockProvider.getPaymentStatus as vi.Mock).mockResolvedValueOnce('failed');

    const extra = {
      sendRequest: vi.fn().mockResolvedValue({
        action: 'accept',
      }),
    };

    const result = await wrapper({ test: 'data' }, extra);

    // Failed payment should not execute original function
    expect(originalFunc).not.toHaveBeenCalled();
    expect(result.status).toBe('canceled'); // failed status maps to canceled
  });

  it('should handle payment status returns error', async () => {
    const wrapper = makePaidWrapper(originalFunc, mockServer, mockProvider, price, 'test_tool');

    (mockProvider.getPaymentStatus as vi.Mock).mockResolvedValueOnce('error');

    const extra = {
      sendRequest: vi.fn().mockResolvedValue({
        action: 'accept',
      }),
    };

    const result = await wrapper({ test: 'data' }, extra);

    expect(originalFunc).not.toHaveBeenCalled();
    expect(result.status).toBe('canceled'); // error status maps to canceled
  });

  it('should handle elicitation error other than method not found', async () => {
    const wrapper = makePaidWrapper(originalFunc, mockServer, mockProvider, price, 'test_tool');

    const extra = {
      sendRequest: vi.fn().mockRejectedValue(new Error('Network error')),
    };

    const result = await wrapper({ test: 'data' }, extra);

    expect(mockProvider.createPayment).toHaveBeenCalled();
    expect(result.status).toBe('canceled');
    expect(result.message).toContain('Payment canceled by user');
  });

  it('should handle waiting and retrying when payment is pending', async () => {
    const wrapper = makePaidWrapper(originalFunc, mockServer, mockProvider, price, 'test_tool');

    // Mock payment status sequence: pending -> pending -> paid
    (mockProvider.getPaymentStatus as vi.Mock)
      .mockResolvedValueOnce('pending')
      .mockResolvedValueOnce('pending')
      .mockResolvedValueOnce('paid');

    const extra = {
      sendRequest: vi
        .fn()
        .mockResolvedValueOnce({ action: 'unknown' })
        .mockResolvedValueOnce({ action: 'unknown' })
        .mockResolvedValueOnce({ action: 'accept' }),
    };

    await withFakeTimers(async () => {
      const promise = wrapper({ test: 'data' }, extra);
      // Run all timers to completion (will fast-forward through elicitation attempts)
      await vi.runAllTimersAsync();
      const result = await promise;

      // Should have called sendRequest multiple times
      expect(extra.sendRequest).toHaveBeenCalledTimes(3);
      expect(originalFunc).toHaveBeenCalled();
      expect(result.annotations?.payment?.status).toBe('paid');
    });
  });

  it('should handle annotation error during successful payment', async () => {
    const wrapper = makePaidWrapper(originalFunc, mockServer, mockProvider, price, 'test_tool');

    // Mock original function to return invalid structure for annotation
    originalFunc.mockResolvedValueOnce(null);

    const extra = {
      sendRequest: vi.fn().mockResolvedValue({
        action: 'accept',
      }),
    };

    const result = await wrapper({ test: 'data' }, extra);

    // Should still process payment even if annotation fails
    expect(originalFunc).toHaveBeenCalled();
    // Result should have payment annotation even if original returns null
    expect(result.annotations?.payment?.status).toBe('paid');
  });

  it('should handle missing sendRequest in extra', async () => {
    const wrapper = makePaidWrapper(originalFunc, mockServer, mockProvider, price, 'test_tool');

    const extra = {}; // No sendRequest

    const result = await wrapper({ test: 'data' }, extra);

    expect(mockProvider.createPayment).not.toHaveBeenCalled(); // Should not create payment if no sendRequest
    expect(result.status).toBe('error');
    expect(result.message).toContain('Client does not support the selected payment flow');
  });

  it('should pass through original function result structure correctly', async () => {
    const complexResult = {
      content: [
        { type: 'text', text: 'Line 1' },
        { type: 'text', text: 'Line 2' },
      ],
      metadata: { foo: 'bar' },
    };

    originalFunc.mockResolvedValueOnce(complexResult);

    const wrapper = makePaidWrapper(originalFunc, mockServer, mockProvider, price, 'test_tool');

    const extra = {
      sendRequest: vi.fn().mockResolvedValue({
        action: 'accept',
      }),
    };

    const result = await wrapper({ test: 'data' }, extra);

    expect(result.content).toEqual(complexResult.content);
    expect(result.metadata).toEqual(complexResult.metadata);
    expect(result.annotations?.payment?.status).toBe('paid');
  });

  it('should handle session storage and retrieval for multi-session scenario', async () => {
    const wrapper = makePaidWrapper(originalFunc, mockServer, mockProvider, price, 'test_tool');

    // First call with session ID
    const extra1 = {
      sendRequest: vi.fn().mockResolvedValue({ action: 'accept' }),
      headers: { 'Mcp-Session-Id': 'session1' },
    };

    await wrapper({ test: 'data' }, extra1);

    // Second call with different session ID
    const extra2 = {
      sendRequest: vi.fn().mockResolvedValue({ action: 'accept' }),
      headers: { 'Mcp-Session-Id': 'session2' },
    };

    await wrapper({ test: 'data' }, extra2);

    // Both should create separate payments
    expect(mockProvider.createPayment).toHaveBeenCalledTimes(2);
  });
});
