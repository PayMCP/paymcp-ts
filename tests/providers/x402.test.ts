import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { X402Provider } from '../../src/providers/x402.js';

const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const BASE_SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

function encodeSignature(payload: any) {
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

describe('X402Provider', () => {
  let mockLogger: any;

  beforeEach(() => {
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      log: vi.fn()
    };

    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createPayment', () => {
    it('should build x402 payment requirements with defaults', async () => {
      const provider = new X402Provider({
        payTo: '0xPayTo',
        logger: mockLogger
      });

      const result = await provider.createPayment(1.5, 'USD', 'Test description');

      expect(result.paymentUrl).toBe('');
      expect(result.paymentId).toBe(result.paymentData?.accepts?.[0]?.extra?.challengeId);
      expect(result.paymentData).toEqual(
        expect.objectContaining({
          x402Version: 2,
          error: 'Payment required',
          accepts: [
            expect.objectContaining({
              scheme: 'exact',
              network: 'eip155:8453',
              amount: '1500000',
              asset: BASE_USDC,
              payTo: '0xPayTo'
            })
          ]
        })
      );
    });

    it('should include resourceInfo when provided', async () => {
      const resourceInfo = {
        url: 'https://example.com/resource',
        description: 'Example resource',
        mimeType: 'text/plain'
      };

      const provider = new X402Provider({
        payTo: '0xPayTo',
        resourceInfo,
        logger: mockLogger
      });

      const result = await provider.createPayment(2, 'USD', 'With resource');

      expect(result.paymentData?.resourceInfo).toEqual(resourceInfo);
    });

    it('should resolve asset symbols using network mapping', async () => {
      const provider = new X402Provider({
        payTo: '0xPayTo',
        network: 'eip155:84532',
        asset: 'USDC',
        logger: mockLogger
      });

      const result = await provider.createPayment(1, 'USD', 'Mapped asset');

      expect(result.paymentData?.accepts?.[0]?.asset).toBe(BASE_SEPOLIA_USDC);
    });
  });

  describe('getPaymentStatus', () => {
    it('should return error when payTo does not match signature', async () => {
      const provider = new X402Provider({
        payTo: '0xPayTo',
        logger: mockLogger
      });

      const sig = encodeSignature({
        x402Version: 2,
        payload: { authorization: { to: '0xOther' } },
        accepted: {
          amount: '100',
          network: 'eip155:8453',
          asset: BASE_USDC,
          payTo: '0xOther',
          extra: { challengeId: 'challenge_1' }
        }
      });

      const result = await provider.getPaymentStatus(sig);

      expect(result).toBe('error');
      expect(mockLogger.warn).toHaveBeenCalled();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should verify and settle payment with facilitator', async () => {
      const provider = new X402Provider({
        payTo: '0xPayTo',
        facilitator: {
          url: 'https://facilitator.test',
          apiKey: 'test_key'
        },
        logger: mockLogger
      });

      const signature = {
        x402Version: 2,
        payload: { authorization: { to: '0xPayTo' } },
        accepted: {
          amount: '1000000',
          network: 'eip155:8453',
          asset: BASE_USDC,
          payTo: '0xPayTo',
          extra: { challengeId: 'challenge_1' }
        }
      };

      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ success: true })
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ success: true })
        });

      const result = await provider.getPaymentStatus(encodeSignature(signature));

      expect(result).toBe('paid');
      expect(global.fetch).toHaveBeenNthCalledWith(
        1,
        'https://facilitator.test/verify',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer test_key'
          }
        })
      );
      expect(global.fetch).toHaveBeenNthCalledWith(
        2,
        'https://facilitator.test/settle',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer test_key'
          }
        })
      );

      const verifyBody = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(verifyBody.paymentRequirements).toEqual(
        expect.objectContaining({
          network: 'eip155:8453',
          amount: '1000000',
          asset: BASE_USDC,
          payTo: '0xPayTo'
        })
      );
    });

    it('should return error when verify fails', async () => {
      const provider = new X402Provider({
        payTo: '0xPayTo',
        logger: mockLogger
      });

      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: () => Promise.resolve('bad verify')
      });

      const signature = {
        x402Version: 2,
        payload: { authorization: { to: '0xPayTo' } },
        accepted: {
          amount: '1000000',
          network: 'eip155:8453',
          asset: BASE_USDC,
          payTo: '0xPayTo',
          extra: { challengeId: 'challenge_1' }
        }
      };

      const result = await provider.getPaymentStatus(encodeSignature(signature));

      expect(result).toBe('error');
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(mockLogger.error).toHaveBeenCalledWith('[PayMCP] x402 verify failed: bad verify');
    });

    it('should return error when settle fails', async () => {
      const provider = new X402Provider({
        payTo: '0xPayTo',
        logger: mockLogger
      });

      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ success: true })
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ success: false, errorReason: 'not settled' })
        });

      const signature = {
        x402Version: 2,
        payload: { authorization: { to: '0xPayTo' } },
        accepted: {
          amount: '1000000',
          network: 'eip155:8453',
          asset: BASE_USDC,
          payTo: '0xPayTo',
          extra: { challengeId: 'challenge_1' }
        }
      };

      const result = await provider.getPaymentStatus(encodeSignature(signature));

      expect(result).toBe('error');
      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(mockLogger.error).toHaveBeenCalledWith('[PayMCP] x402 settle failed: not settled');
    });
  });
});
