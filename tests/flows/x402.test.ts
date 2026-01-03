import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makePaidWrapper } from '../../src/flows/x402.js';
import type { BasePaymentProvider } from '../../src/providers/base.js';
import type { ProviderInstances } from '../../src/providers/index.js';
import type { PriceConfig } from '../../src/types/config.js';
import type { McpServerLike } from '../../src/types/mcp.js';

function encodeSignature(payload: any) {
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

describe('RESUBMIT x402 Flow', () => {
  let mockProvider: BasePaymentProvider;
  let mockProviders: ProviderInstances;
  let mockServer: McpServerLike;
  let mockLogger: any;
  let mockStateStore: any;
  let priceInfo: PriceConfig;
  let storage: Map<string, any>;
  const clientInfo = () => ({ name: 'test', capabilities: {} });

  const paymentData = {
    accepts: [
      {
        scheme: 'exact',
        network: 'eip155:8453',
        amount: '1000000',
        asset: '0xasset',
        payTo: '0xPayTo',
        extra: {
          challengeId: 'challenge_123'
        }
      }
    ]
  };

  beforeEach(() => {
    mockProvider = {
      createPayment: vi.fn().mockResolvedValue({
        paymentId: 'challenge_123',
        paymentUrl: '',
        paymentData
      }),
      getPaymentStatus: vi.fn().mockResolvedValue('paid'),
      logger: undefined
    } as any;
    mockProviders = { x402: mockProvider } as any;

    mockServer = {
      tools: new Map(),
      registerTool: vi.fn()
    } as any;

    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };

    storage = new Map();
    mockStateStore = {
      set: vi.fn().mockImplementation(async (key: string, args: any) => {
        storage.set(key, args);
      }),
      get: vi.fn().mockImplementation(async (key: string) => {
        return storage.get(key);
      }),
      delete: vi.fn().mockImplementation(async (key: string) => {
        storage.delete(key);
      })
    };

    priceInfo = {
      amount: 25.0,
      currency: 'USD'
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
    storage.clear();
  });

  it('should reject when challenge ID is unknown', async () => {
    const mockTool = vi.fn();
    const wrapper = makePaidWrapper(
      mockTool,
      mockServer,
      mockProviders,
      priceInfo,
      'testTool',
      mockStateStore,
      {},
      clientInfo,
      mockLogger
    );

    const signature = encodeSignature({
      payload: { authorization: { to: '0xPayTo' } },
      accepted: {
        amount: '1000000',
        network: 'eip155:8453',
        asset: '0xasset',
        payTo: '0xPayTo',
        extra: { challengeId: 'missing' }
      }
    });

    await expect(
      wrapper({ param: 'value' }, { requestInfo: { headers: { 'payment-signature': signature } } })
    ).rejects.toThrow('Unknown challenge ID');
  });

  it('should reject mismatched signatures', async () => {
    storage.set('challenge_123', { args: { paymentData } });

    const mockTool = vi.fn();
    const wrapper = makePaidWrapper(
      mockTool,
      mockServer,
      mockProviders,
      priceInfo,
      'testTool',
      mockStateStore,
      {},
      clientInfo,
      mockLogger
    );

    const signature = encodeSignature({
      payload: { authorization: { to: '0xPayTo' } },
      accepted: {
        amount: '999',
        network: 'eip155:8453',
        asset: '0xasset',
        payTo: '0xPayTo',
        extra: { challengeId: 'challenge_123' }
      }
    });

    await expect(
      wrapper({ param: 'value' }, { requestInfo: { headers: { 'payment-signature': signature } } })
    ).rejects.toThrow('Incorrect signature');
    expect(mockProvider.getPaymentStatus).not.toHaveBeenCalled();
  });

  it('should error and clear state on verification error', async () => {
    storage.set('challenge_123', { args: { paymentData } });
    mockProvider.getPaymentStatus = vi.fn().mockResolvedValue('error');

    const mockTool = vi.fn();
    const wrapper = makePaidWrapper(
      mockTool,
      mockServer,
      mockProviders,
      priceInfo,
      'testTool',
      mockStateStore,
      {},
      clientInfo,
      mockLogger
    );

    const signature = encodeSignature({
      payload: { authorization: { to: '0xPayTo' } },
      accepted: {
        amount: '1000000',
        network: 'eip155:8453',
        asset: '0xasset',
        payTo: '0xPayTo',
        extra: { challengeId: 'challenge_123' }
      }
    });

    await expect(
      wrapper({ param: 'value' }, { requestInfo: { headers: { 'payment-signature': signature } } })
    ).rejects.toThrow('Payment failed');
    expect(mockStateStore.delete).toHaveBeenCalledWith('challenge_123');
  });

  it('should return payment required when no signature provided', async () => {
    const mockTool = vi.fn();
    const wrapper = makePaidWrapper(
      mockTool,
      mockServer,
      mockProviders,
      priceInfo,
      'testTool',
      mockStateStore,
      {},
      clientInfo,
      mockLogger
    );

    await expect(wrapper({ param: 'value' }, {} as any)).resolves.toEqual(
      expect.objectContaining({
        isError: true,
        error: expect.objectContaining({
          code: 402,
          message: 'Payment required',
          data: paymentData,
        }),
      })
    );
    expect(mockProvider.createPayment).toHaveBeenCalledWith(25, 'USD', 'testTool() execution fee');
  });

  it('should handle x402 v1 signatures and execute tool', async () => {
    const v1PaymentData = {
      x402Version: 1,
      accepts: [
        {
          scheme: 'exact',
          network: 'base',
          asset: 'USDC',
          payTo: '0xPayTo',
          maxAmountRequired: '1000000',
        },
      ],
    };
    mockProvider.createPayment = vi.fn().mockResolvedValue({
      paymentId: 'challenge_123',
      paymentUrl: '',
      paymentData: v1PaymentData,
    });
    mockProvider.getPaymentStatus = vi.fn().mockResolvedValue('paid');

    const v1ClientInfo = () => ({ name: 'test', sessionId: 's1', capabilities: {} });
    storage.set('s1-testTool', { args: { paymentData: v1PaymentData } });

    const mockTool = vi.fn().mockResolvedValue({ ok: true });
    const wrapper = makePaidWrapper(
      mockTool,
      mockServer,
      mockProviders,
      priceInfo,
      'testTool',
      mockStateStore,
      {},
      v1ClientInfo,
      mockLogger
    );

    const signature = encodeSignature({
      x402Version: 1,
      network: 'base',
      payload: { authorization: { to: '0xPayTo', value: '1000000' } },
    });

    const result = await wrapper({ param: 'value' }, { requestInfo: { headers: { 'payment-signature': signature } } });

    expect(result).toEqual({ ok: true });
    expect(mockProvider.getPaymentStatus).toHaveBeenCalledWith(signature);
    expect(mockStateStore.delete).toHaveBeenCalledWith('s1-testTool');
  });

  it('should throw pending error when payment is not confirmed', async () => {
    storage.set('challenge_123', { args: { paymentData } });
    mockProvider.getPaymentStatus = vi.fn().mockResolvedValue('pending');

    const mockTool = vi.fn();
    const wrapper = makePaidWrapper(
      mockTool,
      mockServer,
      mockProviders,
      priceInfo,
      'testTool',
      mockStateStore,
      {},
      clientInfo,
      mockLogger
    );

    const signature = encodeSignature({
      payload: { authorization: { to: '0xPayTo' } },
      accepted: {
        amount: '1000000',
        network: 'eip155:8453',
        asset: '0xasset',
        payTo: '0xPayTo',
        extra: { challengeId: 'challenge_123' },
      },
    });

    await expect(
      wrapper({ param: 'value' }, { requestInfo: { headers: { 'payment-signature': signature } } })
    ).rejects.toThrow('Payment is not confirmed yet');
  });

  it('should execute tool after successful payment', async () => {
    storage.set('challenge_123', { args: { paymentData } });

    const mockTool = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'Tool executed' }]
    });

    const wrapper = makePaidWrapper(
      mockTool,
      mockServer,
      mockProviders,
      priceInfo,
      'testTool',
      mockStateStore,
      {},
      clientInfo,
      mockLogger
    );

    const signature = encodeSignature({
      payload: { authorization: { to: '0xPayTo' } },
      accepted: {
        amount: '1000000',
        network: 'eip155:8453',
        asset: '0xasset',
        payTo: '0xPayTo',
        extra: { challengeId: 'challenge_123' }
      }
    });

    const result = await wrapper({ param: 'value' }, { requestInfo: { headers: { 'payment-signature': signature } } });

    expect(result).toEqual({
      content: [{ type: 'text', text: 'Tool executed' }]
    });
    expect(mockProvider.getPaymentStatus).toHaveBeenCalledWith(signature);
    expect(mockStateStore.delete).toHaveBeenCalledWith('challenge_123');
  });
});
