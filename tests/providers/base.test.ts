import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BasePaymentProvider } from '../../src/providers/base.js';
import type { CreatePaymentResult } from '../../src/types/payment.js';

// Concrete implementation for testing the abstract base class
class TestPaymentProvider extends BasePaymentProvider {
  constructor(apiKey: string, logger?: any) {
    super(apiKey, logger);
  }

  async createPayment(amount: number, currency: string, description: string): Promise<CreatePaymentResult> {
    // Simple test implementation
    return {
      paymentId: 'test_payment_123',
      paymentUrl: `https://test.example.com/pay/${amount}${currency}`
    };
  }

  async getPaymentStatus(paymentId: string): Promise<string> {
    // Simple test implementation
    return paymentId.includes('paid') ? 'paid' : 'pending';
  }

  // Expose protected methods for testing
  public testBuildHeaders() {
    return this.buildHeaders();
  }

  public testRequest<T = any>(method: string, url: string, data?: any): Promise<T> {
    return this.request<T>(method, url, data);
  }
}

describe('BasePaymentProvider', () => {
  let provider: TestPaymentProvider;
  let mockLogger: any;

  beforeEach(() => {
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };

    provider = new TestPaymentProvider('test_api_key_123', mockLogger);

    // Mock global fetch
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with api key and logger', () => {
      const provider = new TestPaymentProvider('my_key', mockLogger);
      expect(provider).toBeInstanceOf(BasePaymentProvider);
    });

    it('should use console as default logger when none provided', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const provider = new TestPaymentProvider('my_key');
      expect(provider).toBeInstanceOf(BasePaymentProvider);
      consoleSpy.mockRestore();
    });
  });

  describe('buildHeaders', () => {
    it('should return default headers with Bearer token', () => {
      const headers = provider.testBuildHeaders();
      expect(headers).toEqual({
        Authorization: 'Bearer test_api_key_123',
        'Content-Type': 'application/x-www-form-urlencoded'
      });
    });
  });

  describe('request method', () => {
    it('should make successful GET request without data', async () => {
      const mockResponse = { id: '123', status: 'success' };
      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockResponse),
        text: () => Promise.resolve(JSON.stringify(mockResponse))
      });

      const result = await provider.testRequest('GET', 'https://api.example.com/test');

      expect(global.fetch).toHaveBeenCalledWith('https://api.example.com/test', {
        method: 'GET',
        headers: {
          Authorization: 'Bearer test_api_key_123',
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });
      expect(result).toEqual(mockResponse);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        '[BasePaymentProvider] HTTP GET https://api.example.com/test ->',
        200,
        mockResponse
      );
    });

    it('should make successful GET request with query parameters', async () => {
      const mockResponse = { results: [] };
      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockResponse),
        text: () => Promise.resolve(JSON.stringify(mockResponse))
      });

      const data = { limit: 10, offset: 20, filter: 'active' };
      await provider.testRequest('GET', 'https://api.example.com/items', data);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.example.com/items?limit=10&offset=20&filter=active',
        expect.objectContaining({
          method: 'GET'
        })
      );
    });

    it('should handle GET request with existing query parameters', async () => {
      const mockResponse = { data: 'test' };
      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockResponse)
      });

      const data = { page: 2 };
      await provider.testRequest('GET', 'https://api.example.com/items?sort=name', data);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.example.com/items?sort=name&page=2',
        expect.objectContaining({
          method: 'GET'
        })
      );
    });

    it('should make successful POST request with form data', async () => {
      const mockResponse = { id: 'created_123' };
      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 201,
        json: () => Promise.resolve(mockResponse)
      });

      const data = { name: 'test', amount: 100 };
      await provider.testRequest('POST', 'https://api.example.com/create', data);

      expect(global.fetch).toHaveBeenCalledWith('https://api.example.com/create', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test_api_key_123',
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: expect.any(URLSearchParams)
      });

      // Verify the URLSearchParams content
      const call = (global.fetch as any).mock.calls[0];
      const body = call[1].body as URLSearchParams;
      expect(body.get('name')).toBe('test');
      expect(body.get('amount')).toBe('100');
    });

    it('should make successful POST request with JSON data when content-type is JSON', async () => {
      // Create provider with JSON headers
      class JsonTestProvider extends TestPaymentProvider {
        protected buildHeaders(): Record<string, string> {
          return {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          };
        }
      }

      const jsonProvider = new JsonTestProvider('test_key', mockLogger);

      const mockResponse = { id: 'json_123' };
      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockResponse)
      });

      const data = { name: 'test', nested: { value: 42 } };
      await jsonProvider.testRequest('POST', 'https://api.example.com/json', data);

      expect(global.fetch).toHaveBeenCalledWith('https://api.example.com/json', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test_key',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
      });
    });

    it('should handle PUT request with form data', async () => {
      const mockResponse = { updated: true };
      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockResponse)
      });

      const data = { status: 'active', priority: 'high' };
      await provider.testRequest('PUT', 'https://api.example.com/update/123', data);

      expect(global.fetch).toHaveBeenCalledWith('https://api.example.com/update/123', {
        method: 'PUT',
        headers: expect.objectContaining({
          'Content-Type': 'application/x-www-form-urlencoded'
        }),
        body: expect.any(URLSearchParams)
      });

      // Verify the URLSearchParams content
      const call = (global.fetch as any).mock.calls[0];
      const body = call[1].body as URLSearchParams;
      expect(body.get('status')).toBe('active');
      expect(body.get('priority')).toBe('high');
    });

    it('should handle request with no data for POST', async () => {
      const mockResponse = { result: 'empty' };
      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockResponse)
      });

      await provider.testRequest('POST', 'https://api.example.com/empty');

      expect(global.fetch).toHaveBeenCalledWith('https://api.example.com/empty', {
        method: 'POST',
        headers: expect.any(Object),
        body: expect.any(URLSearchParams)
      });

      // Verify the URLSearchParams is empty
      const call = (global.fetch as any).mock.calls[0];
      const body = call[1].body as URLSearchParams;
      expect(Array.from(body.keys())).toHaveLength(0);
    });

    it('should handle network errors', async () => {
      const networkError = new Error('Network timeout');
      (global.fetch as any).mockRejectedValue(networkError);

      await expect(
        provider.testRequest('GET', 'https://api.example.com/fail')
      ).rejects.toThrow('Network timeout');

      expect(mockLogger.error).toHaveBeenCalledWith(
        '[BasePaymentProvider] Network error GET https://api.example.com/fail',
        networkError
      );
    });

    it('should handle HTTP errors (4xx)', async () => {
      const errorBody = '{"error": "Bad Request", "code": "INVALID_PARAMS"}';
      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve(errorBody)
      });

      await expect(
        provider.testRequest('POST', 'https://api.example.com/invalid')
      ).rejects.toThrow('HTTP 400 https://api.example.com/invalid');

      expect(mockLogger.error).toHaveBeenCalledWith(
        '[BasePaymentProvider] HTTP 400 POST https://api.example.com/invalid: ' + errorBody
      );
    });

    it('should handle HTTP errors (5xx)', async () => {
      const errorBody = 'Internal Server Error';
      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve(errorBody)
      });

      await expect(
        provider.testRequest('GET', 'https://api.example.com/server-error')
      ).rejects.toThrow('HTTP 500 https://api.example.com/server-error');

      expect(mockLogger.error).toHaveBeenCalledWith(
        '[BasePaymentProvider] HTTP 500 GET https://api.example.com/server-error: ' + errorBody
      );
    });

    it('should convert data values to strings for form encoding', async () => {
      const mockResponse = { ok: true };
      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockResponse)
      });

      const data = {
        stringValue: 'text',
        numberValue: 42,
        booleanValue: true,
        nullValue: null,
        undefinedValue: undefined
      };

      await provider.testRequest('POST', 'https://api.example.com/types', data);

      expect(global.fetch).toHaveBeenCalledWith('https://api.example.com/types', {
        method: 'POST',
        headers: expect.any(Object),
        body: expect.any(URLSearchParams)
      });

      // Verify the URLSearchParams content with type conversion
      const call = (global.fetch as any).mock.calls[0];
      const body = call[1].body as URLSearchParams;
      expect(body.get('stringValue')).toBe('text');
      expect(body.get('numberValue')).toBe('42');
      expect(body.get('booleanValue')).toBe('true');
      expect(body.get('nullValue')).toBe('null');
      expect(body.get('undefinedValue')).toBe('undefined');
    });

    it('should handle empty GET data gracefully', async () => {
      const mockResponse = { data: [] };
      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockResponse)
      });

      await provider.testRequest('GET', 'https://api.example.com/empty', {});

      expect(global.fetch).toHaveBeenCalledWith('https://api.example.com/empty', {
        method: 'GET',
        headers: expect.any(Object)
      });
    });

    it('should handle case-insensitive HTTP methods', async () => {
      const mockResponse = { success: true };
      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockResponse)
      });

      await provider.testRequest('get', 'https://api.example.com/lowercase');

      expect(global.fetch).toHaveBeenCalledWith('https://api.example.com/lowercase', {
        method: 'GET',
        headers: expect.any(Object)
      });

      await provider.testRequest('post', 'https://api.example.com/lowercase', { data: 'test' });

      expect(global.fetch).toHaveBeenCalledWith('https://api.example.com/lowercase', {
        method: 'POST',
        headers: expect.any(Object),
        body: expect.any(URLSearchParams)
      });

      // Verify the URLSearchParams content
      const secondCall = (global.fetch as any).mock.calls[1];
      const postBody = secondCall[1].body as URLSearchParams;
      expect(postBody.get('data')).toBe('test');
    });
  });

  describe('abstract methods implementation', () => {
    it('should implement createPayment', async () => {
      const result = await provider.createPayment(25.50, 'USD', 'Test payment');
      expect(result).toEqual({
        paymentId: 'test_payment_123',
        paymentUrl: 'https://test.example.com/pay/25.5USD'
      });
    });

    it('should implement getPaymentStatus', async () => {
      const paidStatus = await provider.getPaymentStatus('paid_123');
      expect(paidStatus).toBe('paid');

      const pendingStatus = await provider.getPaymentStatus('pending_456');
      expect(pendingStatus).toBe('pending');
    });
  });

  describe('subscription helpers', () => {
    it('should reject getSubscriptions by default', async () => {
      await expect(provider.getSubscriptions('user_1', 'u@example.com')).rejects.toThrow(
        'Subscriptions are not supported for this payment provider'
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        '[BasePaymentProvider] getSubscriptions called for provider that does not support subscriptions (userId=user_1)',
      );
    });

    it('should reject startSubscription by default', async () => {
      await expect(provider.startSubscription('plan_1', 'user_1', 'u@example.com')).rejects.toThrow(
        'Subscriptions are not supported for this payment provider'
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        '[BasePaymentProvider] startSubscription called for provider that does not support subscriptions (userId=user_1, planId=plan_1)',
      );
    });

    it('should reject cancelSubscription by default', async () => {
      await expect(provider.cancelSubscription('sub_1', 'user_1', 'u@example.com')).rejects.toThrow(
        'Subscriptions are not supported for this payment provider'
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        '[BasePaymentProvider] cancelSubscription called for provider that does not support subscriptions (userId=user_1, subscriptionId=sub_1)',
      );
    });
  });
});
