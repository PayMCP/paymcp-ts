/**
 * Tests for MockPaymentProvider
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MockPaymentProvider } from '../../src/providers/mock.js';

describe('MockPaymentProvider', () => {
  describe('Initialization', () => {
    it('should initialize with default configuration', () => {
      const provider = new MockPaymentProvider();
      expect(provider['apiKey']).toBe('mock');
      expect(provider['defaultStatus']).toBe('paid');
      expect(provider['autoConfirm']).toBe(false);
      expect(provider['confirmDelay']).toBe(0);
    });

    it('should initialize with custom configuration', () => {
      const provider = new MockPaymentProvider({
        apiKey: 'custom_mock',
        defaultStatus: 'pending',
        autoConfirm: true,
        confirmDelay: 2.0
      });
      expect(provider['apiKey']).toBe('custom_mock');
      expect(provider['defaultStatus']).toBe('pending');
      expect(provider['autoConfirm']).toBe(true);
      expect(provider['confirmDelay']).toBe(2.0);
    });
  });

  describe('Payment Creation', () => {
    let provider: MockPaymentProvider;

    beforeEach(() => {
      provider = new MockPaymentProvider();
    });

    it('should create a payment with status prefix', async () => {
      const result = await provider.createPayment(10.50, 'USD', 'Test payment');

      // Verify payment ID format: mock_{status}_{16_hex_chars}
      expect(result.paymentId).toMatch(/^mock_paid_[a-f0-9]{16}$/);

      const parts = result.paymentId.split('_');
      expect(parts.length).toBe(3);  // ["mock", "paid", "hex"]
      expect(parts[0]).toBe('mock');
      expect(parts[1]).toBe('paid');
      expect(parts[2].length).toBe(16);

      // Verify payment URL format
      expect(result.paymentUrl).toBe(`https://mock-payment.local/pay/${result.paymentId}`);

      // Verify payment is stored
      const details = provider.getPaymentDetails(result.paymentId);
      expect(details).toBeDefined();
      expect(details?.amount).toBe(10.50);
      expect(details?.currency).toBe('USD');
      expect(details?.description).toBe('Test payment');
      expect(details?.status).toBe('paid'); // default status
    });

    it('should generate unique payment IDs', async () => {
      const ids = new Set<string>();

      for (let i = 0; i < 100; i++) {
        const result = await provider.createPayment(1.00, 'USD', 'Test');
        ids.add(result.paymentId);
      }

      expect(ids.size).toBe(100);
    });
  });

  describe('Payment Status', () => {
    let provider: MockPaymentProvider;

    beforeEach(() => {
      provider = new MockPaymentProvider();
    });

    it('should return paid status for default configuration', async () => {
      const { paymentId } = await provider.createPayment(1.00, 'USD', 'Test');
      const status = await provider.getPaymentStatus(paymentId);
      expect(status).toBe('paid');
    });

    it('should return pending status when configured', async () => {
      provider = new MockPaymentProvider({ defaultStatus: 'pending' });
      const { paymentId } = await provider.createPayment(1.00, 'USD', 'Test');
      const status = await provider.getPaymentStatus(paymentId);
      expect(status).toBe('pending');
    });

    it('should return failed status when configured', async () => {
      provider = new MockPaymentProvider({ defaultStatus: 'failed' });
      const { paymentId } = await provider.createPayment(1.00, 'USD', 'Test');
      const status = await provider.getPaymentStatus(paymentId);
      expect(status).toBe('failed');
    });

    it('should return expired for non-existent payment', async () => {
      const status = await provider.getPaymentStatus('nonexistent_id');
      expect(status).toBe('expired');  // Unknown payments treated as expired
    });
  });

  describe('Manual Status Setting', () => {
    let provider: MockPaymentProvider;

    beforeEach(() => {
      provider = new MockPaymentProvider({ defaultStatus: 'pending' });
    });

    it('should manually set payment status', async () => {
      const { paymentId } = await provider.createPayment(1.00, 'USD', 'Test');

      // Verify initial status
      expect(await provider.getPaymentStatus(paymentId)).toBe('pending');

      // Change to paid
      provider.setPaymentStatus(paymentId, 'paid');
      expect(await provider.getPaymentStatus(paymentId)).toBe('paid');

      // Change to failed
      provider.setPaymentStatus(paymentId, 'failed');
      expect(await provider.getPaymentStatus(paymentId)).toBe('failed');
    });

    it('should handle setting status for non-existent payment', () => {
      // Should not throw error
      expect(() => {
        provider.setPaymentStatus('nonexistent_id', 'paid');
      }).not.toThrow();
    });

    it('should maintain independent states for multiple payments', async () => {
      const { paymentId: id1 } = await provider.createPayment(1.00, 'USD', 'Payment 1');
      const { paymentId: id2 } = await provider.createPayment(2.00, 'USD', 'Payment 2');

      provider.setPaymentStatus(id1, 'paid');
      provider.setPaymentStatus(id2, 'failed');

      expect(await provider.getPaymentStatus(id1)).toBe('paid');
      expect(await provider.getPaymentStatus(id2)).toBe('failed');
    });
  });

  describe('Auto-Confirm', () => {
    it('should keep status when auto_confirm is disabled', async () => {
      const provider = new MockPaymentProvider({
        defaultStatus: 'pending',
        autoConfirm: false
      });
      const { paymentId } = await provider.createPayment(1.00, 'USD', 'Test');

      // Check immediately
      expect(await provider.getPaymentStatus(paymentId)).toBe('pending');

      // Check after delay
      await new Promise(resolve => setTimeout(resolve, 500));
      expect(await provider.getPaymentStatus(paymentId)).toBe('pending');
    });

    it('should auto-confirm with zero delay', async () => {
      const provider = new MockPaymentProvider({
        defaultStatus: 'paid',
        autoConfirm: true,
        confirmDelay: 0
      });
      const { paymentId } = await provider.createPayment(1.00, 'USD', 'Test');

      // Payment should be pending initially
      const details = provider.getPaymentDetails(paymentId);
      expect(details?.status).toBe('pending');

      // Should immediately become paid on first check
      expect(await provider.getPaymentStatus(paymentId)).toBe('paid');

      // Verify status was updated in storage
      const updatedDetails = provider.getPaymentDetails(paymentId);
      expect(updatedDetails?.status).toBe('paid');
    });

    it('should auto-confirm after delay', async () => {
      const provider = new MockPaymentProvider({
        defaultStatus: 'paid',
        autoConfirm: true,
        confirmDelay: 0.5
      });
      const { paymentId } = await provider.createPayment(1.00, 'USD', 'Test');

      // Should be pending before delay
      expect(await provider.getPaymentStatus(paymentId)).toBe('pending');

      // Wait for delay to pass
      await new Promise(resolve => setTimeout(resolve, 600));

      // Should now be paid
      expect(await provider.getPaymentStatus(paymentId)).toBe('paid');
    });

    it('should only auto-confirm pending payments', async () => {
      const provider = new MockPaymentProvider({
        defaultStatus: 'failed',
        autoConfirm: true,
        confirmDelay: 0
      });
      const { paymentId } = await provider.createPayment(1.00, 'USD', 'Test');

      // Manually set to failed (not pending)
      provider.setPaymentStatus(paymentId, 'failed');

      // Auto-confirm should not change non-pending status
      expect(await provider.getPaymentStatus(paymentId)).toBe('failed');
    });
  });

  describe('Payment Details', () => {
    let provider: MockPaymentProvider;

    beforeEach(() => {
      provider = new MockPaymentProvider();
    });

    it('should return full payment details', async () => {
      const { paymentId } = await provider.createPayment(25.99, 'EUR', 'Premium service');

      const details = provider.getPaymentDetails(paymentId);
      expect(details).toBeDefined();
      expect(details?.amount).toBe(25.99);
      expect(details?.currency).toBe('EUR');
      expect(details?.description).toBe('Premium service');
      expect(details?.status).toBe('paid');
      expect(details?.createdAt).toBeDefined();
      expect(details?.metadata).toBeDefined();
    });

    it('should return undefined for non-existent payment', () => {
      const details = provider.getPaymentDetails('nonexistent_id');
      expect(details).toBeUndefined();
    });
  });

  describe('Clear Payments', () => {
    let provider: MockPaymentProvider;

    beforeEach(() => {
      provider = new MockPaymentProvider();
    });

    it('should clear all payments', async () => {
      // Create multiple payments
      const { paymentId: id1 } = await provider.createPayment(1.00, 'USD', 'Test 1');
      const { paymentId: id2 } = await provider.createPayment(2.00, 'USD', 'Test 2');

      // Verify payments exist
      expect(provider.getPaymentDetails(id1)).toBeDefined();
      expect(provider.getPaymentDetails(id2)).toBeDefined();

      // Clear all payments
      provider.clearPayments();

      // Verify payments are gone
      expect(provider.getPaymentDetails(id1)).toBeUndefined();
      expect(provider.getPaymentDetails(id2)).toBeUndefined();
    });
  });

  describe('Payment ID Prefix Hints', () => {
    let provider: MockPaymentProvider;

    beforeEach(() => {
      provider = new MockPaymentProvider();
    });

    it('should determine status from prefix - paid', async () => {
      const status = await provider.getPaymentStatus('mock_paid_abc123def456');
      expect(status).toBe('paid');
    });

    it('should determine status from prefix - failed', async () => {
      const status = await provider.getPaymentStatus('mock_failed_xyz789abc123');
      expect(status).toBe('failed');
    });

    it('should determine status from prefix - pending', async () => {
      const status = await provider.getPaymentStatus('mock_pending_111222333444');
      expect(status).toBe('pending');
    });

    it('should determine status from prefix - cancelled', async () => {
      const status = await provider.getPaymentStatus('mock_cancelled_aabbccddee');
      expect(status).toBe('cancelled');
    });

    it('should determine status from prefix - expired', async () => {
      const status = await provider.getPaymentStatus('mock_expired_ffeeddccbbaa');
      expect(status).toBe('expired');
    });

    it('should create payment IDs with configured default status prefix', async () => {
      provider = new MockPaymentProvider({ defaultStatus: 'failed' });
      const { paymentId } = await provider.createPayment(1.00, 'USD', 'Test');

      expect(paymentId).toMatch(/^mock_failed_[a-f0-9]{16}$/);
      expect(await provider.getPaymentStatus(paymentId)).toBe('failed');
    });

    it('should allow storage to override prefix hint', async () => {
      provider = new MockPaymentProvider({ defaultStatus: 'pending' });
      const { paymentId } = await provider.createPayment(1.00, 'USD', 'Test');

      expect(paymentId).toMatch(/^mock_pending_/);
      expect(await provider.getPaymentStatus(paymentId)).toBe('pending');

      // Manually change status
      provider.setPaymentStatus(paymentId, 'paid');

      // Stored status should override prefix hint
      expect(await provider.getPaymentStatus(paymentId)).toBe('paid');
    });

    it('should return expired for invalid status prefix', async () => {
      const status = await provider.getPaymentStatus('mock_invalid_abc123');
      expect(status).toBe('expired');
    });

    it('should return expired for payment_id without status part', async () => {
      const status = await provider.getPaymentStatus('mock_abc123');
      expect(status).toBe('expired');
    });
  });

  describe('Payment ID Delay Simulation', () => {
    let provider: MockPaymentProvider;

    beforeEach(() => {
      provider = new MockPaymentProvider();
    });

    it('should return pending for payment with delay not elapsed', async () => {
      // Payment ID with 10000ms delay (long enough to ensure pending)
      const paymentId = 'mock_paid_abc123def456_10000';

      const status = await provider.getPaymentStatus(paymentId);
      expect(status).toBe('pending');

      // Verify payment was created with metadata
      const details = provider.getPaymentDetails(paymentId);
      expect(details?.status).toBe('pending');
      expect(details?.metadata).toEqual({ targetStatus: 'paid', delay: 10.0 });
    });

    it('should create payment entry with delay metadata', async () => {
      const paymentId = 'mock_paid_abc123def456_5000';

      // First call creates the entry
      await provider.getPaymentStatus(paymentId);

      // Verify payment entry was created with correct metadata
      const details = provider.getPaymentDetails(paymentId);
      expect(details).toBeDefined();
      expect(details?.status).toBe('pending');
      expect(details?.metadata?.targetStatus).toBe('paid');
      expect(details?.metadata?.delay).toBe(5.0);
      expect(details?.createdAt).toBeDefined();
    });

    it('should parse delay from payment ID correctly', async () => {
      // Test different delay values
      const testCases = [
        { paymentId: 'mock_paid_abc_1000', expectedDelay: 1.0 },
        { paymentId: 'mock_failed_xyz_2500', expectedDelay: 2.5 },
        { paymentId: 'mock_cancelled_aaa_500', expectedDelay: 0.5 },
        { paymentId: 'mock_paid_test_0', expectedDelay: 0.0 }
      ];

      for (const { paymentId, expectedDelay } of testCases) {
        await provider.getPaymentStatus(paymentId);
        const details = provider.getPaymentDetails(paymentId);
        expect(details?.metadata?.delay).toBe(expectedDelay);
      }
    });

    it('should handle zero delay (immediate transition)', async () => {
      const paymentId = 'mock_paid_abc123def456_0';

      // With 0ms delay, elapsed time is immediately >= 0, so it transitions
      const status = await provider.getPaymentStatus(paymentId);
      expect(status).toBe('paid');

      // Verify payment status was updated
      const details = provider.getPaymentDetails(paymentId);
      expect(details?.status).toBe('paid');
    });

    it('should create payment entry only once for delay simulation', async () => {
      const paymentId = 'mock_paid_abc123def456_10000';

      // First call creates payment
      await provider.getPaymentStatus(paymentId);
      const details1 = provider.getPaymentDetails(paymentId);
      const createdAt1 = details1?.createdAt;

      // Second call should use same payment entry
      await provider.getPaymentStatus(paymentId);
      const details2 = provider.getPaymentDetails(paymentId);
      const createdAt2 = details2?.createdAt;

      expect(createdAt1).toBe(createdAt2);
    });

    it('should handle different target statuses with zero delay', async () => {
      // With 0ms delay, payments transition immediately
      const testCases = [
        { paymentId: 'mock_paid_aaa_0', expectedStatus: 'paid' },
        { paymentId: 'mock_failed_bbb_0', expectedStatus: 'failed' },
        { paymentId: 'mock_cancelled_ccc_0', expectedStatus: 'cancelled' },
        { paymentId: 'mock_expired_ddd_0', expectedStatus: 'expired' }
      ];

      for (const { paymentId, expectedStatus } of testCases) {
        const status = await provider.getPaymentStatus(paymentId);
        expect(status).toBe(expectedStatus);
      }
    });

    it('should create independent payment entries for different IDs', async () => {
      const payment1 = 'mock_paid_aaa_10000';
      const payment2 = 'mock_failed_bbb_10000';

      // Create both payments
      await provider.getPaymentStatus(payment1);
      await provider.getPaymentStatus(payment2);

      // Verify both are pending
      expect(provider.getPaymentDetails(payment1)?.status).toBe('pending');
      expect(provider.getPaymentDetails(payment2)?.status).toBe('pending');

      // Verify they have different target statuses
      expect(provider.getPaymentDetails(payment1)?.metadata?.targetStatus).toBe('paid');
      expect(provider.getPaymentDetails(payment2)?.metadata?.targetStatus).toBe('failed');
    });

    it('should not apply delay simulation to invalid status hints', async () => {
      // Invalid status 'unknown' with delay - should return expired (not pending)
      const paymentId = 'mock_unknown_abc123_1000';
      const status = await provider.getPaymentStatus(paymentId);
      expect(status).toBe('expired');
    });
  });
});