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

  describe('getSubscriptions', () => {
    it('should return current and available subscriptions', async () => {
      // Order: prices (listAvailableSubscriptionPlans) -> customer search -> subscriptions
      (global.fetch as any)
        // Mock for prices list (called first by listAvailableSubscriptionPlans)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            data: [
              {
                id: 'price_123',
                active: true,
                currency: 'usd',
                unit_amount: 1999,
                recurring: { interval: 'month' },
                product: { id: 'prod_123', name: 'Pro Plan', description: 'Pro features', active: true }
              }
            ]
          })
        })
        // Mock for customer search
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [{ id: 'cus_123' }] })
        })
        // Mock for subscriptions list
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            data: [
              {
                id: 'sub_123',
                status: 'active',
                created: 1700000000,
                cancel_at_period_end: false,
                items: {
                  data: [
                    {
                      price: {
                        id: 'price_123',
                        currency: 'usd',
                        unit_amount: 1999,
                        recurring: { interval: 'month' }
                      }
                    }
                  ]
                }
              }
            ]
          })
        });

      const result = await provider.getSubscriptions('user123', 'test@example.com');

      expect(result.current_subscriptions).toHaveLength(1);
      expect(result.current_subscriptions[0]).toMatchObject({
        id: 'sub_123',
        status: 'active',
        planId: 'price_123'
      });
      expect(result.available_subscriptions).toHaveLength(1);
      expect(result.available_subscriptions[0]).toMatchObject({
        planId: 'price_123',
        title: 'Pro Plan',
        price: 19.99
      });
    });

    it('should filter out one-time prices from available subscriptions', async () => {
      (global.fetch as any)
        // prices first
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            data: [
              {
                id: 'price_onetime',
                active: true,
                currency: 'usd',
                unit_amount: 999,
                // No recurring field = one-time price
                product: { id: 'prod_123', name: 'One-time', active: true }
              },
              {
                id: 'price_recurring',
                active: true,
                currency: 'usd',
                unit_amount: 1999,
                recurring: { interval: 'month' },
                product: { id: 'prod_456', name: 'Monthly', active: true }
              }
            ]
          })
        })
        // customer search
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [{ id: 'cus_123' }] })
        })
        // subscriptions
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [] })
        });

      const result = await provider.getSubscriptions('user123');

      expect(result.available_subscriptions).toHaveLength(1);
      expect(result.available_subscriptions[0].planId).toBe('price_recurring');
    });

    it('should filter out inactive products', async () => {
      (global.fetch as any)
        // prices first
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            data: [
              {
                id: 'price_inactive',
                active: true,
                currency: 'usd',
                unit_amount: 999,
                recurring: { interval: 'month' },
                product: { id: 'prod_inactive', name: 'Inactive', active: false }
              }
            ]
          })
        })
        // customer search
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [{ id: 'cus_123' }] })
        })
        // subscriptions
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [] })
        });

      const result = await provider.getSubscriptions('user123');

      expect(result.available_subscriptions).toHaveLength(0);
    });
  });

  describe('startSubscription', () => {
    it('should create a checkout session for new subscription', async () => {
      // Flow: listUserSubscriptions (findOrCreateCustomer + list subs) -> findOrCreateCustomer again -> checkout
      (global.fetch as any)
        // 1. Customer search by userId (from listUserSubscriptions -> findOrCreateCustomer)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [] })
        })
        // 2. Customer search by email (from findOrCreateCustomer)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [] })
        })
        // 3. Create customer (from findOrCreateCustomer)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: 'cus_new123' })
        })
        // 4. List subscriptions (from listUserSubscriptions)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [] })
        })
        // 5. Customer search by userId again (from second findOrCreateCustomer call)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [{ id: 'cus_new123' }] })
        })
        // 6. Create checkout session
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            id: 'cs_sub_123',
            url: 'https://checkout.stripe.com/c/pay/cs_sub_123'
          })
        });

      const result = await provider.startSubscription('price_123', 'user123', 'test@example.com');

      expect(result.checkoutUrl).toBe('https://checkout.stripe.com/c/pay/cs_sub_123');
      expect(result.sessionId).toBe('cs_sub_123');
      expect(result.planId).toBe('price_123');
    });

    it('should resume existing subscription if cancel_at_period_end', async () => {
      (global.fetch as any)
        // Customer search by userId
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [{ id: 'cus_existing' }] })
        })
        // List user subscriptions
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            data: [
              {
                id: 'sub_existing',
                status: 'active',
                cancel_at_period_end: true,
                items: {
                  data: [{ price: { id: 'price_123' } }]
                }
              }
            ]
          })
        })
        // Update subscription to resume
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: 'sub_existing' })
        });

      const result = await provider.startSubscription('price_123', 'user123');

      expect(result.message).toContain('reactivated');
      expect(result.checkoutUrl).toBeUndefined();
    });

    it('should throw error when checkout session creation fails', async () => {
      // Flow: listUserSubscriptions (findOrCreateCustomer + list subs) -> findOrCreateCustomer again -> checkout
      (global.fetch as any)
        // 1. Customer search by userId (from listUserSubscriptions -> findOrCreateCustomer)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [{ id: 'cus_123' }] })
        })
        // 2. List subscriptions (from listUserSubscriptions) - no resumable
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [] })
        })
        // 3. Customer search by userId again (from second findOrCreateCustomer call)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [{ id: 'cus_123' }] })
        })
        // 4. Checkout session creation fails
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ object: 'checkout.session' }) // missing id/url
        });

      await expect(
        provider.startSubscription('price_123', 'user123')
      ).rejects.toThrow('Invalid response from /checkout/sessions');
    });
  });

  describe('cancelSubscription', () => {
    it('should schedule subscription cancellation at period end', async () => {
      const cancelAt = Math.floor(Date.now() / 1000) + 2592000; // 30 days from now

      (global.fetch as any)
        // Get subscription
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            id: 'sub_123',
            customer: 'cus_123'
          })
        })
        // Customer search
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [{ id: 'cus_123' }] })
        })
        // Update subscription
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            id: 'sub_123',
            cancel_at: cancelAt,
            cancel_at_period_end: true
          })
        });

      const result = await provider.cancelSubscription('sub_123', 'user123');

      expect(result.canceled).toBe(true);
      expect(result.endDate).toBeTruthy();
    });

    it('should throw error when subscription does not belong to user', async () => {
      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            id: 'sub_123',
            customer: 'cus_other' // different customer
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [{ id: 'cus_123' }] })
        });

      await expect(
        provider.cancelSubscription('sub_123', 'user123')
      ).rejects.toThrow('subscription does not belong to current user');
    });

    it('should handle string cancel_at value', async () => {
      const cancelAt = String(Math.floor(Date.now() / 1000) + 2592000);

      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            id: 'sub_123',
            customer: 'cus_123'
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [{ id: 'cus_123' }] })
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            id: 'sub_123',
            cancel_at: cancelAt
          })
        });

      const result = await provider.cancelSubscription('sub_123', 'user123');

      expect(result.endDate).toBeTruthy();
    });
  });

  describe('findOrCreateCustomer (private method via startSubscription)', () => {
    it('should reuse existing customer found by metadata.userId', async () => {
      // startSubscription flow: listUserSubscriptions (findOrCreate + list) -> findOrCreate again -> checkout
      (global.fetch as any)
        // 1. Customer search by userId (from listUserSubscriptions -> findOrCreateCustomer)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [{ id: 'cus_existing' }] })
        })
        // 2. List subscriptions (from listUserSubscriptions)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [] })
        })
        // 3. Customer search by userId again (from second findOrCreateCustomer)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [{ id: 'cus_existing' }] })
        })
        // 4. Create checkout session
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: 'cs_123', url: 'https://checkout.stripe.com/test' })
        });

      await provider.startSubscription('price_123', 'user123');

      // Should only have been called for customer search, not customer create
      const createCustomerCalls = (global.fetch as any).mock.calls.filter(
        (call: any[]) => call[0] === 'https://api.stripe.com/v1/customers' && call[1]?.method === 'POST'
      );
      expect(createCustomerCalls).toHaveLength(0);
    });

    it('should find customer by email and attach userId to metadata', async () => {
      (global.fetch as any)
        // 1. Search by userId - not found (from listUserSubscriptions -> findOrCreateCustomer)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [] })
        })
        // 2. Search by email - found without userId
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [{ id: 'cus_email', metadata: {} }] })
        })
        // 3. Update customer metadata
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: 'cus_email' })
        })
        // 4. List subscriptions (from listUserSubscriptions)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [] })
        })
        // 5. Search by userId again (from second findOrCreateCustomer) - now has userId
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [{ id: 'cus_email' }] })
        })
        // 6. Create checkout session
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: 'cs_123', url: 'https://checkout.stripe.com/test' })
        });

      await provider.startSubscription('price_123', 'user123', 'test@example.com');

      // Should have updated customer with userId
      const updateCall = (global.fetch as any).mock.calls.find(
        (call: any[]) => call[0].includes('/customers/cus_email') && call[1]?.method === 'POST'
      );
      expect(updateCall).toBeTruthy();
    });

    it('should throw error when email is associated with different user', async () => {
      (global.fetch as any)
        // Search by userId - not found
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [] })
        })
        // Search by email - found with different userId
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            data: [{ id: 'cus_other', metadata: { userId: 'different_user' } }]
          })
        });

      await expect(
        provider.startSubscription('price_123', 'user123', 'test@example.com')
      ).rejects.toThrow('email is already associated with a different user account');
    });

    it('should create new customer when none found', async () => {
      (global.fetch as any)
        // 1. Search by userId - not found (from listUserSubscriptions -> findOrCreateCustomer)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [] })
        })
        // 2. Search by email - not found
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [] })
        })
        // 3. Create customer
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: 'cus_new' })
        })
        // 4. List subscriptions (from listUserSubscriptions)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [] })
        })
        // 5. Search by userId again (from second findOrCreateCustomer) - now found
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [{ id: 'cus_new' }] })
        })
        // 6. Create checkout session
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: 'cs_123', url: 'https://checkout.stripe.com/test' })
        });

      await provider.startSubscription('price_123', 'user123', 'new@example.com');

      // Verify customer was created
      const createCall = (global.fetch as any).mock.calls.find(
        (call: any[]) => call[0] === 'https://api.stripe.com/v1/customers' && call[1]?.method === 'POST'
      );
      expect(createCall).toBeTruthy();
    });

    it('should throw error when customer creation fails', async () => {
      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [] })
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [] })
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({}) // missing id
        });

      await expect(
        provider.startSubscription('price_123', 'user123', 'test@example.com')
      ).rejects.toThrow('failed to create customer');
    });
  });

  describe('mapStripeSubscription (via getSubscriptions)', () => {
    it('should handle subscription with created timestamp', async () => {
      const created = 1700000000;

      // Order: prices (from listAvailableSubscriptionPlans) -> customer search -> subscriptions
      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [] }) // prices list (empty)
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [{ id: 'cus_123' }] }) // customer search
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            data: [{
              id: 'sub_123',
              status: 'active',
              created,
              cancel_at_period_end: false,
              items: { data: [{ price: { id: 'price_123', currency: 'usd', unit_amount: 999 } }] }
            }]
          })
        });

      const result = await provider.getSubscriptions('user123');

      expect(result.current_subscriptions[0].createdAt).toBe(new Date(created * 1000).toISOString());
    });

    it('should handle subscription with ended_at timestamp', async () => {
      const endedAt = 1700000000;

      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [] }) // prices
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [{ id: 'cus_123' }] }) // customer search
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            data: [{
              id: 'sub_123',
              status: 'canceled',
              ended_at: endedAt,
              items: { data: [{ price: { id: 'price_123' } }] }
            }]
          })
        });

      const result = await provider.getSubscriptions('user123');

      expect(result.current_subscriptions[0].endedAtDate).toBe(new Date(endedAt * 1000).toISOString());
    });

    it('should handle string timestamps', async () => {
      const created = '1700000000';

      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [] }) // prices
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [{ id: 'cus_123' }] }) // customer search
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            data: [{
              id: 'sub_123',
              status: 'active',
              created,
              cancel_at: '1705000000',
              ended_at: '1710000000',
              items: { data: [{ price: { id: 'price_123' } }] }
            }]
          })
        });

      const result = await provider.getSubscriptions('user123');

      expect(result.current_subscriptions[0].createdAt).toBeTruthy();
      expect(result.current_subscriptions[0].cancelAtDate).toBeTruthy();
      expect(result.current_subscriptions[0].endedAtDate).toBeTruthy();
    });

    it('should handle subscription with no items', async () => {
      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [] }) // prices
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [{ id: 'cus_123' }] }) // customer search
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            data: [{
              id: 'sub_123',
              status: 'active',
              items: { data: [] }
            }]
          })
        });

      const result = await provider.getSubscriptions('user123');

      expect(result.current_subscriptions[0].planId).toBe('');
      expect(result.current_subscriptions[0].price).toBeNull();
    });

    it('should handle null unit_amount', async () => {
      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [] }) // prices
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [{ id: 'cus_123' }] }) // customer search
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            data: [{
              id: 'sub_123',
              status: 'active',
              items: { data: [{ price: { id: 'price_123', unit_amount: null } }] }
            }]
          })
        });

      const result = await provider.getSubscriptions('user123');

      expect(result.current_subscriptions[0].price).toBeNull();
    });
  });
});