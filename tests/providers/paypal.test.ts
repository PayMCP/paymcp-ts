import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PayPalProvider, createPayPalProvider } from '../../src/providers/paypal.js';

describe('PayPalProvider', () => {
  let provider: PayPalProvider;
  let mockLogger: any;

  beforeEach(() => {
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };

    // Mock global fetch
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with PayPal-specific options (production)', () => {
      provider = new PayPalProvider({
        clientId: 'client_123',
        clientSecret: 'secret_456',
        sandbox: false,
        successUrl: 'https://custom.com/success',
        cancelUrl: 'https://custom.com/cancel',
        logger: mockLogger
      });

      expect(provider).toBeInstanceOf(PayPalProvider);
      expect(mockLogger.debug).toHaveBeenCalledWith('[PayPalProvider] ready');
    });

    it('should initialize with PayPal-specific options (sandbox default)', () => {
      provider = new PayPalProvider({
        clientId: 'client_123',
        clientSecret: 'secret_456',
        logger: mockLogger
      });

      expect(provider).toBeInstanceOf(PayPalProvider);
      expect(mockLogger.debug).toHaveBeenCalledWith('[PayPalProvider] ready');
    });

    it('should initialize with standard options (apiKey format - 2 parts)', () => {
      provider = new PayPalProvider({
        apiKey: 'client_123:secret_456',
        logger: mockLogger
      });

      expect(provider).toBeInstanceOf(PayPalProvider);
      expect(mockLogger.debug).toHaveBeenCalledWith('[PayPalProvider] ready');
    });

    it('should initialize with standard options (apiKey format - 3 parts with sandbox)', () => {
      provider = new PayPalProvider({
        apiKey: 'client_123:secret_456:sandbox',
        logger: mockLogger
      });

      expect(provider).toBeInstanceOf(PayPalProvider);
      expect(mockLogger.debug).toHaveBeenCalledWith('[PayPalProvider] ready');
    });

    it('should use default URLs when not provided', () => {
      provider = new PayPalProvider({
        clientId: 'client_123',
        clientSecret: 'secret_456',
        logger: mockLogger
      });

      expect(provider).toBeInstanceOf(PayPalProvider);
    });

    it('should use console logger when not provided', () => {
      const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

      provider = new PayPalProvider({
        clientId: 'client_123',
        clientSecret: 'secret_456'
      });

      expect(provider).toBeInstanceOf(PayPalProvider);
      consoleSpy.mockRestore();
    });

    it('should throw error for invalid apiKey format (missing secret)', () => {
      expect(() => {
        new PayPalProvider({
          apiKey: 'client_only',
          logger: mockLogger
        });
      }).toThrow('[PayPalProvider] apiKey must be in format "clientId:clientSecret" or "clientId:clientSecret:sandbox"');
    });

    it('should throw error for invalid apiKey format (empty)', () => {
      expect(() => {
        new PayPalProvider({
          apiKey: '',
          logger: mockLogger
        });
      }).toThrow('[PayPalProvider] apiKey must be in format "clientId:clientSecret" or "clientId:clientSecret:sandbox"');
    });
  });

  describe('buildHeaders', () => {
    beforeEach(() => {
      provider = new PayPalProvider({
        clientId: 'client_123',
        clientSecret: 'secret_456',
        logger: mockLogger
      });
    });

    it('should return PayPal headers with empty token initially', () => {
      const headers = (provider as any).buildHeaders();
      expect(headers).toEqual({
        Authorization: 'Bearer ',
        'Content-Type': 'application/json'
      });
    });

    it('should return PayPal headers with access token when available', () => {
      // Set access token internally
      (provider as any).accessToken = 'access_token_123';

      const headers = (provider as any).buildHeaders();
      expect(headers).toEqual({
        Authorization: 'Bearer access_token_123',
        'Content-Type': 'application/json'
      });
    });
  });

  describe('getAccessToken', () => {
    beforeEach(() => {
      provider = new PayPalProvider({
        clientId: 'client_123',
        clientSecret: 'secret_456',
        logger: mockLogger
      });
    });

    it('should fetch new access token successfully', async () => {
      const mockTokenResponse = {
        access_token: 'new_token_123',
        token_type: 'Bearer',
        expires_in: 3600
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockTokenResponse)
      });

      const token = await (provider as any).getAccessToken();

      expect(token).toBe('new_token_123');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api-m.sandbox.paypal.com/v1/oauth2/token',
        {
          method: 'POST',
          headers: {
            Authorization: expect.stringMatching(/^Basic .+$/),
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: 'grant_type=client_credentials'
        }
      );
      expect(mockLogger.debug).toHaveBeenCalledWith('[PayPalProvider] Fetching new access token');
    });

    it('should use production URL when sandbox is false', async () => {
      provider = new PayPalProvider({
        clientId: 'client_123',
        clientSecret: 'secret_456',
        sandbox: false,
        logger: mockLogger
      });

      const mockTokenResponse = {
        access_token: 'prod_token_123',
        token_type: 'Bearer',
        expires_in: 3600
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockTokenResponse)
      });

      await (provider as any).getAccessToken();

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api-m.paypal.com/v1/oauth2/token',
        expect.any(Object)
      );
    });

    it('should return cached token when still valid', async () => {
      // Set a valid cached token
      (provider as any).accessToken = 'cached_token_123';
      (provider as any).tokenExpiry = Date.now() + 1000000; // Far in future

      const token = await (provider as any).getAccessToken();

      expect(token).toBe('cached_token_123');
      expect(global.fetch).not.toHaveBeenCalled();
      expect(mockLogger.debug).not.toHaveBeenCalledWith('[PayPalProvider] Fetching new access token');
    });

    it('should fetch new token when cached token is expired', async () => {
      // Set an expired cached token
      (provider as any).accessToken = 'expired_token';
      (provider as any).tokenExpiry = Date.now() - 1000; // Expired

      const mockTokenResponse = {
        access_token: 'new_token_123',
        token_type: 'Bearer',
        expires_in: 3600
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockTokenResponse)
      });

      const token = await (provider as any).getAccessToken();

      expect(token).toBe('new_token_123');
      expect(global.fetch).toHaveBeenCalled();
    });

    it('should throw error when token request fails', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 401
      });

      await expect((provider as any).getAccessToken()).rejects.toThrow(
        '[PayPalProvider] Failed to get access token: 401'
      );
    });

    it('should calculate token expiry with 5-minute buffer', async () => {
      const mockTokenResponse = {
        access_token: 'buffered_token',
        token_type: 'Bearer',
        expires_in: 3600 // 1 hour
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockTokenResponse)
      });

      const beforeTime = Date.now();
      await (provider as any).getAccessToken();
      const afterTime = Date.now();

      const expectedExpiry = beforeTime + (3600 - 300) * 1000; // 55 minutes from now
      const actualExpiry = (provider as any).tokenExpiry;

      expect(actualExpiry).toBeGreaterThanOrEqual(expectedExpiry);
      expect(actualExpiry).toBeLessThanOrEqual(afterTime + (3600 - 300) * 1000);
    });
  });

  describe('request method override', () => {
    beforeEach(() => {
      provider = new PayPalProvider({
        clientId: 'client_123',
        clientSecret: 'secret_456',
        logger: mockLogger
      });

      // Mock getAccessToken to set token and return it
      vi.spyOn(provider as any, 'getAccessToken').mockImplementation(async () => {
        (provider as any).accessToken = 'mocked_token';
        return 'mocked_token';
      });
    });

    it('should make GET request with access token', async () => {
      const mockResponse = { id: 'order_123', status: 'CREATED' };
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      const result = await (provider as any).request('GET', 'https://api.test.com/orders/123');

      expect(result).toEqual(mockResponse);
      expect((provider as any).getAccessToken).toHaveBeenCalled();
      expect(global.fetch).toHaveBeenCalledWith('https://api.test.com/orders/123', {
        method: 'GET',
        headers: {
          Authorization: 'Bearer mocked_token',
          'Content-Type': 'application/json'
        }
      });
    });

    it('should make POST request with JSON body', async () => {
      const mockResponse = { id: 'order_456', status: 'CREATED' };
      const requestData = { amount: { value: '25.00', currency: 'USD' } };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      const result = await (provider as any).request('POST', 'https://api.test.com/orders', requestData);

      expect(result).toEqual(mockResponse);
      expect(global.fetch).toHaveBeenCalledWith('https://api.test.com/orders', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer mocked_token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestData)
      });
    });

    it('should handle request without data', async () => {
      const mockResponse = { status: 'success' };
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      const result = await (provider as any).request('POST', 'https://api.test.com/capture');

      expect(result).toEqual(mockResponse);
      expect(global.fetch).toHaveBeenCalledWith('https://api.test.com/capture', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer mocked_token',
          'Content-Type': 'application/json'
        }
      });
    });

    it('should throw error for HTTP errors', async () => {
      const errorText = '{"error": "invalid_request"}';
      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve(errorText)
      });

      await expect(
        (provider as any).request('POST', 'https://api.test.com/invalid')
      ).rejects.toThrow('[PayPalProvider] HTTP 400: {"error": "invalid_request"}');
    });
  });

  describe('createPayment', () => {
    beforeEach(() => {
      provider = new PayPalProvider({
        clientId: 'client_123',
        clientSecret: 'secret_456',
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
        logger: mockLogger
      });

      // Mock the request method
      vi.spyOn(provider as any, 'request').mockImplementation(() => Promise.resolve());
    });

    it('should create payment successfully', async () => {
      const mockOrderResponse = {
        id: 'order_123',
        status: 'CREATED',
        links: [
          { href: 'https://api.paypal.com/orders/order_123', rel: 'self', method: 'GET' },
          { href: 'https://paypal.com/checkoutnow?token=order_123', rel: 'approve', method: 'GET' }
        ]
      };

      (provider as any).request.mockResolvedValue(mockOrderResponse);

      const result = await provider.createPayment(25.50, 'USD', 'Test product purchase');

      expect(result).toEqual({
        paymentId: 'order_123',
        paymentUrl: 'https://paypal.com/checkoutnow?token=order_123'
      });

      expect((provider as any).request).toHaveBeenCalledWith(
        'POST',
        'https://api-m.sandbox.paypal.com/v2/checkout/orders',
        {
          intent: 'CAPTURE',
          purchase_units: [
            {
              amount: {
                currency_code: 'USD',
                value: '25.50'
              },
              description: 'Test product purchase'
            }
          ],
          application_context: {
            return_url: 'https://example.com/success',
            cancel_url: 'https://example.com/cancel',
            user_action: 'PAY_NOW'
          }
        }
      );

      expect(mockLogger.debug).toHaveBeenCalledWith(
        '[PayPalProvider] createPayment 25.5 USD "Test product purchase"'
      );
    });

    it('should handle different currency correctly', async () => {
      const mockOrderResponse = {
        id: 'order_eur',
        status: 'CREATED',
        links: [
          { href: 'https://paypal.com/checkoutnow?token=order_eur', rel: 'approve', method: 'GET' }
        ]
      };

      (provider as any).request.mockResolvedValue(mockOrderResponse);

      await provider.createPayment(100.00, 'eur', 'Euro payment');

      expect((provider as any).request).toHaveBeenCalledWith(
        'POST',
        'https://api-m.sandbox.paypal.com/v2/checkout/orders',
        expect.objectContaining({
          purchase_units: [
            expect.objectContaining({
              amount: {
                currency_code: 'EUR',
                value: '100.00'
              }
            })
          ]
        })
      );
    });

    it('should handle decimal amounts correctly', async () => {
      const mockOrderResponse = {
        id: 'order_decimal',
        status: 'CREATED',
        links: [
          { href: 'https://paypal.com/checkoutnow?token=order_decimal', rel: 'approve', method: 'GET' }
        ]
      };

      (provider as any).request.mockResolvedValue(mockOrderResponse);

      await provider.createPayment(12.99, 'USD', 'Decimal test');

      expect((provider as any).request).toHaveBeenCalledWith(
        'POST',
        'https://api-m.sandbox.paypal.com/v2/checkout/orders',
        expect.objectContaining({
          purchase_units: [
            expect.objectContaining({
              amount: {
                currency_code: 'USD',
                value: '12.99'
              }
            })
          ]
        })
      );
    });

    it('should throw error when no approval link is found', async () => {
      const mockOrderResponse = {
        id: 'order_no_approve',
        status: 'CREATED',
        links: [
          { href: 'https://api.paypal.com/orders/order_no_approve', rel: 'self', method: 'GET' }
          // Missing approve link
        ]
      };

      (provider as any).request.mockResolvedValue(mockOrderResponse);

      await expect(
        provider.createPayment(50.00, 'USD', 'No approve link test')
      ).rejects.toThrow('[PayPalProvider] No approval URL in PayPal response');
    });

    it('should throw error when links array is missing', async () => {
      const mockOrderResponse = {
        id: 'order_no_links',
        status: 'CREATED'
        // Missing links array
      };

      (provider as any).request.mockResolvedValue(mockOrderResponse);

      await expect(
        provider.createPayment(50.00, 'USD', 'No links test')
      ).rejects.toThrow('[PayPalProvider] No approval URL in PayPal response');
    });

    it('should throw error when approve link has no href', async () => {
      const mockOrderResponse = {
        id: 'order_no_href',
        status: 'CREATED',
        links: [
          { rel: 'approve', method: 'GET' } // Missing href
        ]
      };

      (provider as any).request.mockResolvedValue(mockOrderResponse);

      await expect(
        provider.createPayment(50.00, 'USD', 'No href test')
      ).rejects.toThrow('[PayPalProvider] No approval URL in PayPal response');
    });
  });

  describe('getPaymentStatus', () => {
    beforeEach(() => {
      provider = new PayPalProvider({
        clientId: 'client_123',
        clientSecret: 'secret_456',
        logger: mockLogger
      });

      // Mock the request method
      vi.spyOn(provider as any, 'request').mockImplementation(() => Promise.resolve());
    });

    it('should get status for COMPLETED payment', async () => {
      const mockOrderResponse = {
        id: 'order_completed',
        status: 'COMPLETED'
      };

      (provider as any).request.mockResolvedValue(mockOrderResponse);

      const status = await provider.getPaymentStatus('order_completed');

      expect(status).toBe('paid');
      expect((provider as any).request).toHaveBeenCalledWith(
        'GET',
        'https://api-m.sandbox.paypal.com/v2/checkout/orders/order_completed'
      );
      expect(mockLogger.debug).toHaveBeenCalledWith('[PayPalProvider] getPaymentStatus order_completed');
    });

    it('should get status for VOIDED payment', async () => {
      const mockOrderResponse = {
        id: 'order_voided',
        status: 'VOIDED'
      };

      (provider as any).request.mockResolvedValue(mockOrderResponse);

      const status = await provider.getPaymentStatus('order_voided');

      expect(status).toBe('canceled');
    });

    it('should get status for EXPIRED payment', async () => {
      const mockOrderResponse = {
        id: 'order_expired',
        status: 'EXPIRED'
      };

      (provider as any).request.mockResolvedValue(mockOrderResponse);

      const status = await provider.getPaymentStatus('order_expired');

      expect(status).toBe('canceled');
    });

    it('should get status for CREATED payment (pending)', async () => {
      const mockOrderResponse = {
        id: 'order_created',
        status: 'CREATED'
      };

      (provider as any).request.mockResolvedValue(mockOrderResponse);

      const status = await provider.getPaymentStatus('order_created');

      expect(status).toBe('pending');
    });

    it('should auto-capture APPROVED payment successfully', async () => {
      const mockOrderResponse = {
        id: 'order_approved',
        status: 'APPROVED'
      };

      const mockCaptureResponse = {
        id: 'order_approved',
        status: 'COMPLETED'
      };

      (provider as any).request
        .mockResolvedValueOnce(mockOrderResponse) // First call for order status
        .mockResolvedValueOnce(mockCaptureResponse); // Second call for capture

      const status = await provider.getPaymentStatus('order_approved');

      expect(status).toBe('paid');
      expect((provider as any).request).toHaveBeenCalledTimes(2);
      expect((provider as any).request).toHaveBeenNthCalledWith(
        1,
        'GET',
        'https://api-m.sandbox.paypal.com/v2/checkout/orders/order_approved'
      );
      expect((provider as any).request).toHaveBeenNthCalledWith(
        2,
        'POST',
        'https://api-m.sandbox.paypal.com/v2/checkout/orders/order_approved/capture',
        {}
      );
      expect(mockLogger.debug).toHaveBeenCalledWith('[PayPalProvider] Auto-capturing payment order_approved');
    });

    it('should handle auto-capture returning non-COMPLETED status', async () => {
      const mockOrderResponse = {
        id: 'order_approved_pending',
        status: 'APPROVED'
      };

      const mockCaptureResponse = {
        id: 'order_approved_pending',
        status: 'PENDING'
      };

      (provider as any).request
        .mockResolvedValueOnce(mockOrderResponse)
        .mockResolvedValueOnce(mockCaptureResponse);

      const status = await provider.getPaymentStatus('order_approved_pending');

      expect(status).toBe('pending');
    });

    it('should handle auto-capture failure gracefully', async () => {
      const mockOrderResponse = {
        id: 'order_capture_fail',
        status: 'APPROVED'
      };

      const captureError = new Error('Capture failed');

      (provider as any).request
        .mockResolvedValueOnce(mockOrderResponse)
        .mockRejectedValueOnce(captureError);

      const status = await provider.getPaymentStatus('order_capture_fail');

      expect(status).toBe('pending');
      expect(mockLogger.error).toHaveBeenCalledWith(
        '[PayPalProvider] Failed to capture order_capture_fail:',
        captureError
      );
    });
  });

  describe('createPayPalProvider factory function', () => {
    it('should create PayPal provider instance', () => {
      const opts = {
        clientId: 'factory_client',
        clientSecret: 'factory_secret',
        sandbox: true,
        logger: mockLogger
      };

      const provider = createPayPalProvider(opts);

      expect(provider).toBeInstanceOf(PayPalProvider);
      expect(mockLogger.debug).toHaveBeenCalledWith('[PayPalProvider] ready');
    });
  });

  describe('error handling and edge cases', () => {
    beforeEach(() => {
      provider = new PayPalProvider({
        clientId: 'client_123',
        clientSecret: 'secret_456',
        logger: mockLogger
      });
    });

    it('should handle network errors from request method', async () => {
      const networkError = new Error('Network failure');
      vi.spyOn(provider as any, 'request').mockRejectedValue(networkError);

      await expect(
        provider.createPayment(25.00, 'USD', 'Network error test')
      ).rejects.toThrow('Network failure');
    });

    it('should handle zero amount', async () => {
      const mockOrderResponse = {
        id: 'order_zero',
        status: 'CREATED',
        links: [
          { href: 'https://paypal.com/checkoutnow?token=order_zero', rel: 'approve', method: 'GET' }
        ]
      };

      vi.spyOn(provider as any, 'request').mockResolvedValue(mockOrderResponse);

      const result = await provider.createPayment(0, 'USD', 'Zero amount test');

      expect(result.paymentId).toBe('order_zero');
      expect((provider as any).request).toHaveBeenCalledWith(
        'POST',
        'https://api-m.sandbox.paypal.com/v2/checkout/orders',
        expect.objectContaining({
          purchase_units: [
            expect.objectContaining({
              amount: {
                currency_code: 'USD',
                value: '0.00'
              }
            })
          ]
        })
      );
    });

    it('should handle large amounts', async () => {
      const mockOrderResponse = {
        id: 'order_large',
        status: 'CREATED',
        links: [
          { href: 'https://paypal.com/checkoutnow?token=order_large', rel: 'approve', method: 'GET' }
        ]
      };

      vi.spyOn(provider as any, 'request').mockResolvedValue(mockOrderResponse);

      await provider.createPayment(9999.99, 'USD', 'Large amount test');

      expect((provider as any).request).toHaveBeenCalledWith(
        'POST',
        'https://api-m.sandbox.paypal.com/v2/checkout/orders',
        expect.objectContaining({
          purchase_units: [
            expect.objectContaining({
              amount: {
                currency_code: 'USD',
                value: '9999.99'
              }
            })
          ]
        })
      );
    });
  });
});