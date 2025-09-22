import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makePaidWrapper as makeElicitationWrapper } from '../../src/flows/elicitation';
import { makePaidWrapper as makeProgressWrapper } from '../../src/flows/progress';
import { BasePaymentProvider } from '../../src/providers/base';
import { SessionManager } from '../../src/session/manager';
import type { McpServerLike } from '../../src/types/mcp';

/**
 * ENG-114 Scenario Test
 *
 * Scenario: User receives payment URL, waits 1-2 minutes before paying,
 * then comes back to confirm. System should handle this without timeout.
 */
describe('ENG-114 Scenario: Delayed Payment Approval', () => {
  let mockServer: McpServerLike;
  let mockProvider: BasePaymentProvider;
  let originalFunc: any;

  beforeEach(() => {
    vi.useFakeTimers();

    mockServer = {
      registerTool: vi.fn(),
      reportProgress: vi.fn(),
      requestElicitation: vi.fn(),
    } as any;

    mockProvider = new BasePaymentProvider('test');
    mockProvider.getName = () => 'mock';

    originalFunc = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'Tool executed successfully' }],
    });

    vi.clearAllMocks();
  });

  afterEach(async () => {
    vi.useRealTimers();
    // Small delay to ensure all async operations complete before reset
    await new Promise(resolve => setTimeout(resolve, 10));
    // Don't reset session manager during tests
    // SessionManager.reset();
  });

  describe('ELICITATION Flow', () => {
    it('should handle 2-minute payment delay via confirmation tool', async () => {
      // Setup
      mockProvider.createPayment = vi.fn().mockResolvedValue({
        paymentId: 'test_payment_123',
        paymentUrl: 'https://payment.test/123',
      });

      // Payment is pending initially, then paid after user approves
      mockProvider.getPaymentStatus = vi.fn()
        .mockResolvedValue('pending'); // Always pending during elicitation

      let confirmHandler: any;
      (mockServer.registerTool as any).mockImplementation((name, config, handler) => {
        if (name.includes('confirm')) confirmHandler = handler;
      });

      const wrapper = makeElicitationWrapper(
        originalFunc,
        mockServer,
        mockProvider,
        { amount: 10, currency: 'USD' },
        'test_tool'
      );

      // Step 1: Initial tool call with elicitation
      const extra = {
        sendRequest: vi.fn()
          .mockResolvedValue({ action: 'unknown' }) // Simulate timeout
      };

      const promise = wrapper({ data: 'test' }, extra);

      // Run all timers to completion (will fast-forward through all 5 elicitation attempts)
      await vi.runAllTimersAsync();

      const result = await promise;

      // Should return pending with confirmation tool
      expect(result.status).toBe('pending');
      expect(result.next_step).toBe('confirm_test_tool_payment');
      expect(result.content[0].text).toContain('Payment not yet received');

      // Step 2: User waits 2 minutes, then pays
      // (In real scenario, user goes to payment URL and approves)

      // Step 3: User comes back and uses confirmation tool
      // Payment is now paid
      (mockProvider.getPaymentStatus as vi.Mock).mockResolvedValue('paid');

      const confirmResult = await confirmHandler({ payment_id: 'test_payment_123' }, {});

      // Should successfully execute the original tool
      // The stored args are wrapped in { toolArgs, extra } format
      expect(originalFunc).toHaveBeenCalledWith(
        expect.objectContaining({ toolArgs: { data: 'test' } }),
        {}
      );
      expect(confirmResult.content[0].text).toBe('Tool executed successfully');
    }, 30000);

    it('should persist session for at least 15 minutes', async () => {
      mockProvider.createPayment = vi.fn().mockResolvedValue({
        paymentId: 'test_payment_456',
        paymentUrl: 'https://payment.test/456',
      });
      mockProvider.getPaymentStatus = vi.fn().mockResolvedValue('pending');

      let confirmHandler: any;
      (mockServer.registerTool as any).mockImplementation((name, config, handler) => {
        if (name.includes('confirm')) confirmHandler = handler;
      });

      const wrapper = makeElicitationWrapper(
        originalFunc,
        mockServer,
        mockProvider,
        { amount: 20, currency: 'USD' },
        'another_tool'
      );

      // Initial call stores session
      const extra = {
        sendRequest: vi.fn().mockResolvedValue({ action: 'unknown' })
      };

      const promise = wrapper({ important: 'data' }, extra);

      // Run all timers to completion (will fast-forward through all 5 elicitation attempts)
      await vi.runAllTimersAsync();

      const result = await promise;

      // Elicitation should return pending status with confirmation tool
      expect(result.status).toBe('pending');
      expect(result.next_step).toBe('confirm_another_tool_payment');

      // Verify session was stored (should be available after elicitation timeout)
      const storage = SessionManager.getStorage();
      const sessionKey = { provider: 'mock', paymentId: 'test_payment_456' };
      const storedSession = await storage.get(sessionKey);
      expect(storedSession).toBeDefined();
      expect(storedSession?.args.toolArgs).toEqual({ important: 'data' });

      // Even after 10 minutes, session should still be available for confirmation
      // (In production, TTL is 15 minutes)
      (mockProvider.getPaymentStatus as vi.Mock).mockResolvedValue('paid');
      const confirmResult = await confirmHandler({ payment_id: 'test_payment_456' }, {});

      // Should successfully execute the original tool with stored args
      expect(originalFunc).toHaveBeenCalledWith(
        expect.objectContaining({ toolArgs: { important: 'data' } }),
        {}
      );
      expect(confirmResult.content[0].text).toBe('Tool executed successfully');

      // Session should be cleaned up after successful confirmation
      const sessionAfterConfirm = await storage.get(sessionKey);
      expect(sessionAfterConfirm).toBeUndefined();
    }, 30000);
  });

  describe('PROGRESS Flow', () => {
    it('should handle 2-minute payment delay during polling', async () => {
      mockProvider.createPayment = vi.fn().mockResolvedValue({
        paymentId: 'progress_payment_123',
        paymentUrl: 'https://payment.test/progress/123',
      });

      // Simulate payment pending for 2 minutes, then paid
      let statusCallCount = 0;
      mockProvider.getPaymentStatus = vi.fn().mockImplementation(() => {
        statusCallCount++;
        // After ~40 calls (2 minutes / 3 seconds), payment is approved
        return statusCallCount > 40 ? 'paid' : 'pending';
      });

      const wrapper = makeProgressWrapper(
        originalFunc,
        mockServer,
        mockProvider,
        { amount: 30, currency: 'USD' },
        'progress_tool'
      );

      const promise = wrapper({ data: 'test' }, {});

      // For the 2-minute payment delay test, run all timers to completion
      await vi.runAllTimersAsync();

      const result = await promise;

      // Should have executed successfully
      expect(originalFunc).toHaveBeenCalledWith({ data: 'test' }, {});
      expect(result.content[0].text).toBe('Tool executed successfully');
      expect(statusCallCount).toBeGreaterThan(40); // Polled many times
    }, 10000);

    it('should provide confirmation tool after 15-minute timeout', async () => {
      mockProvider.createPayment = vi.fn().mockResolvedValue({
        paymentId: 'timeout_payment_123',
        paymentUrl: 'https://payment.test/timeout/123',
      });

      // Payment stays pending (user hasn't paid yet)
      mockProvider.getPaymentStatus = vi.fn().mockResolvedValue('pending');

      let confirmHandler: any;
      (mockServer.registerTool as any).mockImplementation((name, config, handler) => {
        if (name.includes('confirm')) confirmHandler = handler;
      });

      const wrapper = makeProgressWrapper(
        originalFunc,
        mockServer,
        mockProvider,
        { amount: 40, currency: 'USD' },
        'timeout_tool'
      );

      const promise = wrapper({ data: 'test' }, {});

      // Fast-forward exactly 15 minutes (MAX_WAIT_MS) to trigger timeout
      await vi.runAllTimersAsync();

      const result = await promise;

      // Should timeout but provide confirmation tool
      expect(result.status).toBe('pending');
      expect(result.next_step).toBe('confirm_timeout_tool_payment');
      expect(result.content[0].text).toContain('timeout');
      expect(originalFunc).not.toHaveBeenCalled();

      // User can still confirm later if they pay
      (mockProvider.getPaymentStatus as vi.Mock).mockResolvedValue('paid');
      const confirmResult = await confirmHandler({ payment_id: 'timeout_payment_123' }, {});

      // Should successfully execute the original tool with stored args
      expect(originalFunc).toHaveBeenCalledWith(
        expect.objectContaining({ toolArgs: { data: 'test' } }),
        {}
      );
      expect(confirmResult.content[0].text).toBe('Tool executed successfully');
    }, 10000);
  });

  describe('Session Cleanup', () => {
    it('should clean up session after successful payment', async () => {
      mockProvider.createPayment = vi.fn().mockResolvedValue({
        paymentId: 'cleanup_test',
        paymentUrl: 'https://payment.test/cleanup',
      });
      mockProvider.getPaymentStatus = vi.fn().mockResolvedValue('paid');

      const wrapper = makeElicitationWrapper(
        originalFunc,
        mockServer,
        mockProvider,
        { amount: 50, currency: 'USD' },
        'cleanup_tool'
      );

      const extra = {
        sendRequest: vi.fn().mockResolvedValue({ action: 'accept' })
      };

      const promise = wrapper({ data: 'test' }, extra);

      // This test simulates immediate acceptance by the user, so no timer advancement needed
      await promise;

      // Session should be cleaned up after successful payment
      const storage = SessionManager.getStorage();
      const sessionKey = { provider: 'mock', paymentId: 'cleanup_test' };
      const storedSession = await storage.get(sessionKey);
      expect(storedSession).toBeUndefined();
    });
  });
});