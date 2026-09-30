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

  // Map and Set have no own enumerable keys, so describing them generically
  // makes every container - and every plain object - look identical, and calls
  // holding different ones share a fingerprint. A tool whose schema uses
  // z.map()/z.set() receives exactly these.
  it('distinguishes Maps, Sets and plain objects', () => {
    const seen = new Set([
      callFingerprint({ a: new Map([['k', 1]]) }),
      callFingerprint({ a: new Map([['k', 2]]) }),
      callFingerprint({ a: new Map([['j', 1]]) }),
      callFingerprint({ a: new Set([1]) }),
      callFingerprint({ a: new Set([2]) }),
      callFingerprint({ a: {} }),
      callFingerprint({ a: [] }),
    ]);
    expect(seen.size).toBe(7);
  });

  it('matches equal Maps and Sets regardless of insertion order', () => {
    expect(callFingerprint({ a: new Map([['x', 1], ['y', 2]]) }))
      .toBe(callFingerprint({ a: new Map([['y', 2], ['x', 1]]) }));
    expect(callFingerprint({ a: new Set([1, 2]) }))
      .toBe(callFingerprint({ a: new Set([2, 1]) }));
  });

  // Anything that is not a plain object has the same problem Map and Set do:
  // nothing Object.keys can see, so they would all read as "{}" and calls
  // holding different ones would be served each other's results.
  it('distinguishes objects that carry no enumerable keys', () => {
    const values: unknown[] = [
      {}, /a/g, /a/i, /b/g, new Error('x'), new Error('y'), new TypeError('x'),
      new URL('https://a.test/'), new URL('https://b.test/'),
      Promise.resolve(1), new WeakMap(), new Uint8Array([1, 2]), new Uint8Array([2, 1]),
    ];
    const seen = new Set(values.map((v) => callFingerprint({ a: v })));
    expect(seen.size).toBe(values.length);
  });

  // A value appearing twice is described twice - that is what distinguishes it
  // - so a structure sharing one child at every level produces 2^depth of
  // output. This runs synchronously on every call, on arguments the caller
  // chooses, so the walk must not repeat work and the output must be bounded.
  it('gives up rather than blocking on a structure that shares references', () => {
    let node: any = { leaf: 1 };
    for (let i = 0; i < 40; i++) node = { l: node, r: node };

    const started = Date.now();
    const first = callFingerprint(node);
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(1000);
    // Abandoned rather than matched: a cache miss and a re-execution, not a
    // stalled server and not a false match with another such call.
    expect(first.startsWith('unfingerprintable:')).toBe(true);
    expect(callFingerprint(node)).not.toBe(first);
  });

  // Cheap to walk - a dozen distinct objects - but its description is the
  // shared child repeated once per path, so only bounding the output catches it.
  it('gives up on a structure whose description is huge but whose walk is small', () => {
    const shared = { blob: 'x'.repeat(10_000) };
    let node: any = shared;
    for (let i = 0; i < 12; i++) node = { l: node, r: node };

    const started = Date.now();
    const fp = callFingerprint(node);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(fp.startsWith('unfingerprintable:')).toBe(true);
  });

  it('says so when it abandons a call, since the retry will not match', () => {
    const log = logger();
    let node: any = { leaf: 1 };
    for (let i = 0; i < 40; i++) node = { l: node, r: node };
    callFingerprint(node, log);
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('will not match'));
  });

  // Abandoning a fingerprint costs a paid tool a second execution, so ordinary
  // payloads must not reach the budget.
  it('fingerprints a payload of a few thousand rows', () => {
    const rows = Array.from({ length: 5000 }, (_, i) => ({ id: i, name: 'x', n: 1, ok: true }));
    const started = Date.now();
    const fp = callFingerprint({ rows });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(fp.startsWith('unfingerprintable:')).toBe(false);
    expect(fp).toBe(callFingerprint({ rows }));
  });

  it('still fingerprints an ordinary nested structure', () => {
    const modest = { a: [1, 2, 3], b: { c: { d: 'x' } }, e: new Date(0) };
    const fp = callFingerprint(modest);
    expect(fp.startsWith('unfingerprintable:')).toBe(false);
    expect(fp).toBe(callFingerprint({ e: new Date(0), b: { c: { d: 'x' } }, a: [1, 2, 3] }));
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

// A durable store persists as JSON, and JSON drops a key whose value is
// undefined. Every test above uses the in-memory store, which keeps the object
// as it is, so nothing here would notice a payload that cannot survive the
// round trip.
function jsonRoundTripStore(): StateStore {
  const inner = new Map<string, string>();
  return {
    set: async (key, args) => { inner.set(key, JSON.stringify({ args, ts: Date.now() })); },
    get: async (key) => { const raw = inner.get(key); return raw ? JSON.parse(raw) : undefined; },
    delete: async (key) => { inner.delete(key); },
    lock: async (_k, fn) => fn(),
  };
}

describe('state_utils: through a store that persists as JSON', () => {
  it('serves a result that JSON cannot represent as the value it is', async () => {
    const s = jsonRoundTripStore();
    expect(await saveCompletedResult(s, 'k', undefined, RESULT_NS_PAYMENT, 'toolA')).toBe(true);

    // The `result` key does not survive JSON.stringify, so the entry has to say
    // it holds a result some other way - or the retry re-executes a paid tool.
    const found = await peekCompletedResult(s, 'k', RESULT_NS_PAYMENT, 'toolA');
    expect(found.hasResult).toBe(true);
    expect(found.result).toBeUndefined();
  });

  it('round-trips an ordinary result, its tool and its token', async () => {
    const s = jsonRoundTripStore();
    await saveCompletedResult(s, 'k', { content: [{ type: 'text', text: 'ok' }] }, RESULT_NS_SESSION, 'toolA', 'fp');

    const found = await peekCompletedResult(s, 'k', RESULT_NS_SESSION, 'toolA', 'fp');
    expect(found.hasResult).toBe(true);
    expect(found.result).toEqual({ content: [{ type: 'text', text: 'ok' }] });

    expect((await peekCompletedResult(s, 'k', RESULT_NS_SESSION, 'toolB', 'fp')).hasResult).toBe(false);
    expect((await peekCompletedResult(s, 'k', RESULT_NS_SESSION, 'toolA', 'other')).hasResult).toBe(false);

    await clearCompletedResult(s, 'k', RESULT_NS_SESSION, found.token);
    expect((await peekCompletedResult(s, 'k', RESULT_NS_SESSION, 'toolA', 'fp')).hasResult).toBe(false);
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
