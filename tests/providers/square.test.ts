import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SquareProvider, createSquareProvider } from '../../src/providers/square.js';

describe('SquareProvider', () => {
  let provider: SquareProvider;
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
    it('should initialize with Square-specific options (production)', () => {
      provider = new SquareProvider({
        accessToken: 'sq_access_token_123',
        locationId: 'location_456',
        sandbox: false,
        redirectUrl: 'https://custom.com/success',
        apiVersion: '2024-01-01',
        logger: mockLogger
      });

      expect(provider).toBeInstanceOf(SquareProvider);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        '[SquareProvider] ready - locationId: location_456, apiVersion: 2024-01-01'
      );
    });

    it('should initialize with Square-specific options (sandbox default)', () => {
      provider = new SquareProvider({
        accessToken: 'sq_access_token_123',
        locationId: 'location_456',
        logger: mockLogger
      });

      expect(provider).toBeInstanceOf(SquareProvider);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringMatching(/\[SquareProvider\] ready - locationId: location_456, apiVersion: \d{4}-\d{2}-\d{2}/)
      );
    });

    it('should initialize with standard options (apiKey format)', () => {
      provider = new SquareProvider({
        apiKey: 'sq_access_token_123:location_456:sandbox',
        logger: mockLogger
      });

      expect(provider).toBeInstanceOf(SquareProvider);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringMatching(/\[SquareProvider\] ready - locationId: location_456, apiVersion: \d{4}-\d{2}-\d{2}/)
      );
    });

    it('should use default URLs and api version when not provided', () => {
      provider = new SquareProvider({
        accessToken: 'sq_access_token_123',
        locationId: 'location_456',
        logger: mockLogger
      });

      expect(provider).toBeInstanceOf(SquareProvider);
    });

    it('should use console logger when not provided', () => {
      const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

      provider = new SquareProvider({
        accessToken: 'sq_access_token_123',
        locationId: 'location_456'
      });

      expect(provider).toBeInstanceOf(SquareProvider);
      consoleSpy.mockRestore();
    });

    it('should throw error for invalid apiKey format (insufficient parts)', () => {
      expect(() => {
        new SquareProvider({
          apiKey: 'token:location',
          logger: mockLogger
        });
      }).toThrow('[SquareProvider] apiKey must be in format "accessToken:locationId:sandbox"');
    });

    it('should throw error for invalid apiKey format (empty)', () => {
      expect(() => {
        new SquareProvider({
          apiKey: '',
          logger: mockLogger
        });
      }).toThrow('[SquareProvider] apiKey must be in format "accessToken:locationId:sandbox"');
    });

    it('should handle production URL when sandbox is false', () => {
      provider = new SquareProvider({
        accessToken: 'sq_prod_token',
        locationId: 'prod_location',
        sandbox: false,
        logger: mockLogger
      });

      expect(provider).toBeInstanceOf(SquareProvider);
    });

    it('should use environment SQUARE_API_VERSION when not provided', () => {
      const originalEnv = process.env.SQUARE_API_VERSION;
      process.env.SQUARE_API_VERSION = '2023-12-01';

      provider = new SquareProvider({
        accessToken: 'sq_access_token',
        locationId: 'location_id',
        logger: mockLogger
      });

      expect(mockLogger.debug).toHaveBeenCalledWith(
        '[SquareProvider] ready - locationId: location_id, apiVersion: 2023-12-01'
      );

      process.env.SQUARE_API_VERSION = originalEnv;
    });
  });

  describe('buildHeaders', () => {
    beforeEach(() => {
      provider = new SquareProvider({
        accessToken: 'sq_access_token_123',
        locationId: 'location_456',
        apiVersion: '2024-05-15',
        logger: mockLogger
      });
    });

    it('should return Square-specific headers with api version', () => {
      const headers = (provider as any).buildHeaders();

      expect(headers).toEqual({
        Authorization: 'Bearer sq_access_token_123',
        'Content-Type': 'application/json',
        'Square-Version': '2024-05-15'
      });
    });
  });

  describe('request method override', () => {
    beforeEach(() => {
      provider = new SquareProvider({
        accessToken: 'sq_access_token_123',
        locationId: 'location_456',
        logger: mockLogger
      });
    });

    it('should make GET request with Square headers', async () => {
      const mockResponse = { payment_link: { id: 'pl_123', url: 'https://checkout.square.com/123' } };
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      const result = await (provider as any).request('GET', 'https://api.test.com/payment-links/123');

      expect(result).toEqual(mockResponse);
      expect(global.fetch).toHaveBeenCalledWith('https://api.test.com/payment-links/123', {
        method: 'GET',
        headers: {
          Authorization: 'Bearer sq_access_token_123',
          'Content-Type': 'application/json',
          'Square-Version': expect.any(String)
        }
      });
    });

    it('should make POST request with JSON body', async () => {
      const mockResponse = { payment_link: { id: 'pl_456', url: 'https://checkout.square.com/456' } };
      const requestData = { quick_pay: { name: 'Test', price_money: { amount: 2500, currency: 'USD' } } };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      const result = await (provider as any).request('POST', 'https://api.test.com/payment-links', requestData);

      expect(result).toEqual(mockResponse);
      expect(global.fetch).toHaveBeenCalledWith('https://api.test.com/payment-links', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer sq_access_token_123',
          'Content-Type': 'application/json',
          'Square-Version': expect.any(String)
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

      const result = await (provider as any).request('POST', 'https://api.test.com/action');

      expect(result).toEqual(mockResponse);
      expect(global.fetch).toHaveBeenCalledWith('https://api.test.com/action', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer sq_access_token_123',
          'Content-Type': 'application/json',
          'Square-Version': expect.any(String)
        }
      });
    });

    it('should throw error for HTTP errors', async () => {
      const errorText = '{"errors": [{"category": "INVALID_REQUEST_ERROR"}]}';
      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve(errorText)
      });

      await expect(
        (provider as any).request('POST', 'https://api.test.com/invalid')
      ).rejects.toThrow('[SquareProvider] HTTP 400: {"errors": [{"category": "INVALID_REQUEST_ERROR"}]}');
    });
  });

  describe('createPayment', () => {
    beforeEach(() => {
      provider = new SquareProvider({
        accessToken: 'sq_access_token_123',
        locationId: 'location_456',
        logger: mockLogger
      });

      // Mock the request method
      vi.spyOn(provider as any, 'request').mockImplementation(() => Promise.resolve());

      // Mock Date.now and Math.random for consistent idempotency keys
      vi.spyOn(Date, 'now').mockReturnValue(1234567890000);
      vi.spyOn(Math, 'random').mockReturnValue(0.123456789);
    });

    it('should create payment successfully', async () => {
      const mockPaymentLinkResponse = {
        payment_link: {
          id: 'pl_test_12345',
          url: 'https://checkout.square.com/merchant/123/checkout/pl_test_12345',
          version: 1,
          order_id: 'order_123',
          created_at: '2024-01-01T00:00:00Z'
        },
        related_resources: {
          orders: [{
            id: 'order_123',
            location_id: 'location_456',
            state: 'OPEN',
            total_money: { amount: 2550, currency: 'USD' }
          }]
        }
      };

      (provider as any).request.mockResolvedValue(mockPaymentLinkResponse);

      const result = await provider.createPayment(25.50, 'USD', 'Test product purchase');

      expect(result).toEqual({
        paymentId: 'pl_test_12345',
        paymentUrl: 'https://checkout.square.com/merchant/123/checkout/pl_test_12345'
      });

      expect((provider as any).request).toHaveBeenCalledWith(
        'POST',
        'https://connect.squareupsandbox.com/v2/online-checkout/payment-links',
        {
          idempotency_key: expect.stringMatching(/^1234567890000-[a-z0-9]+$/),
          quick_pay: {
            name: 'Test product purchase',
            price_money: {
              amount: 2550,
              currency: 'USD'
            },
            location_id: 'location_456'
          }
        }
      );

      expect(mockLogger.debug).toHaveBeenCalledWith(
        '[SquareProvider] createPayment 25.5 USD (2550) "Test product purchase"'
      );
    });

    it('should handle different currency correctly', async () => {
      const mockPaymentLinkResponse = {
        payment_link: {
          id: 'pl_test_eur',
          url: 'https://checkout.square.com/eur',
          version: 1,
          order_id: 'order_eur',
          created_at: '2024-01-01T00:00:00Z'
        }
      };

      (provider as any).request.mockResolvedValue(mockPaymentLinkResponse);

      await provider.createPayment(100.00, 'eur', 'Euro payment');

      expect((provider as any).request).toHaveBeenCalledWith(
        'POST',
        'https://connect.squareupsandbox.com/v2/online-checkout/payment-links',
        expect.objectContaining({
          quick_pay: expect.objectContaining({
            price_money: {
              amount: 10000,
              currency: 'EUR'
            }
          })
        })
      );
    });

    it('should use production URL when sandbox is false', async () => {
      provider = new SquareProvider({
        accessToken: 'sq_prod_token',
        locationId: 'prod_location',
        sandbox: false,
        logger: mockLogger
      });

      vi.spyOn(provider as any, 'request').mockResolvedValue({
        payment_link: { id: 'pl_prod', url: 'https://checkout.square.com/prod' }
      });

      await provider.createPayment(50.00, 'USD', 'Production payment');

      expect((provider as any).request).toHaveBeenCalledWith(
        'POST',
        'https://connect.squareup.com/v2/online-checkout/payment-links',
        expect.any(Object)
      );
    });

    it('should convert amounts to cents correctly (toSquareAmount)', async () => {
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
          payment_link: { id: 'pl_test_amount', url: 'https://checkout.square.com/test' }
        };

        (provider as any).request.mockResolvedValue(mockResponse);

        await provider.createPayment(testCase.amount, 'USD', 'Amount test');

        const call = (provider as any).request.mock.calls[0];
        const payload = call[2];
        expect(payload.quick_pay.price_money.amount).toBe(testCase.expected);

        // Reset for next iteration
        (provider as any).request.mockClear();
      }
    });

    it('should generate unique idempotency keys', async () => {
      const mockResponse = {
        payment_link: { id: 'pl_unique', url: 'https://checkout.square.com/unique' }
      };

      (provider as any).request.mockResolvedValue(mockResponse);

      // Call twice with different timestamps
      Date.now.mockReturnValueOnce(1000000000000);
      Date.now.mockReturnValueOnce(2000000000000);

      await provider.createPayment(10.00, 'USD', 'First payment');
      const firstCall = (provider as any).request.mock.calls[0][2];

      await provider.createPayment(10.00, 'USD', 'Second payment');
      const secondCall = (provider as any).request.mock.calls[1][2];

      expect(firstCall.idempotency_key).toContain('1000000000000');
      expect(secondCall.idempotency_key).toContain('2000000000000');
      expect(firstCall.idempotency_key).not.toBe(secondCall.idempotency_key);
    });

    it('should throw error when payment link response is missing id', async () => {
      const invalidResponse = {
        payment_link: {
          url: 'https://checkout.square.com/incomplete'
          // Missing id
        }
      };

      (provider as any).request.mockResolvedValue(invalidResponse);

      await expect(
        provider.createPayment(50.00, 'USD', 'Invalid response test')
      ).rejects.toThrow('[SquareProvider] Invalid response from Square Payment Links API');
    });

    it('should throw error when payment link response is missing url', async () => {
      const invalidResponse = {
        payment_link: {
          id: 'pl_test_no_url'
          // Missing url
        }
      };

      (provider as any).request.mockResolvedValue(invalidResponse);

      await expect(
        provider.createPayment(50.00, 'USD', 'Invalid response test')
      ).rejects.toThrow('[SquareProvider] Invalid response from Square Payment Links API');
    });

    it('should throw error when payment_link is missing', async () => {
      const invalidResponse = {
        // Missing payment_link
      };

      (provider as any).request.mockResolvedValue(invalidResponse);

      await expect(
        provider.createPayment(50.00, 'USD', 'Invalid response test')
      ).rejects.toThrow('[SquareProvider] Invalid response from Square Payment Links API');
    });

    it('should handle zero amount', async () => {
      const mockResponse = {
        payment_link: { id: 'pl_zero', url: 'https://checkout.square.com/zero' }
      };

      (provider as any).request.mockResolvedValue(mockResponse);

      await provider.createPayment(0, 'USD', 'Zero amount test');

      const call = (provider as any).request.mock.calls[0];
      const payload = call[2];
      expect(payload.quick_pay.price_money.amount).toBe(0);
    });
  });

  describe('getPaymentStatus', () => {
    beforeEach(() => {
      provider = new SquareProvider({
        accessToken: 'sq_access_token_123',
        locationId: 'location_456',
        logger: mockLogger
      });

      // Mock the request method
      vi.spyOn(provider as any, 'request').mockImplementation(() => Promise.resolve());
    });

    it('should get status for paid payment (net amount due is 0)', async () => {
      const mockPaymentLinkResponse = {
        payment_link: {
          id: 'pl_test_paid',
          order_id: 'order_paid_123'
        }
      };

      const mockOrderResponse = {
        order: {
          id: 'order_paid_123',
          state: 'COMPLETED',
          net_amount_due_money: {
            amount: 0,
            currency: 'USD'
          }
        }
      };

      (provider as any).request
        .mockResolvedValueOnce(mockPaymentLinkResponse)
        .mockResolvedValueOnce(mockOrderResponse);

      const status = await provider.getPaymentStatus('pl_test_paid');

      expect(status).toBe('paid');
      expect((provider as any).request).toHaveBeenCalledTimes(2);
      expect((provider as any).request).toHaveBeenNthCalledWith(
        1,
        'GET',
        'https://connect.squareupsandbox.com/v2/online-checkout/payment-links/pl_test_paid'
      );
      expect((provider as any).request).toHaveBeenNthCalledWith(
        2,
        'GET',
        'https://connect.squareupsandbox.com/v2/orders/order_paid_123?location_id=location_456'
      );
      expect(mockLogger.debug).toHaveBeenCalledWith('[SquareProvider] getPaymentStatus pl_test_paid');
    });

    it('should get status for completed order state', async () => {
      const mockPaymentLinkResponse = {
        payment_link: {
          id: 'pl_test_completed',
          order_id: 'order_completed_123'
        }
      };

      const mockOrderResponse = {
        order: {
          id: 'order_completed_123',
          state: 'COMPLETED',
          net_amount_due_money: {
            amount: 500, // Still has amount due but state is COMPLETED
            currency: 'USD'
          }
        }
      };

      (provider as any).request
        .mockResolvedValueOnce(mockPaymentLinkResponse)
        .mockResolvedValueOnce(mockOrderResponse);

      const status = await provider.getPaymentStatus('pl_test_completed');

      expect(status).toBe('paid');
    });

    it('should get status for canceled order', async () => {
      const mockPaymentLinkResponse = {
        payment_link: {
          id: 'pl_test_canceled',
          order_id: 'order_canceled_123'
        }
      };

      const mockOrderResponse = {
        order: {
          id: 'order_canceled_123',
          state: 'CANCELED'
        }
      };

      (provider as any).request
        .mockResolvedValueOnce(mockPaymentLinkResponse)
        .mockResolvedValueOnce(mockOrderResponse);

      const status = await provider.getPaymentStatus('pl_test_canceled');

      expect(status).toBe('canceled');
    });

    it('should get status for open order (pending)', async () => {
      const mockPaymentLinkResponse = {
        payment_link: {
          id: 'pl_test_open',
          order_id: 'order_open_123'
        }
      };

      const mockOrderResponse = {
        order: {
          id: 'order_open_123',
          state: 'OPEN',
          net_amount_due_money: {
            amount: 2500,
            currency: 'USD'
          }
        }
      };

      (provider as any).request
        .mockResolvedValueOnce(mockPaymentLinkResponse)
        .mockResolvedValueOnce(mockOrderResponse);

      const status = await provider.getPaymentStatus('pl_test_open');

      expect(status).toBe('pending');
    });

    it('should get status for draft order (pending)', async () => {
      const mockPaymentLinkResponse = {
        payment_link: {
          id: 'pl_test_draft',
          order_id: 'order_draft_123'
        }
      };

      const mockOrderResponse = {
        order: {
          id: 'order_draft_123',
          state: 'DRAFT'
        }
      };

      (provider as any).request
        .mockResolvedValueOnce(mockPaymentLinkResponse)
        .mockResolvedValueOnce(mockOrderResponse);

      const status = await provider.getPaymentStatus('pl_test_draft');

      expect(status).toBe('pending');
    });

    it('should return pending when payment link has no order_id', async () => {
      const mockPaymentLinkResponse = {
        payment_link: {
          id: 'pl_test_no_order'
          // Missing order_id
        }
      };

      (provider as any).request.mockResolvedValueOnce(mockPaymentLinkResponse);

      const status = await provider.getPaymentStatus('pl_test_no_order');

      expect(status).toBe('pending');
      expect((provider as any).request).toHaveBeenCalledTimes(1); // Only payment link call
    });

    it('should return pending when payment link response is invalid', async () => {
      const mockPaymentLinkResponse = {
        // Missing payment_link
      };

      (provider as any).request.mockResolvedValueOnce(mockPaymentLinkResponse);

      const status = await provider.getPaymentStatus('pl_test_invalid');

      expect(status).toBe('pending');
    });

    it('should handle errors gracefully and return pending', async () => {
      const error = new Error('Network error');
      (provider as any).request.mockRejectedValue(error);

      const status = await provider.getPaymentStatus('pl_test_error');

      expect(status).toBe('pending');
      expect(mockLogger.error).toHaveBeenCalledWith(
        '[SquareProvider] Error checking status:',
        error
      );
    });

    it('should handle order API errors gracefully', async () => {
      const mockPaymentLinkResponse = {
        payment_link: {
          id: 'pl_test_order_error',
          order_id: 'order_error_123'
        }
      };

      const orderError = new Error('Order not found');

      (provider as any).request
        .mockResolvedValueOnce(mockPaymentLinkResponse)
        .mockRejectedValueOnce(orderError);

      const status = await provider.getPaymentStatus('pl_test_order_error');

      expect(status).toBe('pending');
      expect(mockLogger.error).toHaveBeenCalledWith(
        '[SquareProvider] Error checking status:',
        orderError
      );
    });

    it('should handle missing net_amount_due_money gracefully', async () => {
      const mockPaymentLinkResponse = {
        payment_link: {
          id: 'pl_test_no_amount',
          order_id: 'order_no_amount_123'
        }
      };

      const mockOrderResponse = {
        order: {
          id: 'order_no_amount_123',
          state: 'OPEN'
          // Missing net_amount_due_money
        }
      };

      (provider as any).request
        .mockResolvedValueOnce(mockPaymentLinkResponse)
        .mockResolvedValueOnce(mockOrderResponse);

      const status = await provider.getPaymentStatus('pl_test_no_amount');

      expect(status).toBe('pending');
    });

    it('should handle unknown order states as pending', async () => {
      const mockPaymentLinkResponse = {
        payment_link: {
          id: 'pl_test_unknown',
          order_id: 'order_unknown_123'
        }
      };

      const mockOrderResponse = {
        order: {
          id: 'order_unknown_123',
          state: 'UNKNOWN_STATE',
          net_amount_due_money: {
            amount: 1000,
            currency: 'USD'
          }
        }
      };

      (provider as any).request
        .mockResolvedValueOnce(mockPaymentLinkResponse)
        .mockResolvedValueOnce(mockOrderResponse);

      const status = await provider.getPaymentStatus('pl_test_unknown');

      expect(status).toBe('pending');
    });
  });

  describe('createSquareProvider factory function', () => {
    it('should create Square provider instance', () => {
      const opts = {
        accessToken: 'factory_token',
        locationId: 'factory_location',
        sandbox: true,
        apiVersion: '2024-06-01',
        logger: mockLogger
      };

      const provider = createSquareProvider(opts);

      expect(provider).toBeInstanceOf(SquareProvider);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        '[SquareProvider] ready - locationId: factory_location, apiVersion: 2024-06-01'
      );
    });
  });

  describe('error handling and edge cases', () => {
    beforeEach(() => {
      provider = new SquareProvider({
        accessToken: 'sq_access_token_123',
        locationId: 'location_456',
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

    it('should log debug information during payment creation', async () => {
      const mockResponse = {
        payment_link: { id: 'pl_debug', url: 'https://checkout.square.com/debug' }
      };

      vi.spyOn(provider as any, 'request').mockResolvedValue(mockResponse);

      await provider.createPayment(15.75, 'CAD', 'Debug test');

      expect(mockLogger.debug).toHaveBeenCalledWith(
        '[SquareProvider] createPayment 15.75 CAD (1575) "Debug test"'
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('[SquareProvider] Sending payload:')
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        '[SquareProvider] Location ID in payload: location_456'
      );
    });
  });
});