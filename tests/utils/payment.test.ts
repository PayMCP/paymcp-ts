import { describe, it, expect } from 'vitest';
import { normalizeStatus } from '../../src/utils/payment.js';

describe('payment utils', () => {
  describe('normalizeStatus', () => {
    describe('paid status mapping', () => {
      it('should return "paid" for paid status', () => {
        expect(normalizeStatus('paid')).toBe('paid');
      });

      it('should return "paid" for succeeded status', () => {
        expect(normalizeStatus('succeeded')).toBe('paid');
      });

      it('should return "paid" for success status', () => {
        expect(normalizeStatus('success')).toBe('paid');
      });

      it('should return "paid" for complete status', () => {
        expect(normalizeStatus('complete')).toBe('paid');
      });

      it('should return "paid" for completed status', () => {
        expect(normalizeStatus('completed')).toBe('paid');
      });

      it('should return "paid" for ok status', () => {
        expect(normalizeStatus('ok')).toBe('paid');
      });

      it('should return "paid" for no_payment_required status', () => {
        expect(normalizeStatus('no_payment_required')).toBe('paid');
      });
    });

    describe('canceled status mapping', () => {
      it('should return "canceled" for canceled status', () => {
        expect(normalizeStatus('canceled')).toBe('canceled');
      });

      it('should return "canceled" for cancelled status', () => {
        expect(normalizeStatus('cancelled')).toBe('canceled');
      });

      it('should return "canceled" for void status', () => {
        expect(normalizeStatus('void')).toBe('canceled');
      });

      it('should return "canceled" for failed status', () => {
        expect(normalizeStatus('failed')).toBe('canceled');
      });

      it('should return "canceled" for declined status', () => {
        expect(normalizeStatus('declined')).toBe('canceled');
      });

      it('should return "canceled" for error status', () => {
        expect(normalizeStatus('error')).toBe('canceled');
      });
    });

    describe('pending status mapping (default)', () => {
      it('should return "pending" for pending status', () => {
        expect(normalizeStatus('pending')).toBe('pending');
      });

      it('should return "pending" for unknown status', () => {
        expect(normalizeStatus('unknown')).toBe('pending');
      });

      it('should return "pending" for arbitrary status', () => {
        expect(normalizeStatus('some_custom_status')).toBe('pending');
      });

      it('should return "pending" for empty string', () => {
        expect(normalizeStatus('')).toBe('pending');
      });
    });

    describe('case insensitive mapping', () => {
      it('should handle uppercase paid statuses', () => {
        expect(normalizeStatus('PAID')).toBe('paid');
        expect(normalizeStatus('SUCCEEDED')).toBe('paid');
        expect(normalizeStatus('SUCCESS')).toBe('paid');
        expect(normalizeStatus('COMPLETE')).toBe('paid');
        expect(normalizeStatus('COMPLETED')).toBe('paid');
        expect(normalizeStatus('OK')).toBe('paid');
        expect(normalizeStatus('NO_PAYMENT_REQUIRED')).toBe('paid');
      });

      it('should handle uppercase canceled statuses', () => {
        expect(normalizeStatus('CANCELED')).toBe('canceled');
        expect(normalizeStatus('CANCELLED')).toBe('canceled');
        expect(normalizeStatus('VOID')).toBe('canceled');
        expect(normalizeStatus('FAILED')).toBe('canceled');
        expect(normalizeStatus('DECLINED')).toBe('canceled');
        expect(normalizeStatus('ERROR')).toBe('canceled');
      });

      it('should handle mixed case statuses', () => {
        expect(normalizeStatus('Paid')).toBe('paid');
        expect(normalizeStatus('Succeeded')).toBe('paid');
        expect(normalizeStatus('Canceled')).toBe('canceled');
        expect(normalizeStatus('Failed')).toBe('canceled');
        expect(normalizeStatus('Pending')).toBe('pending');
      });

      it('should handle mixed case with underscores', () => {
        expect(normalizeStatus('No_Payment_Required')).toBe('paid');
        expect(normalizeStatus('NO_payment_REQUIRED')).toBe('paid');
      });
    });

    describe('type coercion and edge cases', () => {
      it('should handle null input (nullish coalescing)', () => {
        expect(normalizeStatus(null)).toBe('pending');
      });

      it('should handle undefined input (nullish coalescing)', () => {
        expect(normalizeStatus(undefined)).toBe('pending');
      });

      it('should handle number inputs', () => {
        expect(normalizeStatus(0)).toBe('pending');
        expect(normalizeStatus(1)).toBe('pending');
        expect(normalizeStatus(200)).toBe('pending');
      });

      it('should handle boolean inputs', () => {
        expect(normalizeStatus(true)).toBe('pending');
        expect(normalizeStatus(false)).toBe('pending');
      });

      it('should handle object inputs', () => {
        expect(normalizeStatus({})).toBe('pending');
        expect(normalizeStatus({ status: 'paid' })).toBe('pending');
      });

      it('should handle array inputs', () => {
        expect(normalizeStatus([])).toBe('pending');
        expect(normalizeStatus(['paid'])).toBe('paid'); // String(['paid']) becomes 'paid'
        expect(normalizeStatus(['canceled'])).toBe('canceled'); // String(['canceled']) becomes 'canceled'
        expect(normalizeStatus(['unknown'])).toBe('pending'); // String(['unknown']) becomes 'unknown'
      });

      it('should handle string numbers', () => {
        expect(normalizeStatus('0')).toBe('pending');
        expect(normalizeStatus('1')).toBe('pending');
        expect(normalizeStatus('200')).toBe('pending');
      });

      it('should handle whitespace and special characters', () => {
        expect(normalizeStatus('  paid  ')).toBe('pending'); // trimming not implemented
        expect(normalizeStatus('paid\n')).toBe('pending'); // newlines not handled
        expect(normalizeStatus('paid-status')).toBe('pending'); // hyphens not handled
      });
    });

    describe('comprehensive coverage tests', () => {
      it('should handle all paid synonyms comprehensively', () => {
        const paidStatuses = ['paid', 'succeeded', 'success', 'complete', 'completed', 'ok', 'no_payment_required'];

        paidStatuses.forEach(status => {
          expect(normalizeStatus(status)).toBe('paid');
          expect(normalizeStatus(status.toUpperCase())).toBe('paid');
          expect(normalizeStatus(status.charAt(0).toUpperCase() + status.slice(1))).toBe('paid');
        });
      });

      it('should handle all canceled synonyms comprehensively', () => {
        const canceledStatuses = ['canceled', 'cancelled', 'void', 'failed', 'declined', 'error'];

        canceledStatuses.forEach(status => {
          expect(normalizeStatus(status)).toBe('canceled');
          expect(normalizeStatus(status.toUpperCase())).toBe('canceled');
          expect(normalizeStatus(status.charAt(0).toUpperCase() + status.slice(1))).toBe('canceled');
        });
      });

      it('should return pending for any other input', () => {
        const pendingInputs = [
          'pending', 'processing', 'unknown', 'active', 'waiting',
          'new', 'created', 'authorized', 'expired', 'timeout',
          123, true, false, {}, [], '', '   ', '\n', '\t'
        ];

        pendingInputs.forEach(input => {
          expect(normalizeStatus(input)).toBe('pending');
        });
      });

      it('should test the nullish coalescing operator specifically', () => {
        // This tests line 4: const s = String(raw ?? "").toLowerCase();
        // We need both null/undefined (triggering ??) and non-null paths

        // Null path (triggers ??)
        expect(normalizeStatus(null)).toBe('pending');
        expect(normalizeStatus(undefined)).toBe('pending');

        // Non-null path (doesn't trigger ??)
        expect(normalizeStatus('paid')).toBe('paid');
        expect(normalizeStatus('')).toBe('pending');
        expect(normalizeStatus(0)).toBe('pending');
        expect(normalizeStatus(false)).toBe('pending');
      });
    });
  });
});