/**
 * @fileoverview Tests for core PayMCP functionality
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PayMCP } from '../../src/core/PayMCP.js';
import { PaymentFlow } from '../../src/types/payment.js';
import type { McpServerLike } from '../../src/types/mcp.js';
import type { PayMCPOptions } from '../../src/types/config.js';

// Mock providers
vi.mock('../../src/providers/stripe', () => ({
  StripeProvider: vi.fn().mockImplementation(() => ({
    getName: () => 'stripe',
    createPayment: vi.fn().mockResolvedValue({
      paymentId: 'pi_test123',
      paymentUrl: 'https://checkout.stripe.com/pay/cs_test123'
    }),
    getPaymentStatus: vi.fn().mockResolvedValue('pending'),
    buildHeaders: vi.fn().mockReturnValue({})
  }))
}));

describe('PayMCP', () => {
  let mockServer: anyed<McpServerLike>;
  let basicConfig: PayMCPOptions;
  let paymcpInstances: PayMCP[] = [];

  beforeEach(() => {
    mockServer = {
      registerTool: vi.fn(),
      reportProgress: vi.fn(),
      requestElicitation: vi.fn()
    } as any;

    basicConfig = {
      providers: {
        stripe: {
          apiKey: 'sk_test_123'
        }
      }
    };
    
    paymcpInstances = [];
  });

  afterEach(() => {
    // Clean up all PayMCP instances
    paymcpInstances.forEach(instance => {
      if (instance && typeof instance.uninstall === 'function') {
        instance.uninstall();
      }
    });
    paymcpInstances = [];
    vi.clearAllMocks();
  });
  
  // Helper to create PayMCP and track for cleanup
  const createPayMCP = (server: any, config: PayMCPOptions) => {
    const instance = new PayMCP(server, config);
    paymcpInstances.push(instance);
    return instance;
  };

  describe('constructor', () => {
    it('should initialize with default configuration', () => {
      const paymcp = createPayMCP(mockServer, basicConfig);

      expect(paymcp).toBeDefined();
      expect(paymcp.getServer()).toBe(mockServer);
    });

    it('should initialize with custom payment flow', () => {
      const configWithFlow: PayMCPOptions = {
        ...basicConfig,
        paymentFlow: PaymentFlow.PROGRESS
      };

      const paymcp = createPayMCP(mockServer, configWithFlow);

      expect(paymcp).toBeDefined();
    });

    it('should handle multiple providers', () => {
      const multiProviderConfig: PayMCPOptions = {
        providers: {
          stripe: { apiKey: 'sk_test_stripe' },
          paypal: { apiKey: 'client_id:client_secret' }
        }
      };

      const paymcp = createPayMCP(mockServer, multiProviderConfig);

      expect(paymcp).toBeDefined();
    });

    it('should handle empty providers configuration', () => {
      const emptyConfig: PayMCPOptions = {
        providers: {}
      };

      const paymcp = createPayMCP(mockServer, emptyConfig);

      expect(paymcp).toBeDefined();
    });

    it('should use default payment flow when not specified', () => {
      const paymcp = createPayMCP(mockServer, basicConfig);

      expect(paymcp).toBeDefined();
      // Default should be TWO_STEP
    });

    it('should handle implemented payment flow types', () => {
      const flows = [
        PaymentFlow.TWO_STEP,
        PaymentFlow.ELICITATION,
        PaymentFlow.PROGRESS
        // OOB is not implemented yet
      ];

      flows.forEach(flow => {
        const config: PayMCPOptions = {
          ...basicConfig,
          paymentFlow: flow
        };

        expect(() => createPayMCP(mockServer, config)).not.toThrow();
      });
    });

    it('should throw for unimplemented OOB flow', () => {
      const config: PayMCPOptions = {
        ...basicConfig,
        paymentFlow: PaymentFlow.OOB
      };

      expect(() => createPayMCP(mockServer, config)).toThrow('Unknown payment flow: OOB');
    });
  });

  describe('payment flow selection', () => {
    it('should handle TWO_STEP flow', () => {
      const config: PayMCPOptions = {
        ...basicConfig,
        paymentFlow: PaymentFlow.TWO_STEP
      };

      const paymcp = createPayMCP(mockServer, config);
      expect(paymcp).toBeDefined();
    });

    it('should handle ELICITATION flow', () => {
      const config: PayMCPOptions = {
        ...basicConfig,
        paymentFlow: PaymentFlow.ELICITATION
      };

      const paymcp = createPayMCP(mockServer, config);
      expect(paymcp).toBeDefined();
    });

    it('should handle PROGRESS flow', () => {
      const config: PayMCPOptions = {
        ...basicConfig,
        paymentFlow: PaymentFlow.PROGRESS
      };

      const paymcp = createPayMCP(mockServer, config);
      expect(paymcp).toBeDefined();
    });

    it('should throw for OOB flow (not implemented)', () => {
      const config: PayMCPOptions = {
        ...basicConfig,
        paymentFlow: PaymentFlow.OOB
      };

      expect(() => createPayMCP(mockServer, config)).toThrow('Unknown payment flow: OOB');
    });
  });

  describe('provider configuration', () => {
    it('should handle stripe provider configuration', () => {
      const config: PayMCPOptions = {
        providers: {
          stripe: {
            apiKey: 'sk_test_stripe_key'
          }
        }
      };

      const paymcp = createPayMCP(mockServer, config);
      expect(paymcp).toBeDefined();
    });

    it('should handle paypal provider configuration', () => {
      const config: PayMCPOptions = {
        providers: {
          paypal: {
            apiKey: 'client_id:client_secret:sandbox'
          }
        }
      };

      const paymcp = createPayMCP(mockServer, config);
      expect(paymcp).toBeDefined();
    });

    it('should handle square provider configuration', () => {
      const config: PayMCPOptions = {
        providers: {
          square: {
            apiKey: 'sandbox_token:location_id:sandbox'
          }
        }
      };

      const paymcp = createPayMCP(mockServer, config);
      expect(paymcp).toBeDefined();
    });

    it('should handle adyen provider configuration', () => {
      const config: PayMCPOptions = {
        providers: {
          adyen: {
            apiKey: 'test_api_key:test_merchant:sandbox'
          }
        }
      };

      const paymcp = createPayMCP(mockServer, config);
      expect(paymcp).toBeDefined();
    });

    it('should handle coinbase provider configuration', () => {
      const config: PayMCPOptions = {
        providers: {
          coinbase: {
            apiKey: 'test_coinbase_api_key'
          }
        }
      };

      const paymcp = createPayMCP(mockServer, config);
      expect(paymcp).toBeDefined();
    });

    it('should handle walleot provider configuration', () => {
      const config: PayMCPOptions = {
        providers: {
          walleot: {
            apiKey: 'test_walleot_key'
          }
        }
      };

      const paymcp = createPayMCP(mockServer, config);
      expect(paymcp).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('should handle invalid provider configuration gracefully', () => {
      const invalidConfig: PayMCPOptions = {
        providers: {
          invalid_provider: {
            apiKey: 'test_key'
          }
        } as any
      };

      expect(() => createPayMCP(mockServer, invalidConfig)).toThrow();
    });

    it('should handle missing server parameter', () => {
      expect(() => createPayMCP(null as any, basicConfig)).toThrow();
    });

    it('should handle missing config parameter', () => {
      expect(() => createPayMCP(mockServer, null as any)).toThrow();
    });

    it('should handle undefined config', () => {
      expect(() => createPayMCP(mockServer, undefined as any)).toThrow();
    });
  });

  describe('integration', () => {
    it('should integrate with server registration', () => {
      // Reset the mock to track calls
      mockServer.registerTool.mockClear();

      const paymcp = createPayMCP(mockServer, basicConfig);

      // PayMCP patches registerTool, so the original should have been stored
      expect(paymcp).toBeDefined();
      expect(paymcp.getServer()).toBe(mockServer);
    });

    it('should handle complex configurations', () => {
      const complexConfig: PayMCPOptions = {
        providers: {
          stripe: { apiKey: 'sk_test_stripe' },
          paypal: { apiKey: 'paypal_client:paypal_secret:sandbox' },
          square: { apiKey: 'square_token:location_123:sandbox' }
        },
        paymentFlow: PaymentFlow.ELICITATION
      };

      const paymcp = createPayMCP(mockServer, complexConfig);
      expect(paymcp).toBeDefined();
    });

    it('should maintain server reference', () => {
      const paymcp = createPayMCP(mockServer, basicConfig);

      expect(paymcp.getServer()).toBe(mockServer);
    });
  });

  describe('edge cases', () => {
    it('should handle empty provider objects', () => {
      const config: PayMCPOptions = {
        providers: {
          stripe: {} as any
        }
      };

      // Providers don't validate apiKey, they accept undefined
      const paymcp = createPayMCP(mockServer, config);
      expect(paymcp).toBeDefined();
    });

    it('should handle null payment flow', () => {
      const config: PayMCPOptions = {
        ...basicConfig,
        paymentFlow: null as any
      };

      const paymcp = createPayMCP(mockServer, config);
      expect(paymcp).toBeDefined();
    });

    it('should handle very large provider configurations', () => {
      const largeConfig: PayMCPOptions = {
        providers: {}
      };

      // Add many provider configurations
      for (let i = 0; i < 100; i++) {
        (largeConfig.providers as any)[`provider_${i}`] = {
          apiKey: `key_${i}`
        };
      }

      // Should handle gracefully even if providers are invalid
      expect(() => createPayMCP(mockServer, largeConfig)).toThrow();
    });
  });
});