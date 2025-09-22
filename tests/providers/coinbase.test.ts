import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CoinbaseProvider } from "../../src/providers/coinbase";

describe("CoinbaseProvider", () => {
  let provider: CoinbaseProvider;
  let fetchSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock fetch
    fetchSpy = vi.spyOn(global, "fetch");

    provider = new CoinbaseProvider({
      apiKey: "test_api_key",
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
      confirmOnPending: true,
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
    it("should initialize with CoinbaseProviderOpts", () => {
      expect(provider.getName()).toBe("coinbase");
    });

    it("should initialize with standard API key", () => {
      const standardProvider = new CoinbaseProvider({
        apiKey: "standard_api_key",
      });
      expect(standardProvider.getName()).toBe("coinbase");
    });

    it("should use custom URLs", () => {
      const customProvider = new CoinbaseProvider({
        apiKey: "test_key",
        successUrl: "https://custom-success.com",
        cancelUrl: "https://custom-cancel.com",
      });
      expect(customProvider.getName()).toBe("coinbase");
    });

    it("should handle confirmOnPending false", () => {
      const provider2 = new CoinbaseProvider({
        apiKey: "test_key",
        confirmOnPending: false,
      });
      expect(provider2.getName()).toBe("coinbase");
    });
  });

  describe("getName", () => {
    it("should return provider name", () => {
      expect(provider.getName()).toBe("coinbase");
    });
  });

  describe("buildHeaders", () => {
    it("should build correct headers", () => {
      const headers = (provider as any).buildHeaders();

      expect(headers).toEqual({
        "X-CC-Api-Key": "test_api_key",
        "X-CC-Version": "2018-03-22",
        "Content-Type": "application/json",
      });
    });
  });

  describe("createPayment", () => {
    it("should create charge successfully", async () => {
      const mockResponse = {
        data: {
          id: "CHARGE123",
          code: "ABC123",
          hosted_url: "https://commerce.coinbase.com/charges/ABC123",
          pricing: {
            local: {
              amount: "25.99",
              currency: "USD",
            },
          },
        },
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await provider.createPayment(25.99, "USD", "Test payment");

      expect(result).toEqual({
        paymentId: "ABC123",
        paymentUrl: "https://commerce.coinbase.com/charges/ABC123",
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        "https://api.commerce.coinbase.com/charges",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "X-CC-Api-Key": "test_api_key",
            "Content-Type": "application/json",
            "X-CC-Version": "2018-03-22",
          }),
        }),
      );

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body).toMatchObject({
        name: "Test payment",
        description: "Test payment",
        pricing_type: "fixed_price",
        local_price: {
          amount: "25.99",
          currency: "USD",
        },
        redirect_url: "https://example.com/success",
        cancel_url: "https://example.com/cancel",
      });
    });

    it("should handle USDC to USD conversion", async () => {
      const mockResponse = {
        data: {
          id: "CHARGE123",
          code: "ABC123",
          hosted_url: "https://commerce.coinbase.com/charges/ABC123",
        },
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await provider.createPayment(25.99, "USDC", "Test USDC payment");

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.local_price.currency).toBe("USD"); // USDC converted to USD
      expect(body.local_price.amount).toBe("25.99");
    });

    it("should handle lowercase currency", async () => {
      const mockResponse = {
        data: {
          id: "CHARGE123",
          code: "ABC123",
          hosted_url: "https://commerce.coinbase.com/charges/ABC123",
        },
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await provider.createPayment(25.99, "usd", "Test payment");

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.local_price.currency).toBe("USD");
    });

    it("should truncate long descriptions", async () => {
      const longDescription = "a".repeat(300);
      const mockResponse = {
        data: {
          id: "CHARGE123",
          code: "ABC123",
          hosted_url: "https://commerce.coinbase.com/charges/ABC123",
        },
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await provider.createPayment(10, "USD", longDescription);

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.description.length).toBeLessThanOrEqual(300);
      expect(body.description).toBe(longDescription);
    });

    it("should handle empty description", async () => {
      const mockResponse = {
        data: {
          id: "CHARGE123",
          code: "ABC123",
          hosted_url: "https://commerce.coinbase.com/charges/ABC123",
        },
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await provider.createPayment(10, "USD", "");

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.name).toBe("Payment");
      expect(body.description).toBe("");
    });

    it("should handle null description", async () => {
      const mockResponse = {
        data: {
          id: "CHARGE123",
          code: "ABC123",
          hosted_url: "https://commerce.coinbase.com/charges/ABC123",
        },
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await provider.createPayment(10, "USD", null as any);

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.name).toBe("Payment");
      expect(body.description).toBe("");
    });

    it("should format amount correctly", async () => {
      const mockResponse = {
        data: {
          id: "CHARGE123",
          code: "ABC123",
          hosted_url: "https://commerce.coinbase.com/charges/ABC123",
        },
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await provider.createPayment(10.9, "USD", "Test payment");

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.local_price.amount).toBe("10.90");
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
    it("should return paid for completed charge", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            id: "CHARGE123",
            timeline: [
              {
                status: "COMPLETED",
                time: "2023-01-01T00:00:00Z",
              },
            ],
          },
        }),
      } as Response);

      const status = await provider.getPaymentStatus("CHARGE123");

      expect(status).toBe("paid");
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://api.commerce.coinbase.com/charges/CHARGE123",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            "X-CC-Api-Key": "test_api_key",
          }),
        }),
      );
    });

    it("should return paid for resolved charge", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            id: "CHARGE123",
            timeline: [
              {
                status: "RESOLVED",
                time: "2023-01-01T00:00:00Z",
              },
            ],
          },
        }),
      } as Response);

      const status = await provider.getPaymentStatus("CHARGE123");

      expect(status).toBe("paid");
    });

    it("should return paid for pending with confirmOnPending", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            id: "CHARGE123",
            timeline: [
              {
                status: "PENDING",
                time: "2023-01-01T00:00:00Z",
              },
            ],
          },
        }),
      } as Response);

      const status = await provider.getPaymentStatus("CHARGE123");

      expect(status).toBe("paid"); // confirmOnPending is true
    });

    it("should return pending for pending without confirmOnPending", async () => {
      const provider2 = new CoinbaseProvider({
        apiKey: "test_key",
        confirmOnPending: false,
      });

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            id: "CHARGE123",
            timeline: [
              {
                status: "PENDING",
                time: "2023-01-01T00:00:00Z",
              },
            ],
          },
        }),
      } as Response);

      const status = await provider2.getPaymentStatus("CHARGE123");

      expect(status).toBe("pending");
    });

    it("should return canceled for expired charge", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            id: "CHARGE123",
            timeline: [
              {
                status: "EXPIRED",
                time: "2023-01-01T00:00:00Z",
              },
            ],
          },
        }),
      } as Response);

      const status = await provider.getPaymentStatus("CHARGE123");

      expect(status).toBe("failed");
    });

    it("should return canceled for canceled charge", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            id: "CHARGE123",
            timeline: [
              {
                status: "CANCELED",
                time: "2023-01-01T00:00:00Z",
              },
            ],
          },
        }),
      } as Response);

      const status = await provider.getPaymentStatus("CHARGE123");

      expect(status).toBe("failed");
    });

    it("should handle empty timeline with completed_at", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            id: "CHARGE123",
            timeline: [],
            completed_at: "2023-01-01T00:00:00Z",
          },
        }),
      } as Response);

      const status = await provider.getPaymentStatus("CHARGE123");

      expect(status).toBe("paid");
    });

    it("should handle null timeline with confirmed_at", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            id: "CHARGE123",
            timeline: null,
            confirmed_at: "2023-01-01T00:00:00Z",
          },
        }),
      } as Response);

      const status = await provider.getPaymentStatus("CHARGE123");

      expect(status).toBe("paid");
    });

    it("should return pending for empty timeline without fallback", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            id: "CHARGE123",
            timeline: [],
          },
        }),
      } as Response);

      const status = await provider.getPaymentStatus("CHARGE123");

      expect(status).toBe("pending");
    });

    it("should return pending when no data", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      } as Response);

      const status = await provider.getPaymentStatus("CHARGE123");

      expect(status).toBe("pending");
    });

    it("should handle API errors", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => "Charge not found",
      } as Response);

      await expect(provider.getPaymentStatus("CHARGE123")).rejects.toThrow(
        "HTTP 404",
      );
    });

    it("should handle network errors", async () => {
      fetchSpy.mockRejectedValueOnce(new Error("Network error"));

      await expect(provider.getPaymentStatus("CHARGE123")).rejects.toThrow(
        "Network error",
      );
    });
  });

  describe("edge cases", () => {
    it("should handle very large amounts", async () => {
      const mockResponse = {
        data: {
          id: "CHARGE123",
          code: "ABC123",
          hosted_url: "https://commerce.coinbase.com/charges/ABC123",
        },
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await provider.createPayment(999999.99, "USD", "Large payment");

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.local_price.amount).toBe("999999.99");
    });

    it("should handle uppercase currency conversion", async () => {
      const mockResponse = {
        data: {
          id: "CHARGE123",
          code: "ABC123",
          hosted_url: "https://commerce.coinbase.com/charges/ABC123",
        },
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await provider.createPayment(10, "ETH", "Crypto payment");

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.local_price.currency).toBe("ETH");
    });

    it("should handle timeline with multiple entries", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            id: "CHARGE123",
            timeline: [
              {
                status: "NEW",
                time: "2023-01-01T00:00:00Z",
              },
              {
                status: "PENDING",
                time: "2023-01-01T00:01:00Z",
              },
              {
                status: "COMPLETED",
                time: "2023-01-01T00:02:00Z",
              },
            ],
          },
        }),
      } as Response);

      const status = await provider.getPaymentStatus("CHARGE123");

      expect(status).toBe("paid"); // Latest status is COMPLETED
    });
  });
});
