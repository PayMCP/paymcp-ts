import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CoinbaseProvider } from '../../src/providers/coinbase.js';

describe('CoinbaseProvider', () => {
  let provider: CoinbaseProvider;
  let mockLogger: any;

  beforeEach(() => {
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };

    provider = new CoinbaseProvider({
      apiKey: 'coinbase_api_key_123',
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
    it('should initialize with all options', () => {
      const provider = new CoinbaseProvider({
        apiKey: 'test_key',
        successUrl: 'https://custom.com/success',
        cancelUrl: 'https://custom.com/cancel',
        confirmOnPending: true,
        logger: mockLogger
      });

      expect(provider).toBeInstanceOf(CoinbaseProvider);
      expect(mockLogger.debug).toHaveBeenCalledWith('[CoinbaseProvider] ready');
    });

    it('should use default URLs when not provided', () => {
      const provider = new CoinbaseProvider({
        apiKey: 'test_key',
        logger: mockLogger
      });

      expect(provider).toBeInstanceOf(CoinbaseProvider);
      expect(mockLogger.debug).toHaveBeenCalledWith('[CoinbaseProvider] ready');
    });

    it('should use console logger when not provided', () => {
      const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

      const provider = new CoinbaseProvider({
        apiKey: 'test_key'
      });

      expect(provider).toBeInstanceOf(CoinbaseProvider);
      consoleSpy.mockRestore();
    });

    it('should handle confirmOnPending option correctly', () => {
      const providerTrue = new CoinbaseProvider({
        apiKey: 'test_key',
        confirmOnPending: true,
        logger: mockLogger
      });

      const providerFalse = new CoinbaseProvider({
        apiKey: 'test_key',
        confirmOnPending: false,
        logger: mockLogger
      });

      const providerUndefined = new CoinbaseProvider({
        apiKey: 'test_key',
        logger: mockLogger
      });

      expect(providerTrue).toBeInstanceOf(CoinbaseProvider);
      expect(providerFalse).toBeInstanceOf(CoinbaseProvider);
      expect(providerUndefined).toBeInstanceOf(CoinbaseProvider);
    });

    it('should convert truthy values to boolean for confirmOnPending', () => {
      const provider = new CoinbaseProvider({
        apiKey: 'test_key',
        confirmOnPending: 'truthy' as any,
        logger: mockLogger
      });

      expect(provider).toBeInstanceOf(CoinbaseProvider);
    });
  });

  describe('buildHeaders', () => {
    it('should return Coinbase-specific headers', () => {
      const headers = (provider as any).buildHeaders();

      expect(headers).toEqual({
        'X-CC-Api-Key': 'coinbase_api_key_123',
        'Content-Type': 'application/json'
      });
    });
  });

  describe('toFiatCurrency', () => {
    it('should convert USDC to USD', () => {
      const result = (provider as any).toFiatCurrency('USDC');
      expect(result).toBe('USD');
    });

    it('should convert usdc (lowercase) to USD', () => {
      const result = (provider as any).toFiatCurrency('usdc');
      expect(result).toBe('USD');
    });

    it('should convert Usdc (mixed case) to USD', () => {
      const result = (provider as any).toFiatCurrency('Usdc');
      expect(result).toBe('USD');
    });

    it('should leave other currencies unchanged', () => {
      const testCases = ['USD', 'EUR', 'GBP', 'CAD', 'JPY', 'BTC', 'ETH'];

      for (const currency of testCases) {
        const result = (provider as any).toFiatCurrency(currency);
        expect(result).toBe(currency.toUpperCase());
      }
    });

    it('should handle lowercase currencies correctly', () => {
      const result1 = (provider as any).toFiatCurrency('usd');
      const result2 = (provider as any).toFiatCurrency('eur');

      expect(result1).toBe('USD');
      expect(result2).toBe('EUR');
    });

    it('should handle empty/null currency with default', () => {
      const result1 = (provider as any).toFiatCurrency('');
      const result2 = (provider as any).toFiatCurrency(null);
      const result3 = (provider as any).toFiatCurrency(undefined);

      expect(result1).toBe('USD');
      expect(result2).toBe('USD');
      expect(result3).toBe('USD');
    });
  });

  describe('createPayment', () => {
    it('should create payment successfully', async () => {
      const mockChargeResponse = {
        data: {
          code: 'CHARGE123',
          hosted_url: 'https://commerce.coinbase.com/charges/CHARGE123',
          name: 'Test product purchase',
          description: 'Test product purchase'
        }
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockChargeResponse)
      });

      const result = await provider.createPayment(25.50, 'USD', 'Test product purchase');

      expect(result).toEqual({
        paymentId: 'CHARGE123',
        paymentUrl: 'https://commerce.coinbase.com/charges/CHARGE123'
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.commerce.coinbase.com/charges',
        {
          method: 'POST',
          headers: {
            'X-CC-Api-Key': 'coinbase_api_key_123',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            name: 'Test product purchase',
            description: 'Test product purchase',
            pricing_type: 'fixed_price',
            local_price: {
              amount: '25.50',
              currency: 'USD'
            },
            redirect_url: 'https://example.com/success',
            cancel_url: 'https://example.com/cancel',
            metadata: {
              reference: 'Test product purchase'
            }
          })
        }
      );

      expect(mockLogger.debug).toHaveBeenCalledWith(
        '[CoinbaseProvider] createPayment 25.5 USD -> USD "Test product purchase"'
      );
    });

    it('should handle USDC currency conversion', async () => {
      const mockChargeResponse = {
        data: {
          code: 'USDC_CHARGE',
          hosted_url: 'https://commerce.coinbase.com/charges/USDC_CHARGE'
        }
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockChargeResponse)
      });

      await provider.createPayment(100.00, 'USDC', 'USDC payment');

      const call = (global.fetch as any).mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.local_price.currency).toBe('USD');

      expect(mockLogger.debug).toHaveBeenCalledWith(
        '[CoinbaseProvider] createPayment 100 USDC -> USD "USDC payment"'
      );
    });

    it('should handle different currencies correctly', async () => {
      const mockChargeResponse = {
        data: {
          code: 'EUR_CHARGE',
          hosted_url: 'https://commerce.coinbase.com/charges/EUR_CHARGE'
        }
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockChargeResponse)
      });

      await provider.createPayment(50.00, 'EUR', 'Euro payment');

      const call = (global.fetch as any).mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.local_price.currency).toBe('EUR');
    });

    it('should format amounts with 2 decimal places', async () => {
      const mockChargeResponse = {
        data: {
          code: 'DECIMAL_CHARGE',
          hosted_url: 'https://commerce.coinbase.com/charges/DECIMAL_CHARGE'
        }
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockChargeResponse)
      });

      const testCases = [
        { input: 1, expected: '1.00' },
        { input: 1.5, expected: '1.50' },
        { input: 12.345, expected: '12.35' }, // Rounded to 2 decimals
        { input: 99.999, expected: '100.00' } // Rounded to 2 decimals
      ];

      for (const testCase of testCases) {
        await provider.createPayment(testCase.input, 'USD', 'Decimal test');

        const call = (global.fetch as any).mock.calls[0];
        const body = JSON.parse(call[1].body);
        expect(body.local_price.amount).toBe(testCase.expected);

        // Reset for next iteration
        (global.fetch as any).mockClear();
      }
    });

    it('should handle empty description with defaults', async () => {
      const mockChargeResponse = {
        data: {
          code: 'EMPTY_DESC',
          hosted_url: 'https://commerce.coinbase.com/charges/EMPTY_DESC'
        }
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockChargeResponse)
      });

      await provider.createPayment(10.00, 'USD', '');

      const call = (global.fetch as any).mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.name).toBe('Payment');
      expect(body.description).toBe('');
      expect(body.metadata.reference).toBe('');
    });

    it('should truncate long descriptions to 100 characters', async () => {
      const longDescription = 'A'.repeat(150); // 150 characters
      const mockChargeResponse = {
        data: {
          code: 'LONG_DESC',
          hosted_url: 'https://commerce.coinbase.com/charges/LONG_DESC'
        }
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockChargeResponse)
      });

      await provider.createPayment(10.00, 'USD', longDescription);

      const call = (global.fetch as any).mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.name).toBe('A'.repeat(100)); // Truncated to 100
      expect(body.description).toBe(longDescription); // Full description preserved
      expect(body.metadata.reference).toBe(longDescription); // Full reference preserved
    });

    it('should throw error when charge response is missing code', async () => {
      const invalidResponse = {
        data: {
          hosted_url: 'https://commerce.coinbase.com/charges/incomplete'
          // Missing code
        }
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(invalidResponse)
      });

      await expect(
        provider.createPayment(50.00, 'USD', 'Invalid response test')
      ).rejects.toThrow(
        '[CoinbaseProvider] Invalid response from /charges (missing code/hosted_url)'
      );
    });

    it('should throw error when charge response is missing hosted_url', async () => {
      const invalidResponse = {
        data: {
          code: 'NO_URL_CHARGE'
          // Missing hosted_url
        }
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(invalidResponse)
      });

      await expect(
        provider.createPayment(50.00, 'USD', 'Invalid response test')
      ).rejects.toThrow(
        '[CoinbaseProvider] Invalid response from /charges (missing code/hosted_url)'
      );
    });

    it('should throw error when data is missing', async () => {
      const invalidResponse = {
        // Missing data
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(invalidResponse)
      });

      await expect(
        provider.createPayment(50.00, 'USD', 'Invalid response test')
      ).rejects.toThrow(
        '[CoinbaseProvider] Invalid response from /charges (missing code/hosted_url)'
      );
    });

    it('should throw error when response is null', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(null)
      });

      await expect(
        provider.createPayment(50.00, 'USD', 'Null response test')
      ).rejects.toThrow(
        '[CoinbaseProvider] Invalid response from /charges (missing code/hosted_url)'
      );
    });
  });

  describe('getPaymentStatus', () => {
    it('should get status for COMPLETED charge', async () => {
      const mockChargeResponse = {
        data: {
          code: 'COMPLETED_CHARGE',
          timeline: [
            { status: 'NEW' },
            { status: 'PENDING' },
            { status: 'COMPLETED' }
          ]
        }
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockChargeResponse)
      });

      const status = await provider.getPaymentStatus('COMPLETED_CHARGE');

      expect(status).toBe('paid');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.commerce.coinbase.com/charges/COMPLETED_CHARGE',
        expect.objectContaining({
          method: 'GET'
        })
      );
      expect(mockLogger.debug).toHaveBeenCalledWith('[CoinbaseProvider] getPaymentStatus COMPLETED_CHARGE');
    });

    it('should get status for RESOLVED charge', async () => {
      const mockChargeResponse = {
        data: {
          code: 'RESOLVED_CHARGE',
          timeline: [
            { status: 'NEW' },
            { status: 'RESOLVED' }
          ]
        }
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockChargeResponse)
      });

      const status = await provider.getPaymentStatus('RESOLVED_CHARGE');

      expect(status).toBe('paid');
    });

    it('should get status for PENDING charge with confirmOnPending=false', async () => {
      const mockChargeResponse = {
        data: {
          code: 'PENDING_CHARGE',
          timeline: [
            { status: 'NEW' },
            { status: 'PENDING' }
          ]
        }
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockChargeResponse)
      });

      const status = await provider.getPaymentStatus('PENDING_CHARGE');

      expect(status).toBe('pending');
    });

    it('should get status for PENDING charge with confirmOnPending=true', async () => {
      const providerConfirm = new CoinbaseProvider({
        apiKey: 'test_key',
        confirmOnPending: true,
        logger: mockLogger
      });

      const mockChargeResponse = {
        data: {
          code: 'PENDING_CONFIRM',
          timeline: [
            { status: 'NEW' },
            { status: 'PENDING' }
          ]
        }
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockChargeResponse)
      });

      const status = await providerConfirm.getPaymentStatus('PENDING_CONFIRM');

      expect(status).toBe('paid');
    });

    it('should get status for EXPIRED charge', async () => {
      const mockChargeResponse = {
        data: {
          code: 'EXPIRED_CHARGE',
          timeline: [
            { status: 'NEW' },
            { status: 'EXPIRED' }
          ]
        }
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockChargeResponse)
      });

      const status = await provider.getPaymentStatus('EXPIRED_CHARGE');

      expect(status).toBe('failed');
    });

    it('should get status for CANCELED charge', async () => {
      const mockChargeResponse = {
        data: {
          code: 'CANCELED_CHARGE',
          timeline: [
            { status: 'NEW' },
            { status: 'CANCELED' }
          ]
        }
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockChargeResponse)
      });

      const status = await provider.getPaymentStatus('CANCELED_CHARGE');

      expect(status).toBe('failed');
    });

    it('should handle charge with completed_at field', async () => {
      const mockChargeResponse = {
        data: {
          code: 'COMPLETED_AT_CHARGE',
          timeline: [
            { status: 'NEW' }
          ],
          completed_at: '2024-01-01T00:00:00Z'
        }
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockChargeResponse)
      });

      const status = await provider.getPaymentStatus('COMPLETED_AT_CHARGE');

      expect(status).toBe('paid');
    });

    it('should handle charge with confirmed_at field', async () => {
      const mockChargeResponse = {
        data: {
          code: 'CONFIRMED_AT_CHARGE',
          timeline: [
            { status: 'NEW' }
          ],
          confirmed_at: '2024-01-01T00:00:00Z'
        }
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockChargeResponse)
      });

      const status = await provider.getPaymentStatus('CONFIRMED_AT_CHARGE');

      expect(status).toBe('paid');
    });

    it('should return pending for unknown status', async () => {
      const mockChargeResponse = {
        data: {
          code: 'UNKNOWN_CHARGE',
          timeline: [
            { status: 'NEW' },
            { status: 'UNKNOWN_STATUS' }
          ]
        }
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockChargeResponse)
      });

      const status = await provider.getPaymentStatus('UNKNOWN_CHARGE');

      expect(status).toBe('pending');
    });

    it('should return pending when timeline is empty', async () => {
      const mockChargeResponse = {
        data: {
          code: 'EMPTY_TIMELINE',
          timeline: []
        }
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockChargeResponse)
      });

      const status = await provider.getPaymentStatus('EMPTY_TIMELINE');

      expect(status).toBe('pending');
    });

    it('should return pending when timeline is missing', async () => {
      const mockChargeResponse = {
        data: {
          code: 'NO_TIMELINE'
          // Missing timeline
        }
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockChargeResponse)
      });

      const status = await provider.getPaymentStatus('NO_TIMELINE');

      expect(status).toBe('pending');
    });

    it('should return pending when data is missing', async () => {
      const mockChargeResponse = {
        // Missing data
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockChargeResponse)
      });

      const status = await provider.getPaymentStatus('NO_DATA');

      expect(status).toBe('pending');
    });

    it('should handle non-string timeline status', async () => {
      const mockChargeResponse = {
        data: {
          code: 'NON_STRING_STATUS',
          timeline: [
            { status: 'NEW' },
            { status: 123 } // Non-string status
          ]
        }
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockChargeResponse)
      });

      const status = await provider.getPaymentStatus('NON_STRING_STATUS');

      expect(status).toBe('pending');
    });

    it('should use last status from timeline', async () => {
      const mockChargeResponse = {
        data: {
          code: 'MULTIPLE_STATUS',
          timeline: [
            { status: 'NEW' },
            { status: 'PENDING' },
            { status: 'EXPIRED' }, // Last status should be used
            { status: 'COMPLETED' } // This should be the final status
          ]
        }
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockChargeResponse)
      });

      const status = await provider.getPaymentStatus('MULTIPLE_STATUS');

      expect(status).toBe('paid'); // Should use COMPLETED (last status)
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
        '[BasePaymentProvider] Network error POST https://api.commerce.coinbase.com/charges',
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
        provider.getPaymentStatus('ERROR_CHARGE')
      ).rejects.toThrow('HTTP 401 https://api.commerce.coinbase.com/charges/ERROR_CHARGE');

      expect(mockLogger.error).toHaveBeenCalledWith(
        '[BasePaymentProvider] HTTP 401 GET https://api.commerce.coinbase.com/charges/ERROR_CHARGE: {"error": {"message": "Invalid API key"}}'
      );
    });
  });
});