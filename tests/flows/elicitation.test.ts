import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makePaidWrapper } from '../../src/flows/elicitation';
import { BasePaymentProvider } from '../../src/providers/base';
import { SessionManager } from '../../src/session/manager';
import type { McpServerLike } from '../../src/types/mcp';
import type { Price } from '../../src/types/payment';

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

describe('ElicitationFlow', () => {
  let mockServer: McpServerLike;
  let mockProvider: MockProvider;
  let originalFunc: any;
  let price: Price;

  beforeEach(() => {
    mockServer = {
      requestElicitation: vi.fn(),
      registerTool: vi.fn(),
      reportProgress: vi.fn(),
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

  it('should create elicitation wrapper', () => {
    const wrapper = makePaidWrapper(originalFunc, mockServer, mockProvider, price, 'test_tool');
    expect(wrapper).toBeDefined();
    expect(typeof wrapper).toBe('function');
  });

  it('should handle accepted payment', async () => {
    const wrapper = makePaidWrapper(originalFunc, mockServer, mockProvider, price, 'test_tool');

    // Mock elicitation response - accepted
    (mockServer.requestElicitation as vi.Mock).mockResolvedValueOnce({
      accepted: true,
    });

    const args = { test: 'data' };
    const extra = {
      sendRequest: vi.fn().mockResolvedValue({
        action: 'accept',
      }),
    };
    const result = await wrapper(args, extra);

    expect(extra.sendRequest).toHaveBeenCalled();

    expect(mockProvider.createPayment).toHaveBeenCalledWith(
      10.0,
      'USD',
      'test_tool() execution fee'
    );

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

  it('should handle rejected payment', async () => {
    const wrapper = makePaidWrapper(originalFunc, mockServer, mockProvider, price, 'test_tool');

    // Mock payment status as canceled when rejected
    (mockProvider.getPaymentStatus as vi.Mock).mockResolvedValueOnce('canceled');

    // Mock elicitation response - rejected
    (mockServer.requestElicitation as vi.Mock).mockResolvedValueOnce({
      accepted: false,
    });

    const extra = {
      sendRequest: vi.fn().mockResolvedValue({
        action: 'decline',
      }),
    };
    const result = await wrapper({ test: 'data' }, extra);

    expect(extra.sendRequest).toHaveBeenCalled();
    expect(mockProvider.createPayment).toHaveBeenCalledWith(
      10.0,
      'USD',
      'test_tool() execution fee'
    ); // Payment is created first, then rejected
    expect(originalFunc).not.toHaveBeenCalled(); // But original function is not called

    expect(result.content).toEqual([{ type: 'text', text: 'Payment canceled by user.' }]);
    expect(result.annotations?.payment?.status).toBe('canceled');
  });

  it('should handle payment creation failure', async () => {
    const wrapper = makePaidWrapper(originalFunc, mockServer, mockProvider, price, 'test_tool');

    // Mock elicitation response - accepted
    (mockServer.requestElicitation as vi.Mock).mockResolvedValueOnce({
      accepted: true,
    });

    // Mock payment creation failure
    (mockProvider.createPayment as vi.Mock).mockRejectedValueOnce(new Error('Payment API error'));

    const extra = {
      sendRequest: vi.fn().mockResolvedValue({
        action: 'accept',
      }),
    };
    await expect(wrapper({ test: 'data' }, extra)).rejects.toThrow('Payment API error');

    expect(originalFunc).not.toHaveBeenCalled();
  });

  it('should handle payment status check failure', async () => {
    const wrapper = makePaidWrapper(originalFunc, mockServer, mockProvider, price, 'test_tool');

    // Mock elicitation response - accepted
    (mockServer.requestElicitation as vi.Mock).mockResolvedValueOnce({
      accepted: true,
    });

    // Mock payment status as paid (after user accepts)
    (mockProvider.getPaymentStatus as vi.Mock).mockResolvedValueOnce('paid');

    const extra = {
      sendRequest: vi.fn().mockResolvedValue({
        action: 'accept',
      }),
    };
    const result = await wrapper({ test: 'data' }, extra);

    // When user accepts and payment is confirmed, original function is called
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

  it('should handle elicitation error', async () => {
    const wrapper = makePaidWrapper(originalFunc, mockServer, mockProvider, price, 'test_tool');

    // Mock elicitation failure
    (mockServer.requestElicitation as vi.Mock).mockRejectedValueOnce(
      new Error('Elicitation not supported')
    );

    const extra = {
      sendRequest: vi.fn().mockRejectedValue(new Error('Elicitation not supported')),
    };
    // When sendRequest fails, elicitation will retry and eventually fail
    const result = await wrapper({ test: 'data' }, extra);

    // Payment is still created but elicitation fails
    expect(mockProvider.createPayment).toHaveBeenCalled();
    expect(originalFunc).not.toHaveBeenCalled();

    // Should return an error result
    expect(result.content).toEqual([{ type: 'text', text: expect.any(String) }]);
  });

  it('should handle original function errors', async () => {
    const errorFunc = vi.fn().mockRejectedValue(new Error('Tool execution failed'));

    const wrapper = makePaidWrapper(errorFunc, mockServer, mockProvider, price, 'test_tool');

    // Mock elicitation response - accepted
    (mockServer.requestElicitation as vi.Mock).mockResolvedValueOnce({
      accepted: true,
    });

    const extra = {
      sendRequest: vi.fn().mockResolvedValue({
        action: 'accept',
      }),
    };
    await expect(wrapper({ test: 'data' }, extra)).rejects.toThrow('Tool execution failed');

    expect(mockProvider.createPayment).toHaveBeenCalled();
    expect(errorFunc).toHaveBeenCalled();
  });

  it('should handle missing elicitation response', async () => {
    const wrapper = makePaidWrapper(originalFunc, mockServer, mockProvider, price, 'test_tool');

    // Mock payment status as canceled for unknown action
    (mockProvider.getPaymentStatus as vi.Mock).mockResolvedValueOnce('canceled');

    // Mock elicitation with missing accepted field
    (mockServer.requestElicitation as vi.Mock).mockResolvedValueOnce({});

    const extra = {
      sendRequest: vi.fn().mockResolvedValue({
        action: 'decline', // Decline action to reject payment
      }),
    };
    const result = await wrapper({ test: 'data' }, extra);

    // Payment is created first
    expect(mockProvider.createPayment).toHaveBeenCalledWith(
      10.0,
      'USD',
      'test_tool() execution fee'
    );

    // Unknown action should be treated as canceled
    expect(originalFunc).not.toHaveBeenCalled();
    expect(result.content).toEqual([{ type: 'text', text: 'Payment canceled by user.' }]);
    expect(result.annotations?.payment?.status).toBe('canceled');
  });
});
