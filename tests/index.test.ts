import { describe, it, expect } from 'vitest';

describe('Index Exports', () => {
  it('should export PayMCP class', async () => {
    const { PayMCP } = await import('../src/index.js');
    expect(PayMCP).toBeDefined();
    expect(typeof PayMCP).toBe('function'); // constructor function
  });

  it('should export installPayMCP function', async () => {
    const { installPayMCP } = await import('../src/index.js');
    expect(installPayMCP).toBeDefined();
    expect(typeof installPayMCP).toBe('function');
  });

  it('should export PaymentFlow enum', async () => {
    const { PaymentFlow } = await import('../src/index.js');
    expect(PaymentFlow).toBeDefined();
    expect(typeof PaymentFlow).toBe('object');
    expect(PaymentFlow.TWO_STEP).toBe('TWO_STEP');
    expect(PaymentFlow.ELICITATION).toBe('ELICITATION');
    expect(PaymentFlow.PROGRESS).toBe('PROGRESS');
    expect(PaymentFlow.OOB).toBe('OOB');
  });

  it('should have all expected exports available', async () => {
    const exports = await import('../src/index.js');

    expect(exports).toHaveProperty('PayMCP');
    expect(exports).toHaveProperty('installPayMCP');
    expect(exports).toHaveProperty('PaymentFlow');

    // Type exports are not runtime values, so we can't test them directly
    // but we can verify they don't appear as runtime exports
    expect(exports).not.toHaveProperty('PayMCPOptions');
    expect(exports).not.toHaveProperty('PriceConfig');
  });
});