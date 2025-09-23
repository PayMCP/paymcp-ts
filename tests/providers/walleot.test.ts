/**
 * @fileoverview Tests for Walleot payment provider
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WalleotProvider } from '../../src/providers/walleot.js';

// No logger mock needed - it's just an interface

describe('WalleotProvider', () => {
  let provider: WalleotProvider;
  let fetchSpy: any;

  beforeEach(() => {
    provider = new WalleotProvider({
      apiKey: 'test_walleot_key',
    });

    fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
        text: () => Promise.resolve(''),
      } as Response)
    );
  });

  afterEach(() => {
    if (fetchSpy) {
      fetchSpy.mockRestore();
    }
  });

  describe('constructor', () => {
    it('should initialize with Walleot API key', () => {
      expect(provider).toBeDefined();
      expect(provider.getName()).toBe('walleot');
    });

    it('should handle custom logger', () => {
      const customLogger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const customProvider = new WalleotProvider({
        apiKey: 'test_key',
        logger: customLogger,
      });

      expect(customProvider).toBeDefined();
      expect(customLogger.debug).toHaveBeenCalled();
    });
  });

  describe('getName', () => {
    it('should return provider name', () => {
      expect(provider.getName()).toBe('walleot');
    });
  });

  describe('buildHeaders', () => {
    it('should build correct headers', () => {
      const headers = (provider as any).buildHeaders();

      expect(headers).toEqual({
        Authorization: 'Bearer test_walleot_key',
        'Content-Type': 'application/json',
      });
    });
  });

  describe('createPayment', () => {
    it('should create session successfully', async () => {
      const mockResponse = {
        sessionId: 'ws_test123',
        url: 'https://checkout.walleot.com/pay/ws_test123',
        status: 'pending',
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await provider.createPayment(10, 'USD', 'Test payment');

      expect(result).toEqual({
        paymentId: 'ws_test123',
        paymentUrl: 'https://checkout.walleot.com/pay/ws_test123',
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.walleot.com/v1/sessions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test_walleot_key',
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({
            amount: 1000, // $10.00 in cents
            currency: 'usd',
            description: 'Test payment',
          }),
        })
      );
    });

    it('should handle different currencies', async () => {
      const mockResponse = {
        sessionId: 'ws_eur123',
        url: 'https://checkout.walleot.com/pay/ws_eur123',
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await provider.createPayment(25.5, 'EUR', 'EUR payment');

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.walleot.com/v1/sessions',
        expect.objectContaining({
          body: JSON.stringify({
            amount: 2550, // €25.50 in cents
            currency: 'eur',
            description: 'EUR payment',
          }),
        })
      );
    });

    it('should handle uppercase currency', async () => {
      const mockResponse = {
        sessionId: 'ws_gbp123',
        url: 'https://checkout.walleot.com/pay/ws_gbp123',
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await provider.createPayment(15, 'GBP', 'GBP payment');

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.walleot.com/v1/sessions',
        expect.objectContaining({
          body: JSON.stringify({
            amount: 1500,
            currency: 'gbp', // Converted to lowercase
            description: 'GBP payment',
          }),
        })
      );
    });

    it('should handle empty description', async () => {
      const mockResponse = {
        sessionId: 'ws_empty123',
        url: 'https://checkout.walleot.com/pay/ws_empty123',
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await provider.createPayment(5, 'USD', '');

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.description).toBe('');
    });

    it('should handle missing sessionId in response', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          url: 'https://checkout.walleot.com/pay/ws_test123',
          // Missing sessionId
        }),
      } as Response);

      await expect(provider.createPayment(10, 'USD', 'Test payment')).rejects.toThrow(
        'Invalid response from /sessions (missing sessionId/url)'
      );
    });

    it('should handle missing url in response', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sessionId: 'ws_test123',
          // Missing url
        }),
      } as Response);

      await expect(provider.createPayment(10, 'USD', 'Test payment')).rejects.toThrow(
        'Invalid response from /sessions (missing sessionId/url)'
      );
    });

    it('should handle API errors', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Bad Request',
      } as Response);

      await expect(provider.createPayment(10, 'USD', 'Test payment')).rejects.toThrow('HTTP 400');
    });

    it('should handle network errors', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('Network error'));

      await expect(provider.createPayment(10, 'USD', 'Test payment')).rejects.toThrow(
        'Network error'
      );
    });

    it('should handle decimal amounts correctly', async () => {
      const mockResponse = {
        sessionId: 'ws_decimal123',
        url: 'https://checkout.walleot.com/pay/ws_decimal123',
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await provider.createPayment(12.34, 'USD', 'Decimal test');

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.amount).toBe(1234); // $12.34 in cents
    });

    it('should handle zero amounts', async () => {
      const mockResponse = {
        sessionId: 'ws_zero123',
        url: 'https://checkout.walleot.com/pay/ws_zero123',
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await provider.createPayment(0, 'USD', 'Zero amount');

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.amount).toBe(0);
    });
  });

  describe('getPaymentStatus', () => {
    it('should return pending status', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'pending',
        }),
      } as Response);

      const status = await provider.getPaymentStatus('ws_test123');

      expect(status).toBe('pending');
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.walleot.com/v1/sessions/ws_test123',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer test_walleot_key',
          }),
        })
      );
    });

    it('should return completed status', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'COMPLETED',
        }),
      } as Response);

      const status = await provider.getPaymentStatus('ws_test123');

      expect(status).toBe('completed'); // Converted to lowercase
    });

    it('should return failed status', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'Failed',
        }),
      } as Response);

      const status = await provider.getPaymentStatus('ws_test123');

      expect(status).toBe('failed');
    });

    it('should return canceled status', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'CANCELED',
        }),
      } as Response);

      const status = await provider.getPaymentStatus('ws_test123');

      expect(status).toBe('canceled');
    });

    it('should handle missing status', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}), // No status field
      } as Response);

      const status = await provider.getPaymentStatus('ws_test123');

      expect(status).toBe('unknown');
    });

    it('should handle null status', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: null,
        }),
      } as Response);

      const status = await provider.getPaymentStatus('ws_test123');

      expect(status).toBe('unknown'); // null converted to "unknown"
    });

    it('should handle numeric status', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 123,
        }),
      } as Response);

      const status = await provider.getPaymentStatus('ws_test123');

      expect(status).toBe('123');
    });

    it('should handle API errors', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => 'Session not found',
      } as Response);

      await expect(provider.getPaymentStatus('ws_invalid')).rejects.toThrow('HTTP 404');
    });

    it('should handle network errors', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('Network error'));

      await expect(provider.getPaymentStatus('ws_test123')).rejects.toThrow('Network error');
    });
  });

  describe('edge cases', () => {
    it('should handle very large amounts', async () => {
      const mockResponse = {
        sessionId: 'ws_large123',
        url: 'https://checkout.walleot.com/pay/ws_large123',
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await provider.createPayment(999999.99, 'USD', 'Large payment');

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.amount).toBe(99999999); // Properly converted to cents
    });

    it('should handle unusual currency codes', async () => {
      const mockResponse = {
        sessionId: 'ws_crypto123',
        url: 'https://checkout.walleot.com/pay/ws_crypto123',
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await provider.createPayment(0.01, 'BTC', 'Crypto payment');

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.currency).toBe('btc');
      expect(body.amount).toBe(1); // 0.01 * 100
    });

    it('should handle special characters in description', async () => {
      const mockResponse = {
        sessionId: 'ws_special123',
        url: 'https://checkout.walleot.com/pay/ws_special123',
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const specialDescription = 'Payment with ümlaut, émoji 🎉, and "quotes"';
      await provider.createPayment(10, 'USD', specialDescription);

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.description).toBe(specialDescription);
    });

    it('should handle very long descriptions', async () => {
      const mockResponse = {
        sessionId: 'ws_long123',
        url: 'https://checkout.walleot.com/pay/ws_long123',
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const longDescription = 'A'.repeat(1000);
      await provider.createPayment(10, 'USD', longDescription);

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.description).toBe(longDescription);
    });
  });
});
