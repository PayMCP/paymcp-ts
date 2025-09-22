import { describe, it, expect, afterEach } from 'vitest';
import { makeFlow } from '../../src/flows/index';
import { PaymentFlow } from '../../src/types/payment';
import { SessionManager } from '../../src/session/manager';

describe('Flow Factory', () => {
  afterEach(() => {
    SessionManager.reset();
  });
  
  describe('makeFlow', () => {
    it('should create two-step flow wrapper', () => {
      const wrapper = makeFlow(PaymentFlow.TWO_STEP);
      expect(wrapper).toBeDefined();
      expect(typeof wrapper).toBe('function');
    });

    it('should create elicitation flow wrapper', () => {
      const wrapper = makeFlow(PaymentFlow.ELICITATION);
      expect(wrapper).toBeDefined();
      expect(typeof wrapper).toBe('function');
    });

    it('should create progress flow wrapper', () => {
      const wrapper = makeFlow(PaymentFlow.PROGRESS);
      expect(wrapper).toBeDefined();
      expect(typeof wrapper).toBe('function');
    });

    it('should throw for OOB flow (not implemented)', () => {
      expect(() => {
        makeFlow(PaymentFlow.OOB);
      }).toThrow('Unknown payment flow: OOB');
    });

    it('should throw for unknown flow', () => {
      expect(() => {
        makeFlow('UNKNOWN' as PaymentFlow);
      }).toThrow('Unknown payment flow: UNKNOWN');
    });

    it('should throw for undefined flow', () => {
      expect(() => {
        makeFlow(undefined as any);
      }).toThrow('Unknown payment flow: undefined');
    });

    it('should throw for null flow', () => {
      expect(() => {
        makeFlow(null as any);
      }).toThrow('Unknown payment flow: null');
    });

    it('should handle PaymentFlow enum values', () => {
      // PaymentFlow enum values are strings
      const wrapper1 = makeFlow(PaymentFlow.TWO_STEP);
      expect(wrapper1).toBeDefined();

      const wrapper2 = makeFlow(PaymentFlow.ELICITATION);
      expect(wrapper2).toBeDefined();

      const wrapper3 = makeFlow(PaymentFlow.PROGRESS);
      expect(wrapper3).toBeDefined();

      expect(() => {
        makeFlow(PaymentFlow.OOB);
      }).toThrow('Unknown payment flow: OOB');
    });
  });
});