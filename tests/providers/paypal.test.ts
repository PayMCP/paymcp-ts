import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  PayPalProvider,
  createPayPalProvider,
} from "../../src/providers/paypal";

describe("PayPalProvider", () => {
  let provider: PayPalProvider;
  let fetchSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock fetch
    fetchSpy = vi.spyOn(global, "fetch");

    provider = new PayPalProvider({
      clientId: "test_client_id",
      clientSecret: "test_client_secret",
      sandbox: true,
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
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

  describe("constructor", () => {
    it("should initialize with PayPalProviderOpts", () => {
      expect(provider.getName()).toBe("paypal");
    });

    it("should initialize with standard API key format", () => {
      const standardProvider = new PayPalProvider({
        apiKey: "client_id:client_secret:sandbox",
      });
      expect(standardProvider.getName()).toBe("paypal");
    });

    it("should initialize with production format", () => {
      const prodProvider = new PayPalProvider({
        apiKey: "client_id:client_secret",
      });
      expect(prodProvider.getName()).toBe("paypal");
    });

    it("should use default URLs if not provided", () => {
      const defaultProvider = new PayPalProvider({
        clientId: "test_client",
        clientSecret: "test_secret",
      });
      expect(defaultProvider).toBeDefined();
    });
  });

  describe("getName", () => {
    it("should return provider name", () => {
      expect(provider.getName()).toBe("paypal");
    });
  });

  describe("_getToken", () => {
    it("should get access token successfully", async () => {
      const mockTokenResponse = {
        access_token: "test_access_token",
        token_type: "Bearer",
        expires_in: 3600,
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockTokenResponse,
      } as Response);

      const token = await (provider as any).getAccessToken();

      expect(token).toBe("test_access_token");
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://api-m.sandbox.paypal.com/v1/oauth2/token",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: expect.stringContaining("Basic"),
            "Content-Type": "application/x-www-form-urlencoded",
          }),
          body: "grant_type=client_credentials",
        }),
      );
    });

    it("should handle token request errors", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => "Unauthorized",
      } as Response);

      await expect((provider as any).getAccessToken()).rejects.toThrow(
        "Failed to get access token: 401",
      );
    });

    it("should handle network errors", async () => {
      fetchSpy.mockRejectedValueOnce(new Error("Network error"));

      await expect((provider as any).getAccessToken()).rejects.toThrow(
        "Network error",
      );
    });
  });

  describe("createPayment", () => {
    beforeEach(() => {
      // Mock token request
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: "test_token",
          token_type: "Bearer",
          expires_in: 3600,
        }),
      } as Response);
    });

    it("should create payment order successfully", async () => {
      const mockOrderResponse = {
        id: "ORDER123",
        status: "CREATED",
        links: [
          {
            href: "https://www.paypal.com/checkoutnow?token=ORDER123",
            rel: "approve",
            method: "GET",
          },
        ],
      };

      // Token request (already mocked above) + Order creation
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockOrderResponse,
      } as Response);

      const result = await provider.createPayment(25.99, "USD", "Test payment");

      expect(result).toEqual({
        paymentId: "ORDER123",
        paymentUrl: "https://www.paypal.com/checkoutnow?token=ORDER123",
      });

      // Check order creation call
      const orderCall = fetchSpy.mock.calls[1];
      expect(orderCall[0]).toBe(
        "https://api-m.sandbox.paypal.com/v2/checkout/orders",
      );
      expect(orderCall[1]?.method).toBe("POST");

      const body = JSON.parse(orderCall[1]?.body as string);
      expect(body).toMatchObject({
        intent: "CAPTURE",
        purchase_units: [
          {
            amount: {
              currency_code: "USD",
              value: "25.99",
            },
            description: "Test payment",
          },
        ],
        application_context: {
          return_url: "https://example.com/success",
          cancel_url: "https://example.com/cancel",
        },
      });
    });

    it("should handle different currencies", async () => {
      const mockOrderResponse = {
        id: "ORDER123",
        status: "CREATED",
        links: [
          {
            href: "https://www.paypal.com/checkoutnow?token=ORDER123",
            rel: "approve",
            method: "GET",
          },
        ],
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockOrderResponse,
      } as Response);

      await provider.createPayment(100, "EUR", "Test EUR payment");

      const orderCall = fetchSpy.mock.calls[1];
      const body = JSON.parse(orderCall[1]?.body as string);
      expect(body.purchase_units[0].amount.currency_code).toBe("EUR");
      expect(body.purchase_units[0].amount.value).toBe("100.00");
    });

    it("should format amount correctly", async () => {
      const mockOrderResponse = {
        id: "ORDER123",
        status: "CREATED",
        links: [
          { href: "https://paypal.com/approve", rel: "approve", method: "GET" },
        ],
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockOrderResponse,
      } as Response);

      await provider.createPayment(10.5, "USD", "Test payment");

      const orderCall = fetchSpy.mock.calls[1];
      const body = JSON.parse(orderCall[1]?.body as string);
      expect(body.purchase_units[0].amount.value).toBe("10.50");
    });

    it("should handle missing approve link", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "ORDER123",
          status: "CREATED",
          links: [{ href: "https://other.link", rel: "other", method: "GET" }],
        }),
      } as Response);

      await expect(
        provider.createPayment(10, "USD", "Test payment"),
      ).rejects.toThrow("No approval URL in PayPal response");
    });

    it("should handle order creation errors", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => "Bad Request",
      } as Response);

      await expect(
        provider.createPayment(10, "USD", "Test payment"),
      ).rejects.toThrow("HTTP 400");
    });
  });

  describe("getPaymentStatus", () => {
    beforeEach(() => {
      // Mock token request
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: "test_token",
          token_type: "Bearer",
          expires_in: 3600,
        }),
      } as Response);
    });

    it("should return completed for COMPLETED order", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "ORDER123",
          status: "COMPLETED",
        }),
      } as Response);

      const status = await provider.getPaymentStatus("ORDER123");

      expect(status).toBe("paid");
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://api-m.sandbox.paypal.com/v2/checkout/orders/ORDER123",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: "Bearer test_token",
          }),
        }),
      );
    });

    it("should handle APPROVED status with auto-capture", async () => {
      // First call returns APPROVED
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "ORDER123",
          status: "APPROVED",
        }),
      } as Response);

      // Capture call
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "ORDER123",
          status: "COMPLETED",
        }),
      } as Response);

      const status = await provider.getPaymentStatus("ORDER123");

      expect(status).toBe("paid");

      // Verify capture was attempted
      const captureCall = fetchSpy.mock.calls[2];
      expect(captureCall[0]).toBe(
        "https://api-m.sandbox.paypal.com/v2/checkout/orders/ORDER123/capture",
      );
      expect(captureCall[1]?.method).toBe("POST");
    });

    it("should handle APPROVED with failed capture", async () => {
      // Order status call
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "ORDER123",
          status: "APPROVED",
        }),
      } as Response);

      // Failed capture call
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => "Capture failed",
      } as Response);

      const status = await provider.getPaymentStatus("ORDER123");

      expect(status).toBe("pending");
    });

    it("should return pending for CREATED order", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "ORDER123",
          status: "CREATED",
        }),
      } as Response);

      const status = await provider.getPaymentStatus("ORDER123");

      expect(status).toBe("pending");
    });

    it("should return canceled for CANCELLED order", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "ORDER123",
          status: "CANCELLED",
        }),
      } as Response);

      const status = await provider.getPaymentStatus("ORDER123");

      expect(status).toBe("canceled");
    });

    it("should handle unknown status", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "ORDER123",
          status: "UNKNOWN_STATUS",
        }),
      } as Response);

      const status = await provider.getPaymentStatus("ORDER123");

      expect(status).toBe("pending");
    });

    it("should handle API errors", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => "Order not found",
      } as Response);

      await expect(provider.getPaymentStatus("ORDER123")).rejects.toThrow(
        "HTTP 404",
      );
    });
  });

  describe("buildHeaders", () => {
    it("should build correct headers", () => {
      const headers = (provider as any).buildHeaders();

      expect(headers).toEqual({
        Authorization: "Bearer ",
        "Content-Type": "application/json",
      });
    });
  });

  describe("edge cases", () => {
    it("should handle empty description", async () => {
      // Mock token
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "token" }),
      } as Response);

      const mockOrderResponse = {
        id: "ORDER123",
        status: "CREATED",
        links: [
          { href: "https://paypal.com/approve", rel: "approve", method: "GET" },
        ],
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockOrderResponse,
      } as Response);

      await provider.createPayment(10, "USD", "");

      const orderCall = fetchSpy.mock.calls[1];
      const body = JSON.parse(orderCall[1]?.body as string);
      expect(body.purchase_units[0].description).toBe("");
    });

    it("should handle very large amounts", async () => {
      // Mock token
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "token" }),
      } as Response);

      const mockOrderResponse = {
        id: "ORDER123",
        status: "CREATED",
        links: [
          { href: "https://paypal.com/approve", rel: "approve", method: "GET" },
        ],
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockOrderResponse,
      } as Response);

      await provider.createPayment(999999.99, "USD", "Large payment");

      const orderCall = fetchSpy.mock.calls[1];
      const body = JSON.parse(orderCall[1]?.body as string);
      expect(body.purchase_units[0].amount.value).toBe("999999.99");
    });

    it("should handle production mode", () => {
      const prodProvider = new PayPalProvider({
        clientId: "prod_client",
        clientSecret: "prod_secret",
        sandbox: false,
      });

      expect(prodProvider).toBeDefined();
      // baseUrl should be production URL (tested indirectly through API calls)
    });
  });

  describe("factory function", () => {
    it("should create provider using factory function", () => {
      const factoryProvider = createPayPalProvider({
        clientId: "factory_client",
        clientSecret: "factory_secret",
        sandbox: true,
      });

      expect(factoryProvider).toBeInstanceOf(PayPalProvider);
      expect(factoryProvider.getName()).toBe("paypal");
    });
  });
});
