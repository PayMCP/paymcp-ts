import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StripeProvider } from '../../src/providers/stripe';

describe('StripeProvider', () => {
  let provider: StripeProvider;
  let fetchSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Best practice: Use vi.spyOn for cleaner mocking
    fetchSpy = vi.spyOn(global, 'fetch');

    provider = new StripeProvider({
      apiKey: 'sk_test_123456',
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    });
  });

  afterEach(() => {
    if (fetchSpy) {
      fetchSpy.mockRestore();
    }
  });

  describe('constructor', () => {
    it('should initialize with provided options', () => {
      expect(provider.getName()).toBe('stripe');
    });

    it('should use default URLs if not provided', () => {
      const defaultProvider = new StripeProvider({
        apiKey: 'sk_test_123456',
      });
      expect(defaultProvider).toBeDefined();
    });
  });

  describe('getName', () => {
    it('should return provider name', () => {
      expect(provider.getName()).toBe('stripe');
    });
  });

  describe('createPayment', () => {
    it('should throw error when session response is missing id', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ url: 'https://checkout.stripe.com/pay/cs_test' }), // Missing id
      } as Response);

      await expect(provider.createPayment(10, 'USD', 'Test payment')).rejects.toThrow(
        'Invalid response from /checkout/sessions (missing id/url)'
      );
    });

    it('should throw error when session response is missing url', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'cs_test123' }), // Missing url
      } as Response);

      await expect(provider.createPayment(10, 'USD', 'Test payment')).rejects.toThrow(
        'Invalid response from /checkout/sessions (missing id/url)'
      );
    });

    it('should create a checkout session successfully', async () => {
      const mockResponse = {
        id: 'cs_test_123',
        url: 'https://checkout.stripe.com/pay/cs_test_123',
      };

      // Simple mock - only mock what we need
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await provider.createPayment(10.0, 'USD', 'Test payment');

      expect(result).toEqual({
        paymentId: 'cs_test_123',
        paymentUrl: 'https://checkout.stripe.com/pay/cs_test_123',
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.stripe.com/v1/checkout/sessions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer sk_test_123456',
            'Content-Type': 'application/x-www-form-urlencoded',
          }),
        })
      );
    });

    it('should handle API errors', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Bad Request',
      } as Response);

      await expect(provider.createPayment(10.0, 'USD', 'Test payment')).rejects.toThrow('HTTP 400');
    });

    it('should handle network errors', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('Network error'));

      await expect(provider.createPayment(10.0, 'USD', 'Test payment')).rejects.toThrow(
        'Network error'
      );
    });

    it('should convert amount to cents correctly', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'cs_test_123',
          url: 'https://checkout.stripe.com/pay/cs_test_123',
        }),
      } as Response);

      await provider.createPayment(10.99, 'USD', 'Test payment');

      const call = fetchSpy.mock.calls[0];
      const body = call[1]?.body as URLSearchParams;

      // URL encoding changes brackets to %5B and %5D
      expect(body.toString()).toContain('line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=1099');
    });
  });

  describe('getPaymentStatus', () => {
    it('should retrieve payment status successfully', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          payment_status: 'paid',
        }),
      } as Response);

      const status = await provider.getPaymentStatus('cs_test_123');

      expect(status).toBe('paid');
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.stripe.com/v1/checkout/sessions/cs_test_123',
        expect.objectContaining({
          method: 'GET',
        })
      );
    });

    it('should handle unpaid status', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          payment_status: 'unpaid',
        }),
      } as Response);

      const status = await provider.getPaymentStatus('cs_test_123');

      expect(status).toBe('unpaid');
    });

    it('should handle expired sessions', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          payment_status: 'expired',
        }),
      } as Response);

      const status = await provider.getPaymentStatus('cs_test_123');

      expect(status).toBe('expired');
    });

    it('should handle API errors', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => 'Not Found',
      } as Response);

      await expect(provider.getPaymentStatus('cs_test_123')).rejects.toThrow('HTTP 404');
    });
  });

  describe('buildHeaders', () => {
    it('should build correct headers', () => {
      const headers = (provider as any).buildHeaders();

      expect(headers).toEqual({
        Authorization: 'Bearer sk_test_123456',
        'Content-Type': 'application/x-www-form-urlencoded',
      });
    });
  });
});
