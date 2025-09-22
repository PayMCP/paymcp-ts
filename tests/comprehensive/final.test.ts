import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makePaidWrapper as makeElicitationWrapper } from "../../src/flows/elicitation";
import { makePaidWrapper as makeProgressWrapper } from "../../src/flows/progress";
import { makePaidWrapper as makeTwoStepWrapper } from "../../src/flows/two_step";
import { BasePaymentProvider } from "../../src/providers/base";
import { AdyenProvider } from "../../src/providers/adyen";
import { CoinbaseProvider } from "../../src/providers/coinbase";
import { SquareProvider } from "../../src/providers/square";
import { StripeProvider } from "../../src/providers/stripe";
import { PayPalProvider } from "../../src/providers/paypal";
import { SessionManager } from "../../src/session/manager";
import type { McpServerLike } from "../../src/types/mcp";

// Mock fetch
global.fetch = vi.fn();

describe("Coverage Final - Uncovered Lines", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (global.fetch as vi.Mock).mockReset();
  });

  afterAll(() => {
    SessionManager.reset();
  });

  describe("Elicitation Flow - Error Paths", () => {
    it("should handle confirm tool with unknown payment_id", async () => {
      const mockServer = {
        registerTool: vi.fn(),
        reportProgress: vi.fn(),
        requestElicitation: vi.fn(),
      } as any;

      const mockProvider = new BasePaymentProvider("test");
      mockProvider.getName = () => "mock";
      mockProvider.createPayment = vi.fn();
      mockProvider.getPaymentStatus = vi.fn();

      let confirmHandler: any;
      (mockServer.registerTool as any).mockImplementation(
        (name, config, handler) => {
          if (name.includes("confirm")) confirmHandler = handler;
        },
      );

      const originalFunc = vi.fn();

      makeElicitationWrapper(
        originalFunc,
        mockServer,
        mockProvider,
        { amount: 10, currency: "USD" },
        "test_tool",
      );

      // Try to confirm without stored session
      await expect(
        confirmHandler({ payment_id: "unknown_id" }, {}),
      ).rejects.toThrow("Unknown or expired payment_id");
    });

    it("should handle confirm tool with unpaid status", async () => {
      const mockServer = {
        registerTool: vi.fn(),
        reportProgress: vi.fn(),
        requestElicitation: vi.fn(),
      } as any;

      const mockProvider = new BasePaymentProvider("test");
      mockProvider.getName = () => "mock";
      mockProvider.createPayment = vi.fn();
      mockProvider.getPaymentStatus = vi.fn().mockResolvedValue("pending");

      let confirmHandler: any;
      (mockServer.registerTool as any).mockImplementation(
        (name, config, handler) => {
          if (name.includes("confirm")) confirmHandler = handler;
        },
      );

      const originalFunc = vi.fn();

      makeElicitationWrapper(
        originalFunc,
        mockServer,
        mockProvider,
        { amount: 10, currency: "USD" },
        "test_tool",
      );

      // Store session
      const storage = SessionManager.getStorage();
      await storage.set(
        { provider: "mock", paymentId: "test_id" },
        { args: {}, ts: Date.now(), providerName: "mock" },
      );

      // Try to confirm with non-paid status
      await expect(
        confirmHandler({ payment_id: "test_id" }, {}),
      ).rejects.toThrow("Payment status is pending, expected 'paid'");
    });

    it("should handle elicitation loop error and provider status check", async () => {
      const mockServer = {
        registerTool: vi.fn(),
        reportProgress: vi.fn(),
        requestElicitation: vi.fn(),
      } as any;

      const mockProvider = new BasePaymentProvider("test");
      mockProvider.getName = () => "mock";
      mockProvider.createPayment = vi.fn().mockResolvedValue({
        paymentId: "test_id",
        paymentUrl: "https://test.com/pay",
      });
      // First call fails, second succeeds
      mockProvider.getPaymentStatus = vi
        .fn()
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValueOnce("paid");

      const logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const originalFunc = vi.fn().mockResolvedValue({
        content: [{ type: "text", text: "Success" }],
      });

      const wrapper = makeElicitationWrapper(
        originalFunc,
        mockServer,
        mockProvider,
        { amount: 10, currency: "USD" },
        "test_tool",
        logger,
      );

      // Extra that throws error in sendRequest
      const extra = {
        sendRequest: vi.fn().mockRejectedValue(new Error("Request failed")),
      };

      vi.useFakeTimers();
      const promise = wrapper({ test: "data" }, extra);
      await vi.runOnlyPendingTimersAsync();
      vi.useRealTimers();
      const result = await promise;

      // Should have warned about the failed request
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("elicitation request failed"),
      );
    });

    it("should handle unsupported elicitation", async () => {
      const mockServer = {
        registerTool: vi.fn(),
        reportProgress: vi.fn(),
        requestElicitation: vi.fn(),
      } as any;

      const mockProvider = new BasePaymentProvider("test");
      mockProvider.getName = () => "mock";
      mockProvider.createPayment = vi.fn().mockResolvedValue({
        paymentId: "test_id",
        paymentUrl: "https://test.com/pay",
      });
      mockProvider.getPaymentStatus = vi.fn().mockResolvedValue("pending");

      const originalFunc = vi.fn();

      const wrapper = makeElicitationWrapper(
        originalFunc,
        mockServer,
        mockProvider,
        { amount: 10, currency: "USD" },
        "test_tool",
      );

      // Extra with sendRequest that returns Method not found error
      const extra = {
        sendRequest: vi.fn().mockRejectedValue({
          code: -32601,
          message: "Method not found",
        }),
      };

      vi.useFakeTimers();
      const promise = wrapper({ test: "data" }, extra);
      await vi.runOnlyPendingTimersAsync();
      vi.useRealTimers();
      const result = await promise;

      expect(result.content[0].text).toContain("Client does not support");
      expect(result.annotations?.payment?.reason).toBe(
        "elicitation_not_supported",
      );
    });

    it("should handle elicitation with no args", async () => {
      const mockServer = {
        registerTool: vi.fn(),
        reportProgress: vi.fn(),
        requestElicitation: vi.fn(),
      } as any;

      const mockProvider = new BasePaymentProvider("test");
      mockProvider.getName = () => "mock";
      mockProvider.createPayment = vi.fn().mockResolvedValue({
        paymentId: "test_id",
        paymentUrl: "https://test.com/pay",
      });
      mockProvider.getPaymentStatus = vi.fn().mockResolvedValue("paid");

      const originalFunc = vi.fn().mockResolvedValue({
        content: [{ type: "text", text: "Success" }],
      });

      const wrapper = makeElicitationWrapper(
        originalFunc,
        mockServer,
        mockProvider,
        { amount: 10, currency: "USD" },
        "test_tool",
      );

      // Call with no args (single parameter call)
      const extra = {
        sendRequest: vi.fn().mockResolvedValue({ action: "accept" }),
      };

      vi.useFakeTimers();
      const promise = wrapper(extra);
      await vi.runOnlyPendingTimersAsync();
      vi.useRealTimers();
      const result = await promise;

      expect(originalFunc).toHaveBeenCalledWith(extra);
      expect(result.content[0].text).toBe("Success");
    }, 30000);
  });

  describe("Progress Flow - Token-based Reporting", () => {
    it("should handle token-based progress reporting", async () => {
      const mockServer = {
        registerTool: vi.fn(),
        reportProgress: vi.fn(),
        requestElicitation: vi.fn(),
      } as any;

      const mockProvider = new BasePaymentProvider("test");
      mockProvider.getName = () => "mock";
      mockProvider.createPayment = vi.fn().mockResolvedValue({
        paymentId: "test_id",
        paymentUrl: "https://test.com/pay",
      });
      mockProvider.getPaymentStatus = vi
        .fn()
        .mockResolvedValueOnce("pending")
        .mockResolvedValueOnce("paid");

      const originalFunc = vi.fn().mockResolvedValue({
        content: [{ type: "text", text: "Success" }],
      });

      const wrapper = makeProgressWrapper(
        originalFunc,
        mockServer,
        mockProvider,
        { amount: 10, currency: "USD" },
        "test_tool",
      );

      // Extra with progressToken and sendNotification
      const extra = {
        _meta: { progressToken: "token123" },
        sendNotification: vi.fn(),
      };

      vi.useFakeTimers();
      const promise = wrapper({ test: "data" }, extra);

      // Advance through creation and initial polling
      for (let i = 0; i < 5; i++) {
        await Promise.resolve();
        vi.advanceTimersByTime(3000);
      }

      // Check that sendNotification was called
      expect(extra.sendNotification).toHaveBeenCalled();
      const callArgs = extra.sendNotification.mock.calls[0][0];
      expect(callArgs.method).toBe("notifications/progress");
      expect(callArgs.params.progressToken).toBe("token123");
      expect(callArgs.params.total).toBe(100);

      vi.useRealTimers();
      await promise;
    }, 30000);

    it("should handle token-based reporting failure", async () => {
      const mockServer = {
        registerTool: vi.fn(),
        reportProgress: vi.fn(),
        requestElicitation: vi.fn(),
      } as any;

      const mockProvider = new BasePaymentProvider("test");
      mockProvider.getName = () => "mock";
      mockProvider.createPayment = vi.fn().mockResolvedValue({
        paymentId: "test_id",
        paymentUrl: "https://test.com/pay",
      });
      mockProvider.getPaymentStatus = vi
        .fn()
        .mockResolvedValueOnce("pending")
        .mockResolvedValueOnce("paid");

      const logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const originalFunc = vi.fn().mockResolvedValue({
        content: [{ type: "text", text: "Success" }],
      });

      const wrapper = makeProgressWrapper(
        originalFunc,
        mockServer,
        mockProvider,
        { amount: 10, currency: "USD" },
        "test_tool",
        logger,
      );

      // Extra with token but sendNotification throws
      const extra = {
        progressToken: "token456",
        sendNotification: vi
          .fn()
          .mockRejectedValue(new Error("Notification failed")),
      };

      vi.useFakeTimers();
      const promise = wrapper({ test: "data" }, extra);

      // Advance through creation and polling
      for (let i = 0; i < 5; i++) {
        await Promise.resolve();
        vi.advanceTimersByTime(3000);
      }

      // Should have attempted to send notification
      expect(extra.sendNotification).toHaveBeenCalled();

      vi.useRealTimers();
      await promise;

      // Check if warning was logged
      const warnCall = logger.warn.mock.calls.find((call) =>
        call[0].includes("notify failed"),
      );
      expect(warnCall).toBeDefined();
    }, 30000);

    it("should handle progress confirm with missing session", async () => {
      const mockServer = {
        registerTool: vi.fn(),
        reportProgress: vi.fn(),
        requestElicitation: vi.fn(),
      } as any;

      const mockProvider = new BasePaymentProvider("test");
      mockProvider.getName = () => "mock";

      let confirmHandler: any;
      (mockServer.registerTool as any).mockImplementation(
        (name, config, handler) => {
          if (name.includes("confirm")) confirmHandler = handler;
        },
      );

      const originalFunc = vi.fn();

      makeProgressWrapper(
        originalFunc,
        mockServer,
        mockProvider,
        { amount: 10, currency: "USD" },
        "test_tool",
      );

      // Try to confirm without stored session
      await expect(
        confirmHandler({ payment_id: "unknown_id" }, {}),
      ).rejects.toThrow("Unknown or expired payment_id");
    });

    it("should handle progress confirm with unpaid status", async () => {
      const mockServer = {
        registerTool: vi.fn(),
        reportProgress: vi.fn(),
        requestElicitation: vi.fn(),
      } as any;

      const mockProvider = new BasePaymentProvider("test");
      mockProvider.getName = () => "mock";
      mockProvider.getPaymentStatus = vi.fn().mockResolvedValue("pending");

      let confirmHandler: any;
      (mockServer.registerTool as any).mockImplementation(
        (name, config, handler) => {
          if (name.includes("confirm")) confirmHandler = handler;
        },
      );

      const originalFunc = vi.fn();

      makeProgressWrapper(
        originalFunc,
        mockServer,
        mockProvider,
        { amount: 10, currency: "USD" },
        "test_tool",
      );

      // Store session
      const storage = SessionManager.getStorage();
      await storage.set(
        { provider: "mock", paymentId: "test_id" },
        { args: {}, ts: Date.now(), providerName: "mock" },
      );

      // Try to confirm with non-paid status
      await expect(
        confirmHandler({ payment_id: "test_id" }, {}),
      ).rejects.toThrow("Payment status is pending, expected 'paid'");
    });

    it("should handle progress flow with no args", async () => {
      const mockServer = {
        registerTool: vi.fn(),
        reportProgress: vi.fn(),
        requestElicitation: vi.fn(),
      } as any;

      const mockProvider = new BasePaymentProvider("test");
      mockProvider.getName = () => "mock";
      mockProvider.createPayment = vi.fn().mockResolvedValue({
        paymentId: "test_id",
        paymentUrl: "https://test.com/pay",
      });
      // Return pending first, then paid on second call
      mockProvider.getPaymentStatus = vi
        .fn()
        .mockResolvedValueOnce("pending")
        .mockResolvedValueOnce("paid");

      const originalFunc = vi.fn().mockResolvedValue({
        content: [{ type: "text", text: "Success" }],
      });

      const wrapper = makeProgressWrapper(
        originalFunc,
        mockServer,
        mockProvider,
        { amount: 10, currency: "USD" },
        "test_tool",
      );

      // Use fake timers to simulate time passing
      vi.useFakeTimers();

      // Call with single argument
      const promise = wrapper({ someData: "value" });

      // Advance through polling cycles
      for (let i = 0; i < 5; i++) {
        await Promise.resolve();
        vi.advanceTimersByTime(3000);
      }

      vi.useRealTimers();
      const result = await promise;

      expect(originalFunc).toHaveBeenCalledWith({ someData: "value" });
      expect(result.content[0].text).toBe("Success");
    }, 30000);
  });

  describe("Two-step Flow - Edge Cases", () => {
    it("should handle two-step with single argument", async () => {
      const mockServer = {
        registerTool: vi.fn(),
        reportProgress: vi.fn(),
        requestElicitation: vi.fn(),
      } as any;

      const mockProvider = new BasePaymentProvider("test");
      mockProvider.getName = () => "mock";
      mockProvider.createPayment = vi.fn().mockResolvedValue({
        paymentId: "test_id",
        paymentUrl: "https://test.com/pay",
      });

      const originalFunc = vi.fn().mockResolvedValue({
        content: [{ type: "text", text: "Success" }],
      });

      const wrapper = makeTwoStepWrapper(
        originalFunc,
        mockServer,
        mockProvider,
        { amount: 10, currency: "USD" },
        "test_tool",
      );

      // Call with single argument
      const result = await wrapper({ data: "test" });

      expect(result.content[0].text).toContain("To continue, please pay");
    });
  });

  describe("Provider Edge Cases", () => {
    it("should handle Adyen error response", async () => {
      const adyen = new AdyenProvider({ apiKey: "test_KEY:merchant_ACCOUNT" });
      (global.fetch as vi.Mock).mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => "Unauthorized",
      });

      await expect(adyen.createPayment(10, "USD", "test")).rejects.toThrow(
        "HTTP 401",
      );
    });

    it("should handle Coinbase without webhook signature", async () => {
      const coinbase = new CoinbaseProvider({ apiKey: "test_key" });
      (global.fetch as vi.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            code: "charge_123",
            hosted_url: "https://commerce.coinbase.com/charges/123",
          },
        }),
      });

      const result = await coinbase.createPayment(10, "USD", "test");
      expect(result.paymentId).toBe("charge_123");
      expect(result.paymentUrl).toBe(
        "https://commerce.coinbase.com/charges/123",
      );
    });

    it("should handle Square sandbox environment", async () => {
      const square = new SquareProvider({
        apiKey: "test_token:test_location:sandbox",
      });

      (global.fetch as vi.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          payment_link: {
            id: "pl_123",
            url: "https://sandbox.square.link/test",
          },
        }),
      });

      const result = await square.createPayment(10, "USD", "test");
      expect(result.paymentUrl).toContain("sandbox");
    });

    it("should handle Stripe test mode", async () => {
      const stripe = new StripeProvider({ apiKey: "sk_test_123" });

      // Mock checkout session creation (only one call needed)
      (global.fetch as vi.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "cs_test",
          url: "https://checkout.stripe.com/test",
        }),
      });

      const result = await stripe.createPayment(10, "USD", "test");
      expect(result.paymentId).toBe("cs_test");
      expect(result.paymentUrl).toBe("https://checkout.stripe.com/test");
    });

    it("should handle PayPal OAuth token refresh", async () => {
      const paypal = new PayPalProvider({
        clientId: "test_client",
        clientSecret: "test_secret",
      });

      // First call for token
      (global.fetch as vi.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "new_token" }),
      });

      // Second call for order creation
      (global.fetch as vi.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "ORDER_123",
          links: [{ rel: "approve", href: "https://paypal.com/approve" }],
        }),
      });

      const result = await paypal.createPayment(10, "USD", "test");
      expect(result.paymentId).toBe("ORDER_123");
    });

    it("should handle PayPal capture with no purchase_units", async () => {
      const paypal = new PayPalProvider({
        clientId: "test_client",
        clientSecret: "test_secret",
      });

      // Mock token
      (paypal as any).accessToken = "test_token";
      (paypal as any).tokenExpiry = Date.now() + 3600000; // Not expired

      // First call: get order status shows APPROVED
      (global.fetch as vi.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "APPROVED" }),
      });

      // Second call: capture order (no purchase_units in response)
      (global.fetch as vi.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "COMPLETED" }),
      });

      const status = await paypal.getPaymentStatus("ORDER_123");
      // PayPal's normalized status for COMPLETED is 'paid'
      expect(status).toBe("paid");
    });
  });

  describe("Session Storage Edge Cases", () => {
    it("should handle destroy method in custom storage", () => {
      const customStorage = {
        set: vi.fn(),
        get: vi.fn(),
        delete: vi.fn(),
        has: vi.fn(),
        clear: vi.fn(),
        destroy: vi.fn(),
      };

      // Reset any existing instance first
      SessionManager.reset();

      SessionManager.getStorage({
        type: "custom",
        options: { implementation: customStorage },
      });

      SessionManager.reset();
      expect(customStorage.destroy).toHaveBeenCalled();
    });
  });
});
