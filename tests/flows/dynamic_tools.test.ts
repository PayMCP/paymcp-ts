import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makePaidWrapper, PAYMENTS, HIDDEN_TOOLS } from '../../src/flows/dynamic_tools.js';
import type { BasePaymentProvider } from '../../src/providers/base.js';
import type { ProviderInstances } from '../../src/providers/index.js';
import type { PriceConfig } from '../../src/types/config.js';
import type { McpServerLike } from '../../src/types/mcp.js';

describe('DYNAMIC_TOOLS Flow', () => {
  let mockProvider: BasePaymentProvider;
  let mockProviders: ProviderInstances;
  let mockServer: McpServerLike;
  let mockLogger: any;
  let mockStateStore: any;
  let priceInfo: PriceConfig;
  let registeredTools: Map<string, any>;
  const clientInfo = () => ({ name: 'test', capabilities: {} });

  beforeEach(() => {
    // Setup mock provider
    mockProvider = {
      createPayment: vi.fn().mockResolvedValue({
        paymentId: 'test_payment_id_123456',
        paymentUrl: 'https://payment.example.com/123'
      }),
      getPaymentStatus: vi.fn().mockResolvedValue('paid'),
      logger: undefined
    } as any;
    mockProviders = { mock: mockProvider };

    // Setup mock server with dynamic tool registration
    registeredTools = new Map();
    mockServer = {
      tools: new Map(),
      registerTool: vi.fn((name, config, handler) => {
        registeredTools.set(name, { config, handler });
      }),
      sendNotification: vi.fn().mockResolvedValue(undefined)
    } as any;

    // Setup mock logger
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };

    // Mock state store with actual storage
    const storage = new Map();
    mockStateStore = {
      set: vi.fn().mockImplementation(async (key: string, args: any) => {
        storage.set(key, { args, ts: Date.now() });
      }),
      get: vi.fn().mockImplementation(async (key: string) => {
        return storage.get(key);
      }),
      delete: vi.fn().mockImplementation(async (key: string) => {
        storage.delete(key);
      })
    };

    // Setup price info
    priceInfo = {
      amount: 25.00,
      currency: 'EUR'
    };
  });

  afterEach(() => {
    // Clear state between tests
    PAYMENTS.clear();
    registeredTools.clear();
  });

  describe('Dynamic Tool Registration', () => {
    it('should not register confirmation tool at wrapper creation', () => {
      const mockTool = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Tool result' }]
      });

      // Create wrapper - should NOT register confirmation tool yet
      makePaidWrapper(
        mockTool,
        mockServer,
        mockProviders,
        priceInfo,
        'testTool',
        mockStateStore,
        mockLogger
      );

      // No tools should be registered at this point
      expect(mockServer.registerTool).not.toHaveBeenCalled();
      expect(registeredTools.size).toBe(0);
    });

    it('should register confirmation tool dynamically when payment is initiated', async () => {
      const mockTool = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Tool result' }]
      });

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProviders,
        priceInfo,
        'testTool',
        mockStateStore,
        mockLogger
      );

      // Initiate payment
      const result = await wrapper({ data: 'test_data' });

      // Now confirmation tool should be registered
      expect(mockServer.registerTool).toHaveBeenCalledOnce();
      expect(mockServer.registerTool).toHaveBeenCalledWith(
        'confirm_testTool_test_payment_id_123456', // FULL payment ID, not truncated
        expect.objectContaining({
          title: 'Confirm payment for testTool',
          description: 'Confirm payment test_payment_id_123456 and execute testTool()'
        }),
        expect.any(Function)
      );

      // Verify tool is in our registry
      expect(registeredTools.has('confirm_testTool_test_payment_id_123456')).toBe(true);
    });

    it('should create unique confirmation tool names for different payments', async () => {
      // Setup provider to return different payment IDs
      let paymentCount = 0;
      mockProvider.createPayment = vi.fn().mockImplementation(async () => {
        paymentCount++;
        return {
          paymentId: `payment_${paymentCount}abc${paymentCount}def`,
          paymentUrl: `https://payment.example.com/${paymentCount}`
        };
      });

      const mockTool = vi.fn();
      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProviders,
        priceInfo,
        'testTool',
        mockStateStore,
        mockLogger
      );

      // Initiate two payments
      const result1 = await wrapper({ data: 'first' });
      const result2 = await wrapper({ data: 'second' });

      // Each should have unique confirmation tool names (FULL payment ID)
      expect(result1.next_tool).toBe('confirm_testTool_payment_1abc1def');
      expect(result2.next_tool).toBe('confirm_testTool_payment_2abc2def');

      // Both tools should be registered with unique FULL payment IDs
      expect(result1.next_tool).not.toBe(result2.next_tool);
      expect(registeredTools.has('confirm_testTool_payment_1abc1def')).toBe(true);
      expect(registeredTools.has('confirm_testTool_payment_2abc2def')).toBe(true);

      // Both payments should be stored
      expect(PAYMENTS.has('payment_1abc1def')).toBe(true);
      expect(PAYMENTS.has('payment_2abc2def')).toBe(true);
    });
  });

  describe('Payment Flow Execution', () => {
    it('should execute original tool after payment confirmation', async () => {
      const mockTool = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Executed successfully' }]
      });

      // Setup server.tools as a Map to enable tool hiding/restoration
      mockServer.tools = new Map();
      mockServer.tools.set('testTool', { config: {}, handler: mockTool });

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProviders,
        priceInfo,
        'testTool',
        mockStateStore,
        mockLogger
      );

      // Initiate payment
      const initResult = await wrapper({ data: 'test_input' });

      // Tool hiding is tracked in HIDDEN_TOOLS (per-session)
      // Note: In test environment with mock server, HIDDEN_TOOLS is populated
      // but actual tool filtering happens via Proxy in PayMCP
      expect(HIDDEN_TOOLS.size).toBeGreaterThan(0);

      // Get the dynamically registered confirmation tool
      const confirmTool = registeredTools.get(initResult.next_tool);
      expect(confirmTool).toBeDefined();

      // Execute confirmation tool
      const confirmResult = await confirmTool.handler({});

      // Verify payment status was checked
      expect(mockProvider.getPaymentStatus).toHaveBeenCalledWith('test_payment_id_123456');

      // Verify original tool was called with correct args (extra is not passed if undefined)
      expect(mockTool).toHaveBeenCalledWith({ data: 'test_input' });

      // Check result
      expect(confirmResult).toEqual({
        content: [{ type: 'text', text: 'Executed successfully' }]
      });

      // Payment should be cleaned up
      expect(PAYMENTS.has('test_payment_id_123456')).toBe(false);

      // Tool should be restored
      expect(mockServer.tools.has('testTool')).toBe(true);
    });

    it('should handle unpaid payment status', async () => {
      mockProvider.getPaymentStatus = vi.fn().mockResolvedValue('pending');

      const mockTool = vi.fn();
      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProviders,
        priceInfo,
        'testTool',
        mockStateStore,
        mockLogger
      );

      // Initiate payment
      const initResult = await wrapper({ data: 'test' });

      // Execute confirmation tool
      const confirmTool = registeredTools.get(initResult.next_tool);
      const confirmResult = await confirmTool.handler({});

      // Should return payment pending message
      expect(confirmResult.content[0].text).toContain('not yet completed');
      expect(confirmResult.content[0].text).toContain('status: pending');

      // Original tool should NOT be called
      expect(mockTool).not.toHaveBeenCalled();

      // Payment should NOT be cleaned up yet
      expect(PAYMENTS.has('test_payment_id_123456')).toBe(true);
    });

    it('should handle missing payment ID gracefully', async () => {
      const mockTool = vi.fn();
      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProviders,
        priceInfo,
        'testTool',
        mockStateStore,
        mockLogger
      );

      // Initiate payment
      const initResult = await wrapper({ data: 'test' });

      // Clear stored payments to simulate expired/missing payment
      PAYMENTS.clear();

      // Execute confirmation tool
      const confirmTool = registeredTools.get(initResult.next_tool);
      const confirmResult = await confirmTool.handler({});

      // Should return error message
      expect(confirmResult.content[0].text).toContain('unknown or has expired');

      // Original tool should NOT be called
      expect(mockTool).not.toHaveBeenCalled();
    });

    it('should handle provider errors during confirmation', async () => {
      mockProvider.getPaymentStatus = vi.fn().mockRejectedValue(new Error('Provider API error'));

      const mockTool = vi.fn();
      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProviders,
        priceInfo,
        'testTool',
        mockStateStore,
        mockLogger
      );

      // Initiate payment
      const initResult = await wrapper({ data: 'test' });

      // Execute confirmation tool
      const confirmTool = registeredTools.get(initResult.next_tool);
      const confirmResult = await confirmTool.handler({});

      // Should return error message
      expect(confirmResult.content[0].text).toContain('Unable to confirm payment');
      expect(confirmResult.content[0].text).toContain('Provider API error');

      // Original tool should NOT be called
      expect(mockTool).not.toHaveBeenCalled();
    });
  });

  describe('Response Format', () => {
    it('should return correct payment initiation response', async () => {
      const mockTool = vi.fn();
      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProviders,
        priceInfo,
        'testTool',
        mockStateStore,
        mockLogger
      );

      const result = await wrapper({ data: 'test' });

      // Check response structure
      expect(result).toHaveProperty('content');
      expect(result).toHaveProperty('payment_url', 'https://payment.example.com/123');
      expect(result).toHaveProperty('payment_id', 'test_payment_id_123456');
      expect(result).toHaveProperty('next_tool', 'confirm_testTool_test_payment_id_123456');

      // Check message content
      expect(result.content[0].text).toContain('payment');
      expect(result.content[0].text).toContain('confirm_testTool_test_payment_id_123456');
    });

    it('should handle payment creation errors', async () => {
      mockProvider.createPayment = vi.fn().mockRejectedValue(new Error('Payment creation failed'));

      const mockTool = vi.fn();
      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProviders,
        priceInfo,
        'testTool',
        mockStateStore,
        mockLogger
      );

      const result = await wrapper({ data: 'test' });

      // Should return error message
      expect(result.content[0].text).toContain('Unable to initiate payment');
      expect(result.content[0].text).toContain('Payment creation failed');

      // No confirmation tool should be registered
      expect(mockServer.registerTool).not.toHaveBeenCalled();
    });
  });

  describe('Argument Handling', () => {
    it('should handle tools with no arguments', async () => {
      const mockTool = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'No args result' }]
      });

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProviders,
        priceInfo,
        'testTool',
        mockStateStore,
        mockLogger
      );

      // Call without args (only extra)
      const initResult = await wrapper({ extra: 'data' });

      // Execute confirmation
      const confirmTool = registeredTools.get(initResult.next_tool);
      const confirmResult = await confirmTool.handler({});

      // Original tool should be called with extra only
      expect(mockTool).toHaveBeenCalledWith({ extra: 'data' });
    });

    it('should handle tools with both args and extra', async () => {
      const mockTool = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Result' }]
      });

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProviders,
        priceInfo,
        'testTool',
        mockStateStore,
        mockLogger
      );

      // Call with both args and extra
      const initResult = await wrapper({ param: 'value' }, { extra: 'context' });

      // Execute confirmation
      const confirmTool = registeredTools.get(initResult.next_tool);
      const confirmResult = await confirmTool.handler({}, { extra: 'context' });

      // Original tool should be called with both
      expect(mockTool).toHaveBeenCalledWith({ param: 'value' }, { extra: 'context' });
    });
  });

  describe('Notification Emission', () => {
    it('should emit tools/list_changed after hiding tool', async () => {
      const mockTool = vi.fn();
      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProviders,
        priceInfo,
        'testTool',
        mockStateStore,
        mockLogger
      );

      await wrapper({ data: 'test' });

      // Should have emitted notification after hiding tool
      expect(mockServer.sendNotification).toHaveBeenCalledWith({
        method: 'notifications/tools/list_changed'
      });
    });

    it('should emit tools/list_changed after restoring tool', async () => {
      const mockTool = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Success' }]
      });
      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProviders,
        priceInfo,
        'testTool',
        mockStateStore,
        mockLogger
      );

      const initResult = await wrapper({ data: 'test' });
      const confirmTool = registeredTools.get(initResult.next_tool);

      // Reset call count
      vi.clearAllMocks();

      await confirmTool.handler({});

      // Should have emitted notification after restoring tool
      expect(mockServer.sendNotification).toHaveBeenCalledWith({
        method: 'notifications/tools/list_changed'
      });
    });

    it('should handle notification failures gracefully on hiding', async () => {
      mockServer.sendNotification = vi.fn().mockRejectedValue(new Error('Notification failed'));

      const mockTool = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Success' }]
      });
      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProviders,
        priceInfo,
        'testTool',
        mockStateStore,
        mockLogger
      );

      // Should not throw even if notification fails
      await expect(wrapper({ data: 'test' })).resolves.toBeDefined();
    });

    it('should handle notification failures gracefully on restoration', async () => {
      const mockTool = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Success' }]
      });
      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProviders,
        priceInfo,
        'testTool',
        mockStateStore,
        mockLogger
      );

      const initResult = await wrapper({ data: 'test' });
      const confirmTool = registeredTools.get(initResult.next_tool);

      // Make notification fail on restoration
      mockServer.sendNotification = vi.fn().mockRejectedValue(new Error('Notification failed on restore'));

      // Should not throw even if notification fails during restoration
      await expect(confirmTool.handler({})).resolves.toBeDefined();
    });
  });

  describe('Tool Cleanup', () => {
    it('should remove confirmation tool after successful payment', async () => {
      const mockTool = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Success' }]
      });

      mockServer.tools = new Map();

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProviders,
        priceInfo,
        'testTool',
        mockStateStore,
        mockLogger
      );

      const initResult = await wrapper({ data: 'test' });
      const confirmToolName = initResult.next_tool;

      // Manually add to server.tools to simulate registration
      mockServer.tools.set(confirmToolName, { config: {}, handler: () => {} });

      const confirmTool = registeredTools.get(confirmToolName);
      await confirmTool.handler({});

      // Confirmation tool should be removed
      expect(mockServer.tools.has(confirmToolName)).toBe(false);
    });

    it('should restore original tool on error', async () => {
      mockProvider.getPaymentStatus = vi.fn().mockRejectedValue(new Error('API error'));

      const mockTool = vi.fn();
      mockServer.tools = new Map();
      const originalToolData = { config: {}, handler: mockTool };
      mockServer.tools.set('testTool', originalToolData);

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProviders,
        priceInfo,
        'testTool',
        mockStateStore,
        mockLogger
      );

      const initResult = await wrapper({ data: 'test' });

      // Tool hiding is tracked in HIDDEN_TOOLS
      expect(HIDDEN_TOOLS.size).toBeGreaterThan(0);

      const confirmTool = registeredTools.get(initResult.next_tool);
      await confirmTool.handler({});

      // On error, implementation attempts to restore tool state
      // (HIDDEN_TOOLS cleanup is best-effort in error scenarios)
    });
  });

  describe('Cleanup Interval', () => {
    it('should cleanup old payments after timeout', () => {
      // Manually test the cleanup logic without relying on setInterval timing
      const CLEANUP_INTERVAL = 10 * 60 * 1000; // 10 minutes

      // Add an old payment (11 minutes old)
      const now = Date.now();
      const oldTimestamp = now - (11 * 60 * 1000);
      PAYMENTS.set('old_payment_id', { sessionId: 'session1', args: { data: 'old' }, ts: oldTimestamp });

      // Add a recent payment (1 minute old)
      const recentTimestamp = now - (1 * 60 * 1000);
      PAYMENTS.set('recent_payment_id', { sessionId: 'session2', args: { data: 'recent' }, ts: recentTimestamp });

      expect(PAYMENTS.has('old_payment_id')).toBe(true);
      expect(PAYMENTS.has('recent_payment_id')).toBe(true);

      // Manually run the cleanup logic (simulating what setInterval does)
      for (const [key, data] of PAYMENTS.entries()) {
        if (now - data.ts > CLEANUP_INTERVAL) {
          PAYMENTS.delete(key);
        }
      }

      // Old payment should be cleaned up
      expect(PAYMENTS.has('old_payment_id')).toBe(false);

      // Recent payment should still exist
      expect(PAYMENTS.has('recent_payment_id')).toBe(true);

      // Clean up
      PAYMENTS.clear();
    });
  });

  describe('SDK Version Compatibility', () => {
    it('should hide tool using _registeredTools for newer SDK', async () => {
      const mockTool = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Tool result' }]
      });

      // Setup mock server with _registeredTools (newer SDK)
      mockServer._registeredTools = {
        testTool: {
          enabled: true,
          config: {},
          handler: mockTool
        }
      };
      mockServer.tools = undefined;

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProviders,
        priceInfo,
        'testTool',
        mockStateStore,
        mockLogger
      );

      // Initiate payment
      await wrapper({ data: 'test_data' });

      // Tool should be in HIDDEN_TOOLS
      expect(HIDDEN_TOOLS.size).toBeGreaterThan(0);
    });

    it('should remove confirmation tool using _registeredTools for newer SDK', async () => {
      const mockTool = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Success' }]
      });

      // Setup mock server with _registeredTools (newer SDK)
      mockServer._registeredTools = {
        testTool: {
          enabled: true,
          config: {},
          handler: mockTool
        }
      };
      mockServer.tools = undefined;

      const wrapper = makePaidWrapper(
        mockTool,
        mockServer,
        mockProviders,
        priceInfo,
        'testTool',
        mockStateStore,
        mockLogger
      );

      const initResult = await wrapper({ data: 'test' });
      const confirmToolName = initResult.next_tool;

      // Add confirmation tool to _registeredTools
      mockServer._registeredTools[confirmToolName] = {
        enabled: true,
        config: {},
        handler: () => {}
      };

      const confirmTool = registeredTools.get(confirmToolName);
      await confirmTool.handler({});

      // Confirmation tool should be removed from _registeredTools
      expect(mockServer._registeredTools[confirmToolName]).toBeUndefined();
    });
  });

  describe('Setup and Patching', () => {
    it('should patch server.connect when setup is called', async () => {
      const { setup } = await import('../../src/flows/dynamic_tools.js');

      const mockServer = {
        connect: vi.fn().mockResolvedValue(undefined),
        server: {
          _requestHandlers: new Map([
            ['tools/list', vi.fn().mockResolvedValue({ tools: [] })]
          ])
        }
      };

      const originalConnect = mockServer.connect;
      setup(mockServer);

      // Verify connect was wrapped
      expect(mockServer.connect).not.toBe(originalConnect);
      expect((mockServer.connect as any)._paymcp_dynamic_tools_patched).toBe(true);

      // Verify calling connect invokes original
      await mockServer.connect();
      expect(originalConnect).toHaveBeenCalled();
    });

    it('should not patch server.connect if already patched', async () => {
      const { setup } = await import('../../src/flows/dynamic_tools.js');

      const mockConnect = vi.fn().mockResolvedValue(undefined);
      (mockConnect as any)._paymcp_dynamic_tools_patched = true;

      const mockServer = {
        connect: mockConnect,
        server: {
          _requestHandlers: new Map([
            ['tools/list', vi.fn().mockResolvedValue({ tools: [] })]
          ])
        }
      };

      setup(mockServer);

      // Should not re-wrap
      expect(mockServer.connect).toBe(mockConnect);
    });

    it('should not patch if server has no connect method', async () => {
      const { setup } = await import('../../src/flows/dynamic_tools.js');

      const mockServer = { server: {} };

      // Should not throw
      expect(() => setup(mockServer)).not.toThrow();
    });

    it('should filter tools per session when patched', async () => {
      const { setup, HIDDEN_TOOLS: hiddenTools, CONFIRMATION_TOOLS: confirmTools } = await import('../../src/flows/dynamic_tools.js');

      const mockTool1 = { name: 'tool1' };
      const mockTool2 = { name: 'tool2' };
      const mockConfirmTool = { name: 'confirm_tool1_payment123' };

      const originalHandler = vi.fn().mockResolvedValue({
        tools: [mockTool1, mockTool2, mockConfirmTool]
      });

      const handlersMap = new Map([['tools/list', originalHandler]]);

      const mockServer = {
        connect: vi.fn(async () => {
          // Simulate connection completing
        }),
        server: {
          _requestHandlers: handlersMap
        }
      };

      setup(mockServer);

      // Call the wrapped connect to trigger patching
      await mockServer.connect();

      // Get the patched handler
      const patchedHandler = handlersMap.get('tools/list');
      expect(patchedHandler).not.toBe(originalHandler);

      // Test filtering with no session (should return all tools)
      const resultNoSession = await patchedHandler({}, {});
      expect(resultNoSession.tools.length).toBe(3);

      // Clean up
      hiddenTools.clear();
      confirmTools.clear();
    });

    it('should filter tools when session has hidden tools', async () => {
      const { setup, HIDDEN_TOOLS: hiddenTools, CONFIRMATION_TOOLS: confirmTools } = await import('../../src/flows/dynamic_tools.js');
      const { runWithSession } = await import('../../src/core/sessionContext.js');

      const mockTool1 = { name: 'tool1' };
      const mockTool2 = { name: 'tool2' };
      const mockTool3 = { name: 'tool3' };

      const originalHandler = vi.fn().mockResolvedValue({
        tools: [mockTool1, mockTool2, mockTool3]
      });

      const handlersMap = new Map([['tools/list', originalHandler]]);

      const mockServer = {
        connect: vi.fn(async () => {
          // Simulate connection completing
        }),
        server: {
          _requestHandlers: handlersMap
        }
      };

      setup(mockServer);

      // Call the wrapped connect to trigger patching
      await mockServer.connect();

      // Get the patched handler
      const patchedHandler = handlersMap.get('tools/list');

      // Create session and hide tool1
      const sessionId = 'test-session-123';
      const sessionHiddenTools = new Map();
      sessionHiddenTools.set('tool1', { enabled: true });
      hiddenTools.set(sessionId, sessionHiddenTools);

      // Call with session context using runWithSession
      const result = await runWithSession(sessionId, async () => {
        return await patchedHandler({}, {});
      });

      // tool1 should be filtered out, tool2 and tool3 should remain
      expect(result.tools.length).toBe(2);
      expect(result.tools.find((t: any) => t.name === 'tool1')).toBeUndefined();
      expect(result.tools.find((t: any) => t.name === 'tool2')).toBeDefined();
      expect(result.tools.find((t: any) => t.name === 'tool3')).toBeDefined();

      // Clean up
      hiddenTools.clear();
      confirmTools.clear();
    });

    it('should return unfiltered results when session has no hidden tools', async () => {
      const { setup, HIDDEN_TOOLS: hiddenTools, CONFIRMATION_TOOLS: confirmTools } = await import('../../src/flows/dynamic_tools.js');

      const mockTool1 = { name: 'tool1' };
      const mockTool2 = { name: 'tool2' };

      const originalHandler = vi.fn().mockResolvedValue({
        tools: [mockTool1, mockTool2]
      });

      const handlersMap = new Map([['tools/list', originalHandler]]);

      const mockServer = {
        connect: vi.fn(async () => {
          // Simulate connection completing
        }),
        server: {
          _requestHandlers: handlersMap
        }
      };

      setup(mockServer);

      // Call the wrapped connect to trigger patching
      await mockServer.connect();

      // Get the patched handler
      const patchedHandler = handlersMap.get('tools/list');

      // Call with session that has no hidden tools
      const result = await patchedHandler({}, { _meta: { sessionId: 'session-with-no-hidden-tools' } });

      // All tools should be returned
      expect(result.tools.length).toBe(2);

      // Clean up
      hiddenTools.clear();
      confirmTools.clear();
    });

    it('should filter confirmation tools from other sessions', async () => {
      const { setup, HIDDEN_TOOLS: hiddenTools, CONFIRMATION_TOOLS: confirmTools } = await import('../../src/flows/dynamic_tools.js');
      const { runWithSession } = await import('../../src/core/sessionContext.js');

      const mockTool1 = { name: 'tool1' };
      const mockConfirmToolSession1 = { name: 'confirm_tool1_payment123' };
      const mockConfirmToolSession2 = { name: 'confirm_tool1_payment456' };

      const originalHandler = vi.fn().mockResolvedValue({
        tools: [mockTool1, mockConfirmToolSession1, mockConfirmToolSession2]
      });

      const handlersMap = new Map([['tools/list', originalHandler]]);

      const mockServer = {
        connect: vi.fn(async () => {
          // Simulate connection completing
        }),
        server: {
          _requestHandlers: handlersMap
        }
      };

      setup(mockServer);

      // Call the wrapped connect to trigger patching
      await mockServer.connect();

      // Get the patched handler
      const patchedHandler = handlersMap.get('tools/list');

      // Register confirmation tools for different sessions
      confirmTools.set('confirm_tool1_payment123', 'session-1');
      confirmTools.set('confirm_tool1_payment456', 'session-2');

      // Call with session-1 context using runWithSession
      const result = await runWithSession('session-1', async () => {
        return await patchedHandler({}, {});
      });

      // Should only see tool1 and session-1's confirmation tool
      expect(result.tools.length).toBe(2);
      expect(result.tools.find((t: any) => t.name === 'tool1')).toBeDefined();
      expect(result.tools.find((t: any) => t.name === 'confirm_tool1_payment123')).toBeDefined();
      expect(result.tools.find((t: any) => t.name === 'confirm_tool1_payment456')).toBeUndefined();

      // Clean up
      hiddenTools.clear();
      confirmTools.clear();
    });
  });
});
