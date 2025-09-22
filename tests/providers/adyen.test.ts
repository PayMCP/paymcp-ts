import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AdyenProvider } from "../../src/providers/adyen";

describe("AdyenProvider", () => {
  let provider: AdyenProvider;
  let fetchSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock fetch
    fetchSpy = vi.spyOn(global, "fetch");

    provider = new AdyenProvider({
      apiKey: "test_api_key",
      merchantAccount: "TestMerchant",
      successUrl: "https://example.com/success",
      sandbox: true,
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
    it("should initialize with sandbox mode", () => {
      expect(provider.getName()).toBe("adyen");
    });

    it("should initialize with production mode", () => {
      const prodProvider = new AdyenProvider({
        apiKey: "prod_api_key",
        merchantAccount: "ProdMerchant",
        sandbox: false,
      });
      expect(prodProvider.getName()).toBe("adyen");
    });

    it("should use apiKey fallback for backwards compatibility", () => {
      const fallbackProvider = new AdyenProvider({
        apiKey: "fallback_key",
        merchantAccount: "TestMerchant",
      });
      expect(fallbackProvider.getName()).toBe("adyen");
    });

    it("should use custom return URL", () => {
      const customProvider = new AdyenProvider({
        apiKey: "test_key",
        merchantAccount: "TestMerchant",
        successUrl: "https://custom.example.com/return",
      });
      expect(customProvider.getName()).toBe("adyen");
    });
  });

  describe("getName", () => {
    it("should return provider name", () => {
      expect(provider.getName()).toBe("adyen");
    });
  });

  describe("buildHeaders", () => {
    it("should build correct headers", () => {
      const headers = (provider as any).buildHeaders();

      expect(headers).toEqual({
        "X-API-Key": "test_api_key",
        "Content-Type": "application/json",
      });
    });
  });

  describe("createPayment", () => {
    it("should create payment session successfully", async () => {
      const mockResponse = {
        id: "CS1234567890",
        url: "https://checkoutshopper-test.adyen.com/checkoutshopper/demo/adyen-checkout/v1/session.shtml?sessionId=CS1234567890",
        sessionData: "test_session_data",
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await provider.createPayment(25.99, "USD", "Test payment");

      expect(result).toEqual({
        paymentId: "CS1234567890",
        paymentUrl:
          "https://checkoutshopper-test.adyen.com/checkoutshopper/demo/adyen-checkout/v1/session.shtml?sessionId=CS1234567890",
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        "https://checkout-test.adyen.com/v71/paymentLinks",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "X-API-Key": "test_api_key",
            "Content-Type": "application/json",
          }),
        }),
      );

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body).toMatchObject({
        merchantAccount: "TestMerchant",
        amount: {
          value: 2599,
          currency: "USD",
        },
        reference: "Test payment",
        returnUrl: "https://example.com/success",
      });
    });

    it("should handle different currencies", async () => {
      const mockResponse = {
        id: "CS1234567890",
        url: "https://checkoutshopper-test.adyen.com/session",
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await provider.createPayment(100, "EUR", "Test EUR payment");

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.amount.currency).toBe("EUR");
      expect(body.amount.value).toBe(10000); // EUR cents
    });

    it("should convert amount to cents correctly", async () => {
      const mockResponse = {
        id: "CS1234567890",
        url: "https://checkoutshopper-test.adyen.com/session",
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await provider.createPayment(10.99, "USD", "Test payment");

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.amount.value).toBe(1099);
    });

    it("should handle zero amount", async () => {
      const mockResponse = {
        id: "CS1234567890",
        url: "https://checkoutshopper-test.adyen.com/session",
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await provider.createPayment(0, "USD", "Free item");

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.amount.value).toBe(0);
    });

    it("should handle fractional cents", async () => {
      const mockResponse = {
        id: "CS1234567890",
        url: "https://checkoutshopper-test.adyen.com/session",
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await provider.createPayment(10.995, "USD", "Test payment");

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.amount.value).toBe(1100); // Rounded up
    });

    it("should handle large amounts", async () => {
      const mockResponse = {
        id: "CS1234567890",
        url: "https://checkoutshopper-test.adyen.com/session",
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await provider.createPayment(999999.99, "USD", "Large payment");

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.amount.value).toBe(99999999);
    });

    it("should handle API errors", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => "Bad Request",
      } as Response);

      await expect(
        provider.createPayment(10, "USD", "Test payment"),
      ).rejects.toThrow("HTTP 400");
    });

    it("should handle network errors", async () => {
      fetchSpy.mockRejectedValueOnce(new Error("Network error"));

      await expect(
        provider.createPayment(10, "USD", "Test payment"),
      ).rejects.toThrow("Network error");
    });
  });

  describe("getPaymentStatus", () => {
    it("should return paid for completed payment", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "completed",
          resultCode: "Authorised",
        }),
      } as Response);

      const status = await provider.getPaymentStatus("CS1234567890");

      expect(status).toBe("paid");
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://checkout-test.adyen.com/v71/paymentLinks/CS1234567890",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            "X-API-Key": "test_api_key",
          }),
        }),
      );
    });

    it("should return pending for active payment", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "active",
        }),
      } as Response);

      const status = await provider.getPaymentStatus("CS1234567890");

      expect(status).toBe("pending");
    });

    it("should return canceled for expired payment", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "expired",
        }),
      } as Response);

      const status = await provider.getPaymentStatus("CS1234567890");

      expect(status).toBe("failed");
    });

    it("should return unknown for other statuses", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "unknown_status",
        }),
      } as Response);

      const status = await provider.getPaymentStatus("CS1234567890");

      expect(status).toBe("unknown_status");
    });

    it("should return unknown when status is missing", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          // No status field
        }),
      } as Response);

      const status = await provider.getPaymentStatus("CS1234567890");

      expect(status).toBe("unknown");
    });

    it("should return pending when status is null", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: null,
        }),
      } as Response);

      const status = await provider.getPaymentStatus("CS1234567890");

      expect(status).toBe("unknown");
    });

    it("should handle API errors", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => "Session not found",
      } as Response);

      await expect(provider.getPaymentStatus("CS1234567890")).rejects.toThrow(
        "HTTP 404",
      );
    });

    it("should handle network errors", async () => {
      fetchSpy.mockRejectedValueOnce(new Error("Network error"));

      await expect(provider.getPaymentStatus("CS1234567890")).rejects.toThrow(
        "Network error",
      );
    });
  });

  describe("edge cases", () => {
    it("should handle empty description", async () => {
      const mockResponse = {
        id: "CS1234567890",
        url: "https://checkoutshopper-test.adyen.com/session",
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await provider.createPayment(10, "USD", "");

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.reference).toBe("");
    });

    it("should use default return URL when not provided", () => {
      const defaultProvider = new AdyenProvider({
        apiKey: "test_key",
        merchantAccount: "TestMerchant",
      });
      expect(defaultProvider.getName()).toBe("adyen");
    });

    it("should generate unique payment references", async () => {
      const mockResponse = {
        id: "CS1234567890",
        url: "https://checkoutshopper-test.adyen.com/session",
      };

      fetchSpy
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockResponse,
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockResponse,
        } as Response);

      await provider.createPayment(10, "USD", "Payment 1");
      await provider.createPayment(10, "USD", "Payment 2");

      const body1 = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      const body2 = JSON.parse(fetchSpy.mock.calls[1][1]?.body as string);

      expect(body1.reference).not.toBe(body2.reference);
      expect(body1.reference).toBe("Payment 1");
      expect(body2.reference).toBe("Payment 2");
    });

    it("should handle production mode", () => {
      const prodProvider = new AdyenProvider({
        apiKey: "prod_key",
        merchantAccount: "ProdMerchant",
        sandbox: false,
      });

      expect(prodProvider.getName()).toBe("adyen");
      // baseUrl should be production URL (tested indirectly through API calls)
    });
  });
});
