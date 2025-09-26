import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AdyenProvider } from '../../src/providers/adyen.js';

describe('AdyenProvider', () => {
  let provider: AdyenProvider;
  let mockLogger: any;

  beforeEach(() => {
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };

    provider = new AdyenProvider({
      apiKey: 'adyen_api_key_123',
      merchantAccount: 'test_merchant_account',
      successUrl: 'https://example.com/success',
      sandbox: true,
      logger: mockLogger
    });

    // Mock global fetch
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with all options (sandbox)', () => {
      const provider = new AdyenProvider({
        apiKey: 'test_key',
        merchantAccount: 'test_merchant',
        successUrl: 'https://custom.com/success',
        sandbox: true,
        logger: mockLogger
      });

      expect(provider).toBeInstanceOf(AdyenProvider);
      expect(mockLogger.debug).toHaveBeenCalledWith('Adyen ready');
    });

    it('should initialize with production environment', () => {
      const provider = new AdyenProvider({
        apiKey: 'prod_key',
        merchantAccount: 'prod_merchant',
        sandbox: false,
        logger: mockLogger
      });

      expect(provider).toBeInstanceOf(AdyenProvider);
      expect(mockLogger.debug).toHaveBeenCalledWith('Adyen ready');
    });

    it('should use default success URL when not provided', () => {
      const provider = new AdyenProvider({
        apiKey: 'test_key',
        merchantAccount: 'test_merchant',
        logger: mockLogger
      });

      expect(provider).toBeInstanceOf(AdyenProvider);
    });

    it('should use console logger when not provided', () => {
      const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

      const provider = new AdyenProvider({
        apiKey: 'test_key',
        merchantAccount: 'test_merchant'
      });

      expect(provider).toBeInstanceOf(AdyenProvider);
      consoleSpy.mockRestore();
    });

    it('should handle undefined merchantAccount', () => {
      const provider = new AdyenProvider({
        apiKey: 'test_key',
        merchantAccount: undefined,
        logger: mockLogger
      });

      expect(provider).toBeInstanceOf(AdyenProvider);
    });

    it('should default to live environment when sandbox is not specified', () => {
      const provider = new AdyenProvider({
        apiKey: 'live_key',
        merchantAccount: 'live_merchant',
        logger: mockLogger
      });

      expect(provider).toBeInstanceOf(AdyenProvider);
    });

    it('should handle logger being undefined', () => {
      const provider = new AdyenProvider({
        apiKey: 'test_key',
        merchantAccount: 'test_merchant',
        logger: undefined
      });

      expect(provider).toBeInstanceOf(AdyenProvider);
    });
  });

  describe('buildHeaders', () => {
    it('should return Adyen-specific headers', () => {
      const headers = (provider as any).buildHeaders();

      expect(headers).toEqual({
        'X-API-Key': 'adyen_api_key_123',
        'Content-Type': 'application/json'
      });
    });
  });

  describe('createPayment', () => {
    it('should create payment successfully in sandbox', async () => {
      const mockPaymentResponse = {
        id: 'PL123456789',
        url: 'https://checkoutshopper-test.adyen.com/checkoutshopper/paymentLink/PL123456789',
        reference: 'Test product purchase',
        amount: {
          currency: 'USD',
          value: 2550
        }
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockPaymentResponse)
      });

      const result = await provider.createPayment(25.50, 'USD', 'Test product purchase');

      expect(result).toEqual({
        paymentId: 'PL123456789',
        paymentUrl: 'https://checkoutshopper-test.adyen.com/checkoutshopper/paymentLink/PL123456789'
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://checkout-test.adyen.com/v71/paymentLinks',
        {
          method: 'POST',
          headers: {
            'X-API-Key': 'adyen_api_key_123',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            amount: {
              currency: 'USD',
              value: 2550
            },
            reference: 'Test product purchase',
            merchantAccount: 'test_merchant_account',
            returnUrl: 'https://example.com/success'
          })
        }
      );

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Creating Adyen payment: 25.5 USD for \'Test product purchase\' (MERCHANT: test_merchant_account)'
      );
    });

    it('should create payment in production environment', async () => {
      const prodProvider = new AdyenProvider({
        apiKey: 'prod_key',
        merchantAccount: 'prod_merchant',
        sandbox: false,
        logger: mockLogger
      });

      const mockPaymentResponse = {
        id: 'PL_PROD_123',
        url: 'https://checkoutshopper-live.adyen.com/checkoutshopper/paymentLink/PL_PROD_123'
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockPaymentResponse)
      });

      await prodProvider.createPayment(100.00, 'EUR', 'Production payment');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://checkout-live.adyen.com/v71/paymentLinks',
        expect.objectContaining({
          method: 'POST'
        })
      );
    });

    it('should handle different currencies correctly', async () => {
      const mockPaymentResponse = {
        id: 'PL_EUR_123',
        url: 'https://checkoutshopper-test.adyen.com/checkoutshopper/paymentLink/PL_EUR_123'
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockPaymentResponse)
      });

      await provider.createPayment(50.00, 'eur', 'Euro payment');

      const call = (global.fetch as any).mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.amount.currency).toBe('EUR');
      expect(body.amount.value).toBe(5000);
    });

    it('should convert amounts to cents correctly', async () => {
      const testCases = [
        { amount: 1.00, expected: 100 },
        { amount: 0.50, expected: 50 },
        { amount: 12.34, expected: 1234 },
        { amount: 999.99, expected: 99999 },
        { amount: 0.01, expected: 1 },
        { amount: 100, expected: 10000 },
        { amount: 12.995, expected: 1300 } // Test rounding
      ];

      for (const testCase of testCases) {
        const mockResponse = {
          id: 'PL_AMOUNT_TEST',
          url: 'https://checkoutshopper-test.adyen.com/test'
        };

        (global.fetch as any).mockResolvedValue({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockResponse)
        });

        await provider.createPayment(testCase.amount, 'USD', 'Amount test');

        const call = (global.fetch as any).mock.calls[0];
        const body = JSON.parse(call[1].body);
        expect(body.amount.value).toBe(testCase.expected);

        // Reset for next iteration
        (global.fetch as any).mockClear();
      }
    });

    it('should handle zero amount', async () => {
      const mockResponse = {
        id: 'PL_ZERO',
        url: 'https://checkoutshopper-test.adyen.com/zero'
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockResponse)
      });

      await provider.createPayment(0, 'USD', 'Zero amount test');

      const call = (global.fetch as any).mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.amount.value).toBe(0);
    });

    it('should handle large amounts', async () => {
      const mockResponse = {
        id: 'PL_LARGE',
        url: 'https://checkoutshopper-test.adyen.com/large'
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockResponse)
      });

      await provider.createPayment(9999.99, 'USD', 'Large amount test');

      const call = (global.fetch as any).mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.amount.value).toBe(999999);
    });

    it('should throw error when payment response is missing id', async () => {
      const invalidResponse = {
        url: 'https://checkoutshopper-test.adyen.com/incomplete'
        // Missing id
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(invalidResponse)
      });

      await expect(
        provider.createPayment(50.00, 'USD', 'Invalid response test')
      ).rejects.toThrow('Adyen createPayment: missing id or url in response');
    });

    it('should throw error when payment response is missing url', async () => {
      const invalidResponse = {
        id: 'PL_NO_URL'
        // Missing url
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(invalidResponse)
      });

      await expect(
        provider.createPayment(50.00, 'USD', 'Invalid response test')
      ).rejects.toThrow('Adyen createPayment: missing id or url in response');
    });

    it('should throw error when payment response is missing both id and url', async () => {
      const invalidResponse = {
        reference: 'test'
        // Missing both id and url
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(invalidResponse)
      });

      await expect(
        provider.createPayment(50.00, 'USD', 'Invalid response test')
      ).rejects.toThrow('Adyen createPayment: missing id or url in response');
    });

    it('should throw error when payment response is null', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(null)
      });

      await expect(
        provider.createPayment(50.00, 'USD', 'Null response test')
      ).rejects.toThrow('Adyen createPayment: missing id or url in response');
    });
  });

  describe('getPaymentStatus', () => {
    it('should get status for completed payment', async () => {
      const mockPaymentResponse = {
        id: 'PL_COMPLETED',
        status: 'completed',
        amount: {
          currency: 'USD',
          value: 2550
        }
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockPaymentResponse)
      });

      const status = await provider.getPaymentStatus('PL_COMPLETED');

      expect(status).toBe('paid');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://checkout-test.adyen.com/v71/paymentLinks/PL_COMPLETED',
        expect.objectContaining({
          method: 'GET'
        })
      );
      expect(mockLogger.debug).toHaveBeenCalledWith('Checking Adyen payment status for: PL_COMPLETED');
    });

    it('should get status for active payment', async () => {
      const mockPaymentResponse = {
        id: 'PL_ACTIVE',
        status: 'active'
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockPaymentResponse)
      });

      const status = await provider.getPaymentStatus('PL_ACTIVE');

      expect(status).toBe('pending');
    });

    it('should get status for expired payment', async () => {
      const mockPaymentResponse = {
        id: 'PL_EXPIRED',
        status: 'expired'
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockPaymentResponse)
      });

      const status = await provider.getPaymentStatus('PL_EXPIRED');

      expect(status).toBe('failed');
    });

    it('should return original status for unknown statuses', async () => {
      const mockPaymentResponse = {
        id: 'PL_UNKNOWN',
        status: 'custom_status'
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockPaymentResponse)
      });

      const status = await provider.getPaymentStatus('PL_UNKNOWN');

      expect(status).toBe('custom_status');
    });

    it('should return "unknown" when status is missing', async () => {
      const mockPaymentResponse = {
        id: 'PL_NO_STATUS'
        // Missing status
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockPaymentResponse)
      });

      const status = await provider.getPaymentStatus('PL_NO_STATUS');

      expect(status).toBe('unknown');
    });

    it('should return "unknown" when payment response is null', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(null)
      });

      const status = await provider.getPaymentStatus('PL_NULL');

      expect(status).toBe('unknown');
    });

    it('should return "unknown" when payment response is undefined', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(undefined)
      });

      const status = await provider.getPaymentStatus('PL_UNDEFINED');

      expect(status).toBe('unknown');
    });

    it('should handle different status cases correctly', async () => {
      const testCases = [
        { status: 'completed', expected: 'paid' },
        { status: 'COMPLETED', expected: 'COMPLETED' }, // Case sensitive - should return as-is
        { status: 'active', expected: 'pending' },
        { status: 'ACTIVE', expected: 'ACTIVE' }, // Case sensitive - should return as-is
        { status: 'expired', expected: 'failed' },
        { status: 'EXPIRED', expected: 'EXPIRED' }, // Case sensitive - should return as-is
        { status: 'pending', expected: 'pending' }, // Unknown status - return as-is
        { status: 'cancelled', expected: 'cancelled' }, // Unknown status - return as-is
        { status: null, expected: 'unknown' },
        { status: undefined, expected: 'unknown' }
      ];

      for (const testCase of testCases) {
        const mockResponse = {
          id: 'PL_STATUS_TEST',
          status: testCase.status
        };

        (global.fetch as any).mockResolvedValue({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockResponse)
        });

        const status = await provider.getPaymentStatus('PL_STATUS_TEST');
        expect(status).toBe(testCase.expected);

        // Reset for next iteration
        (global.fetch as any).mockClear();
      }
    });

    it('should use production URL when sandbox is false', async () => {
      const prodProvider = new AdyenProvider({
        apiKey: 'prod_key',
        merchantAccount: 'prod_merchant',
        sandbox: false,
        logger: mockLogger
      });

      const mockResponse = {
        id: 'PL_PROD_STATUS',
        status: 'completed'
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockResponse)
      });

      await prodProvider.getPaymentStatus('PL_PROD_STATUS');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://checkout-live.adyen.com/v71/paymentLinks/PL_PROD_STATUS',
        expect.objectContaining({
          method: 'GET'
        })
      );
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
        '[BasePaymentProvider] Network error POST https://checkout-test.adyen.com/v71/paymentLinks',
        networkError
      );
    });

    it('should propagate HTTP errors from base class', async () => {
      const errorBody = '{"errorCode": "401", "message": "Invalid API key"}';
      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve(errorBody)
      });

      await expect(
        provider.getPaymentStatus('PL_ERROR')
      ).rejects.toThrow('HTTP 401 https://checkout-test.adyen.com/v71/paymentLinks/PL_ERROR');

      expect(mockLogger.error).toHaveBeenCalledWith(
        '[BasePaymentProvider] HTTP 401 GET https://checkout-test.adyen.com/v71/paymentLinks/PL_ERROR: {"errorCode": "401", "message": "Invalid API key"}'
      );
    });
  });

  describe('edge cases and detailed scenarios', () => {
    it('should handle mixed case currencies correctly', async () => {
      const mockResponse = {
        id: 'PL_MIXED_CASE',
        url: 'https://checkoutshopper-test.adyen.com/mixed'
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockResponse)
      });

      const testCases = ['USD', 'usd', 'Usd', 'UsD', 'EUR', 'eur', 'Eur'];

      for (const currency of testCases) {
        await provider.createPayment(10.00, currency, 'Mixed case test');

        const call = (global.fetch as any).mock.calls[0];
        const body = JSON.parse(call[1].body);
        expect(body.amount.currency).toBe(currency.toUpperCase());

        // Reset for next iteration
        (global.fetch as any).mockClear();
      }
    });

    it('should handle very small amounts correctly', async () => {
      const mockResponse = {
        id: 'PL_SMALL',
        url: 'https://checkoutshopper-test.adyen.com/small'
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockResponse)
      });

      await provider.createPayment(0.01, 'USD', 'Very small amount');

      const call = (global.fetch as any).mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.amount.value).toBe(1);
    });

    it('should handle fractional cents by rounding', async () => {
      const mockResponse = {
        id: 'PL_FRACTIONAL',
        url: 'https://checkoutshopper-test.adyen.com/fractional'
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockResponse)
      });

      // Test cases that result in fractional cents
      const testCases = [
        { input: 1.235, expected: 124 }, // rounds to 124 cents
        { input: 1.234, expected: 123 }, // rounds to 123 cents
        { input: 9.999, expected: 1000 } // rounds to 1000 cents
      ];

      for (const testCase of testCases) {
        await provider.createPayment(testCase.input, 'USD', 'Fractional test');

        const call = (global.fetch as any).mock.calls[0];
        const body = JSON.parse(call[1].body);
        expect(body.amount.value).toBe(testCase.expected);

        // Reset for next iteration
        (global.fetch as any).mockClear();
      }
    });

    it('should handle logger being null', async () => {
      const providerNoLogger = new AdyenProvider({
        apiKey: 'test_key',
        merchantAccount: 'test_merchant',
        logger: null as any
      });

      expect(providerNoLogger).toBeInstanceOf(AdyenProvider);

      // Should not throw when logger is null
      const mockResponse = {
        id: 'PL_NO_LOGGER',
        url: 'https://checkoutshopper-test.adyen.com/no-logger'
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockResponse)
      });

      await expect(
        providerNoLogger.createPayment(10.00, 'USD', 'No logger test')
      ).resolves.not.toThrow();
    });
  });
});