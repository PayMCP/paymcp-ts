import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makePaidWrapper } from '../../src/flows/two_step';
import { BasePaymentProvider } from '../../src/providers/base';
import { SessionManager } from '../../src/session/manager';
import { SessionKey } from '../../src/session/types';
import type { Price } from '../../src/types/payment';

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

describe('TwoStepFlow - Coverage Tests', () => {
  let mockProvider: MockProvider;
  let originalFunc: any;
  let price: Price;
  let mockServer: any;

  beforeEach(async () => {
    // Don't reset SessionManager, just clear the storage
    const storage = SessionManager.getStorage();
    await storage.clear();

    mockServer = {
      registerTool: vi.fn(),
      tools: new Map(),
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

  it('should handle confirmation tool with payment_id in extra when no args', async () => {
    const wrapper = makePaidWrapper(originalFunc, mockServer, mockProvider, price, 'test_tool');

    // Register the confirmation tool
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      'confirm_test_tool_payment',
      expect.objectContaining({
        title: expect.stringContaining('Confirm payment'),
        description: expect.stringContaining('Confirm payment'),
      }),
      expect.any(Function)
    );

    // Get the confirmation handler
    const confirmCall = mockServer.registerTool.mock.calls[0];
    const confirmHandler = confirmCall[2]; // Handler is the third argument

    // Store a session
    const sessionStorage = SessionManager.getStorage();
    const sessionKey = new SessionKey(mockProvider.getName(), 'test_payment', undefined);
    await sessionStorage.set(sessionKey, {
      args: { test: 'data' },
      ts: Date.now(),
      providerName: mockProvider.getName(),
      metadata: {},
    });

    // Call confirmation handler with payment_id as first arg, empty object as extra
    const extra = {};
    const result = await confirmHandler({ payment_id: 'test_payment' }, extra);

    expect(mockProvider.getPaymentStatus).toHaveBeenCalledWith('test_payment');
    expect(originalFunc).toHaveBeenCalledWith({ test: 'data' }, extra);
    expect(result.content).toEqual([{ type: 'text', text: 'Success' }]);
  });

  it('should handle original function without arguments', async () => {
    // Original function that expects no arguments
    const noArgsFunc = vi.fn().mockImplementation(extra => {
      return { content: [{ type: 'text', text: 'No args success' }] };
    });

    const wrapper = makePaidWrapper(noArgsFunc, mockServer, mockProvider, price, 'test_tool');

    const extra = {};
    const result = await wrapper(extra); // Call without args

    expect(mockProvider.createPayment).toHaveBeenCalled();
    // The message field contains JSON string with payment details
    expect(result.structured_content?.status).toBe('payment_required');
    expect(result.structured_content?.next_step).toBe('confirm_test_tool_payment');
  });

  it('should reuse existing confirmation tool if already registered', () => {
    // First wrapper
    makePaidWrapper(originalFunc, mockServer, mockProvider, price, 'test_tool');

    // Add tool to the map to simulate it being registered
    mockServer.tools.set('confirm_test_tool_payment', {
      config: {},
      handler: vi.fn(),
    });

    // Reset the mock to track new calls
    mockServer.registerTool.mockClear();

    // Second wrapper for same tool
    makePaidWrapper(originalFunc, mockServer, mockProvider, price, 'test_tool');

    // Should not register again
    expect(mockServer.registerTool).not.toHaveBeenCalled();
  });

  it('should handle confirmation without session found', async () => {
    const wrapper = makePaidWrapper(originalFunc, mockServer, mockProvider, price, 'test_tool');

    // Get the confirmation handler
    const confirmCall = mockServer.registerTool.mock.calls[0];
    const confirmHandler = confirmCall[2]; // Handler is the third argument

    // Call confirmation with non-existent payment_id
    const result = await confirmHandler({ payment_id: 'non_existent' }, {});

    expect(result.status).toBe('error');
    expect(result.message).toContain('Unknown or expired payment_id');
  });

  it('should handle confirmation with unpaid status', async () => {
    const wrapper = makePaidWrapper(originalFunc, mockServer, mockProvider, price, 'test_tool');

    // Mock payment as pending
    (mockProvider.getPaymentStatus as vi.Mock).mockResolvedValueOnce('pending');

    // Get the confirmation handler
    const confirmCall = mockServer.registerTool.mock.calls[0];
    const confirmHandler = confirmCall[2]; // Handler is the third argument

    // Store a session
    const sessionStorage = SessionManager.getStorage();
    const sessionKey = new SessionKey(mockProvider.getName(), 'test_payment', undefined);
    await sessionStorage.set(sessionKey, {
      args: { test: 'data' },
      ts: Date.now(),
      providerName: mockProvider.getName(),
      metadata: {},
    });

    // Call confirmation
    const result = await confirmHandler({ payment_id: 'test_payment' }, {});

    expect(result.status).toBe('error');
    expect(result.message).toContain('Payment status is pending');
    expect(originalFunc).not.toHaveBeenCalled();
  });

  it('should handle confirmation with canceled status', async () => {
    const wrapper = makePaidWrapper(originalFunc, mockServer, mockProvider, price, 'test_tool');

    // Mock payment as canceled
    (mockProvider.getPaymentStatus as vi.Mock).mockResolvedValueOnce('canceled');

    // Get the confirmation handler
    const confirmCall = mockServer.registerTool.mock.calls[0];
    const confirmHandler = confirmCall[2]; // Handler is the third argument

    // Store a session
    const sessionStorage = SessionManager.getStorage();
    const sessionKey = new SessionKey(mockProvider.getName(), 'test_payment', undefined);
    await sessionStorage.set(sessionKey, {
      args: { test: 'data' },
      ts: Date.now(),
      providerName: mockProvider.getName(),
      metadata: {},
    });

    // Call confirmation
    const result = await confirmHandler({ payment_id: 'test_payment' }, {});

    expect(result.status).toBe('error');
    expect(result.message).toContain('Payment status is canceled');
    expect(originalFunc).not.toHaveBeenCalled();
  });

  it('should handle confirmation with failed status', async () => {
    const wrapper = makePaidWrapper(originalFunc, mockServer, mockProvider, price, 'test_tool');

    // Mock payment as failed
    (mockProvider.getPaymentStatus as vi.Mock).mockResolvedValueOnce('failed');

    // Get the confirmation handler
    const confirmCall = mockServer.registerTool.mock.calls[0];
    const confirmHandler = confirmCall[2]; // Handler is the third argument

    // Store a session
    const sessionStorage = SessionManager.getStorage();
    const sessionKey = new SessionKey(mockProvider.getName(), 'test_payment', undefined);
    await sessionStorage.set(sessionKey, {
      args: { test: 'data' },
      ts: Date.now(),
      providerName: mockProvider.getName(),
      metadata: {},
    });

    // Call confirmation
    const result = await confirmHandler({ payment_id: 'test_payment' }, {});

    expect(result.status).toBe('error');
    expect(result.message).toContain('Payment status is failed');
    expect(originalFunc).not.toHaveBeenCalled();
  });

  it('should handle initiation wrapper with undefined args correctly', async () => {
    const wrapper = makePaidWrapper(originalFunc, mockServer, mockProvider, price, 'test_tool');

    // Call wrapper without arguments (undefined)
    const extra = {};
    const result = await wrapper(undefined, extra);

    expect(mockProvider.createPayment).toHaveBeenCalled();

    // Sessions are stored internally, we just verify createPayment was called
    // The session creation happens in the wrapper itself
    expect(mockProvider.createPayment).toHaveBeenCalled();
  });

  it('should clean up session after successful confirmation', async () => {
    const wrapper = makePaidWrapper(originalFunc, mockServer, mockProvider, price, 'test_tool');

    // Get the confirmation handler
    const confirmCall = mockServer.registerTool.mock.calls[0];
    const confirmHandler = confirmCall[2]; // Handler is the third argument

    // Store a session
    const sessionStorage = SessionManager.getStorage();
    const sessionKey = new SessionKey(mockProvider.getName(), 'test_payment', undefined);
    await sessionStorage.set(sessionKey, {
      args: { test: 'data' },
      ts: Date.now(),
      providerName: mockProvider.getName(),
      metadata: {},
    });

    // Verify session exists
    const sessionBefore = await sessionStorage.get(sessionKey);
    expect(sessionBefore).toBeDefined();

    // Call confirmation
    await confirmHandler({ payment_id: 'test_payment' }, {});

    // Session should be cleaned up
    const sessionAfter = await sessionStorage.get(sessionKey);
    expect(sessionAfter).toBeUndefined();
  });
});
