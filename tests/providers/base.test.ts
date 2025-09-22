import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BasePaymentProvider } from "../../src/providers/base";

// Concrete implementation for testing
class TestProvider extends BasePaymentProvider {
  getName() {
    return "test";
  }

  async createPayment(amount: number, currency: string, description: string) {
    return {
      paymentId: "test_123",
      paymentUrl: "https://test.com/pay/123",
    };
  }

  async getPaymentStatus(paymentId: string) {
    return "paid";
  }

  // Expose protected methods for testing
  public testBuildHeaders() {
    return this.buildHeaders();
  }

  public testRequest<T>(method: string, url: string, data?: any) {
    return this.request<T>(method, url, data);
  }
}

describe("BasePaymentProvider", () => {
  let fetchSpy: any;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch");
  });

  afterEach(() => {
    if (fetchSpy) {
      fetchSpy.mockRestore();
    }
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should use provided logger", () => {
      const logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const provider = new TestProvider("test_key", logger);
      expect((provider as any).logger).toBe(logger);
    });

    it("should use console as default logger when none provided", () => {
      const provider = new TestProvider("test_key");
      expect((provider as any).logger).toBe(console);
    });
  });

  describe("buildHeaders", () => {
    it("should return default headers", () => {
      const provider = new TestProvider("test_key");
      const headers = provider.testBuildHeaders();

      expect(headers).toEqual({
        Authorization: "Bearer test_key",
        "Content-Type": "application/x-www-form-urlencoded",
      });
    });
  });

  describe("request", () => {
    it("should make GET request with query params", async () => {
      const provider = new TestProvider("test_key");

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      } as Response);

      const result = await provider.testRequest(
        "GET",
        "https://api.test.com/data",
        {
          foo: "bar",
          baz: 123,
        },
      );

      expect(fetchSpy).toHaveBeenCalledWith(
        "https://api.test.com/data?foo=bar&baz=123",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: "Bearer test_key",
          }),
        }),
      );

      expect(result).toEqual({ success: true });
    });

    it("should handle GET request with empty data", async () => {
      const provider = new TestProvider("test_key");

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      } as Response);

      await provider.testRequest("GET", "https://api.test.com/data", {});

      expect(fetchSpy).toHaveBeenCalledWith(
        "https://api.test.com/data",
        expect.any(Object),
      );
    });

    it("should handle GET request with URL that already has query params", async () => {
      const provider = new TestProvider("test_key");

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      } as Response);

      await provider.testRequest(
        "GET",
        "https://api.test.com/data?existing=param",
        {
          new: "param",
        },
      );

      expect(fetchSpy).toHaveBeenCalledWith(
        "https://api.test.com/data?existing=param&new=param",
        expect.any(Object),
      );
    });

    it("should make POST request with form-encoded body", async () => {
      const provider = new TestProvider("test_key");

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      } as Response);

      await provider.testRequest("POST", "https://api.test.com/data", {
        foo: "bar",
        baz: 123,
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        "https://api.test.com/data",
        expect.objectContaining({
          method: "POST",
          body: expect.any(URLSearchParams),
        }),
      );
    });

    it("should make POST request with JSON body when Content-Type is JSON", async () => {
      // Custom provider that uses JSON
      class JSONProvider extends TestProvider {
        protected override buildHeaders() {
          return {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          };
        }
      }

      const provider = new JSONProvider("test_key");

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      } as Response);

      await provider.testRequest("POST", "https://api.test.com/data", {
        foo: "bar",
        baz: 123,
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        "https://api.test.com/data",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ foo: "bar", baz: 123 }),
        }),
      );
    });

    it("should handle POST with null data", async () => {
      const provider = new TestProvider("test_key");

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      } as Response);

      await provider.testRequest("POST", "https://api.test.com/data", null);

      const call = fetchSpy.mock.calls[0];
      expect(call[1].body).toBeDefined(); // Should have a body even with null data
    });

    it("should handle network errors", async () => {
      const logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const provider = new TestProvider("test_key", logger);

      const networkError = new Error("Network failed");
      fetchSpy.mockRejectedValueOnce(networkError);

      await expect(
        provider.testRequest("GET", "https://api.test.com/data"),
      ).rejects.toThrow("Network failed");

      expect(logger.error).toHaveBeenCalledWith(
        "[BasePaymentProvider] Network error GET https://api.test.com/data",
        networkError,
      );
    });

    it("should handle HTTP errors", async () => {
      const logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const provider = new TestProvider("test_key", logger);

      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => "Not Found",
      } as Response);

      await expect(
        provider.testRequest("GET", "https://api.test.com/data"),
      ).rejects.toThrow("HTTP 404 https://api.test.com/data");

      expect(logger.error).toHaveBeenCalledWith(
        "[BasePaymentProvider] HTTP 404 GET https://api.test.com/data: Not Found",
      );
    });

    it("should log successful responses with debug level", async () => {
      const logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const provider = new TestProvider("test_key", logger);

      const responseData = { success: true, data: "test" };
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => responseData,
      } as Response);

      const result = await provider.testRequest(
        "GET",
        "https://api.test.com/data",
      );

      expect(logger.debug).toHaveBeenCalledWith(
        "[BasePaymentProvider] HTTP GET https://api.test.com/data ->",
        200,
        responseData,
      );

      expect(result).toEqual(responseData);
    });
  });
});
