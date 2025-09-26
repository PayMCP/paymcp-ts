import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WalleotProvider } from '../../src/providers/walleot.js';

describe('WalleotProvider', () => {
  let provider: WalleotProvider;
  let mockLogger: any;

  beforeEach(() => {
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };

    provider = new WalleotProvider({
      apiKey: 'walleot_test_key_123',
      logger: mockLogger
    });

    // Mock global fetch
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with api key and logger', () => {
      const provider = new WalleotProvider({
        apiKey: 'test_key',
        logger: mockLogger
      });

      expect(provider).toBeInstanceOf(WalleotProvider);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringMatching(/\[WalleotProvider\] ready v\d+\.\d+\.\d+/)
      );
    });

    it('should use console logger when not provided', () => {
      const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

      const provider = new WalleotProvider({
        apiKey: 'test_key'
      });

      expect(provider).toBeInstanceOf(WalleotProvider);
      consoleSpy.mockRestore();
    });
  });

  describe('buildHeaders', () => {
    it('should return Walleot-specific headers', () => {
      const headers = (provider as any).buildHeaders();

      expect(headers).toEqual({
        Authorization: 'Bearer walleot_test_key_123',
        'Content-Type': 'application/json'
      });
    });
  });

  describe('createPayment', () => {
    it('should create payment successfully', async () => {
      const mockSession = {
        sessionId: 'ws_test_12345',
        url: 'https://checkout.walleot.com/ws_test_12345',
        status: 'created'
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockSession)
      });

      const result = await provider.createPayment(25.50, 'USD', 'Test product purchase');

      expect(result).toEqual({
        paymentId: 'ws_test_12345',
        paymentUrl: 'https://checkout.walleot.com/ws_test_12345'
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.walleot.com/v1/sessions',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer walleot_test_key_123',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            amount: 2550, // 25.50 * 100
            currency: 'usd',
            description: 'Test product purchase'
          })
        }
      );

      expect(mockLogger.debug).toHaveBeenCalledWith(
        '[WalleotProvider] createPayment 25.5 USD "Test product purchase"'
      );
    });

    it('should handle different currency case correctly', async () => {
      const mockSession = {
        sessionId: 'ws_test_eur',
        url: 'https://checkout.walleot.com/ws_test_eur'
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockSession)
      });

      await provider.createPayment(100.00, 'EUR', 'Euro payment');

      const call = (global.fetch as any).mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.currency).toBe('eur');
      expect(body.amount).toBe(10000);
    });

    it('should handle lowercase currency correctly', async () => {
      const mockSession = {
        sessionId: 'ws_test_gbp',
        url: 'https://checkout.walleot.com/ws_test_gbp'
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockSession)
      });

      await provider.createPayment(50.00, 'gbp', 'British pound payment');

      const call = (global.fetch as any).mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.currency).toBe('gbp');
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
        const mockSession = {
          sessionId: 'ws_test_amount',
          url: 'https://checkout.walleot.com/test'
        };

        (global.fetch as any).mockResolvedValue({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockSession)
        });

        await provider.createPayment(testCase.amount, 'USD', 'Amount test');

        const call = (global.fetch as any).mock.calls[0];
        const body = JSON.parse(call[1].body);
        expect(body.amount).toBe(testCase.expected);

        // Reset mock for next iteration
        (global.fetch as any).mockClear();
      }
    });

    it('should handle zero amount', async () => {
      const mockSession = {
        sessionId: 'ws_test_zero',
        url: 'https://checkout.walleot.com/zero'
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockSession)
      });

      await provider.createPayment(0, 'USD', 'Zero amount test');

      const call = (global.fetch as any).mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.amount).toBe(0);
    });

    it('should handle large amounts', async () => {
      const mockSession = {
        sessionId: 'ws_test_large',
        url: 'https://checkout.walleot.com/large'
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockSession)
      });

      await provider.createPayment(9999.99, 'USD', 'Large amount test');

      const call = (global.fetch as any).mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.amount).toBe(999999);
    });

    it('should throw error when session response is missing sessionId', async () => {
      const invalidSession = {
        url: 'https://checkout.walleot.com/incomplete'
        // Missing sessionId
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(invalidSession)
      });

      await expect(
        provider.createPayment(50.00, 'USD', 'Invalid response test')
      ).rejects.toThrow(
        '[WalleotProvider] Invalid response from /sessions (missing sessionId/url)'
      );
    });

    it('should throw error when session response is missing url', async () => {
      const invalidSession = {
        sessionId: 'ws_test_no_url'
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
        '[WalleotProvider] Invalid response from /sessions (missing sessionId/url)'
      );
    });

    it('should throw error when session response is missing both sessionId and url', async () => {
      const invalidSession = {
        status: 'created'
        // Missing both sessionId and url
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(invalidSession)
      });

      await expect(
        provider.createPayment(50.00, 'USD', 'Invalid response test')
      ).rejects.toThrow(
        '[WalleotProvider] Invalid response from /sessions (missing sessionId/url)'
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
        '[WalleotProvider] Invalid response from /sessions (missing sessionId/url)'
      );
    });

    it('should throw error when session response is undefined', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(undefined)
      });

      await expect(
        provider.createPayment(50.00, 'USD', 'Undefined response test')
      ).rejects.toThrow(
        '[WalleotProvider] Invalid response from /sessions (missing sessionId/url)'
      );
    });
  });

  describe('getPaymentStatus', () => {
    it('should retrieve payment status successfully', async () => {
      const mockSession = {
        sessionId: 'ws_test_12345',
        status: 'PAID'
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockSession)
      });

      const status = await provider.getPaymentStatus('ws_test_12345');

      expect(status).toBe('paid');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.walleot.com/v1/sessions/ws_test_12345',
        expect.objectContaining({
          method: 'GET'
        })
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        '[WalleotProvider] getPaymentStatus ws_test_12345'
      );
    });

    it('should handle different payment statuses and convert to lowercase', async () => {
      const testCases = [
        { response: 'PAID', expected: 'paid' },
        { response: 'PENDING', expected: 'pending' },
        { response: 'CANCELED', expected: 'canceled' },
        { response: 'FAILED', expected: 'failed' },
        { response: 'Completed', expected: 'completed' },
        { response: 'created', expected: 'created' }
      ];

      for (const testCase of testCases) {
        const mockSession = {
          sessionId: 'ws_test_status',
          status: testCase.response
        };

        (global.fetch as any).mockResolvedValue({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockSession)
        });

        const status = await provider.getPaymentStatus('ws_test_status');
        expect(status).toBe(testCase.expected);

        // Reset mock for next iteration
        (global.fetch as any).mockClear();
      }
    });

    it('should return "unknown" when status is missing', async () => {
      const mockSession = {
        sessionId: 'ws_test_no_status'
        // Missing status
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockSession)
      });

      const status = await provider.getPaymentStatus('ws_test_no_status');

      expect(status).toBe('unknown');
    });

    it('should return "unknown" when session response is null', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(null)
      });

      const status = await provider.getPaymentStatus('ws_test_null');

      expect(status).toBe('unknown');
    });

    it('should return "unknown" when session response is undefined', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(undefined)
      });

      const status = await provider.getPaymentStatus('ws_test_undefined');

      expect(status).toBe('unknown');
    });

    it('should convert non-string status to string and lowercase', async () => {
      const testCases = [
        { response: 123, expected: '123' },
        { response: true, expected: 'true' },
        { response: false, expected: 'false' },
        { response: null, expected: 'unknown' }, // special case for null
        { response: undefined, expected: 'unknown' } // special case for undefined
      ];

      for (const testCase of testCases) {
        const mockSession = {
          sessionId: 'ws_test_types',
          status: testCase.response
        };

        (global.fetch as any).mockResolvedValue({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockSession)
        });

        const status = await provider.getPaymentStatus('ws_test_types');
        expect(status).toBe(testCase.expected);

        // Reset mock for next iteration
        (global.fetch as any).mockClear();
      }
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
        '[BasePaymentProvider] Network error POST https://api.walleot.com/v1/sessions',
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
        provider.getPaymentStatus('ws_test_error')
      ).rejects.toThrow('HTTP 401 https://api.walleot.com/v1/sessions/ws_test_error');

      expect(mockLogger.error).toHaveBeenCalledWith(
        '[BasePaymentProvider] HTTP 401 GET https://api.walleot.com/v1/sessions/ws_test_error: {"error": {"message": "Invalid API key"}}'
      );
    });

    it('should handle fetch errors gracefully', async () => {
      const fetchError = new Error('Fetch failed');
      (global.fetch as any).mockRejectedValue(fetchError);

      await expect(
        provider.getPaymentStatus('ws_test_fetch_error')
      ).rejects.toThrow('Fetch failed');
    });
  });

  describe('decimal precision and edge cases', () => {
    it('should handle very small amounts', async () => {
      const mockSession = {
        sessionId: 'ws_test_small',
        url: 'https://checkout.walleot.com/small'
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockSession)
      });

      await provider.createPayment(0.01, 'USD', 'Very small amount');

      const call = (global.fetch as any).mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.amount).toBe(1);
    });

    it('should handle fractional cents by rounding', async () => {
      const mockSession = {
        sessionId: 'ws_test_fractional',
        url: 'https://checkout.walleot.com/fractional'
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockSession)
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
        expect(body.amount).toBe(testCase.expected);

        // Reset for next iteration
        (global.fetch as any).mockClear();
      }
    });

    it('should handle mixed case currencies correctly', async () => {
      const mockSession = {
        sessionId: 'ws_test_mixed',
        url: 'https://checkout.walleot.com/mixed'
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockSession)
      });

      const testCases = ['USD', 'usd', 'Usd', 'UsD', 'EUR', 'eur', 'Eur'];

      for (const currency of testCases) {
        await provider.createPayment(10.00, currency, 'Mixed case test');

        const call = (global.fetch as any).mock.calls[0];
        const body = JSON.parse(call[1].body);
        expect(body.currency).toBe(currency.toLowerCase());

        // Reset for next iteration
        (global.fetch as any).mockClear();
      }
    });
  });
});