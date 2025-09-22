import { describe, it, expect, vi } from 'vitest';
import { appendPriceToDescription, paymentPromptMessage } from '../../src/utils/messages';
import { PriceConfig } from '../../src/types/config';

describe('Messages Utils', () => {
  describe('appendPriceToDescription', () => {
    it('should append price to description', () => {
      const price: PriceConfig = { amount: 10.99, currency: 'USD' };
      const result = appendPriceToDescription('Test tool', price);
      expect(result).toBe('Test tool. .\nThis is a paid function:10.99 USD.\nPayment will be requested during execution.');
    });

    it('should handle undefined description', () => {
      const price: PriceConfig = { amount: 5.00, currency: 'EUR' };
      const result = appendPriceToDescription(undefined, price);
      expect(result).toBe('.\nThis is a paid function:5 EUR.\nPayment will be requested during execution.');
    });

    it('should handle empty description', () => {
      const price: PriceConfig = { amount: 0.99, currency: 'GBP' };
      const result = appendPriceToDescription('', price);
      expect(result).toBe('.\nThis is a paid function:0.99 GBP.\nPayment will be requested during execution.');
    });

    it('should handle zero amount', () => {
      const price: PriceConfig = { amount: 0, currency: 'USD' };
      const result = appendPriceToDescription('Free tool', price);
      expect(result).toBe('Free tool. .\nThis is a paid function:0 USD.\nPayment will be requested during execution.');
    });

    it('should handle large amounts', () => {
      const price: PriceConfig = { amount: 999999.99, currency: 'USD' };
      const result = appendPriceToDescription('Expensive tool', price);
      expect(result).toBe('Expensive tool. .\nThis is a paid function:999999.99 USD.\nPayment will be requested during execution.');
    });

    it('should handle whitespace trimming', () => {
      const price: PriceConfig = { amount: 10, currency: 'USD' };
      const result = appendPriceToDescription('  Tool with spaces  ', price);
      expect(result).toBe('Tool with spaces. .\nThis is a paid function:10 USD.\nPayment will be requested during execution.');
    });
  });

  describe('paymentPromptMessage', () => {
    it('should format payment prompt message', () => {
      const result = paymentPromptMessage('https://pay.example.com', 10.99, 'USD');
      expect(result).toBe('To continue, please pay 10.99 USD at:\nhttps://pay.example.com');
    });

    it('should handle different currencies', () => {
      const result = paymentPromptMessage('https://pay.example.com', 50, 'EUR');
      expect(result).toBe('To continue, please pay 50 EUR at:\nhttps://pay.example.com');
    });

    it('should handle zero amount', () => {
      const result = paymentPromptMessage('https://pay.example.com', 0, 'USD');
      expect(result).toBe('To continue, please pay 0 USD at:\nhttps://pay.example.com');
    });

    it('should handle large amounts', () => {
      const result = paymentPromptMessage('https://pay.example.com', 999999.99, 'USD');
      expect(result).toBe('To continue, please pay 999999.99 USD at:\nhttps://pay.example.com');
    });

    it('should handle long URLs', () => {
      const longUrl = 'https://very-long-payment-gateway.example.com/checkout/session/abc123def456/pay?ref=xyz';
      const result = paymentPromptMessage(longUrl, 25, 'GBP');
      expect(result).toBe(`To continue, please pay 25 GBP at:\n${longUrl}`);
    });
  });
});