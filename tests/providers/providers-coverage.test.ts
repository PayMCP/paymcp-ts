import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AdyenProvider } from '../../src/providers/adyen';
import { CoinbaseProvider } from '../../src/providers/coinbase';
import { PayPalProvider } from '../../src/providers/paypal';
import { SquareProvider } from '../../src/providers/square';
import { StripeProvider } from '../../src/providers/stripe';
import { BasePaymentProvider } from '../../src/providers/base';

// Mock fetch globally
const originalFetch = global.fetch;
beforeEach(() => {
  global.fetch = vi.fn();
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('Providers - Coverage Tests', () => {
  describe('AdyenProvider - Uncovered Lines', () => {
    it('should handle createPayment error with non-Error object', async () => {
      const provider = new AdyenProvider({ apiKey: 'test_key' });

      // Mock fetch to throw a non-Error object
      (global.fetch as vi.Mock).mockRejectedValueOnce({ message: 'Network error' });

      await expect(provider.createPayment(10, 'USD', 'Test')).rejects.toThrow('Network error');
    });

    it('should handle createPayment error with string', async () => {
      const provider = new AdyenProvider({ apiKey: 'test_key' });

      // Mock fetch to throw a string
      (global.fetch as vi.Mock).mockRejectedValueOnce('String error');

      await expect(provider.createPayment(10, 'USD', 'Test')).rejects.toThrow('String error');
    });
  });

  describe('CoinbaseProvider - Uncovered Lines', () => {
    it('should handle getPaymentStatus with confirmOnPending true and PENDING status', async () => {
      const provider = new CoinbaseProvider({
        apiKey: 'test_key',
        confirmOnPending: true,
      });

      (global.fetch as vi.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            id: 'CHARGE123',
            timeline: [{ status: 'PENDING' }],
          },
        }),
      });

      const status = await provider.getPaymentStatus('CHARGE123');
      expect(status).toBe('paid'); // PENDING treated as paid when confirmOnPending is true
    });

    it('should handle getPaymentStatus with multiple timeline entries', async () => {
      const provider = new CoinbaseProvider({ apiKey: 'test_key' });

      (global.fetch as vi.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            id: 'CHARGE123',
            timeline: [{ status: 'NEW' }, { status: 'PENDING' }, { status: 'COMPLETED' }],
          },
        }),
      });

      const status = await provider.getPaymentStatus('CHARGE123');
      expect(status).toBe('paid'); // Should use last status (COMPLETED)
    });

    it('should handle getPaymentStatus with empty timeline', async () => {
      const provider = new CoinbaseProvider({ apiKey: 'test_key' });

      (global.fetch as vi.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            id: 'CHARGE123',
            timeline: [],
          },
        }),
      });

      const status = await provider.getPaymentStatus('CHARGE123');
      expect(status).toBe('pending'); // Default when no timeline
    });

    it('should handle getPaymentStatus with EXPIRED status', async () => {
      const provider = new CoinbaseProvider({ apiKey: 'test_key' });

      (global.fetch as vi.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            id: 'CHARGE123',
            timeline: [{ status: 'EXPIRED' }],
          },
        }),
      });

      const status = await provider.getPaymentStatus('CHARGE123');
      expect(status).toBe('failed'); // EXPIRED maps to failed in Coinbase
    });
  });

  describe('PayPalProvider - Uncovered Lines', () => {
    it('should handle getPaymentStatus with auto-capture and purchase_units', async () => {
      const provider = new PayPalProvider({
        apiKey: 'CLIENT_ID:SECRET',
        autoCapture: true,
      });

      // Mock access token fetch
      (global.fetch as vi.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'test_token' }),
        })
        // Mock order details fetch - APPROVED status
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: 'ORDER123',
            status: 'APPROVED',
            purchase_units: [
              {
                payments: {
                  captures: [],
                },
              },
            ],
          }),
        })
        // Mock access token fetch for capture request
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'test_token' }),
        })
        // Mock capture request
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            status: 'COMPLETED',
            purchase_units: [
              {
                payments: {
                  captures: [{ status: 'COMPLETED' }],
                },
              },
            ],
          }),
        });

      const status = await provider.getPaymentStatus('ORDER123');
      expect(status).toBe('paid');
    });

    it('should handle capture with missing purchase_units in response', async () => {
      const provider = new PayPalProvider({
        apiKey: 'CLIENT_ID:SECRET',
        autoCapture: true,
      });

      // Mock access token fetch
      (global.fetch as vi.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'test_token' }),
        })
        // Mock order details fetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: 'ORDER123',
            status: 'APPROVED',
            purchase_units: [{ payments: { captures: [] } }],
          }),
        })
        // Mock access token fetch for capture request
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'test_token' }),
        })
        // Mock capture response without purchase_units
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ status: 'COMPLETED' }),
        });

      const status = await provider.getPaymentStatus('ORDER123');
      expect(status).toBe('paid'); // Falls back to top-level status
    });

    it('should handle capture with null captures array', async () => {
      const provider = new PayPalProvider({
        apiKey: 'CLIENT_ID:SECRET',
        autoCapture: true,
      });

      // Mock access token fetch
      (global.fetch as vi.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'test_token' }),
        })
        // Mock order details fetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: 'ORDER123',
            status: 'APPROVED',
            purchase_units: [{ payments: { captures: [] } }],
          }),
        })
        // Mock access token fetch for capture request
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'test_token' }),
        })
        // Mock capture response with null captures
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            status: 'COMPLETED',
            purchase_units: [{ payments: { captures: null } }],
          }),
        });

      const status = await provider.getPaymentStatus('ORDER123');
      expect(status).toBe('paid');
    });
  });

  describe('SquareProvider - Uncovered Lines', () => {
    it('should handle getPaymentStatus with COMPLETED state', async () => {
      const provider = new SquareProvider({ apiKey: 'test_key:location:sandbox' });

      (global.fetch as vi.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            payment_link: {
              order_id: 'order_123',
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            order: {
              state: 'COMPLETED',
              net_amount_due_money: { amount: 100 },
            },
          }),
        });

      const status = await provider.getPaymentStatus('pl_123');
      expect(status).toBe('paid');
    });
  });

  describe('StripeProvider - Uncovered Lines', () => {
    it('should handle createPayment with redirect URL in production', async () => {
      const provider = new StripeProvider({
        apiKey: 'sk_live_test',
        redirectUrl: 'https://example.com/success',
      });

      (global.fetch as vi.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'cs_test123',
          url: 'https://checkout.stripe.com/test123',
        }),
      });

      const result = await provider.createPayment(10, 'USD', 'Test');

      expect(result.paymentId).toBe('cs_test123');
      expect(result.paymentUrl).toBe('https://checkout.stripe.com/test123');
    });
  });

  describe('BasePaymentProvider - Uncovered Lines', () => {
    it('should handle GET request with URLSearchParams already in URL', async () => {
      class TestProvider extends BasePaymentProvider {
        getName() {
          return 'test';
        }
        async createPayment() {
          return { paymentId: '1', paymentUrl: 'url' };
        }
        async getPaymentStatus() {
          return 'paid';
        }
      }

      const provider = new TestProvider('key');

      (global.fetch as vi.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const result = await provider.request('GET', 'https://api.test.com/data?existing=param', {
        new: 'value',
      });

      // Check that URL was constructed correctly
      const fetchCall = (global.fetch as vi.Mock).mock.calls[0];
      expect(fetchCall[0]).toContain('existing=param');
      expect(fetchCall[0]).toContain('new=value');
    });
  });
});
