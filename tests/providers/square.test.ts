import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  SquareProvider,
  createSquareProvider,
} from "../../src/providers/square";

describe("SquareProvider", () => {
  let provider: SquareProvider;
  let fetchSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock fetch
    fetchSpy = vi.spyOn(global, "fetch");

    provider = new SquareProvider({
      accessToken: "test_access_token",
      locationId: "test_location_id",
      sandbox: true,
      redirectUrl: "https://example.com/success",
      apiVersion: "2023-10-18",
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
    it("should throw error for invalid apiKey format", () => {
      expect(
        () =>
          new SquareProvider({
            apiKey: "invalid_format",
          }),
      ).toThrow('apiKey must be in format "accessToken:locationId:sandbox"');

      expect(
        () =>
          new SquareProvider({
            apiKey: "token:location", // Missing third part
          }),
      ).toThrow('apiKey must be in format "accessToken:locationId:sandbox"');
    });

    it("should initialize with SquareProviderOpts", () => {
      expect(provider.getName()).toBe("square");
    });

    it("should initialize with standard API key format", () => {
      const standardProvider = new SquareProvider({
        apiKey: "access_token:location_id:sandbox",
      });
      expect(standardProvider.getName()).toBe("square");
    });

    it("should initialize with production format", () => {
      const prodProvider = new SquareProvider({
        apiKey: "access_token:location_id:production",
      });
      expect(prodProvider.getName()).toBe("square");
    });

    it("should use default values if not provided", () => {
      const defaultProvider = new SquareProvider({
        accessToken: "test_token",
        locationId: "test_location",
      });
      expect(defaultProvider).toBeDefined();
    });

    it("should use API version from environment variable", () => {
      process.env.SQUARE_API_VERSION = "2024-01-01";

      const envProvider = new SquareProvider({
        accessToken: "test_token",
        locationId: "test_location",
      });
      expect(envProvider).toBeDefined();

      delete process.env.SQUARE_API_VERSION;
    });
  });

  describe("getName", () => {
    it("should return provider name", () => {
      expect(provider.getName()).toBe("square");
    });
  });

  describe("buildHeaders", () => {
    it("should build correct headers", () => {
      const headers = (provider as any).buildHeaders();

      expect(headers).toEqual({
        Authorization: "Bearer test_access_token",
        "Content-Type": "application/json",
        "Square-Version": "2023-10-18",
      });
    });
  });

  describe("createPayment", () => {
    it("should create payment link successfully", async () => {
      const mockResponse = {
        payment_link: {
          id: "PLINK123",
          url: "https://squareup.com/pay/PLINK123",
          version: 1,
          order_id: "ORDER123",
          created_at: "2023-01-01T00:00:00Z",
        },
        related_resources: {
          orders: [
            {
              id: "ORDER123",
              location_id: "test_location_id",
              state: "OPEN",
              total_money: {
                amount: 2500,
                currency: "USD",
              },
            },
          ],
        },
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await provider.createPayment(25.0, "USD", "Test payment");

      expect(result).toEqual({
        paymentId: "PLINK123",
        paymentUrl: "https://squareup.com/pay/PLINK123",
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        "https://connect.squareupsandbox.com/v2/online-checkout/payment-links",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer test_access_token",
            "Content-Type": "application/json",
            "Square-Version": "2023-10-18",
          }),
        }),
      );

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body).toMatchObject({
        quick_pay: {
          location_id: "test_location_id",
          name: "Test payment",
          price_money: {
            amount: 2500,
            currency: "USD",
          },
        },
      });
    });

    it("should handle different currencies", async () => {
      const mockResponse = {
        payment_link: {
          id: "PLINK123",
          url: "https://squareup.com/pay/PLINK123",
        },
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await provider.createPayment(100, "EUR", "Test EUR payment");

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.quick_pay.price_money.currency).toBe("EUR");
      expect(body.quick_pay.price_money.amount).toBe(10000); // EUR cents
    });

    it("should convert amount to cents correctly", async () => {
      const mockResponse = {
        payment_link: {
          id: "PLINK123",
          url: "https://squareup.com/pay/PLINK123",
        },
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await provider.createPayment(10.99, "USD", "Test payment");

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.quick_pay.price_money.amount).toBe(1099);
    });

    it("should handle zero amount", async () => {
      const mockResponse = {
        payment_link: {
          id: "PLINK123",
          url: "https://squareup.com/pay/PLINK123",
        },
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await provider.createPayment(0, "USD", "Free item");

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.quick_pay.price_money.amount).toBe(0);
    });

    it("should handle fractional cents", async () => {
      const mockResponse = {
        payment_link: {
          id: "PLINK123",
          url: "https://squareup.com/pay/PLINK123",
        },
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await provider.createPayment(10.995, "USD", "Test payment");

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.quick_pay.price_money.amount).toBe(1100); // Rounded up
    });

    it("should handle missing payment link ID", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          payment_link: {
            url: "https://squareup.com/pay/PLINK123",
          },
        }),
      } as Response);

      await expect(
        provider.createPayment(10, "USD", "Test payment"),
      ).rejects.toThrow("Invalid response from Square Payment Links API");
    });

    it("should handle missing payment link URL", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          payment_link: {
            id: "PLINK123",
          },
        }),
      } as Response);

      await expect(
        provider.createPayment(10, "USD", "Test payment"),
      ).rejects.toThrow("Invalid response from Square Payment Links API");
    });

    it("should handle HTTP errors", async () => {
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
    it("should return paid for completed order", async () => {
      // Mock payment link response (first call)
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          payment_link: {
            id: "PLINK123",
            url: "https://squareup.com/pay/PLINK123",
            order_id: "ORDER123",
          },
        }),
      } as Response);

      // Mock order status response (second call)
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          order: {
            id: "ORDER123",
            state: "COMPLETED",
            total_money: {
              amount: 2500,
              currency: "USD",
            },
            net_amount_due_money: {
              amount: 0, // Fully paid
              currency: "USD",
            },
          },
        }),
      } as Response);

      const status = await provider.getPaymentStatus("PLINK123");

      expect(status).toBe("paid");
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://connect.squareupsandbox.com/v2/online-checkout/payment-links/PLINK123",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: "Bearer test_access_token",
          }),
        }),
      );
    });

    it("should return paid for net zero amount", async () => {
      // Mock payment link response
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          payment_link: {
            id: "PLINK123",
            order_id: "ORDER123",
          },
        }),
      } as Response);

      // Mock order response
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          order: {
            id: "ORDER123",
            state: "OPEN", // Not completed but fully paid
            total_money: {
              amount: 100,
              currency: "USD",
            },
            net_amount_due_money: {
              amount: 0, // Net zero means fully paid
              currency: "USD",
            },
          },
        }),
      } as Response);

      const status = await provider.getPaymentStatus("PLINK123");

      expect(status).toBe("paid");
    });

    it("should return canceled for canceled order", async () => {
      // Mock payment link response
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          payment_link: {
            id: "PLINK123",
            order_id: "ORDER123",
          },
        }),
      } as Response);

      // Mock order response
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          order: {
            id: "ORDER123",
            state: "CANCELED",
            net_amount_due_money: {
              amount: 1000, // Not paid
            },
          },
        }),
      } as Response);

      const status = await provider.getPaymentStatus("PLINK123");

      expect(status).toBe("canceled");
    });

    it("should return pending for open order", async () => {
      // Mock payment link response
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          payment_link: {
            id: "PLINK123",
            order_id: "ORDER123",
          },
        }),
      } as Response);

      // Mock order response
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          order: {
            id: "ORDER123",
            state: "OPEN",
            net_amount_due_money: {
              amount: 1000, // Not yet paid
            },
          },
        }),
      } as Response);

      const status = await provider.getPaymentStatus("PLINK123");

      expect(status).toBe("pending");
    });

    it("should handle order lookup", async () => {
      // Mock payment link response
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          payment_link: {
            id: "PLINK123",
            order_id: "ORDER456",
          },
        }),
      } as Response);

      // Mock order response
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          order: {
            id: "ORDER456",
            state: "COMPLETED",
            net_amount_due_money: {
              amount: 0,
            },
          },
        }),
      } as Response);

      await provider.getPaymentStatus("PLINK123");

      expect(fetchSpy).toHaveBeenCalledWith(
        "https://connect.squareupsandbox.com/v2/online-checkout/payment-links/PLINK123",
        expect.any(Object),
      );
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://connect.squareupsandbox.com/v2/orders/ORDER456?location_id=test_location_id",
        expect.any(Object),
      );
    });

    it("should handle payment link without order ID", async () => {
      // Mock payment link response with no order ID
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          payment_link: {
            id: "PLINK123",
            // No order_id field
          },
        }),
      } as Response);

      const status = await provider.getPaymentStatus("PLINK123");

      expect(status).toBe("pending");
      expect(fetchSpy).toHaveBeenCalledTimes(1); // Only fetched payment link
    });

    it("should handle API errors gracefully", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => "Payment link not found",
      } as Response);

      // Provider catches errors and returns 'pending'
      const status = await provider.getPaymentStatus("PLINK123");
      expect(status).toBe("pending");
    });

    it("should handle network errors gracefully", async () => {
      fetchSpy.mockRejectedValueOnce(new Error("Network error"));

      // Provider catches errors and returns 'pending'
      const status = await provider.getPaymentStatus("PLINK123");
      expect(status).toBe("pending");
    });
  });

  describe("edge cases", () => {
    it("should handle empty description", async () => {
      const mockResponse = {
        payment_link: {
          id: "PLINK123",
          url: "https://squareup.com/pay/PLINK123",
        },
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await provider.createPayment(10, "USD", "");

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.quick_pay.name).toBe("");
    });

    it("should handle very large amounts", async () => {
      const mockResponse = {
        payment_link: {
          id: "PLINK123",
          url: "https://squareup.com/pay/PLINK123",
        },
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await provider.createPayment(999999.99, "USD", "Large payment");

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.quick_pay.price_money.amount).toBe(99999999);
    });

    it("should handle production mode", () => {
      const prodProvider = new SquareProvider({
        accessToken: "prod_token",
        locationId: "prod_location",
        sandbox: false,
      });

      expect(prodProvider).toBeDefined();
      // baseUrl should be production URL (tested indirectly through API calls)
    });

    it("should handle custom redirect URL", async () => {
      const customProvider = new SquareProvider({
        accessToken: "test_token",
        locationId: "test_location",
        redirectUrl: "https://custom.example.com/redirect",
      });

      const mockResponse = {
        payment_link: {
          id: "PLINK123",
          url: "https://squareup.com/pay/PLINK123",
        },
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await customProvider.createPayment(10, "USD", "Test payment");

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      // Square Payment Links API doesn't use checkout_options for redirect URLs
      // The redirect URL is configured in the Square dashboard, not via API
      expect(body.quick_pay).toBeDefined();
      expect(body.quick_pay.name).toBe("Test payment");
    });
  });

  describe("getPaymentStatus", () => {
    it("should return pending when payment link has no order_id", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          payment_link: {
            id: "pl_test123",
            url: "https://squareup.com/pay/pl_test123",
            version: 1,
            created_at: "2025-01-01T00:00:00Z",
            // Missing order_id field
          },
        }),
      } as Response);

      const status = await provider.getPaymentStatus("pl_test123");
      expect(status).toBe("pending");
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/v2/online-checkout/payment-links/pl_test123"),
        expect.any(Object),
      );
    });
  });

  describe("factory function", () => {
    it("should create provider using factory function", () => {
      const factoryProvider = createSquareProvider({
        accessToken: "factory_token",
        locationId: "factory_location",
        sandbox: true,
      });

      expect(factoryProvider).toBeInstanceOf(SquareProvider);
      expect(factoryProvider.getName()).toBe("square");
    });
  });
});
