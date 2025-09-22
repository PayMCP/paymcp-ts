import { describe, it, expect, vi } from 'vitest';
import { normalizeStatus } from '../../src/utils/payment';

describe('Payment Utils', () => {
  describe('normalizeStatus', () => {
    it('should normalize paid statuses', () => {
      expect(normalizeStatus('paid')).toBe('paid');
      expect(normalizeStatus('PAID')).toBe('paid');
      expect(normalizeStatus('complete')).toBe('paid');
      expect(normalizeStatus('completed')).toBe('paid');
      expect(normalizeStatus('succeeded')).toBe('paid');
      expect(normalizeStatus('success')).toBe('paid');
      expect(normalizeStatus('captured')).toBe('paid');
      expect(normalizeStatus('CONFIRMED')).toBe('paid');
    });

    it('should normalize canceled statuses', () => {
      expect(normalizeStatus('canceled')).toBe('canceled');
      expect(normalizeStatus('cancelled')).toBe('canceled');
      expect(normalizeStatus('failed')).toBe('canceled');
      expect(normalizeStatus('expired')).toBe('canceled');
      expect(normalizeStatus('error')).toBe('canceled');
      expect(normalizeStatus('refused')).toBe('canceled');
      expect(normalizeStatus('VOIDED')).toBe('canceled');
    });

    it('should default to pending for unknown statuses', () => {
      expect(normalizeStatus('pending')).toBe('pending');
      expect(normalizeStatus('processing')).toBe('pending');
      expect(normalizeStatus('unknown')).toBe('pending');
      expect(normalizeStatus('waiting')).toBe('pending');
      expect(normalizeStatus('')).toBe('pending');
      expect(normalizeStatus('some-random-status')).toBe('pending');
    });

    it('should handle null and undefined', () => {
      expect(normalizeStatus(null as any)).toBe('pending');
      expect(normalizeStatus(undefined as any)).toBe('pending');
    });

    it('should handle non-string inputs', () => {
      expect(normalizeStatus(123 as any)).toBe('pending');
      expect(normalizeStatus({} as any)).toBe('pending');
      expect(normalizeStatus([] as any)).toBe('pending');
    });
  });
});