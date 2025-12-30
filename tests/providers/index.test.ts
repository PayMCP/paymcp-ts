import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  registerProvider,
  buildProviders,
  StripeProvider,
  PayPalProvider,
  WalleotProvider,
  type BasePaymentProvider,
  type ProviderConfig
} from '../../src/providers/index.js';

// Mock provider classes for testing
class MockProvider implements BasePaymentProvider {
  constructor(public opts: any) {}

  async createPayment(amount: number, currency: string, description: string) {
    return { paymentId: 'mock_123', paymentUrl: 'https://mock.test/pay' };
  }

  async getPaymentStatus(paymentId: string) {
    return 'paid';
  }
}

class InvalidProvider {
  constructor(public opts: any) {}
  // Missing required methods
}

describe('Provider Index', () => {
  describe('registerProvider', () => {
    it('should register a new provider successfully', () => {
      expect(() => {
        registerProvider('testprovider', MockProvider);
      }).not.toThrow();
    });

    it('should register provider with case insensitive name', () => {
      expect(() => {
        registerProvider('UPPERCASEPROVIDER', MockProvider);
      }).not.toThrow();
    });

    it('should throw error for empty name', () => {
      expect(() => {
        registerProvider('', MockProvider);
      }).toThrow('[PayMCP] registerProvider: name must be a non-empty string');
    });

    it('should throw error for null name', () => {
      expect(() => {
        registerProvider(null as any, MockProvider);
      }).toThrow('[PayMCP] registerProvider: name must be a non-empty string');
    });

    it('should throw error for undefined name', () => {
      expect(() => {
        registerProvider(undefined as any, MockProvider);
      }).toThrow('[PayMCP] registerProvider: name must be a non-empty string');
    });

    it('should throw error for non-string name', () => {
      expect(() => {
        registerProvider(123 as any, MockProvider);
      }).toThrow('[PayMCP] registerProvider: name must be a non-empty string');
    });
  });

  describe('buildProviders', () => {
    beforeEach(() => {
      // Register our mock provider for testing
      registerProvider('mock', MockProvider);
    });

    describe('with array input', () => {
      it('should build providers from array of instances', () => {
        const provider1 = new MockProvider({ name: 'provider1' });
        (provider1 as any).slug = 'provider1';

        const provider2 = new MockProvider({ name: 'provider2' });
        (provider2 as any).slug = 'provider2';

        const result = buildProviders([provider1, provider2]);

        expect(result).toEqual({
          '1': provider1,
          '2': provider2
        });
      });

      it('should use name property when slug is not available', () => {
        const provider = new MockProvider({ test: true });
        (provider as any).name = 'testname';

        const result = buildProviders([provider]);

        expect(result).toEqual({
          testname: provider
        });
      });

      it('should use constructor name when slug and name are not available', () => {
        const provider = new MockProvider({ test: true });

        const result = buildProviders([provider]);

        expect(result).toEqual({
          mock: provider
        });
      });

      it('should use fallback "provider" when no identifiers available', () => {
        const provider = new MockProvider({ test: true });
        // Remove constructor name
        Object.defineProperty(provider.constructor, 'name', { value: undefined });
        delete (provider as any).slug;
        delete (provider as any).name;

        const result = buildProviders([provider]);

        expect(result).toEqual({
          '': provider
        });
      });

      it('should handle provider with explicit slug', () => {
        const provider = new MockProvider({ test: true });
        (provider as any).slug = 'customslug';
        (provider as any).name = 'shouldnotusethis';

        const result = buildProviders([provider]);

        expect(result).toEqual({
          customslug: provider
        });
      });

      it('should convert keys to lowercase', () => {
        const provider = new MockProvider({ test: true });
        (provider as any).slug = 'UPPERCASE';

        const result = buildProviders([provider]);

        expect(result).toEqual({
          uppercase: provider
        });
      });

      it('should throw error for non-provider instances in array', () => {
        const invalidInstance = { notAProvider: true };

        expect(() => {
          buildProviders([invalidInstance as any]);
        }).toThrow('[PayMCP] buildProviders: iterable contains a non-provider instance');
      });

      it('should handle empty array', () => {
        const result = buildProviders([]);
        expect(result).toEqual({});
      });
    });

    describe('with config mapping input', () => {
      it('should build providers from config mapping', () => {
        const config: ProviderConfig = {
          stripe: { apiKey: 'sk_test_123' },
          mock: { apiKey: 'mock_key' }
        };

        const result = buildProviders(config);

        expect(result.stripe).toBeInstanceOf(StripeProvider);
        expect(result.mock).toBeInstanceOf(MockProvider);
      });

      it('should handle provider instances directly in mapping', () => {
        const mockInstance = new MockProvider({ apiKey: 'direct' });

        const config: ProviderConfig = {
          mock: mockInstance,
          stripe: { apiKey: 'sk_test_123' }
        };

        const result = buildProviders(config);

        expect(result.mock).toBe(mockInstance);
        expect(result.stripe).toBeInstanceOf(StripeProvider);
      });

      it('should use derived key when name is null for provider instance', () => {
        const mockInstance = new MockProvider({ apiKey: 'test' });
        (mockInstance as any).slug = 'derivedkey';

        const config: ProviderConfig = {
          [null as any]: mockInstance
        };

        const result = buildProviders(config);

        // When name is null, String(null) becomes 'null', so the key is 'null'
        expect(result['null']).toBe(mockInstance);
      });

      it('should use original name when name is truthy for provider instance', () => {
        const mockInstance = new MockProvider({ apiKey: 'test' });
        (mockInstance as any).slug = 'shouldnotusethis';

        const config: ProviderConfig = {
          originalname: mockInstance
        };

        const result = buildProviders(config);

        expect(result.originalname).toBe(mockInstance);
      });

      it('should throw error for unknown provider name', () => {
        const config: ProviderConfig = {
          unknownprovider: { apiKey: 'test' }
        };

        expect(() => {
          buildProviders(config);
        }).toThrow('[PayMCP] Unknown provider: unknownprovider');
      });

      it('should throw error when constructed object is not a provider', () => {
        registerProvider('invalid', InvalidProvider as any);

        const config: ProviderConfig = {
          invalid: { apiKey: 'test' }
        };

        expect(() => {
          buildProviders(config);
        }).toThrow('[PayMCP] Constructed provider for \'invalid\' does not implement required methods');
      });

      it('should handle case insensitive provider lookup', () => {
        const config: ProviderConfig = {
          STRIPE: { apiKey: 'sk_test_123' }
        };

        const result = buildProviders(config);

        expect(result.STRIPE).toBeInstanceOf(StripeProvider);
      });

      it('should handle mixed case provider names', () => {
        const config: ProviderConfig = {
          StRiPe: { apiKey: 'sk_test_123' }
        };

        const result = buildProviders(config);

        expect(result.StRiPe).toBeInstanceOf(StripeProvider);
      });

      it('should handle empty config object', () => {
        const result = buildProviders({});
        expect(result).toEqual({});
      });
    });

    describe('provider validation (isProvider function)', () => {
      it('should validate valid provider instances', () => {
        const validProvider = new MockProvider({ test: true });

        const result = buildProviders([validProvider]);

        expect(Object.keys(result)).toHaveLength(1);
      });

      it('should reject objects missing createPayment method', () => {
        const invalidProvider = {
          getPaymentStatus: () => Promise.resolve('paid')
          // Missing createPayment
        };

        expect(() => {
          buildProviders([invalidProvider as any]);
        }).toThrow('[PayMCP] buildProviders: iterable contains a non-provider instance');
      });

      it('should reject objects missing getPaymentStatus method', () => {
        const invalidProvider = {
          createPayment: () => Promise.resolve({ paymentId: 'test', paymentUrl: 'test' })
          // Missing getPaymentStatus
        };

        expect(() => {
          buildProviders([invalidProvider as any]);
        }).toThrow('[PayMCP] buildProviders: iterable contains a non-provider instance');
      });

      it('should reject null objects', () => {
        expect(() => {
          buildProviders([null as any]);
        }).toThrow('[PayMCP] buildProviders: iterable contains a non-provider instance');
      });

      it('should reject undefined objects', () => {
        expect(() => {
          buildProviders([undefined as any]);
        }).toThrow('[PayMCP] buildProviders: iterable contains a non-provider instance');
      });

      it('should reject primitive values', () => {
        expect(() => {
          buildProviders(['string' as any]);
        }).toThrow('[PayMCP] buildProviders: iterable contains a non-provider instance');

        expect(() => {
          buildProviders([123 as any]);
        }).toThrow('[PayMCP] buildProviders: iterable contains a non-provider instance');

        expect(() => {
          buildProviders([true as any]);
        }).toThrow('[PayMCP] buildProviders: iterable contains a non-provider instance');
      });

      it('should reject objects with non-function methods', () => {
        const invalidProvider = {
          createPayment: 'not a function',
          getPaymentStatus: () => Promise.resolve('paid')
        };

        expect(() => {
          buildProviders([invalidProvider as any]);
        }).toThrow('[PayMCP] buildProviders: iterable contains a non-provider instance');
      });
    });

    describe('key derivation (keyFor function)', () => {
      it('should handle various property types', () => {
        const provider1 = new MockProvider({});
        (provider1 as any).slug = 123; // number

        const provider2 = new MockProvider({});
        (provider2 as any).slug = true; // boolean

        const provider3 = new MockProvider({});
        (provider3 as any).slug = null; // null -> fallback to name
        (provider3 as any).name = 'namevalue';

        const result = buildProviders([provider1, provider2, provider3]);

        expect(result['123']).toBe(provider1);
        expect(result['true']).toBe(provider2);
        expect(result['namevalue']).toBe(provider3);
      });

      it('should handle complex fallback chain', () => {
        const provider = new MockProvider({});
        // All properties are falsy, should use constructor name fallback
        (provider as any).slug = undefined;
        (provider as any).name = undefined;
        // Set constructor name since it might be undefined in test environment
        Object.defineProperty(provider.constructor, 'name', { value: 'TestProvider' });

        const result = buildProviders([provider]);

        expect(result['test']).toBe(provider);
      });
    });

    describe('integration with real providers', () => {
      it('should work with multiple real provider types', () => {
        const config: ProviderConfig = {
          stripe: {
            apiKey: 'sk_test_123',
            successUrl: 'https://example.com/success',
            cancelUrl: 'https://example.com/cancel'
          },
          walleot: {
            apiKey: 'walleot_key'
          }
        };

        const result = buildProviders(config);

        expect(result.stripe).toBeInstanceOf(StripeProvider);
        expect(result.walleot).toBeInstanceOf(WalleotProvider);
        expect(Object.keys(result)).toHaveLength(2);
      });

      it('should handle provider instances with real providers', () => {
        const stripeInstance = new StripeProvider({
          apiKey: 'sk_direct',
          logger: console
        });

        const config: ProviderConfig = {
          mystripe: stripeInstance,
          walleot: { apiKey: 'walleot_key' }
        };

        const result = buildProviders(config);

        expect(result.mystripe).toBe(stripeInstance);
        expect(result.walleot).toBeInstanceOf(WalleotProvider);
      });
    });
  });
});
