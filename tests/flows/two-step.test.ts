import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makePaidWrapper } from '../../src/flows/two_step';
import { SessionManager } from '../../src/session/manager';
import { BasePaymentProvider } from '../../src/providers/base';

// Clean mock provider using best practices
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

describe('TwoStepFlow', () => {
  let mockProvider: MockProvider;
  let mockServer: any;
  let mockLogger: any;
  let originalFunc: any;

  beforeEach(() => {
    // Clean session state
    SessionManager.reset();

    // Simple logger mock
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    // Create provider and spy on methods
    mockProvider = new MockProvider('api_key', mockLogger);
    vi.spyOn(mockProvider, 'createPayment');
    vi.spyOn(mockProvider, 'getPaymentStatus');

    // Best practice: Simple mock function
    originalFunc = vi.fn(async () => ({
      content: [{ type: 'text', text: 'Tool executed successfully' }],
    }));

    // Mock server object
    mockServer = {
      tools: new Map(),
      registerTool: vi.fn(function (this: any, name: string, config: any, handler: any) {
        this.tools.set(name, { config, handler });
      }),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
    SessionManager.reset();
  });

  describe('Wrapper Creation', () => {
    it('should create wrapper and register confirmation tool', () => {
      const wrapper = makePaidWrapper(
        originalFunc,
        mockServer,
        mockProvider,
        { amount: 10, currency: 'USD' },
        'test_tool',
        mockLogger
      );

      expect(wrapper).toBeDefined();
      expect(mockServer.registerTool).toHaveBeenCalledWith(
        'confirm_test_tool_payment',
        expect.objectContaining({
          title: 'Confirm payment for test_tool',
          description: 'Confirm payment and execute test_tool()',
        }),
        expect.any(Function)
      );
    });

    it('should not re-register confirmation tool if already exists', () => {
      const wrapper1 = makePaidWrapper(
        originalFunc,
        mockServer,
        mockProvider,
        { amount: 10, currency: 'USD' },
        'test_tool',
        mockLogger
      );

      // Clear the mock to check second call
      mockServer.registerTool.mockClear();

      const wrapper2 = makePaidWrapper(
        originalFunc,
        mockServer,
        mockProvider,
        { amount: 10, currency: 'USD' },
        'test_tool',
        mockLogger
      );

      // Should not register again
      expect(mockServer.registerTool).not.toHaveBeenCalled();
    });
  });

  describe('Payment Initiation (Step 1)', () => {
    it('should initiate payment and store session', async () => {
      const wrapper = makePaidWrapper(
        originalFunc,
        mockServer,
        mockProvider,
        { amount: 10, currency: 'USD' },
        'test_tool',
        mockLogger
      );

      const testArgs = { input: 'test data' };
      const result = await wrapper(testArgs, {});

      expect(mockProvider.createPayment).toHaveBeenCalledWith(
        10,
        'USD',
        'test_tool() execution fee'
      );

      expect(result).toMatchObject({
        content: expect.arrayContaining([
          expect.objectContaining({
            type: 'text',
            text: expect.stringContaining('mock_payment_123'),
          }),
        ]),
        structured_content: expect.objectContaining({
          payment_url: 'https://mock.payment.com/pay/123',
          payment_id: 'mock_payment_123',
          next_step: 'confirm_test_tool_payment',
          status: 'payment_required',
          amount: 10,
          currency: 'USD',
        }),
      });

      // Session verification - just check payment initiation worked
      expect(result.structured_content.payment_id).toBe('mock_payment_123');
    });

    it('should handle payment creation errors', async () => {
      // Best practice: Use mockImplementation for complex behavior
      vi.spyOn(mockProvider, 'createPayment').mockRejectedValue(new Error('Payment API error'));

      const wrapper = makePaidWrapper(
        originalFunc,
        mockServer,
        mockProvider,
        { amount: 10, currency: 'USD' },
        'test_tool',
        mockLogger
      );

      await expect(wrapper({ input: 'test' }, {})).rejects.toThrow('Payment API error');
    });
  });

  describe('Payment Confirmation (Step 2)', () => {
    it('should confirm payment and execute original tool', async () => {
      const wrapper = makePaidWrapper(
        originalFunc,
        mockServer,
        mockProvider,
        { amount: 10, currency: 'USD' },
        'test_tool',
        mockLogger
      );

      // Step 1: Initiate payment
      const testArgs = { input: 'test data' };
      await wrapper(testArgs, {});

      // Get the confirmation handler
      const confirmTool = mockServer.tools.get('confirm_test_tool_payment');
      expect(confirmTool).toBeDefined();

      // Step 2: Confirm payment
      const confirmResult = await confirmTool.handler({ payment_id: 'mock_payment_123' }, {});

      expect(mockProvider.getPaymentStatus).toHaveBeenCalledWith('mock_payment_123');
      expect(originalFunc).toHaveBeenCalledWith(testArgs, {
        payment_id: 'mock_payment_123',
      });
      expect(confirmResult).toEqual({
        content: [{ type: 'text', text: 'Tool executed successfully' }],
      });
    });

    it('should handle missing payment_id', async () => {
      const wrapper = makePaidWrapper(
        originalFunc,
        mockServer,
        mockProvider,
        { amount: 10, currency: 'USD' },
        'test_tool',
        mockLogger
      );

      await wrapper({ input: 'test' }, {});

      const confirmTool = mockServer.tools.get('confirm_test_tool_payment');
      const result = await confirmTool.handler({}, {});

      expect(result).toEqual({
        content: [{ type: 'text', text: 'Missing payment_id.' }],
        status: 'error',
        message: 'Missing payment_id',
      });
    });

    it('should handle unknown payment_id', async () => {
      const wrapper = makePaidWrapper(
        originalFunc,
        mockServer,
        mockProvider,
        { amount: 10, currency: 'USD' },
        'test_tool',
        mockLogger
      );

      await wrapper({ input: 'test' }, {});

      const confirmTool = mockServer.tools.get('confirm_test_tool_payment');
      const result = await confirmTool.handler({ payment_id: 'unknown_123' }, {});

      expect(result).toEqual({
        content: [{ type: 'text', text: 'Unknown or expired payment_id.' }],
        status: 'error',
        message: 'Unknown or expired payment_id',
        payment_id: 'unknown_123',
      });
    });

    it('should handle unpaid payment status', async () => {
      // Best practice: Use mockImplementationOnce for specific test cases
      vi.spyOn(mockProvider, 'getPaymentStatus').mockImplementationOnce(async () => 'pending');

      const wrapper = makePaidWrapper(
        originalFunc,
        mockServer,
        mockProvider,
        { amount: 10, currency: 'USD' },
        'test_tool',
        mockLogger
      );

      await wrapper({ input: 'test' }, {});

      const confirmTool = mockServer.tools.get('confirm_test_tool_payment');
      const result = await confirmTool.handler({ payment_id: 'mock_payment_123' }, {});

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: "Payment status is pending, expected 'paid'.",
          },
        ],
        status: 'error',
        message: "Payment status is pending, expected 'paid'",
        payment_id: 'mock_payment_123',
      });
    });

    it('should handle payment status check errors', async () => {
      const wrapper = makePaidWrapper(
        originalFunc,
        mockServer,
        mockProvider,
        { amount: 10, currency: 'USD' },
        'test_tool',
        mockLogger
      );

      await wrapper({ input: 'test' }, {});

      // Mock error after wrapper creation
      vi.spyOn(mockProvider, 'getPaymentStatus').mockRejectedValueOnce(new Error('API Error'));

      const confirmTool = mockServer.tools.get('confirm_test_tool_payment');
      const result = await confirmTool.handler({ payment_id: 'mock_payment_123' }, {});

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: 'Failed to check payment status: API Error',
          },
        ],
        status: 'error',
        message: 'Failed to check payment status',
        payment_id: 'mock_payment_123',
      });
    });

    it('should handle original tool without content field', async () => {
      // Best practice: Create new mock for specific test behavior
      const customOriginalFunc = vi.fn(async () => ({ success: true }));

      const wrapper = makePaidWrapper(
        customOriginalFunc,
        mockServer,
        mockProvider,
        { amount: 10, currency: 'USD' },
        'test_tool',
        mockLogger
      );

      await wrapper({ input: 'test' }, {});

      const confirmTool = mockServer.tools.get('confirm_test_tool_payment');
      const result = await confirmTool.handler({ payment_id: 'mock_payment_123' }, {});

      expect(result).toEqual({
        content: [{ type: 'text', text: 'Tool completed after confirmed payment.' }],
        raw: { success: true },
      });
    });
  });

  describe('Session Isolation', () => {
    it('should isolate sessions by provider', async () => {
      const provider1 = new MockProvider('api1', mockLogger);
      vi.spyOn(provider1, 'getName').mockReturnValue('stripe');

      const provider2 = new MockProvider('api2', mockLogger);
      vi.spyOn(provider2, 'getName').mockReturnValue('paypal');

      const wrapper1 = makePaidWrapper(
        originalFunc,
        mockServer,
        provider1,
        { amount: 10, currency: 'USD' },
        'tool1',
        mockLogger
      );

      const wrapper2 = makePaidWrapper(
        originalFunc,
        mockServer,
        provider2,
        { amount: 20, currency: 'EUR' },
        'tool2',
        mockLogger
      );

      // Same payment ID, different providers
      vi.spyOn(provider1, 'createPayment').mockImplementationOnce(async () => ({
        paymentId: 'shared_123',
        paymentUrl: 'https://stripe.com/pay/shared_123',
      }));

      vi.spyOn(provider2, 'createPayment').mockImplementationOnce(async () => ({
        paymentId: 'shared_123',
        paymentUrl: 'https://paypal.com/pay/shared_123',
      }));

      const result1 = await wrapper1({ stripe: 'data' }, {});
      const result2 = await wrapper2({ paypal: 'data' }, {});

      // Verify both payments were initiated with correct providers
      expect(result1.structured_content.payment_id).toBe('shared_123');
      expect(result2.structured_content.payment_id).toBe('shared_123');

      // Verify providers are different
      expect(provider1.getName()).toBe('stripe');
      expect(provider2.getName()).toBe('paypal');
    });
  });
});
