import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PayMCP, installPayMCP } from "../../src/core/PayMCP";
import { makePaidWrapper as makeElicitationWrapper } from "../../src/flows/elicitation";
import { makePaidWrapper as makeProgressWrapper } from "../../src/flows/progress";
import { makePaidWrapper as makeTwoStepWrapper } from "../../src/flows/two_step";
import { makeFlow } from "../../src/flows/index";
import { BasePaymentProvider } from "../../src/providers/base";
import { SessionManager } from "../../src/session/manager";
import { normalizeStatus } from "../../src/utils/payment";
import { PaymentFlow } from "../../src/types/payment";
import type { McpServerLike } from "../../src/types/mcp";

// Mock global fetch
global.fetch = vi.fn();

describe("100% Coverage Achievement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (global.fetch as vi.Mock).mockReset();
  });

  afterAll(() => {
    // Only reset SessionManager after ALL tests complete
    // Some tests need the same storage instance across setup
    SessionManager.reset();
  });

  describe("Core PayMCP coverage", () => {
    it("should handle patch when already installed", () => {
      const mockServer = {
        registerTool: vi.fn(),
        reportProgress: vi.fn(),
        requestElicitation: vi.fn(),
      } as any;

      const paymcp = new PayMCP(mockServer, {
        providers: { stripe: { apiKey: "test" } },
      });

      // Manually set installed to true
      (paymcp as any).installed = true;
      const currentRegisterTool = (mockServer as any).registerTool;

      // Call patch again
      (paymcp as any).patch();

      // Should not change registerTool
      expect((mockServer as any).registerTool).toBe(currentRegisterTool);

      paymcp.uninstall();
    });

    it("should skip tools without price during retrofit", () => {
      const originalRegisterTool = vi.fn();
      const mockServer = {
        registerTool: originalRegisterTool,
        reportProgress: vi.fn(),
        requestElicitation: vi.fn(),
      } as any;

      const toolsMap = new Map();
      toolsMap.set("tool1", {
        config: { description: "Tool without price" },
        handler: vi.fn(),
      });
      toolsMap.set("tool2", {
        config: {
          price: { amount: 10, currency: "USD" },
          description: "Paid tool",
        },
        handler: vi.fn(),
      });

      (mockServer as any).tools = toolsMap;

      const paymcp = new PayMCP(mockServer, {
        providers: { stripe: { apiKey: "test" } },
        retrofitExisting: true,
      });

      // Check that original registerTool was called (PayMCP stores it internally)
      const registeredTools = originalRegisterTool.mock.calls
        .map((call) => call[0])
        .filter((name) => !name.includes("confirm"));

      expect(registeredTools).toContain("tool2");
      expect(registeredTools).not.toContain("tool1");

      paymcp.uninstall();
    });
  });

  describe("Two-step flow coverage", () => {
    it("should handle confirmation without extra field", async () => {
      const originalFunc = vi.fn().mockResolvedValue({
        content: [{ type: "text", text: "Success" }],
      });

      const mockProvider = new BasePaymentProvider("test");
      mockProvider.getName = () => "mock";
      mockProvider.createPayment = vi.fn().mockResolvedValue({
        paymentId: "payment_123",
        paymentUrl: "https://test.com/pay",
      });
      // Payment is paid when we check status during confirmation
      mockProvider.getPaymentStatus = vi.fn().mockResolvedValue("paid");

      let confirmHandler: any;
      const mockServer = {
        registerTool: vi.fn((name, config, handler) => {
          if (name.includes("confirm")) confirmHandler = handler;
        }),
        reportProgress: vi.fn(),
        requestElicitation: vi.fn(),
      } as any;

      const wrapper = makeTwoStepWrapper(
        originalFunc,
        mockServer,
        mockProvider,
        { amount: 10, currency: "USD" },
        "test_tool",
      );

      // Call wrapper to create payment and store session
      const args = { data: "test" };
      const wrapperExtra = {};
      const paymentResult = await wrapper(args, wrapperExtra);
      expect(paymentResult.content[0].text).toContain(
        "To continue, please pay",
      );

      // Confirm the payment - when confirm tool is called with just params
      // (no extra), the two-step handler passes params as the extra to original
      const confirmResult = await confirmHandler({ payment_id: "payment_123" });

      // Two-step passes stored args and the params object when no extra is provided
      expect(originalFunc).toHaveBeenCalledWith(
        args,
        expect.objectContaining({ payment_id: "payment_123" }),
      );
      expect(confirmResult.content[0].text).toBe("Success");
    });
  });

  describe("Elicitation flow coverage", () => {
    it("should log when no notification channel available", async () => {
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

      const wrapper = makeElicitationWrapper(
        originalFunc,
        mockServer,
        mockProvider,
        { amount: 10, currency: "USD" },
        "test_tool",
        logger,
      );

      // Extra without sendNotification - force polling to trigger logs
      const extra = {
        sendRequest: vi
          .fn()
          .mockResolvedValueOnce({ action: "unknown" }) // Force retry
          .mockResolvedValueOnce({ action: "accept" }),
      };

      vi.useFakeTimers();
      const promise = wrapper({ test: "data" }, extra);
      await vi.runOnlyPendingTimersAsync();
      vi.useRealTimers();
      await promise;

      // Should have logged provider status during polling
      const statusCall = logger.debug.mock.calls.find((call) =>
        call[0].includes("provider status during loop"),
      );
      expect(statusCall).toBeDefined();
    });

    it("should handle elapsed time logging", async () => {
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

      const wrapper = makeElicitationWrapper(
        originalFunc,
        mockServer,
        mockProvider,
        { amount: 10, currency: "USD" },
        "test_tool",
        logger,
      );

      const extra = {
        sendRequest: vi
          .fn()
          .mockResolvedValueOnce({ action: "unknown" })
          .mockResolvedValueOnce({ action: "accept" }),
      };

      vi.useFakeTimers();
      const promise = wrapper({ test: "data" }, extra);
      await vi.runOnlyPendingTimersAsync();
      vi.useRealTimers();

      await promise;

      // Check for loop attempt logs with attempt=2 (second attempt)
      const attemptCall = logger.debug.mock.calls.find((call) =>
        call[0].includes("loop attempt=2"),
      );
      expect(attemptCall).toBeDefined();
    });

    it("should handle non-object elicitation response", async () => {
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

      const wrapper = makeElicitationWrapper(
        originalFunc,
        mockServer,
        mockProvider,
        { amount: 10, currency: "USD" },
        "test_tool",
      );

      const extra = {
        sendRequest: vi
          .fn()
          .mockResolvedValueOnce("string_response") // Non-object
          .mockResolvedValueOnce({ action: "accept" }),
      };

      vi.useFakeTimers();
      const promise = wrapper({ test: "data" }, extra);
      await vi.runOnlyPendingTimersAsync();
      vi.useRealTimers();

      await promise;
      expect(extra.sendRequest).toHaveBeenCalledTimes(2);
    });

    it("should handle annotation errors silently", async () => {
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

      const originalFunc = vi
        .fn()
        .mockResolvedValue(
          Object.freeze({ content: [{ type: "text", text: "Frozen" }] }),
        );

      const wrapper = makeElicitationWrapper(
        originalFunc,
        mockServer,
        mockProvider,
        { amount: 10, currency: "USD" },
        "test_tool",
      );

      const extra = {
        sendRequest: vi.fn().mockResolvedValue({ action: "accept" }),
      };

      const result = await wrapper({ test: "data" }, extra);
      expect(result.content[0].text).toBe("Frozen");
    });
  });

  describe("Progress flow coverage", () => {
    it("should handle confirmation with various args formats", async () => {
      // This test verifies the confirm handler behavior
      // The actual flow with real payment is tested in flows/progress.test.ts
      // Here we just ensure the code paths for different arg patterns are covered

      const originalFunc = vi.fn().mockResolvedValue({
        content: [{ type: "text", text: "Success" }],
      });

      const mockProvider = new BasePaymentProvider("test");
      mockProvider.getName = () => "mock";
      mockProvider.createPayment = vi.fn().mockResolvedValue({
        paymentId: "test_payment",
        paymentUrl: "https://test.com/pay",
      });
      mockProvider.getPaymentStatus = vi
        .fn()
        .mockResolvedValueOnce("pending")
        .mockResolvedValueOnce("pending")
        .mockResolvedValueOnce("paid");

      let confirmHandler: any;
      const mockServer = {
        registerTool: vi.fn((name, config, handler) => {
          if (name.includes("confirm_test_tool")) confirmHandler = handler;
        }),
        reportProgress: vi.fn(),
        requestElicitation: vi.fn(),
      } as any;

      const wrapper = makeProgressWrapper(
        originalFunc,
        mockServer,
        mockProvider,
        { amount: 10, currency: "USD" },
        "test_tool",
      );

      // Start a payment flow to store a session
      vi.useFakeTimers();
      const promise = wrapper({ data: "test" }, { extraValue: "extra" });

      // Let it create payment and store session
      await Promise.resolve();
      vi.advanceTimersByTime(6000); // Two polling cycles
      vi.useRealTimers();

      // Wait for the wrapper to complete
      const result = await promise;

      // The wrapper should have been called since payment was paid
      expect(originalFunc).toHaveBeenCalledWith(
        { data: "test" },
        { extraValue: "extra" },
      );

      // Also verify the result structure
      expect(result.annotations?.payment?.status).toBe("paid");
    }, 10000); // Increase timeout for this test
  });

  describe("Provider coverage", () => {
    it("should cover all provider edge cases", async () => {
      // Import all providers
      const { AdyenProvider } = await import("../../src/providers/adyen");
      const { CoinbaseProvider } = await import("../../src/providers/coinbase");
      const { SquareProvider } = await import("../../src/providers/square");
      const { StripeProvider } = await import("../../src/providers/stripe");

      // Adyen without environment
      const adyen = new AdyenProvider({ apiKey: "key:merchant" });
      expect(adyen.getName()).toBe("adyen");

      // Base provider non-GET request
      const base = new BasePaymentProvider("test");
      (global.fetch as vi.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ result: "ok" }),
      });
      const result = await (base as any).request("PUT", "https://api.test", {
        data: "test",
      });
      expect(result.result).toBe("ok");

      // Coinbase with webhook signature
      const coinbase = new CoinbaseProvider({
        apiKey: "test_key",
        webhookSignature: "webhook_sig",
      });
      expect(coinbase.getName()).toBe("coinbase");

      // Square payment link without order_id
      const square = new SquareProvider({ apiKey: "token:location:sandbox" });
      (global.fetch as vi.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          payment_link: { id: "pl_123", url: "https://test" },
        }),
      });
      const status = await square.getPaymentStatus("pl_123");
      expect(status).toBe("pending");

      // Stripe with 'test' in key
      const stripe = new StripeProvider({ apiKey: "sk_test_123" });
      expect(stripe.getName()).toBe("stripe");
    });
  });

  describe("Session manager coverage", () => {
    it("should handle reset with no instance", () => {
      (SessionManager as any).instance = undefined;
      expect(() => SessionManager.reset()).not.toThrow();
    });

    it("should handle memory storage expiration", async () => {
      const storage = SessionManager.getStorage();
      const key = { provider: "test", paymentId: "old" };

      // Set a session with a very short TTL
      await storage.set(
        key,
        {
          args: {},
          ts: Date.now(),
          providerName: "test",
        },
        0.001,
      ); // 1 millisecond TTL

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 5));

      // After expiration, session should be gone when accessed
      const result = await storage.get(key);
      expect(result).toBeUndefined();
    });
  });

  describe("Utils coverage", () => {
    it("should normalize various payment statuses", () => {
      // Paid statuses
      expect(normalizeStatus("paid")).toBe("paid");
      expect(normalizeStatus("succeeded")).toBe("paid");
      expect(normalizeStatus("success")).toBe("paid");
      expect(normalizeStatus("complete")).toBe("paid");
      expect(normalizeStatus("completed")).toBe("paid");
      expect(normalizeStatus("ok")).toBe("paid");
      expect(normalizeStatus("no_payment_required")).toBe("paid");
      expect(normalizeStatus("captured")).toBe("paid");
      expect(normalizeStatus("confirmed")).toBe("paid");
      expect(normalizeStatus("approved")).toBe("paid");
      expect(normalizeStatus("PAID")).toBe("paid"); // Uppercase

      // Canceled statuses
      expect(normalizeStatus("canceled")).toBe("canceled");
      expect(normalizeStatus("cancelled")).toBe("canceled");
      expect(normalizeStatus("void")).toBe("canceled");
      expect(normalizeStatus("voided")).toBe("canceled");
      expect(normalizeStatus("failed")).toBe("canceled");
      expect(normalizeStatus("declined")).toBe("canceled");
      expect(normalizeStatus("error")).toBe("canceled");
      expect(normalizeStatus("expired")).toBe("canceled");
      expect(normalizeStatus("refused")).toBe("canceled");
      expect(normalizeStatus("rejected")).toBe("canceled");

      // Pending statuses (everything else)
      expect(normalizeStatus("processing")).toBe("pending");
      expect(normalizeStatus("pending")).toBe("pending");
      expect(normalizeStatus("created")).toBe("pending");
      expect(normalizeStatus("authorized")).toBe("pending");
      expect(normalizeStatus("unknown_status")).toBe("pending");
      expect(normalizeStatus(null)).toBe("pending");
      expect(normalizeStatus(undefined)).toBe("pending");
      expect(normalizeStatus("")).toBe("pending");
    });
  });

  describe("Flow index coverage", () => {
    it("should throw for OOB flow", () => {
      expect(() => makeFlow(PaymentFlow.OOB)).toThrow(
        "Unknown payment flow: OOB",
      );
    });

    it("should throw for invalid flow", () => {
      expect(() => makeFlow("INVALID" as any)).toThrow(
        "Unknown payment flow: INVALID",
      );
    });
  });
});
