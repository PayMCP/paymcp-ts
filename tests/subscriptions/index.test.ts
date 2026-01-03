import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeSubscriptionWrapper, registerSubscriptionTools } from '../../src/subscriptions/index.js';
import type { ProviderInstances } from '../../src/providers/index.js';

function createJwt(payload: object, expiresIn: number = 3600): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const finalPayload = { ...payload, exp: Math.floor(Date.now() / 1000) + expiresIn };

  const encodeBase64Url = (obj: object) => {
    const json = JSON.stringify(obj);
    const base64 = Buffer.from(json).toString('base64');
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };

  const headerB64 = encodeBase64Url(header);
  const payloadB64 = encodeBase64Url(finalPayload);
  const signature = 'fake_signature';

  return `${headerB64}.${payloadB64}.${signature}`;
}

describe('makeSubscriptionWrapper', () => {
  let mockLogger: any;
  let mockProvider: any;
  let mockProviders: ProviderInstances;
  let mockServer: any;
  let mockStateStore: any;

  beforeEach(() => {
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };

    mockProvider = {
      getSubscriptions: vi.fn(),
      logger: mockLogger
    };
    mockProviders = { mock: mockProvider };

    mockServer = {};
    mockStateStore = {};
  });

  describe('authentication', () => {
    it('should extract userId from authInfo.userId', async () => {
      mockProvider.getSubscriptions.mockResolvedValue({
        current_subscriptions: [{ planId: 'plan_123', status: 'active' }],
        available_subscriptions: []
      });

      const originalHandler = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });

      const wrapper = makeSubscriptionWrapper(
        originalHandler,
        mockServer,
        mockProviders,
        { plan: 'plan_123' },
        'test_tool',
        mockStateStore,
        {},
        mockLogger
      );

      const extra = { authInfo: { userId: 'user123' } };
      await wrapper({}, extra);

      expect(mockProvider.getSubscriptions).toHaveBeenCalledWith('user123', undefined);
      expect(originalHandler).toHaveBeenCalled();
    });

    it('should extract userId from JWT token sub claim', async () => {
      mockProvider.getSubscriptions.mockResolvedValue({
        current_subscriptions: [{ planId: 'plan_123', status: 'active' }],
        available_subscriptions: []
      });

      const originalHandler = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });

      const wrapper = makeSubscriptionWrapper(
        originalHandler,
        mockServer,
        mockProviders,
        { plan: 'plan_123' },
        'test_tool',
        mockStateStore,
        {},
        mockLogger
      );

      const token = createJwt({ sub: 'jwt_user123', email: 'test@example.com' });
      const extra = { authInfo: { token } };
      await wrapper({}, extra);

      expect(mockProvider.getSubscriptions).toHaveBeenCalledWith('jwt_user123', 'test@example.com');
    });

    it('should throw error when userId is not available', async () => {
      const originalHandler = vi.fn();

      const wrapper = makeSubscriptionWrapper(
        originalHandler,
        mockServer,
        mockProviders,
        { plan: 'plan_123' },
        'test_tool',
        mockStateStore,
        {},
        mockLogger
      );

      const extra = { authInfo: {} };

      await expect(wrapper({}, extra)).rejects.toThrow('Not authorized');
      expect(mockLogger.error).toHaveBeenCalled();
      expect(originalHandler).not.toHaveBeenCalled();
    });

    it('should extract email from authInfo.email', async () => {
      mockProvider.getSubscriptions.mockResolvedValue({
        current_subscriptions: [{ planId: 'plan_123', status: 'active' }],
        available_subscriptions: []
      });

      const originalHandler = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });

      const wrapper = makeSubscriptionWrapper(
        originalHandler,
        mockServer,
        mockProviders,
        { plan: 'plan_123' },
        'test_tool',
        mockStateStore,
        {},
        mockLogger
      );

      const extra = { authInfo: { userId: 'user123', email: 'direct@example.com' } };
      await wrapper({}, extra);

      expect(mockProvider.getSubscriptions).toHaveBeenCalledWith('user123', 'direct@example.com');
    });
  });

  describe('subscription validation', () => {
    it('should allow access when user has required subscription', async () => {
      mockProvider.getSubscriptions.mockResolvedValue({
        current_subscriptions: [{ planId: 'plan_123', status: 'active' }],
        available_subscriptions: []
      });

      const originalHandler = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'success' }] });

      const wrapper = makeSubscriptionWrapper(
        originalHandler,
        mockServer,
        mockProviders,
        { plan: 'plan_123' },
        'test_tool',
        mockStateStore,
        {},
        mockLogger
      );

      const extra = { authInfo: { userId: 'user123' } };
      const result = await wrapper({}, extra);

      expect(originalHandler).toHaveBeenCalled();
      expect(result).toEqual({ content: [{ type: 'text', text: 'success' }] });
    });

    it('should allow access with trialing subscription', async () => {
      mockProvider.getSubscriptions.mockResolvedValue({
        current_subscriptions: [{ planId: 'plan_123', status: 'trialing' }],
        available_subscriptions: []
      });

      const originalHandler = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });

      const wrapper = makeSubscriptionWrapper(
        originalHandler,
        mockServer,
        mockProviders,
        { plan: 'plan_123' },
        'test_tool',
        mockStateStore,
        {},
        mockLogger
      );

      const extra = { authInfo: { userId: 'user123' } };
      await wrapper({}, extra);

      expect(originalHandler).toHaveBeenCalled();
    });

    it('should allow access with past_due subscription', async () => {
      mockProvider.getSubscriptions.mockResolvedValue({
        current_subscriptions: [{ planId: 'plan_123', status: 'past_due' }],
        available_subscriptions: []
      });

      const originalHandler = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });

      const wrapper = makeSubscriptionWrapper(
        originalHandler,
        mockServer,
        mockProviders,
        { plan: 'plan_123' },
        'test_tool',
        mockStateStore,
        {},
        mockLogger
      );

      const extra = { authInfo: { userId: 'user123' } };
      await wrapper({}, extra);

      expect(originalHandler).toHaveBeenCalled();
    });

    it('should deny access when subscription is canceled', async () => {
      mockProvider.getSubscriptions.mockResolvedValue({
        current_subscriptions: [{ planId: 'plan_123', status: 'canceled' }],
        available_subscriptions: [{ planId: 'plan_123', title: 'Pro Plan' }]
      });

      const originalHandler = vi.fn();

      const wrapper = makeSubscriptionWrapper(
        originalHandler,
        mockServer,
        mockProviders,
        { plan: 'plan_123' },
        'test_tool',
        mockStateStore,
        {},
        mockLogger
      );

      const extra = { authInfo: { userId: 'user123' } };

      await expect(wrapper({}, extra)).rejects.toThrow();
      expect(originalHandler).not.toHaveBeenCalled();
    });

    it('should deny access when user has wrong plan', async () => {
      mockProvider.getSubscriptions.mockResolvedValue({
        current_subscriptions: [{ planId: 'plan_other', status: 'active' }],
        available_subscriptions: [{ planId: 'plan_123', title: 'Required Plan' }]
      });

      const originalHandler = vi.fn();

      const wrapper = makeSubscriptionWrapper(
        originalHandler,
        mockServer,
        mockProviders,
        { plan: 'plan_123' },
        'test_tool',
        mockStateStore,
        {},
        mockLogger
      );

      const extra = { authInfo: { userId: 'user123' } };

      await expect(wrapper({}, extra)).rejects.toThrow();
      expect(originalHandler).not.toHaveBeenCalled();
    });

    it('should allow access when user has any of multiple required plans', async () => {
      mockProvider.getSubscriptions.mockResolvedValue({
        current_subscriptions: [{ planId: 'plan_b', status: 'active' }],
        available_subscriptions: []
      });

      const originalHandler = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });

      const wrapper = makeSubscriptionWrapper(
        originalHandler,
        mockServer,
        mockProviders,
        { plan: ['plan_a', 'plan_b', 'plan_c'] },
        'test_tool',
        mockStateStore,
        {},
        mockLogger
      );

      const extra = { authInfo: { userId: 'user123' } };
      await wrapper({}, extra);

      expect(originalHandler).toHaveBeenCalled();
    });

    it('should skip validation when no plan is required', async () => {
      const originalHandler = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });

      const wrapper = makeSubscriptionWrapper(
        originalHandler,
        mockServer,
        mockProviders,
        { plan: '' },
        'test_tool',
        mockStateStore,
        {},
        mockLogger
      );

      const extra = { authInfo: { userId: 'user123' } };
      await wrapper({}, extra);

      expect(mockProvider.getSubscriptions).not.toHaveBeenCalled();
      expect(originalHandler).toHaveBeenCalled();
    });

    it('should skip validation when plan is empty array', async () => {
      const originalHandler = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });

      const wrapper = makeSubscriptionWrapper(
        originalHandler,
        mockServer,
        mockProviders,
        { plan: [] },
        'test_tool',
        mockStateStore,
        {},
        mockLogger
      );

      const extra = { authInfo: { userId: 'user123' } };
      await wrapper({}, extra);

      expect(mockProvider.getSubscriptions).not.toHaveBeenCalled();
      expect(originalHandler).toHaveBeenCalled();
    });
  });

  describe('provider error handling', () => {
    it('should throw clear error when provider does not support subscriptions', async () => {
      mockProvider.getSubscriptions.mockRejectedValue(
        new Error('Subscriptions are not supported for this payment provider')
      );

      const originalHandler = vi.fn();

      const wrapper = makeSubscriptionWrapper(
        originalHandler,
        mockServer,
        mockProviders,
        { plan: 'plan_123' },
        'test_tool',
        mockStateStore,
        {},
        mockLogger
      );

      const extra = { authInfo: { userId: 'user123' } };

      await expect(wrapper({}, extra)).rejects.toThrow(
        'Subscriptions are required for this tool, but the current payment provider does not support subscription checks.'
      );
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('should rethrow other provider errors', async () => {
      mockProvider.getSubscriptions.mockRejectedValue(new Error('Network error'));

      const originalHandler = vi.fn();

      const wrapper = makeSubscriptionWrapper(
        originalHandler,
        mockServer,
        mockProviders,
        { plan: 'plan_123' },
        'test_tool',
        mockStateStore,
        {},
        mockLogger
      );

      const extra = { authInfo: { userId: 'user123' } };

      await expect(wrapper({}, extra)).rejects.toThrow('Network error');
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('handler invocation', () => {
    it('should pass args and extra to original handler', async () => {
      mockProvider.getSubscriptions.mockResolvedValue({
        current_subscriptions: [{ planId: 'plan_123', status: 'active' }],
        available_subscriptions: []
      });

      const originalHandler = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });

      const wrapper = makeSubscriptionWrapper(
        originalHandler,
        mockServer,
        mockProviders,
        { plan: 'plan_123' },
        'test_tool',
        mockStateStore,
        {},
        mockLogger
      );

      const args = { input: 'test value' };
      const extra = { authInfo: { userId: 'user123' } };
      await wrapper(args, extra);

      expect(originalHandler).toHaveBeenCalledWith(args, extra);
    });

    it('should handle single argument invocation', async () => {
      mockProvider.getSubscriptions.mockResolvedValue({
        current_subscriptions: [{ planId: 'plan_123', status: 'active' }],
        available_subscriptions: []
      });

      const originalHandler = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });

      const wrapper = makeSubscriptionWrapper(
        originalHandler,
        mockServer,
        mockProviders,
        { plan: 'plan_123' },
        'test_tool',
        mockStateStore,
        {},
        mockLogger
      );

      const extra = { authInfo: { userId: 'user123' } };
      await wrapper(extra);

      expect(originalHandler).toHaveBeenCalledWith(extra);
    });
  });

  describe('logger fallback', () => {
    it('should use provider logger when no logger provided', async () => {
      mockProvider.getSubscriptions.mockResolvedValue({
        current_subscriptions: [{ planId: 'plan_123', status: 'active' }],
        available_subscriptions: []
      });

      const originalHandler = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });

      const wrapper = makeSubscriptionWrapper(
        originalHandler,
        mockServer,
        mockProviders,
        { plan: 'plan_123' },
        'test_tool',
        mockStateStore,
        {},
        undefined // no logger
      );

      const extra = { authInfo: { userId: 'user123' } };
      await wrapper({}, extra);

      expect(mockProvider.logger.debug).toHaveBeenCalled();
    });
  });

  describe('subscription response normalization', () => {
    it('should handle currentSubscriptions camelCase response', async () => {
      mockProvider.getSubscriptions.mockResolvedValue({
        currentSubscriptions: [{ planId: 'plan_123', status: 'active' }],
        availableSubscriptions: []
      });

      const originalHandler = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });

      const wrapper = makeSubscriptionWrapper(
        originalHandler,
        mockServer,
        mockProviders,
        { plan: 'plan_123' },
        'test_tool',
        mockStateStore,
        {},
        mockLogger
      );

      const extra = { authInfo: { userId: 'user123' } };
      await wrapper({}, extra);

      expect(originalHandler).toHaveBeenCalled();
    });

    it('should handle priceId as planId alias', async () => {
      mockProvider.getSubscriptions.mockResolvedValue({
        current_subscriptions: [{ priceId: 'plan_123', status: 'active' }],
        available_subscriptions: []
      });

      const originalHandler = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });

      const wrapper = makeSubscriptionWrapper(
        originalHandler,
        mockServer,
        mockProviders,
        { plan: 'plan_123' },
        'test_tool',
        mockStateStore,
        {},
        mockLogger
      );

      const extra = { authInfo: { userId: 'user123' } };
      await wrapper({}, extra);

      expect(originalHandler).toHaveBeenCalled();
    });

    it('should handle plan_id snake_case as planId alias', async () => {
      mockProvider.getSubscriptions.mockResolvedValue({
        current_subscriptions: [{ plan_id: 'plan_123', status: 'active' }],
        available_subscriptions: []
      });

      const originalHandler = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });

      const wrapper = makeSubscriptionWrapper(
        originalHandler,
        mockServer,
        mockProviders,
        { plan: 'plan_123' },
        'test_tool',
        mockStateStore,
        {},
        mockLogger
      );

      const extra = { authInfo: { userId: 'user123' } };
      await wrapper({}, extra);

      expect(originalHandler).toHaveBeenCalled();
    });
  });
});

describe('registerSubscriptionTools', () => {
  let mockLogger: any;
  let mockProvider: any;
  let mockProviders: ProviderInstances;
  let mockServer: any;
  let registeredTools: Map<string, any>;

  beforeEach(() => {
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };

    mockProvider = {
      getSubscriptions: vi.fn(),
      startSubscription: vi.fn(),
      cancelSubscription: vi.fn(),
      logger: mockLogger
    };
    mockProviders = { mock: mockProvider };

    registeredTools = new Map();
    mockServer = {
      registerTool: vi.fn((name: string, config: any, handler: any) => {
        registeredTools.set(name, { config, handler });
      })
    };
  });

  it('should register list_subscriptions tool', () => {
    registerSubscriptionTools(mockServer, mockProviders, mockLogger);

    expect(mockServer.registerTool).toHaveBeenCalledWith(
      'list_subscriptions',
      expect.objectContaining({
        title: expect.any(String),
        description: expect.any(String)
      }),
      expect.any(Function)
    );
  });

  it('should register start_subscription tool', () => {
    registerSubscriptionTools(mockServer, mockProviders, mockLogger);

    expect(mockServer.registerTool).toHaveBeenCalledWith(
      'start_subscription',
      expect.objectContaining({
        title: expect.any(String),
        description: expect.any(String),
        inputSchema: expect.any(Object)
      }),
      expect.any(Function)
    );
  });

  it('should register cancel_subscription tool', () => {
    registerSubscriptionTools(mockServer, mockProviders, mockLogger);

    expect(mockServer.registerTool).toHaveBeenCalledWith(
      'cancel_subscription',
      expect.objectContaining({
        title: expect.any(String),
        description: expect.any(String),
        inputSchema: expect.any(Object)
      }),
      expect.any(Function)
    );
  });

  describe('list_subscriptions handler', () => {
    it('should call provider.getSubscriptions and return result', async () => {
      const subscriptionData = {
        current_subscriptions: [{ planId: 'plan_123', status: 'active' }],
        available_subscriptions: [{ planId: 'plan_456', title: 'Pro' }]
      };
      mockProvider.getSubscriptions.mockResolvedValue(subscriptionData);

      registerSubscriptionTools(mockServer, mockProviders, mockLogger);
      const { handler } = registeredTools.get('list_subscriptions')!;

      const token = createJwt({ sub: 'user123', email: 'test@example.com' });
      const extra = { authInfo: { token } };
      const result = await handler(extra);

      expect(mockProvider.getSubscriptions).toHaveBeenCalledWith('user123', 'test@example.com');
      expect(result.content[0].type).toBe('text');
      expect(JSON.parse(result.content[0].text)).toEqual(subscriptionData);
    });

    it('should throw when userId is not available', async () => {
      registerSubscriptionTools(mockServer, mockProviders, mockLogger);
      const { handler } = registeredTools.get('list_subscriptions')!;

      const extra = { authInfo: {} };

      await expect(handler(extra)).rejects.toThrow('Not authorized');
    });
  });

  describe('start_subscription handler', () => {
    it('should call provider.startSubscription and return result', async () => {
      const startResult = {
        message: 'Subscription started',
        checkoutUrl: 'https://checkout.stripe.com/session',
        planId: 'plan_123'
      };
      mockProvider.startSubscription.mockResolvedValue(startResult);

      registerSubscriptionTools(mockServer, mockProviders, mockLogger);
      const { handler } = registeredTools.get('start_subscription')!;

      const token = createJwt({ sub: 'user123', email: 'test@example.com' });
      const extra = { authInfo: { token } };
      const result = await handler({ planId: 'plan_123' }, extra);

      expect(mockProvider.startSubscription).toHaveBeenCalledWith('plan_123', 'user123', 'test@example.com');
      expect(result.content[0].type).toBe('text');
      expect(JSON.parse(result.content[0].text)).toEqual(startResult);
    });

    it('should throw when userId is not available', async () => {
      registerSubscriptionTools(mockServer, mockProviders, mockLogger);
      const { handler } = registeredTools.get('start_subscription')!;

      const extra = { authInfo: {} };

      await expect(handler({ planId: 'plan_123' }, extra)).rejects.toThrow('Not authorized');
    });

    it('should throw when planId is not provided', async () => {
      registerSubscriptionTools(mockServer, mockProviders, mockLogger);
      const { handler } = registeredTools.get('start_subscription')!;

      const extra = { authInfo: { userId: 'user123' } };

      await expect(handler({ planId: '' }, extra)).rejects.toThrow('planId is required');
    });
  });

  describe('cancel_subscription handler', () => {
    it('should call provider.cancelSubscription and return result', async () => {
      const cancelResult = {
        message: 'Subscription cancelled',
        canceled: true,
        endDate: '2024-12-31T00:00:00.000Z'
      };
      mockProvider.cancelSubscription.mockResolvedValue(cancelResult);

      registerSubscriptionTools(mockServer, mockProviders, mockLogger);
      const { handler } = registeredTools.get('cancel_subscription')!;

      const token = createJwt({ sub: 'user123', email: 'test@example.com' });
      const extra = { authInfo: { token } };
      const result = await handler({ subscriptionId: 'sub_123' }, extra);

      expect(mockProvider.cancelSubscription).toHaveBeenCalledWith('sub_123', 'user123', 'test@example.com');
      expect(result.content[0].type).toBe('text');
      expect(JSON.parse(result.content[0].text)).toEqual(cancelResult);
    });

    it('should throw when userId is not available', async () => {
      registerSubscriptionTools(mockServer, mockProviders, mockLogger);
      const { handler } = registeredTools.get('cancel_subscription')!;

      const extra = { authInfo: {} };

      await expect(handler({ subscriptionId: 'sub_123' }, extra)).rejects.toThrow('Not authorized');
    });

    it('should throw when subscriptionId is not provided', async () => {
      registerSubscriptionTools(mockServer, mockProviders, mockLogger);
      const { handler } = registeredTools.get('cancel_subscription')!;

      const extra = { authInfo: { userId: 'user123' } };

      await expect(handler({ subscriptionId: '' }, extra)).rejects.toThrow('subscriptionId is required');
    });
  });
});
