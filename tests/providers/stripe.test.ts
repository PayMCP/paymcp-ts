import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StripeProvider } from '../../src/providers/stripe.js';

describe('StripeProvider', () => {
  let provider: StripeProvider;
  let mockLogger: any;

  beforeEach(() => {
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };

    provider = new StripeProvider({
      apiKey: 'sk_test_123456789',
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
      logger: mockLogger
    });

    // Mock global fetch
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with custom URLs and logger', () => {
      const provider = new StripeProvider({
        apiKey: 'sk_test_key',
        successUrl: 'https://custom.com/success',
        cancelUrl: 'https://custom.com/cancel',
        logger: mockLogger
      });

      expect(provider).toBeInstanceOf(StripeProvider);
      expect(mockLogger.debug).toHaveBeenCalledWith('[StripeProvider] ready');
    });

    it('should use default URLs when not provided', () => {
      const provider = new StripeProvider({
        apiKey: 'sk_test_key',
        logger: mockLogger
      });

      expect(provider).toBeInstanceOf(StripeProvider);
      expect(mockLogger.debug).toHaveBeenCalledWith('[StripeProvider] ready');
    });

    it('should use console logger when not provided', () => {
      const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

      const provider = new StripeProvider({
        apiKey: 'sk_test_key'
      });

      expect(provider).toBeInstanceOf(StripeProvider);
      consoleSpy.mockRestore();
    });
  });

  describe('buildHeaders', () => {
    it('should return Stripe-specific headers', () => {
      // Access protected method for testing
      const headers = (provider as any).buildHeaders();

      expect(headers).toEqual({
        Authorization: 'Bearer sk_test_123456789',
        'Content-Type': 'application/x-www-form-urlencoded'
      });
    });
  });

  describe('createPayment', () => {
    it('should create payment successfully', async () => {
      const mockSession = {
        id: 'cs_test_12345',
        url: 'https://checkout.stripe.com/c/pay/cs_test_12345'
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockSession)
      });

      const result = await provider.createPayment(25.50, 'USD', 'Test product purchase');

      expect(result).toEqual({
        paymentId: 'cs_test_12345',
        paymentUrl: 'https://checkout.stripe.com/c/pay/cs_test_12345'
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.stripe.com/v1/checkout/sessions',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer sk_test_123456789',
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: expect.any(URLSearchParams)
        }
      );

      // Verify the request body content
      const call = (global.fetch as any).mock.calls[0];
      const body = call[1].body as URLSearchParams;
      expect(body.get('mode')).toBe('payment');
      expect(body.get('success_url')).toBe('https://example.com/success');
      expect(body.get('cancel_url')).toBe('https://example.com/cancel');
      expect(body.get('line_items[0][price_data][currency]')).toBe('usd');
      expect(body.get('line_items[0][price_data][unit_amount]')).toBe('2550');
      expect(body.get('line_items[0][price_data][product_data][name]')).toBe('Test product purchase');
      expect(body.get('line_items[0][quantity]')).toBe('1');

      expect(mockLogger.debug).toHaveBeenCalledWith(
        '[StripeProvider] createPayment 25.5 USD (2550) "Test product purchase"'
      );
    });

    it('should handle different currency case correctly', async () => {
      const mockSession = {
        id: 'cs_test_eur',
        url: 'https://checkout.stripe.com/c/pay/cs_test_eur'
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockSession)
      });

      await provider.createPayment(100.00, 'EUR', 'Euro payment');

      const call = (global.fetch as any).mock.calls[0];
      const body = call[1].body as URLSearchParams;
      expect(body.get('line_items[0][price_data][currency]')).toBe('eur');
      expect(body.get('line_items[0][price_data][unit_amount]')).toBe('10000');
    });

    it('should handle decimal amounts correctly', async () => {
      const mockSession = {
        id: 'cs_test_decimal',
        url: 'https://checkout.stripe.com/decimal'
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockSession)
      });

      await provider.createPayment(12.99, 'USD', 'Decimal test');

      const call = (global.fetch as any).mock.calls[0];
      const body = call[1].body as URLSearchParams;
      expect(body.get('line_items[0][price_data][unit_amount]')).toBe('1299');
    });

    it('should round fractional cents correctly', async () => {
      const mockSession = {
        id: 'cs_test_round',
        url: 'https://checkout.stripe.com/round'
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockSession)
      });

      await provider.createPayment(12.995, 'USD', 'Rounding test');

      const call = (global.fetch as any).mock.calls[0];
      const body = call[1].body as URLSearchParams;
      expect(body.get('line_items[0][price_data][unit_amount]')).toBe('1300'); // rounds to 1300
    });

    it('should throw error when session response is missing id', async () => {
      const invalidSession = {
        url: 'https://checkout.stripe.com/c/pay/incomplete'
        // Missing id
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(invalidSession)
      });

      await expect(
        provider.createPayment(50.00, 'USD', 'Invalid response test')
      ).rejects.toThrow(
        '[StripeProvider] Invalid response from /checkout/sessions (missing id/url)'
      );
    });

    it('should throw error when session response is missing url', async () => {
      const invalidSession = {
        id: 'cs_test_no_url'
        // Missing url
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(invalidSession)
      });

      await expect(
        provider.createPayment(50.00, 'USD', 'Invalid response test')
      ).rejects.toThrow(
        '[StripeProvider] Invalid response from /checkout/sessions (missing id/url)'
      );
    });

    it('should throw error when session response is missing both id and url', async () => {
      const invalidSession = {
        object: 'checkout.session'
        // Missing both id and url
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(invalidSession)
      });

      await expect(
        provider.createPayment(50.00, 'USD', 'Invalid response test')
      ).rejects.toThrow(
        '[StripeProvider] Invalid response from /checkout/sessions (missing id/url)'
      );
    });

    it('should throw error when session response is null', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(null)
      });

      await expect(
        provider.createPayment(50.00, 'USD', 'Null response test')
      ).rejects.toThrow(
        '[StripeProvider] Invalid response from /checkout/sessions (missing id/url)'
      );
    });
  });

  describe('getPaymentStatus', () => {
    it('should retrieve payment status successfully', async () => {
      const mockSession = {
        id: 'cs_test_12345',
        payment_status: 'paid'
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockSession)
      });

      const status = await provider.getPaymentStatus('cs_test_12345');

      expect(status).toBe('paid');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.stripe.com/v1/checkout/sessions/cs_test_12345',
        expect.objectContaining({
          method: 'GET'
        })
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        '[StripeProvider] getPaymentStatus cs_test_12345'
      );
    });

    it('should handle different payment statuses', async () => {
      const testCases = [
        { payment_status: 'unpaid', expected: 'unpaid' },
        { payment_status: 'paid', expected: 'paid' },
        { payment_status: 'no_payment_required', expected: 'no_payment_required' }
      ];

      for (const testCase of testCases) {
        const mockSession = {
          id: 'cs_test_status',
          payment_status: testCase.payment_status
        };

        (global.fetch as any).mockResolvedValue({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockSession)
        });

        const status = await provider.getPaymentStatus('cs_test_status');
        expect(status).toBe(testCase.expected);
      }
    });

    it('should return "unknown" when payment_status is missing', async () => {
      const mockSession = {
        id: 'cs_test_no_status'
        // Missing payment_status
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockSession)
      });

      const status = await provider.getPaymentStatus('cs_test_no_status');

      expect(status).toBe('unknown');
    });

    it('should return "unknown" when session response is null', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(null)
      });

      const status = await provider.getPaymentStatus('cs_test_null');

      expect(status).toBe('unknown');
    });

    it('should return "unknown" when session response is undefined', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(undefined)
      });

      const status = await provider.getPaymentStatus('cs_test_undefined');

      expect(status).toBe('unknown');
    });

    it('should convert non-string payment_status to string', async () => {
      const mockSession = {
        id: 'cs_test_number',
        payment_status: 123 // Non-string value
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockSession)
      });

      const status = await provider.getPaymentStatus('cs_test_number');

      expect(status).toBe('123');
    });
  });

  describe('toStripeAmount (private method testing via createPayment)', () => {
    it('should convert various amounts correctly', async () => {
      const testCases = [
        { amount: 1.00, expected: '100' },
        { amount: 0.50, expected: '50' },
        { amount: 12.34, expected: '1234' },
        { amount: 999.99, expected: '99999' },
        { amount: 0.01, expected: '1' },
        { amount: 100, expected: '10000' }
      ];

      for (const testCase of testCases) {
        const mockSession = {
          id: 'cs_test_amount',
          url: 'https://checkout.stripe.com/test'
        };

        (global.fetch as any).mockResolvedValue({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockSession)
        });

        await provider.createPayment(testCase.amount, 'USD', 'Amount test');

        const call = (global.fetch as any).mock.calls[0];
        const body = call[1].body as URLSearchParams;
        expect(body.get('line_items[0][price_data][unit_amount]')).toBe(testCase.expected);

        // Reset mock for next iteration
        (global.fetch as any).mockClear();
      }
    });

    it('should handle zero amount', async () => {
      const mockSession = {
        id: 'cs_test_zero',
        url: 'https://checkout.stripe.com/zero'
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockSession)
      });

      await provider.createPayment(0, 'USD', 'Zero amount test');

      const call = (global.fetch as any).mock.calls[0];
      const body = call[1].body as URLSearchParams;
      expect(body.get('line_items[0][price_data][unit_amount]')).toBe('0');
    });

    it('should handle large amounts', async () => {
      const mockSession = {
        id: 'cs_test_large',
        url: 'https://checkout.stripe.com/large'
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockSession)
      });

      await provider.createPayment(9999.99, 'USD', 'Large amount test');

      const call = (global.fetch as any).mock.calls[0];
      const body = call[1].body as URLSearchParams;
      expect(body.get('line_items[0][price_data][unit_amount]')).toBe('999999');
    });
  });

  describe('error handling', () => {
    it('should propagate network errors from base class', async () => {
      const networkError = new Error('Network failure');
      (global.fetch as any).mockRejectedValue(networkError);

      await expect(
        provider.createPayment(25.00, 'USD', 'Network error test')
      ).rejects.toThrow('Network failure');

      expect(mockLogger.error).toHaveBeenCalledWith(
        '[BasePaymentProvider] Network error POST https://api.stripe.com/v1/checkout/sessions',
        networkError
      );
    });

    it('should propagate HTTP errors from base class', async () => {
      const errorBody = '{"error": {"message": "Invalid API key"}}';
      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve(errorBody)
      });

      await expect(
        provider.getPaymentStatus('cs_test_error')
      ).rejects.toThrow('HTTP 401 https://api.stripe.com/v1/checkout/sessions/cs_test_error');

      expect(mockLogger.error).toHaveBeenCalledWith(
        '[BasePaymentProvider] HTTP 401 GET https://api.stripe.com/v1/checkout/sessions/cs_test_error: {"error": {"message": "Invalid API key"}}'
      );
    });
  });
});