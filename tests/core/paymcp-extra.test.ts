import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PayMCP } from "../../src/core/PayMCP";
import { PaymentFlow } from "../../src/types/payment";
import type { McpServerLike } from "../../src/types/mcp";
import type { PayMCPOptions } from "../../src/types/config";

import { installPayMCP } from "../../src/core/PayMCP";

describe("PayMCP Extra Coverage", () => {
  let mockServer: anyed<McpServerLike>;
  let basicConfig: PayMCPOptions;
  let paymcp: PayMCP | null = null;

  beforeEach(() => {
    mockServer = {
      registerTool: vi.fn(),
      reportProgress: vi.fn(),
      requestElicitation: vi.fn(),
    } as any;

    basicConfig = {
      providers: {
        stripe: {
          apiKey: "sk_test_123",
        },
      },
    };
  });

  afterEach(() => {
    if (paymcp) {
      paymcp.uninstall();
      paymcp = null;
    }
    vi.clearAllMocks();
  });

  describe("retrofitExisting", () => {
    it("should attempt to retrofit existing tools when enabled", () => {
      // Store original mock before patching
      const originalRegisterTool = mockServer.registerTool;

      // Set up mock server with existing tools
      const toolsMap = new Map();
      toolsMap.set("existing_tool", {
        config: {
          price: { amount: 5, currency: "USD" },
          description: "Existing tool",
        },
        handler: vi.fn(),
      });
      (mockServer as any).tools = toolsMap;

      const configWithRetrofit: PayMCPOptions = {
        ...basicConfig,
        retrofitExisting: true,
      };

      // Create PayMCP with retrofit option
      paymcp = new PayMCP(mockServer, configWithRetrofit);

      // Should have attempted to patch the existing tool
      expect(originalRegisterTool).toHaveBeenCalled();
    });

    it("should not retrofit when server has no tools", () => {
      // Store original mock before patching
      const originalRegisterTool = mockServer.registerTool;

      const configWithRetrofit: PayMCPOptions = {
        ...basicConfig,
        retrofitExisting: true,
      };

      // Create PayMCP without tools map
      paymcp = new PayMCP(mockServer, configWithRetrofit);

      // Should not have called registerTool
      expect(originalRegisterTool).not.toHaveBeenCalled();
    });
  });

  describe("patched registerTool", () => {
    it("should wrap tool handler when price is specified", () => {
      // Store original mock before patching
      const originalRegisterTool = mockServer.registerTool;

      paymcp = new PayMCP(mockServer, basicConfig);

      const toolConfig = {
        price: { amount: 10, currency: "USD" },
        description: "Test tool",
      };

      const handler = vi.fn();

      // Call the patched registerTool
      (mockServer as any).registerTool("test_tool", toolConfig, handler);

      // Check that the original registerTool was called
      expect(originalRegisterTool).toHaveBeenCalled();

      // Find the call for our test_tool (might not be the first if confirmation tools are registered)
      const testToolCall = originalRegisterTool.mock.calls.find(
        (call) => call[0] === "test_tool",
      );

      expect(testToolCall).toBeDefined();
      const [name, config, wrappedHandler] = testToolCall!;

      expect(name).toBe("test_tool");
      expect(config.description).toContain("10 USD");
      expect(typeof wrappedHandler).toBe("function");
      // The wrapped handler should be different from the original
      expect(wrappedHandler).not.toBe(handler);
    });

    it("should not wrap tool handler when price is not specified", () => {
      // Store original mock before patching
      const originalRegisterTool = mockServer.registerTool;

      paymcp = new PayMCP(mockServer, basicConfig);

      const toolConfig = {
        description: "Test tool without price",
      };

      const handler = vi.fn();

      // Call the patched registerTool
      (mockServer as any).registerTool("test_tool", toolConfig, handler);

      // Check that the original registerTool was called
      const [name, config, passedHandler] = originalRegisterTool.mock.calls[0];

      expect(name).toBe("test_tool");
      expect(config.description).toBe("Test tool without price");
      // Handler should be passed through unchanged
      expect(passedHandler).toBe(handler);
    });

    it("should throw error when no provider is configured", () => {
      const emptyConfig: PayMCPOptions = {
        providers: {},
      };

      paymcp = new PayMCP(mockServer, emptyConfig);

      const toolConfig = {
        price: { amount: 10, currency: "USD" },
        description: "Test tool",
      };

      const handler = vi.fn();

      // Should throw when trying to register a paid tool without providers
      expect(() => {
        (mockServer as any).registerTool("test_tool", toolConfig, handler);
      }).toThrow("[PayMCP] No payment provider configured");
    });
  });

  describe("uninstall", () => {
    it("should be idempotent - calling multiple times is safe", () => {
      paymcp = new PayMCP(mockServer, basicConfig);

      // Store the patched function
      const patchedRegisterTool = (mockServer as any).registerTool;

      // First uninstall
      paymcp.uninstall();

      // registerTool should be restored
      expect((mockServer as any).registerTool).not.toBe(patchedRegisterTool);

      // Second uninstall should not throw
      expect(() => paymcp!.uninstall()).not.toThrow();
    });
  });

  describe("installPayMCP function", () => {
    it("should create PayMCP instance using factory function", () => {
      const instance = installPayMCP(mockServer, basicConfig);

      expect(instance).toBeInstanceOf(PayMCP);
      expect(instance.getServer()).toBe(mockServer);

      // Clean up
      instance.uninstall();
    });
  });
});
