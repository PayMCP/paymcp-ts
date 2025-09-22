import { describe, it, expect, vi } from 'vitest';
import { buildProviders } from '../../src/providers/index';

describe('Provider Builder', () => {
  describe('buildProviders', () => {
    it('should build stripe provider', () => {
      const providers = buildProviders({
        stripe: { apiKey: 'sk_test_123' }
      });
      
      expect(providers.stripe).toBeDefined();
      expect(providers.stripe.getName()).toBe('stripe');
    });

    it('should build paypal provider', () => {
      const providers = buildProviders({
        paypal: { apiKey: 'client:secret:sandbox' }
      });
      
      expect(providers.paypal).toBeDefined();
      expect(providers.paypal.getName()).toBe('paypal');
    });

    it('should build square provider', () => {
      const providers = buildProviders({
        square: { apiKey: 'token:location:sandbox' }
      });
      
      expect(providers.square).toBeDefined();
      expect(providers.square.getName()).toBe('square');
    });

    it('should build adyen provider', () => {
      const providers = buildProviders({
        adyen: { apiKey: 'key:merchant:sandbox' }
      });
      
      expect(providers.adyen).toBeDefined();
      expect(providers.adyen.getName()).toBe('adyen');
    });

    it('should build coinbase provider', () => {
      const providers = buildProviders({
        coinbase: { apiKey: 'test_key' }
      });
      
      expect(providers.coinbase).toBeDefined();
      expect(providers.coinbase.getName()).toBe('coinbase');
    });

    it('should build walleot provider', () => {
      const providers = buildProviders({
        walleot: { apiKey: 'test_key' }
      });
      
      expect(providers.walleot).toBeDefined();
      expect(providers.walleot.getName()).toBe('walleot');
    });

    it('should build multiple providers', () => {
      const providers = buildProviders({
        stripe: { apiKey: 'sk_test_123' },
        paypal: { apiKey: 'client:secret:sandbox' },
        square: { apiKey: 'token:location:sandbox' }
      });
      
      expect(Object.keys(providers)).toHaveLength(3);
      expect(providers.stripe).toBeDefined();
      expect(providers.paypal).toBeDefined();
      expect(providers.square).toBeDefined();
    });

    it('should handle empty configuration', () => {
      const providers = buildProviders({});
      
      expect(providers).toEqual({});
      expect(Object.keys(providers)).toHaveLength(0);
    });

    it('should throw for unknown provider', () => {
      expect(() => {
        buildProviders({
          unknown_provider: { apiKey: 'test' }
        } as any);
      }).toThrow('Unknown provider: unknown_provider');
    });

    it('should pass logger to providers if provided', () => {
      const logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const providers = buildProviders({
        stripe: { apiKey: 'sk_test_123', logger }
      });
      
      expect(providers.stripe).toBeDefined();
      // Logger should have been used during initialization
      expect(logger.debug).toHaveBeenCalled();
    });

    it('should create provider even with missing apiKey', () => {
      // The buildProviders function doesn't validate apiKey presence,
      // it passes the options to the provider constructor which accepts undefined
      const providers = buildProviders({
        stripe: {} as any
      });
      expect(providers.stripe).toBeDefined();
      expect(providers.stripe.getName()).toBe('stripe');
    });

    it('should handle provider with invalid configuration', () => {
      expect(() => {
        buildProviders({
          paypal: { apiKey: 'invalid' } // Missing required parts
        });
      }).toThrow();
    });
  });
});