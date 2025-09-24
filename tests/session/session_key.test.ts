import { describe, it, expect } from 'vitest';
import { SessionKey } from '../../src/session/types';

describe('SessionKey', () => {
  describe('constructor', () => {
    it('should create instance with provider and paymentId only', () => {
      const key = new SessionKey('stripe', 'payment123');
      expect(key.provider).toBe('stripe');
      expect(key.paymentId).toBe('payment123');
      expect(key.mcpSessionId).toBeUndefined();
    });

    it('should create instance with all parameters', () => {
      const key = new SessionKey('stripe', 'payment123', 'session456');
      expect(key.provider).toBe('stripe');
      expect(key.paymentId).toBe('payment123');
      expect(key.mcpSessionId).toBe('session456');
    });
  });

  describe('toString', () => {
    it('should generate key with MCP session ID when available', () => {
      const key = new SessionKey('stripe', 'payment123', 'session456');
      expect(key.toString()).toBe('mcp:session456:payment123');
    });

    it('should generate key without MCP session ID (STDIO mode)', () => {
      const key = new SessionKey('stripe', 'payment123');
      expect(key.toString()).toBe('stripe:payment123');
    });

    it('should handle empty MCP session ID as undefined', () => {
      const key = new SessionKey('paypal', 'order789', '');
      // Empty string is falsy, so should use provider:paymentId format
      expect(key.toString()).toBe('paypal:order789');
    });

    it('should handle null MCP session ID', () => {
      const key = new SessionKey('square', 'checkout456', null as any);
      expect(key.toString()).toBe('square:checkout456');
    });

    it('should handle different provider names', () => {
      const providers = ['stripe', 'paypal', 'square', 'adyen', 'coinbase', 'walleot'];

      providers.forEach(provider => {
        const key = new SessionKey(provider, 'testPayment');
        expect(key.toString()).toBe(`${provider}:testPayment`);
      });
    });

    it('should handle special characters in IDs', () => {
      const key1 = new SessionKey('stripe', 'payment_with-special.chars');
      expect(key1.toString()).toBe('stripe:payment_with-special.chars');

      const key2 = new SessionKey('paypal', 'order123', 'session:with:colons');
      expect(key2.toString()).toBe('mcp:session:with:colons:order123');
    });

    it('should generate unique keys for different sessions with same payment', () => {
      const key1 = new SessionKey('stripe', 'payment123', 'session1');
      const key2 = new SessionKey('stripe', 'payment123', 'session2');

      expect(key1.toString()).toBe('mcp:session1:payment123');
      expect(key2.toString()).toBe('mcp:session2:payment123');
      expect(key1.toString()).not.toBe(key2.toString());
    });

    it('should generate same key for same inputs', () => {
      const key1 = new SessionKey('stripe', 'payment123', 'session456');
      const key2 = new SessionKey('stripe', 'payment123', 'session456');

      expect(key1.toString()).toBe(key2.toString());
    });

    it('should handle very long IDs', () => {
      const longId = 'a'.repeat(1000);
      const key = new SessionKey('provider', longId, 'session');
      expect(key.toString()).toBe(`mcp:session:${longId}`);
    });

    it('should handle unicode characters in IDs', () => {
      const key = new SessionKey('stripe', 'payment_🚀_123', 'session_✨');
      expect(key.toString()).toBe('mcp:session_✨:payment_🚀_123');
    });
  });

  describe('edge cases', () => {
    it('should handle undefined provider gracefully', () => {
      const key = new SessionKey(undefined as any, 'payment123');
      expect(key.toString()).toBe('undefined:payment123');
    });

    it('should handle undefined paymentId gracefully', () => {
      const key = new SessionKey('stripe', undefined as any);
      expect(key.toString()).toBe('stripe:undefined');
    });

    it('should handle all undefined parameters', () => {
      const key = new SessionKey(undefined as any, undefined as any, undefined);
      expect(key.toString()).toBe('undefined:undefined');
    });

    it('should handle numeric values converted to strings', () => {
      const key = new SessionKey('stripe', 12345 as any, 67890 as any);
      // Numbers are truthy, so mcpSessionId will be used
      expect(key.toString()).toBe('mcp:67890:12345');
    });

    it('should handle boolean values', () => {
      const key1 = new SessionKey('stripe', 'payment', true as any);
      // true is truthy
      expect(key1.toString()).toBe('mcp:true:payment');

      const key2 = new SessionKey('stripe', 'payment', false as any);
      // false is falsy
      expect(key2.toString()).toBe('stripe:payment');
    });
  });
});
