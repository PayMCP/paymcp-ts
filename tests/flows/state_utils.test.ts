import { describe, it, expect, vi } from 'vitest';
import { InMemoryStateStore } from '../../src/state/inMemory.js';
import type { StateStore } from '../../src/types/state.js';
import {
  RESULT_NS_PAYMENT,
  RESULT_NS_SESSION,
  callFingerprint,
  clearCompletedResult,
  peekCompletedResult,
  saveCompletedResult,
} from '../../src/flows/state_utils.js';

const logger = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });

// The real store is used throughout: these helpers depend on the `{ args, ts }`
// wrapper the StateStore contract puts around a stored value, and a hand-rolled
// fake that forgets it would let a broken read pass.
const store = () => new InMemoryStateStore();

describe('state_utils: callFingerprint', () => {
  it('matches the same arguments regardless of key order', () => {
    expect(callFingerprint({ a: 1, b: 2 })).toBe(callFingerprint({ b: 2, a: 1 }));
  });

  it('distinguishes different arguments', () => {
    expect(callFingerprint({ a: 1 })).not.toBe(callFingerprint({ a: 2 }));
    expect(callFingerprint({ a: 1 })).not.toBe(callFingerprint({ b: 1 }));
  });

  it('distinguishes no arguments from empty arguments', () => {
    expect(callFingerprint(undefined)).not.toBe(callFingerprint({}));
  });

  it('describes the primitive argument shapes distinctly', () => {
    const seen = new Set([
      callFingerprint(undefined),
      callFingerprint(null),
      callFingerprint(true),
      callFingerprint(false),
      callFingerprint(0),
      callFingerprint('0'),
      callFingerprint(''),
      callFingerprint([]),
      callFingerprint({}),
    ]);
    expect(seen.size).toBe(9);
  });

  it('covers positional arguments, and their order', () => {
    expect(callFingerprint([1, 2])).toBe(callFingerprint([1, 2]));
    expect(callFingerprint([1, 2])).not.toBe(callFingerprint([2, 1]));
    expect(callFingerprint({ args: [1, 2] })).not.toBe(callFingerprint({ args: [2, 1] }));
  });

  it('distinguishes values JSON cannot tell apart', () => {
    expect(callFingerprint({ n: 1 })).not.toBe(callFingerprint({ n: '1' }));
    expect(callFingerprint({ n: null })).not.toBe(callFingerprint({ n: undefined }));
  });

  // Runs on every call, including calls that never disconnect, so it must not throw.
  it('does not throw on a circular structure, and is stable across equal ones', () => {
    const a: any = { x: 1 };
    a.self = a;
    const b: any = { x: 1 };
    b.self = b;
    let first = '';
    expect(() => { first = callFingerprint(a); }).not.toThrow();
    expect(first).toBe(callFingerprint(b));
    expect(first.startsWith('unfingerprintable:')).toBe(false);
  });

  it('does not throw on values JSON.stringify rejects', () => {
    expect(() => callFingerprint({ n: 1n })).not.toThrow();
    expect(callFingerprint({ n: 1n })).not.toBe(callFingerprint({ n: 2n }));
    expect(() => callFingerprint({ f: () => 1, s: Symbol('x'), d: new Date(5) })).not.toThrow();
    expect(() => callFingerprint({ n: NaN, i: Infinity })).not.toThrow();
    expect(callFingerprint({ n: NaN })).not.toBe(callFingerprint({ n: Infinity }));
  });

  // A constant here would make every undescribable call match every other one,
  // and they would be served each other's results.
  it('gives an undescribable call a value unique to that call', () => {
    const hostile = { get boom() { throw new Error('unreadable'); } };
    const first = callFingerprint(hostile);
    const second = callFingerprint(hostile);
    expect(first.startsWith('unfingerprintable:')).toBe(true);
    expect(second.startsWith('unfingerprintable:')).toBe(true);
    expect(first).not.toBe(second);
  });
});

describe('state_utils: save / peek', () => {
  it('hands back what was stored, with a token', async () => {
    const s = store();
    expect(await saveCompletedResult(s, 'pay_1', { ok: 1 }, RESULT_NS_PAYMENT, 'toolA')).toBe(true);

    const found = await peekCompletedResult(s, 'pay_1', RESULT_NS_PAYMENT, 'toolA');
    expect(found.hasResult).toBe(true);
    expect(found.result).toEqual({ ok: 1 });
    expect(typeof found.token).toBe('string');
  });

  it('counts a stored undefined as a result', async () => {
    const s = store();
    await saveCompletedResult(s, 'pay_1', undefined, RESULT_NS_PAYMENT, 'toolA');
    const found = await peekCompletedResult(s, 'pay_1', RESULT_NS_PAYMENT, 'toolA');
    expect(found.hasResult).toBe(true);
    expect(found.result).toBeUndefined();
  });

  it('misses when nothing was stored', async () => {
    const found = await peekCompletedResult(store(), 'pay_1', RESULT_NS_PAYMENT, 'toolA');
    expect(found.hasResult).toBe(false);
  });

  it('does nothing without a store or a key', async () => {
    expect(await saveCompletedResult(undefined, 'pay_1', 1, RESULT_NS_PAYMENT, 'toolA')).toBe(false);
    expect(await saveCompletedResult(store(), undefined, 1, RESULT_NS_PAYMENT, 'toolA')).toBe(false);
    expect((await peekCompletedResult(undefined, 'pay_1', RESULT_NS_PAYMENT, 'toolA')).hasResult).toBe(false);
    expect((await peekCompletedResult(store(), undefined, RESULT_NS_PAYMENT, 'toolA')).hasResult).toBe(false);
  });

  it('ignores an entry that is not a well-formed result', async () => {
    const s = store();
    // Whatever else lives in the store, only our own payload shape counts.
    await s.set('paymcp:result:payment:pay_1', 'not-an-object');
    expect((await peekCompletedResult(s, 'pay_1', RESULT_NS_PAYMENT, 'toolA')).hasResult).toBe(false);

    await s.set('paymcp:result:payment:pay_2', { tool: 'toolA', token: 't' });
    expect((await peekCompletedResult(s, 'pay_2', RESULT_NS_PAYMENT, 'toolA')).hasResult).toBe(false);
  });

  // A payment id names a payment, not a tool, and every paid tool reads the
  // same namespace.
  it('does not serve one tool the result of another', async () => {
    const s = store();
    await saveCompletedResult(s, 'pay_1', { secret: 1 }, RESULT_NS_PAYMENT, 'toolA');
    expect((await peekCompletedResult(s, 'pay_1', RESULT_NS_PAYMENT, 'toolB')).hasResult).toBe(false);
    expect((await peekCompletedResult(s, 'pay_1', RESULT_NS_PAYMENT, 'toolA')).hasResult).toBe(true);
  });

  // The payment id comes from the client, so a caller must not be able to name
  // a key a session-keyed flow cached under and be handed that result.
  it('keeps the payment and session namespaces apart for the same key', async () => {
    const s = store();
    await saveCompletedResult(s, 'toolA_sess1', { secret: 1 }, RESULT_NS_SESSION, 'toolA', 'fp');
    expect((await peekCompletedResult(s, 'toolA_sess1', RESULT_NS_PAYMENT, 'toolA')).hasResult).toBe(false);
    expect((await peekCompletedResult(s, 'toolA_sess1', RESULT_NS_SESSION, 'toolA', 'fp')).hasResult).toBe(true);

    await saveCompletedResult(s, 'pay_1', { other: 1 }, RESULT_NS_PAYMENT, 'toolA');
    expect((await peekCompletedResult(s, 'pay_1', RESULT_NS_SESSION, 'toolA', 'fp')).hasResult).toBe(false);
  });

  it('only serves a fingerprinted result back to a matching call', async () => {
    const s = store();
    const mine = callFingerprint({ q: 1 });
    const theirs = callFingerprint({ q: 2 });
    await saveCompletedResult(s, 'k', { ok: 1 }, RESULT_NS_SESSION, 'toolA', mine);

    expect((await peekCompletedResult(s, 'k', RESULT_NS_SESSION, 'toolA', theirs)).hasResult).toBe(false);
    expect((await peekCompletedResult(s, 'k', RESULT_NS_SESSION, 'toolA', mine)).hasResult).toBe(true);
  });

  // Payment-keyed flows pass no fingerprint: the key is already per-call.
  it('skips the fingerprint check when the caller has none', async () => {
    const s = store();
    await saveCompletedResult(s, 'k', { ok: 1 }, RESULT_NS_PAYMENT, 'toolA', 'some-fp');
    expect((await peekCompletedResult(s, 'k', RESULT_NS_PAYMENT, 'toolA')).hasResult).toBe(true);
  });
});

describe('state_utils: a store that refuses', () => {
  // Nothing is validated up front: the value goes to the store, and a durable
  // store that serialises to JSON is what refuses it.
  it('reports failure instead of throwing when the store rejects the value', async () => {
    const log = logger();
    const refusing: StateStore = {
      set: async () => { throw new TypeError('Converting circular structure to JSON'); },
      get: async () => undefined,
      delete: async () => {},
      lock: async (_k, fn) => fn(),
    };

    const saved = await saveCompletedResult(refusing, 'k', {}, RESULT_NS_PAYMENT, 'toolA', undefined, log);
    expect(saved).toBe(false);
    expect(log.warn).toHaveBeenCalledTimes(1);

    // The type of the failure survives; the stack does not.
    const line = String(log.warn.mock.calls[0][0]);
    expect(line).toContain('TypeError');
    expect(line).not.toContain('\n    at ');
  });

  it('keeps the exception type even when the message is empty', async () => {
    const log = logger();
    class ConnectionError extends Error {}
    const refusing: StateStore = {
      set: async () => { throw new ConnectionError(); },
      get: async () => { throw new ConnectionError(); },
      delete: async () => {},
      lock: async (_k, fn) => fn(),
    };

    await saveCompletedResult(refusing, 'k', {}, RESULT_NS_PAYMENT, 'toolA', undefined, log);
    expect(String(log.warn.mock.calls[0][0])).toContain('ConnectionError');

    await peekCompletedResult(refusing, 'k', RESULT_NS_PAYMENT, 'toolA', undefined, log);
    expect(String(log.warn.mock.calls[1][0])).toContain('ConnectionError');
  });

  it('describes a thrown value that is not an Error', async () => {
    const log = logger();
    const refusing: StateStore = {
      set: async () => { throw 'just a string'; },
      get: async () => undefined,
      delete: async () => {},
      lock: async (_k, fn) => fn(),
    };
    expect(await saveCompletedResult(refusing, 'k', {}, RESULT_NS_PAYMENT, 'toolA', undefined, log)).toBe(false);
    expect(String(log.warn.mock.calls[0][0])).toContain('just a string');
  });

  it('survives a thrown value that cannot even be printed', async () => {
    const log = logger();
    const unprintable = { get message() { throw new Error('nope'); } };
    Object.setPrototypeOf(unprintable, Error.prototype);
    const refusing: StateStore = {
      set: async () => { throw unprintable; },
      get: async () => undefined,
      delete: async () => {},
      lock: async (_k, fn) => fn(),
    };
    expect(await saveCompletedResult(refusing, 'k', {}, RESULT_NS_PAYMENT, 'toolA', undefined, log)).toBe(false);
    expect(log.warn).toHaveBeenCalled();
  });

  it('treats a store that cannot be read as having nothing cached', async () => {
    const log = logger();
    const broken: StateStore = {
      set: async () => {},
      get: async () => { throw new Error('redis down'); },
      delete: async () => {},
      lock: async (_k, fn) => fn(),
    };
    const found = await peekCompletedResult(broken, 'k', RESULT_NS_PAYMENT, 'toolA', undefined, log);
    expect(found.hasResult).toBe(false);
    expect(log.warn).toHaveBeenCalled();
  });

  it('swallows a failure while clearing', async () => {
    const log = logger();
    const broken: StateStore = {
      set: async () => {},
      get: async () => ({ args: { result: 1, tool: 'toolA', token: 't' }, ts: 0 }),
      delete: async () => { throw new Error('redis down'); },
      lock: async (_k, fn) => fn(),
    };
    await expect(clearCompletedResult(broken, 'k', RESULT_NS_PAYMENT, 't', log)).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalled();
  });
});

describe('state_utils: clearCompletedResult', () => {
  it('clears the entry it was handed the token for', async () => {
    const s = store();
    await saveCompletedResult(s, 'k', { ok: 1 }, RESULT_NS_SESSION, 'toolA', 'fp');
    const found = await peekCompletedResult(s, 'k', RESULT_NS_SESSION, 'toolA', 'fp');

    await clearCompletedResult(s, 'k', RESULT_NS_SESSION, found.token);
    expect((await peekCompletedResult(s, 'k', RESULT_NS_SESSION, 'toolA', 'fp')).hasResult).toBe(false);
  });

  // Two concurrent retries of the same call share a fingerprint. Matching on
  // that would delete the other one's freshly cached, already-paid-for result.
  it('keeps an entry cached by another call under the same key', async () => {
    const s = store();
    const fp = callFingerprint({ q: 1 });

    // Retry A reads the result it is about to serve.
    await saveCompletedResult(s, 'k', { run: 1 }, RESULT_NS_SESSION, 'toolA', fp);
    const servedByA = await peekCompletedResult(s, 'k', RESULT_NS_SESSION, 'toolA', fp);

    // Meanwhile call B pays, runs, drops, and caches its own result - same key,
    // same arguments, a different entry.
    await saveCompletedResult(s, 'k', { run: 2 }, RESULT_NS_SESSION, 'toolA', fp);

    // A clears what it served, and B's result survives.
    await clearCompletedResult(s, 'k', RESULT_NS_SESSION, servedByA.token);
    const remaining = await peekCompletedResult(s, 'k', RESULT_NS_SESSION, 'toolA', fp);
    expect(remaining.hasResult).toBe(true);
    expect(remaining.result).toEqual({ run: 2 });
  });

  it('keeps an entry that has a token when the caller holds none', async () => {
    const s = store();
    await saveCompletedResult(s, 'k', { ok: 1 }, RESULT_NS_SESSION, 'toolA', 'fp');

    await clearCompletedResult(s, 'k', RESULT_NS_SESSION, undefined);
    expect((await peekCompletedResult(s, 'k', RESULT_NS_SESSION, 'toolA', 'fp')).hasResult).toBe(true);
  });

  it('does nothing without a store or a key', async () => {
    await expect(clearCompletedResult(undefined, 'k', RESULT_NS_PAYMENT, 't')).resolves.toBeUndefined();
    await expect(clearCompletedResult(store(), undefined, RESULT_NS_PAYMENT, 't')).resolves.toBeUndefined();
  });

  it('leaves alone a key that holds nothing', async () => {
    const s = store();
    await expect(clearCompletedResult(s, 'missing', RESULT_NS_PAYMENT, 't')).resolves.toBeUndefined();
  });
});
