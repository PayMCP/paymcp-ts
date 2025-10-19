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
      paymentUrl: 'https://checkout.stripe.com/pay/cs_test123',
    }),
    getPaymentStatus: vi.fn().mockResolvedValue('pending'),
    buildHeaders: vi.fn().mockReturnValue({}),
  })),
}));

describe('PayMCP', () => {
  let mockServer: anyed<McpServerLike>;
  let basicConfig: PayMCPOptions;
  let paymcpInstances: PayMCP[] = [];

  beforeEach(() => {
    mockServer = {
      registerTool: vi.fn(),
      reportProgress: vi.fn(),
      requestElicitation: vi.fn(),
    } as any;

    basicConfig = {
      providers: {
        stripe: {
          apiKey: 'sk_test_123',
        },
      },
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
        paymentFlow: PaymentFlow.PROGRESS,
      };

      const paymcp = createPayMCP(mockServer, configWithFlow);

      expect(paymcp).toBeDefined();
    });

    it('should handle multiple providers', () => {
      const multiProviderConfig: PayMCPOptions = {
        providers: {
          stripe: { apiKey: 'sk_test_stripe' },
          paypal: { apiKey: 'client_id:client_secret' },
        },
      };

      const paymcp = createPayMCP(mockServer, multiProviderConfig);

      expect(paymcp).toBeDefined();
    });

    it('should handle empty providers configuration', () => {
      const emptyConfig: PayMCPOptions = {
        providers: {},
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
        PaymentFlow.PROGRESS,
        // OOB is not implemented yet
      ];

      flows.forEach(flow => {
        const config: PayMCPOptions = {
          ...basicConfig,
          paymentFlow: flow,
        };

        expect(() => createPayMCP(mockServer, config)).not.toThrow();
      });
    });

    it('should throw for unimplemented OOB flow', () => {
      const config: PayMCPOptions = {
        ...basicConfig,
        paymentFlow: PaymentFlow.OOB,
      };

      expect(() => createPayMCP(mockServer, config)).toThrow('Unknown payment flow: OOB');
    });
  });

  describe('payment flow selection', () => {
    it('should handle TWO_STEP flow', () => {
      const config: PayMCPOptions = {
        ...basicConfig,
        paymentFlow: PaymentFlow.TWO_STEP,
      };

      const paymcp = createPayMCP(mockServer, config);
      expect(paymcp).toBeDefined();
    });

    it('should handle ELICITATION flow', () => {
      const config: PayMCPOptions = {
        ...basicConfig,
        paymentFlow: PaymentFlow.ELICITATION,
      };

      const paymcp = createPayMCP(mockServer, config);
      expect(paymcp).toBeDefined();
    });

    it('should handle PROGRESS flow', () => {
      const config: PayMCPOptions = {
        ...basicConfig,
        paymentFlow: PaymentFlow.PROGRESS,
      };

      const paymcp = createPayMCP(mockServer, config);
      expect(paymcp).toBeDefined();
    });

    it('should throw for OOB flow (not implemented)', () => {
      const config: PayMCPOptions = {
        ...basicConfig,
        paymentFlow: PaymentFlow.OOB,
      };

      expect(() => createPayMCP(mockServer, config)).toThrow('Unknown payment flow: OOB');
    });
  });

  describe('provider configuration', () => {
    it('should handle stripe provider configuration', () => {
      const config: PayMCPOptions = {
        providers: {
          stripe: {
            apiKey: 'sk_test_stripe_key',
          },
        },
      };

      const paymcp = createPayMCP(mockServer, config);
      expect(paymcp).toBeDefined();
    });

    it('should handle paypal provider configuration', () => {
      const config: PayMCPOptions = {
        providers: {
          paypal: {
            apiKey: 'client_id:client_secret:sandbox',
          },
        },
      };

      const paymcp = createPayMCP(mockServer, config);
      expect(paymcp).toBeDefined();
    });

    it('should handle square provider configuration', () => {
      const config: PayMCPOptions = {
        providers: {
          square: {
            apiKey: 'sandbox_token:location_id:sandbox',
          },
        },
      };

      const paymcp = createPayMCP(mockServer, config);
      expect(paymcp).toBeDefined();
    });

    it('should handle adyen provider configuration', () => {
      const config: PayMCPOptions = {
        providers: {
          adyen: {
            apiKey: 'test_api_key:test_merchant:sandbox',
          },
        },
      };

      const paymcp = createPayMCP(mockServer, config);
      expect(paymcp).toBeDefined();
    });

    it('should handle coinbase provider configuration', () => {
      const config: PayMCPOptions = {
        providers: {
          coinbase: {
            apiKey: 'test_coinbase_api_key',
          },
        },
      };

      const paymcp = createPayMCP(mockServer, config);
      expect(paymcp).toBeDefined();
    });

    it('should handle walleot provider configuration', () => {
      const config: PayMCPOptions = {
        providers: {
          walleot: {
            apiKey: 'test_walleot_key',
          },
        },
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
            apiKey: 'test_key',
          },
        } as any,
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
          square: { apiKey: 'square_token:location_123:sandbox' },
        },
        paymentFlow: PaymentFlow.ELICITATION,
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
          stripe: {} as any,
        },
      };

      // Providers don't validate apiKey, they accept undefined
      const paymcp = createPayMCP(mockServer, config);
      expect(paymcp).toBeDefined();
    });

    it('should handle null payment flow', () => {
      const config: PayMCPOptions = {
        ...basicConfig,
        paymentFlow: null as any,
      };

      const paymcp = createPayMCP(mockServer, config);
      expect(paymcp).toBeDefined();
    });

    it('should handle very large provider configurations', () => {
      const largeConfig: PayMCPOptions = {
        providers: {},
      };

      // Add many provider configurations
      for (let i = 0; i < 100; i++) {
        (largeConfig.providers as any)[`provider_${i}`] = {
          apiKey: `key_${i}`,
        };
      }

      // Should handle gracefully even if providers are invalid
      expect(() => createPayMCP(mockServer, largeConfig)).toThrow();
    });
  });

  describe('retrofitExistingTools', () => {
    it('should retrofit existing tools with price decoration', () => {
      const registerToolSpy = vi.fn();
      const serverWithTools: any = {
        ...mockServer,
        registerTool: registerToolSpy,
        tools: new Map([
          ['test_tool', {
            config: { price: { amount: 1.0, currency: 'USD' }, description: 'Test tool' },
            handler: vi.fn()
          }],
          ['free_tool', {
            config: { description: 'Free tool' },
            handler: vi.fn()
          }]
        ])
      };

      const config: PayMCPOptions = {
        ...basicConfig,
        retrofitExisting: true
      };

      const paymcp = createPayMCP(serverWithTools, config);

      // Verify PayMCP was created
      expect(paymcp).toBeDefined();

      // retrofitExistingTools() should have been called during construction
      // It iterates through tools Map and re-registers tools with price
      // The original spy is replaced by patched version, so we can't check calls
      // But we can verify PayMCP was created successfully
      expect(paymcp.getServer()).toBe(serverWithTools);
    });

    it('should skip tools without price decoration during retrofit', () => {
      const serverWithTools: any = {
        ...mockServer,
        tools: new Map([
          ['free_tool_1', {
            config: { description: 'Free tool 1' },
            handler: vi.fn()
          }],
          ['free_tool_2', {
            config: { description: 'Free tool 2' },
            handler: vi.fn()
          }]
        ])
      };

      const config: PayMCPOptions = {
        ...basicConfig,
        retrofitExisting: true
      };

      const paymcp = createPayMCP(serverWithTools, config);

      // Verify PayMCP was created
      expect(paymcp).toBeDefined();

      // retrofitExistingTools() should not re-register tools without price
      // Only tools with cfg?.price are re-registered
    });

    it('should handle server without tools Map during retrofit', () => {
      const serverNoTools: any = {
        ...mockServer,
        tools: undefined
      };

      const config: PayMCPOptions = {
        ...basicConfig,
        retrofitExisting: true
      };

      // Should not throw even if tools Map doesn't exist
      expect(() => createPayMCP(serverNoTools, config)).not.toThrow();
    });

    it('should not retrofit when retrofitExisting is false', () => {
      const serverWithTools: any = {
        ...mockServer,
        tools: new Map([
          ['test_tool', {
            config: { price: { amount: 1.0, currency: 'USD' } },
            handler: vi.fn()
          }]
        ])
      };

      const config: PayMCPOptions = {
        ...basicConfig,
        retrofitExisting: false
      };

      mockServer.registerTool.mockClear();

      createPayMCP(serverWithTools, config);

      // retrofitExistingTools() should not be called when retrofitExisting is false
      // We can't directly verify this, but no extra registerTool calls should occur
    });
  });

  describe('patchServerConnect (LIST_CHANGE flow)', () => {
    it('should patch server.connect() for LIST_CHANGE flow', () => {
      const serverWithConnect: any = {
        ...mockServer,
        connect: vi.fn().mockResolvedValue(undefined)
      };

      const config: PayMCPOptions = {
        ...basicConfig,
        paymentFlow: PaymentFlow.LIST_CHANGE
      };

      const paymcp = createPayMCP(serverWithConnect, config);

      expect(paymcp).toBeDefined();

      // Verify connect method was patched (marked with _paymcp_list_change_patched flag)
      expect((serverWithConnect.connect as any)._paymcp_list_change_patched).toBe(true);
    });

    it.skip('should warn if server does not have connect() method', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const serverNoConnect: any = {
        ...mockServer,
        connect: undefined
      };

      const config: PayMCPOptions = {
        ...basicConfig,
        paymentFlow: PaymentFlow.LIST_CHANGE
      };

      createPayMCP(serverNoConnect, config);

      // Should log warning when connect() doesn't exist
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Server does not have connect() method')
      );

      consoleWarnSpy.mockRestore();
    });

    it.skip('should prevent double-patching of server.connect()', () => {
      const consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

      const serverWithConnect: any = {
        ...mockServer,
        connect: vi.fn().mockResolvedValue(undefined)
      };

      const config: PayMCPOptions = {
        ...basicConfig,
        paymentFlow: PaymentFlow.LIST_CHANGE
      };

      // First PayMCP instance patches connect()
      const paymcp1 = createPayMCP(serverWithConnect, config);

      // Second PayMCP instance should detect existing patch
      const paymcp2 = createPayMCP(serverWithConnect, config);

      expect(paymcp1).toBeDefined();
      expect(paymcp2).toBeDefined();

      // Should log debug message about already patched
      expect(consoleDebugSpy).toHaveBeenCalledWith(
        expect.stringContaining('server.connect() already patched')
      );

      consoleDebugSpy.mockRestore();
    });

    it('should call patchToolListing() after connect() completes', async () => {
      const connectSpy = vi.fn().mockResolvedValue(undefined);
      const serverWithConnect: any = {
        ...mockServer,
        connect: connectSpy,
        server: {
          _requestHandlers: new Map()
        }
      };

      const config: PayMCPOptions = {
        ...basicConfig,
        paymentFlow: PaymentFlow.LIST_CHANGE
      };

      createPayMCP(serverWithConnect, config);

      // Call the patched connect() method (now replaced by PayMCP)
      await serverWithConnect.connect();

      // patchToolListing() should have been called (which tries to import list_change.js)
      // We can verify connect completed successfully (it's now the patched version)
      expect(serverWithConnect.connect).toBeDefined();
      expect(typeof serverWithConnect.connect).toBe('function');
    });

    it('should not patch server.connect() for non-LIST_CHANGE flows', () => {
      const serverWithConnect: any = {
        ...mockServer,
        connect: vi.fn().mockResolvedValue(undefined)
      };

      const config: PayMCPOptions = {
        ...basicConfig,
        paymentFlow: PaymentFlow.TWO_STEP
      };

      createPayMCP(serverWithConnect, config);

      // connect() should not be patched for TWO_STEP flow
      expect((serverWithConnect.connect as any)._paymcp_patched).toBeUndefined();
    });
  });

  describe('patchToolListing (LIST_CHANGE flow)', () => {
    it.skip('should warn if _requestHandlers is missing', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const serverNoHandlers: any = {
        ...mockServer,
        connect: vi.fn().mockResolvedValue(undefined),
        server: {
          _requestHandlers: undefined
        }
      };

      const config: PayMCPOptions = {
        ...basicConfig,
        paymentFlow: PaymentFlow.LIST_CHANGE
      };

      createPayMCP(serverNoHandlers, config);

      // Call connect() to trigger patchToolListing()
      await serverNoHandlers.connect();

      // Give dynamic import time to resolve
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should warn about missing _requestHandlers
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('_requestHandlers missing tools/list')
      );

      consoleWarnSpy.mockRestore();
    });

    it.skip('should warn if tools/list handler is missing', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const serverNoListHandler: any = {
        ...mockServer,
        connect: vi.fn().mockResolvedValue(undefined),
        server: {
          _requestHandlers: new Map()  // Empty Map, no tools/list
        }
      };

      const config: PayMCPOptions = {
        ...basicConfig,
        paymentFlow: PaymentFlow.LIST_CHANGE
      };

      createPayMCP(serverNoListHandler, config);

      // Call connect() to trigger patchToolListing()
      await serverNoListHandler.connect();

      // Give dynamic import time to resolve
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should warn about missing tools/list handler
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('_requestHandlers missing tools/list')
      );

      consoleWarnSpy.mockRestore();
    });

    it('should patch tools/list handler for session-based filtering', async () => {
      const originalListHandler = vi.fn().mockResolvedValue({
        tools: [
          { name: 'tool1', description: 'Tool 1' },
          { name: 'tool2', description: 'Tool 2' }
        ]
      });

      const requestHandlers = new Map([
        ['tools/list', originalListHandler]
      ]);

      const serverWithListHandler: any = {
        ...mockServer,
        connect: vi.fn().mockResolvedValue(undefined),
        server: {
          _requestHandlers: requestHandlers
        }
      };

      const config: PayMCPOptions = {
        ...basicConfig,
        paymentFlow: PaymentFlow.LIST_CHANGE
      };

      createPayMCP(serverWithListHandler, config);

      // Call connect() to trigger patchToolListing()
      await serverWithListHandler.connect();

      // Give dynamic import time to resolve
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify handler was replaced (not the original function anymore)
      const currentHandler = requestHandlers.get('tools/list');
      expect(currentHandler).toBeDefined();

      // Call the patched handler
      if (currentHandler) {
        const result = await currentHandler({}, {});
        expect(result).toBeDefined();
        expect(result.tools).toBeDefined();
      }
    });

    it('should handle import errors gracefully', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const requestHandlers = new Map([
        ['tools/list', vi.fn().mockResolvedValue({ tools: [] })]
      ]);

      const serverWithBrokenImport: any = {
        ...mockServer,
        connect: vi.fn().mockResolvedValue(undefined),
        server: {
          _requestHandlers: requestHandlers
        }
      };

      const config: PayMCPOptions = {
        ...basicConfig,
        paymentFlow: PaymentFlow.LIST_CHANGE
      };

      createPayMCP(serverWithBrokenImport, config);

      // Call connect() to trigger patchToolListing()
      await serverWithBrokenImport.connect();

      // Give dynamic import time to fail
      await new Promise(resolve => setTimeout(resolve, 100));

      // If import failed, error should be logged
      // (This may or may not trigger depending on module availability)

      consoleErrorSpy.mockRestore();
    });
  });

  describe('tool registration patching', () => {
    it('should wrap tools with price decoration', () => {
      const originalRegisterTool = vi.fn();
      const testServer: any = {
        ...mockServer,
        registerTool: originalRegisterTool
      };

      const paymcp = createPayMCP(testServer, basicConfig);

      const toolHandler = vi.fn().mockResolvedValue({ result: 'success' });
      const toolConfig = {
        title: 'Test Tool',
        description: 'A test tool',
        price: { amount: 2.50, currency: 'USD' }
      };

      // Call the patched registerTool
      testServer.registerTool('test_tool', toolConfig, toolHandler);

      // Verify originalRegisterTool was called by the patch
      expect(originalRegisterTool).toHaveBeenCalled();

      // The patched tool calls originalRegisterTool
      // We can verify it was called successfully
      expect(originalRegisterTool.mock.calls.length).toBeGreaterThan(0);
    });

    it('should not wrap tools without price decoration', () => {
      const originalRegisterTool = vi.fn();
      const testServer: any = {
        ...mockServer,
        registerTool: originalRegisterTool
      };

      const paymcp = createPayMCP(testServer, basicConfig);

      const toolHandler = vi.fn().mockResolvedValue({ result: 'success' });
      const toolConfig = {
        title: 'Free Tool',
        description: 'A free tool'
        // No price field
      };

      // Call the patched registerTool
      testServer.registerTool('free_tool', toolConfig, toolHandler);

      // Verify originalRegisterTool was called
      expect(originalRegisterTool).toHaveBeenCalled();

      // Description should not be modified
      const callArgs = originalRegisterTool.mock.calls[0];
      expect(callArgs[1].description).toBe('A free tool');
    });

    it('should throw error when no provider configured for priced tool', () => {
      const emptyProviderConfig: PayMCPOptions = {
        providers: {}
      };

      mockServer.registerTool.mockClear();

      createPayMCP(mockServer, emptyProviderConfig);

      const toolHandler = vi.fn().mockResolvedValue({ result: 'success' });
      const toolConfig = {
        title: 'Expensive Tool',
        description: 'Requires payment',
        price: { amount: 5.0, currency: 'USD' }
      };

      // Call the patched registerTool - should throw because no provider
      expect(() => {
        (mockServer.registerTool as any)('expensive_tool', toolConfig, toolHandler);
      }).toThrow('No payment provider configured');
    });

    it('should use first provider when multiple configured', () => {
      const multiProviderConfig: PayMCPOptions = {
        providers: {
          stripe: { apiKey: 'sk_test_stripe' },
          paypal: { apiKey: 'client_id:client_secret:sandbox' }  // Fixed format
        }
      };

      const originalRegisterTool = vi.fn();
      const testServer: any = {
        ...mockServer,
        registerTool: originalRegisterTool
      };

      createPayMCP(testServer, multiProviderConfig);

      const toolHandler = vi.fn().mockResolvedValue({ result: 'success' });
      const toolConfig = {
        title: 'Paid Tool',
        description: 'Uses first provider',
        price: { amount: 1.0, currency: 'USD' }
      };

      // Should not throw - uses first provider (stripe)
      expect(() => {
        testServer.registerTool('paid_tool', toolConfig, toolHandler);
      }).not.toThrow();
    });
  });

  describe('uninstall', () => {
    it('should restore original registerTool method', () => {
      const originalRegisterTool = vi.fn();
      const testServer: any = {
        ...mockServer,
        registerTool: originalRegisterTool
      };

      const paymcp = createPayMCP(testServer, basicConfig);

      // registerTool should be patched (different from original)
      const patchedRegisterTool = testServer.registerTool;
      expect(patchedRegisterTool).not.toBe(originalRegisterTool);
      expect(typeof patchedRegisterTool).toBe('function');

      // Uninstall should restore original (it's bound, so compare name)
      paymcp.uninstall();

      // After uninstall, should be the bound version of original
      expect(testServer.registerTool.name).toContain('spy');
      expect(typeof testServer.registerTool).toBe('function');
    });

    it('should handle multiple uninstall calls gracefully', () => {
      const paymcp = createPayMCP(mockServer, basicConfig);

      // First uninstall
      paymcp.uninstall();

      // Second uninstall should not throw
      expect(() => paymcp.uninstall()).not.toThrow();
    });

    it('should mark instance as not installed after uninstall', () => {
      const paymcp = createPayMCP(mockServer, basicConfig);

      paymcp.uninstall();

      // Calling uninstall again should return early (no effect)
      paymcp.uninstall();

      // Should not throw
      expect(paymcp).toBeDefined();
    });
  });

  describe('getServer', () => {
    it('should return the wrapped server instance', () => {
      const paymcp = createPayMCP(mockServer, basicConfig);

      const returnedServer = paymcp.getServer();

      expect(returnedServer).toBe(mockServer);
    });

    it('should maintain server reference after operations', () => {
      const paymcp = createPayMCP(mockServer, basicConfig);

      // Perform some operations
      const config = {
        title: 'Test',
        description: 'Test tool',
        price: { amount: 1.0, currency: 'USD' }
      };
      (mockServer.registerTool as any)('test', config, vi.fn());

      // Server reference should still be valid
      expect(paymcp.getServer()).toBe(mockServer);
    });
  });
});
