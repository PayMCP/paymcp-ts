// A paid tool runs, the client drops before receiving the result, and the
// caller retries the way the returned message tells them to. The retry must be
// answered from the stored result: the tool must not run a second time on a
// single payment, and the result the caller paid for must not be discarded.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InMemoryStateStore } from '../../src/state/inMemory.js';
import type { StateStore } from '../../src/types/state.js';
import type { PriceConfig } from '../../src/types/config.js';
import {
  RESULT_NS_PAYMENT,
  RESULT_NS_SESSION,
  callFingerprint,
  peekCompletedResult,
} from '../../src/flows/state_utils.js';
import { makePaidWrapper as resubmitWrapper } from '../../src/flows/resubmit.js';
import { makePaidWrapper as twoStepWrapper } from '../../src/flows/two_step.js';
import { makePaidWrapper as progressWrapper } from '../../src/flows/progress.js';
import { makePaidWrapper as elicitationWrapper } from '../../src/flows/elicitation.js';
import { makePaidWrapper as dynamicWrapper, PAYMENTS } from '../../src/flows/dynamic_tools.js';

const priceInfo: PriceConfig = { amount: 25, currency: 'EUR' };
const clientInfo = (async () => ({ name: 'test', capabilities: {} })) as any;
const ABORT_TEXT = 'Connection aborted. Call the tool again to retrieve the result.';

const silent = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) as any;

const provider = () => ({
  createPayment: vi.fn().mockResolvedValue({ paymentId: 'pay_1', paymentUrl: 'https://pay/1' }),
  getPaymentStatus: vi.fn().mockResolvedValue('paid'),
  logger: undefined,
}) as any;

/**
 * A tool that drops the connection the first time it runs, and counts its runs.
 * Aborting from inside the tool is what actually happens: the client goes away
 * while the work is in flight, not before it starts.
 */
function droppingTool(controller: AbortController, label = 'run') {
  const runs: any[][] = [];
  const fn = vi.fn(async (...args: any[]) => {
    runs.push(args);
    if (runs.length === 1) controller.abort('client gone');
    return { content: [{ type: 'text', text: `${label} #${runs.length}` }] };
  });
  return { fn, runs };
}

/** A store that refuses to hold a cached result, the way a durable JSON store would. */
function storeRefusingResults(): StateStore {
  const inner = new InMemoryStateStore();
  return {
    set: async (key, args, options) => {
      if (key.startsWith('paymcp:result:')) {
        throw new TypeError('Converting circular structure to JSON');
      }
      return inner.set(key, args, options);
    },
    get: (key) => inner.get(key),
    delete: (key) => inner.delete(key),
    lock: (key, fn) => inner.lock(key, fn),
  };
}

const text = (r: any) => r?.content?.[0]?.text;

// ---------------------------------------------------------------------------
// RESUBMIT - keyed by payment id
// ---------------------------------------------------------------------------
describe('RESUBMIT: disconnect after a paid execution', () => {
  const build = (store: StateStore, fn: any) =>
    resubmitWrapper(fn, {} as any, { mock: provider() }, priceInfo, 'testTool', store, {}, clientInfo, silent());

  /** Run the first call to get a payment id out of the 402. */
  async function initiate(wrapper: any) {
    try {
      await wrapper({}, {});
      throw new Error('expected a payment_required error');
    } catch (err: any) {
      expect(err.error).toBe('payment_required');
      return err.data.payment_id as string;
    }
  }

  it('serves the retry from the stored result and runs the tool once', async () => {
    const store = new InMemoryStateStore();
    const ctl = new AbortController();
    const { fn, runs } = droppingTool(ctl);
    const wrapper = build(store, fn);

    const pid = await initiate(wrapper);
    const dropped = await wrapper({ payment_id: pid }, { signal: ctl.signal });
    expect(text(dropped)).toBe(ABORT_TEXT);
    expect(dropped.status).toBe('pending');

    const retry = await wrapper({ payment_id: pid }, {});
    expect(text(retry)).toBe('run #1');
    expect(runs).toHaveLength(1);
  });

  it('one payment buys exactly one execution, however often it is retried', async () => {
    const store = new InMemoryStateStore();
    const ctl = new AbortController();
    const { fn, runs } = droppingTool(ctl);
    const wrapper = build(store, fn);

    const pid = await initiate(wrapper);
    await wrapper({ payment_id: pid }, { signal: ctl.signal });
    for (let i = 0; i < 3; i++) {
      expect(text(await wrapper({ payment_id: pid }, {}))).toBe('run #1');
    }
    expect(runs).toHaveLength(1);
  });

  it('holds the result back while the retry is itself disconnected', async () => {
    const store = new InMemoryStateStore();
    const ctl = new AbortController();
    const { fn, runs } = droppingTool(ctl);
    const wrapper = build(store, fn);

    const pid = await initiate(wrapper);
    await wrapper({ payment_id: pid }, { signal: ctl.signal });

    const stillGone = await wrapper({ payment_id: pid }, { signal: AbortSignal.abort() });
    expect(text(stillGone)).toBe(ABORT_TEXT);
    // Nothing was handed over, so the result is still there for the next try.
    expect(text(await wrapper({ payment_id: pid }, {}))).toBe('run #1');
    expect(runs).toHaveLength(1);
  });

  // A payment id names a payment, not a tool, and every paid tool reads the
  // same namespace.
  it('does not answer one tool with another tool\'s result', async () => {
    const store = new InMemoryStateStore();
    const ctl = new AbortController();
    const { fn, runs } = droppingTool(ctl);
    const wrapper = build(store, fn);
    const pid = await initiate(wrapper);
    await wrapper({ payment_id: pid }, { signal: ctl.signal });

    const other = droppingTool(new AbortController(), 'other');
    const otherWrapper = resubmitWrapper(
      other.fn, {} as any, { mock: provider() }, priceInfo, 'otherTool', store, {}, clientInfo, silent()
    );
    // Whatever else it does with this payment id, it must not be handed the
    // first tool's result - every paid tool reads the same namespace.
    const served = await otherWrapper({ payment_id: pid }, {});
    expect(text(served)).toBe('other #1');

    // And the first tool's result is still waiting for the caller who paid.
    expect(text(await wrapper({ payment_id: pid }, {}))).toBe('run #1');
    expect(runs).toHaveLength(1);
  });

  // The payment id comes from the client: naming a session-keyed flow's key
  // must not reach that flow's cached result.
  it('cannot be pointed at a session-keyed flow\'s cached result', async () => {
    const store = new InMemoryStateStore();
    const { fn, runs } = droppingTool(new AbortController());
    const wrapper = build(store, fn);

    // A session-keyed flow has a result cached for this session and tool.
    const { saveCompletedResult } = await import('../../src/flows/state_utils.js');
    await saveCompletedResult(
      store, 'testTool_sess1', { content: [{ type: 'text', text: 'someone else' }] },
      RESULT_NS_SESSION, 'testTool', callFingerprint({})
    );

    await expect(wrapper({ payment_id: 'testTool_sess1' }, {})).rejects.toMatchObject({
      error: 'payment_id_not_found',
    });
    expect(runs).toHaveLength(0);
  });

  it('falls back to the old behaviour when the store will not hold the result', async () => {
    const store = storeRefusingResults();
    const ctl = new AbortController();
    const { fn, runs } = droppingTool(ctl);
    const log = silent();
    const wrapper = resubmitWrapper(
      fn, {} as any, { mock: provider() }, priceInfo, 'testTool', store, {}, clientInfo, log
    );

    const pid = await initiate(wrapper);
    // The call still succeeds - a cache that cannot be written is not a fault
    // in the call being made.
    const dropped = await wrapper({ payment_id: pid }, { signal: ctl.signal });
    expect(text(dropped)).toBe(ABORT_TEXT);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('TypeError'));

    // Without a stored result the retry runs the tool again, as it did before.
    expect(text(await wrapper({ payment_id: pid }, {}))).toBe('run #2');
    expect(runs).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// TWO_STEP - keyed by payment id, executed from the confirm tool
// ---------------------------------------------------------------------------
describe('TWO_STEP: disconnect after a paid execution', () => {
  // NOTE: the confirm handler reads `arguments` from its enclosing factory, so
  // on the SDK's real `(params, extra)` call it never sees the request's abort
  // signal and this branch cannot be reached. These tests drive it through the
  // shape that does reach it; making the production shape reach it is a
  // separate change.
  function build(store: StateStore, fn: any, tool = 'testTool') {
    let confirm: any;
    const server = { tools: new Map(), registerTool: (_n: string, _c: any, h: any) => { confirm = h; } } as any;
    const wrapper = twoStepWrapper(
      fn, server, { mock: provider() }, priceInfo, tool, store, {}, clientInfo, silent()
    );
    return { wrapper, confirm: (args: any) => confirm(args) };
  }

  it('serves the retry from the stored result and runs the tool once', async () => {
    const store = new InMemoryStateStore();
    const ctl = new AbortController();
    const { fn, runs } = droppingTool(ctl);
    const { wrapper, confirm } = build(store, fn);

    const init: any = await wrapper({ q: 1 }, {});
    const pid = init.structured_content.payment_id;

    const dropped = await confirm({ payment_id: pid, signal: ctl.signal });
    expect(text(dropped)).toBe(ABORT_TEXT);

    // The stored arguments were already consumed by the first confirm, so
    // without the cached result this retry would find nothing at all.
    const retry = await confirm({ payment_id: pid });
    expect(text(retry)).toBe('run #1');
    expect(runs).toHaveLength(1);
  });

  it('holds the result back while the retry is itself disconnected', async () => {
    const store = new InMemoryStateStore();
    const ctl = new AbortController();
    const { fn, runs } = droppingTool(ctl);
    const { wrapper, confirm } = build(store, fn);

    const init: any = await wrapper({ q: 1 }, {});
    const pid = init.structured_content.payment_id;
    await confirm({ payment_id: pid, signal: ctl.signal });

    expect(text(await confirm({ payment_id: pid, signal: AbortSignal.abort() }))).toBe(ABORT_TEXT);
    expect(text(await confirm({ payment_id: pid }))).toBe('run #1');
    expect(runs).toHaveLength(1);
  });

  it('does not answer one tool with another tool\'s result', async () => {
    const store = new InMemoryStateStore();
    const ctl = new AbortController();
    const { fn, runs } = droppingTool(ctl);
    const { wrapper, confirm } = build(store, fn);
    const init: any = await wrapper({ q: 1 }, {});
    const pid = init.structured_content.payment_id;
    await confirm({ payment_id: pid, signal: ctl.signal });

    const other = droppingTool(new AbortController(), 'other');
    const otherFlow = build(store, other.fn, 'otherTool');
    // Its own confirm tool, its own state: the first tool's cached result is
    // not in reach, so this payment id buys it nothing.
    const served = await otherFlow.confirm({ payment_id: pid });
    expect(text(served)).not.toBe('run #1');
    expect(served.status).toBe('error');
    expect(other.runs).toHaveLength(0);

    // And the first tool's result survives for the caller who paid.
    expect(text(await confirm({ payment_id: pid }))).toBe('run #1');
    expect(runs).toHaveLength(1);
  });

  it('falls back to the old behaviour when the store will not hold the result', async () => {
    const store = storeRefusingResults();
    const ctl = new AbortController();
    const { fn, runs } = droppingTool(ctl);
    let confirm: any;
    const server = { tools: new Map(), registerTool: (_n: string, _c: any, h: any) => { confirm = h; } } as any;
    const log = silent();
    const wrapper = twoStepWrapper(
      fn, server, { mock: provider() }, priceInfo, 'testTool', store, {}, clientInfo, log
    );

    const init: any = await wrapper({ q: 1 }, {});
    const pid = init.structured_content.payment_id;
    expect(text(await confirm({ payment_id: pid, signal: ctl.signal }))).toBe(ABORT_TEXT);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('TypeError'));

    // Unchanged from before the fix: the args are gone and nothing was cached.
    expect((await confirm({ payment_id: pid })).status).toBe('error');
    expect(runs).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// PROGRESS - keyed by tool:session, so results carry a call fingerprint
// ---------------------------------------------------------------------------
describe('PROGRESS: disconnect after a paid execution', () => {
  const SESSION_KEY = 'testTool_sess1';
  const build = (store: StateStore, fn: any) =>
    progressWrapper(fn, {} as any, { mock: provider() }, priceInfo, 'testTool', store, {}, clientInfo, silent());

  /** Put a paid payment under the session key, so the poll loop is skipped. */
  const seedPaid = (store: StateStore) =>
    store.set(SESSION_KEY, { paymentId: 'pay_1', paymentUrl: 'https://pay/1' });

  const extra = (signal?: AbortSignal) => ({ sessionId: 'sess1', signal }) as any;

  it('serves the retry from the stored result and runs the tool once', async () => {
    const store = new InMemoryStateStore();
    const ctl = new AbortController();
    const { fn, runs } = droppingTool(ctl);
    const wrapper = build(store, fn);
    await seedPaid(store);

    const dropped = await wrapper({ q: 1 }, extra(ctl.signal));
    expect(text(dropped)).toBe(ABORT_TEXT);

    const retry = await wrapper({ q: 1 }, extra());
    expect(text(retry)).toBe('run #1');
    expect(runs).toHaveLength(1);
  });

  it('holds the result back while the retry is itself disconnected', async () => {
    const store = new InMemoryStateStore();
    const ctl = new AbortController();
    const { fn, runs } = droppingTool(ctl);
    const wrapper = build(store, fn);
    await seedPaid(store);

    await wrapper({ q: 1 }, extra(ctl.signal));
    expect(text(await wrapper({ q: 1 }, extra(AbortSignal.abort())))).toBe(ABORT_TEXT);
    expect(text(await wrapper({ q: 1 }, extra()))).toBe('run #1');
    expect(runs).toHaveLength(1);
  });

  // This key covers every call the session makes to this tool, so a result
  // pinned to one call must not answer a different one.
  it('does not serve the result to a later call with different arguments', async () => {
    const store = new InMemoryStateStore();
    const ctl = new AbortController();
    const { fn, runs } = droppingTool(ctl);
    const wrapper = build(store, fn);
    await seedPaid(store);

    await wrapper({ q: 1 }, extra(ctl.signal));

    const different = await wrapper({ q: 2 }, extra());
    expect(text(different)).toBe('run #2');
    expect(runs).toHaveLength(2);
    // The first call's result is still waiting for the call that paid for it.
    expect(text(await wrapper({ q: 1 }, extra()))).toBe('run #1');
    expect(runs).toHaveLength(2);
  });

  // Otherwise the next identical call would be served from cache instead of
  // being paid for.
  it('drops the result once it has been delivered', async () => {
    const store = new InMemoryStateStore();
    const ctl = new AbortController();
    const { fn, runs } = droppingTool(ctl);
    const wrapper = build(store, fn);
    await seedPaid(store);

    await wrapper({ q: 1 }, extra(ctl.signal));
    expect(text(await wrapper({ q: 1 }, extra()))).toBe('run #1');

    expect(
      (await peekCompletedResult(store, SESSION_KEY, RESULT_NS_SESSION, 'testTool', callFingerprint({ q: 1 }))).hasResult
    ).toBe(false);

    // The same call again is a new, separate purchase.
    await seedPaid(store);
    expect(text(await wrapper({ q: 1 }, extra()))).toBe('run #2');
    expect(runs).toHaveLength(2);
  });

  it('does not serve one tool the result of another in the same session', async () => {
    const store = new InMemoryStateStore();
    const ctl = new AbortController();
    const { fn, runs } = droppingTool(ctl);
    const wrapper = build(store, fn);
    await seedPaid(store);
    await wrapper({ q: 1 }, extra(ctl.signal));

    // Another tool, same session: its own key, and nothing cached under it.
    const other = droppingTool(new AbortController(), 'other');
    const otherWrapper = progressWrapper(
      other.fn, {} as any, { mock: provider() }, priceInfo, 'otherTool', store, {}, clientInfo, silent()
    );
    await store.set('otherTool_sess1', { paymentId: 'pay_1', paymentUrl: 'https://pay/1' });
    expect(text(await otherWrapper({ q: 1 }, extra()))).toBe('other #1');
    expect(other.runs).toHaveLength(1);

    // And the first tool's result is still there for the call that paid.
    expect(text(await wrapper({ q: 1 }, extra()))).toBe('run #1');
    expect(runs).toHaveLength(1);
  });

  it('falls back to the old behaviour when the store will not hold the result', async () => {
    const store = storeRefusingResults();
    const ctl = new AbortController();
    const { fn, runs } = droppingTool(ctl);
    const log = silent();
    const wrapper = progressWrapper(
      fn, {} as any, { mock: provider() }, priceInfo, 'testTool', store, {}, clientInfo, log
    );
    await seedPaid(store);

    expect(text(await wrapper({ q: 1 }, extra(ctl.signal)))).toBe(ABORT_TEXT);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('TypeError'));
    expect(text(await wrapper({ q: 1 }, extra()))).toBe('run #2');
    expect(runs).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// ELICITATION - keyed by tool:session, so results carry a call fingerprint
// ---------------------------------------------------------------------------
describe('ELICITATION: disconnect after a paid execution', () => {
  const SESSION_KEY = 'testTool_sess1';
  const build = (store: StateStore, fn: any, tool = 'testTool') =>
    elicitationWrapper(fn, {} as any, { mock: provider() }, priceInfo, tool, store, {}, clientInfo, silent());

  const seedPaid = (store: StateStore, key = SESSION_KEY) =>
    store.set(key, { paymentId: 'pay_1', paymentUrl: 'https://pay/1' });

  const extra = (signal?: AbortSignal) => ({
    sessionId: 'sess1',
    signal,
    sendRequest: vi.fn().mockResolvedValue({ action: 'accept' }),
  }) as any;

  it('serves the retry from the stored result and runs the tool once', async () => {
    const store = new InMemoryStateStore();
    const ctl = new AbortController();
    const { fn, runs } = droppingTool(ctl);
    const wrapper = build(store, fn);
    await seedPaid(store);

    expect(text(await wrapper({ q: 1 }, extra(ctl.signal)))).toBe(ABORT_TEXT);
    expect(text(await wrapper({ q: 1 }, extra()))).toBe('run #1');
    expect(runs).toHaveLength(1);
  });

  it('holds the result back while the retry is itself disconnected', async () => {
    const store = new InMemoryStateStore();
    const ctl = new AbortController();
    const { fn, runs } = droppingTool(ctl);
    const wrapper = build(store, fn);
    await seedPaid(store);

    await wrapper({ q: 1 }, extra(ctl.signal));
    expect(text(await wrapper({ q: 1 }, extra(AbortSignal.abort())))).toBe(ABORT_TEXT);
    expect(text(await wrapper({ q: 1 }, extra()))).toBe('run #1');
    expect(runs).toHaveLength(1);
  });

  it('does not serve the result to a later call with different arguments', async () => {
    const store = new InMemoryStateStore();
    const ctl = new AbortController();
    const { fn, runs } = droppingTool(ctl);
    const wrapper = build(store, fn);
    await seedPaid(store);

    await wrapper({ q: 1 }, extra(ctl.signal));
    expect(text(await wrapper({ q: 2 }, extra()))).toBe('run #2');
    expect(text(await wrapper({ q: 1 }, extra()))).toBe('run #1');
    expect(runs).toHaveLength(2);
  });

  it('drops the result once it has been delivered', async () => {
    const store = new InMemoryStateStore();
    const ctl = new AbortController();
    const { fn, runs } = droppingTool(ctl);
    const wrapper = build(store, fn);
    await seedPaid(store);

    await wrapper({ q: 1 }, extra(ctl.signal));
    expect(text(await wrapper({ q: 1 }, extra()))).toBe('run #1');
    expect(
      (await peekCompletedResult(store, SESSION_KEY, RESULT_NS_SESSION, 'testTool', callFingerprint({ q: 1 }))).hasResult
    ).toBe(false);

    await seedPaid(store);
    expect(text(await wrapper({ q: 1 }, extra()))).toBe('run #2');
    expect(runs).toHaveLength(2);
  });

  it('does not serve one tool the result of another in the same session', async () => {
    const store = new InMemoryStateStore();
    const ctl = new AbortController();
    const { fn, runs } = droppingTool(ctl);
    await seedPaid(store);
    await build(store, fn)({ q: 1 }, extra(ctl.signal));

    const other = droppingTool(new AbortController(), 'other');
    await seedPaid(store, 'otherTool_sess1');
    expect(text(await build(store, other.fn, 'otherTool')({ q: 1 }, extra()))).toBe('other #1');
    expect(other.runs).toHaveLength(1);
    expect(runs).toHaveLength(1);
  });

  // The disconnect check used to sit behind the early return that synthesizes
  // `content`, so a tool whose result is not MCP-shaped skipped it entirely.
  it('covers a tool whose result needs synthesizing', async () => {
    const store = new InMemoryStateStore();
    const ctl = new AbortController();
    let n = 0;
    const fn = vi.fn(async () => { n++; if (n === 1) ctl.abort(); return 'a bare string'; });
    const wrapper = build(store, fn);
    await seedPaid(store);

    expect(text(await wrapper({ q: 1 }, extra(ctl.signal)))).toBe(ABORT_TEXT);
    const retry: any = await wrapper({ q: 1 }, extra());
    expect(retry.raw).toBe('a bare string');
    expect(text(retry)).toBe('Tool completed after payment.');
    expect(n).toBe(1);
  });

  it('caches nothing when the client gave us no session to key it by', async () => {
    const store = new InMemoryStateStore();
    const ctl = new AbortController();
    const { fn, runs } = droppingTool(ctl);
    const wrapper = build(store, fn);
    // Without a session id every caller would share one key, so a paid result
    // could reach someone who did not pay for it. Better to run twice.
    await store.set('testTool_undefined', { paymentId: 'pay_1', paymentUrl: 'https://pay/1' });

    const noSession = { signal: ctl.signal, sendRequest: vi.fn() } as any;
    expect(text(await wrapper({ q: 1 }, noSession))).toBe(ABORT_TEXT);
    expect(runs).toHaveLength(1);
    const keys = ['payment', 'session'] as const;
    for (const ns of keys) {
      expect((await peekCompletedResult(store, 'testTool_undefined', ns as any, 'testTool')).hasResult).toBe(false);
    }
  });

  it('falls back to the old behaviour when the store will not hold the result', async () => {
    const store = storeRefusingResults();
    const ctl = new AbortController();
    const { fn, runs } = droppingTool(ctl);
    const log = silent();
    const wrapper = elicitationWrapper(
      fn, {} as any, { mock: provider() }, priceInfo, 'testTool', store, {}, clientInfo, log
    );
    await seedPaid(store);

    expect(text(await wrapper({ q: 1 }, extra(ctl.signal)))).toBe(ABORT_TEXT);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('TypeError'));
    expect(text(await wrapper({ q: 1 }, extra()))).toBe('run #2');
    expect(runs).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// DYNAMIC_TOOLS - sessions live in this process, so the result rides along
// ---------------------------------------------------------------------------
describe('DYNAMIC_TOOLS: disconnect after a paid execution', () => {
  beforeEach(() => PAYMENTS.clear());

  // NOTE: the confirm tool is registered without an inputSchema, so the SDK
  // calls it as `(extra)` and its handler's second parameter - the only place
  // it looks for the abort signal - is undefined. These tests drive it through
  // the `(params, extra)` shape that does reach the branch; making the
  // production shape reach it is a separate change.
  function build(fn: any) {
    let confirm: any;
    const server = {
      tools: new Map(),
      _registeredTools: {} as any,
      registerTool: (name: string, _c: any, h: any) => {
        server._registeredTools[name] = { enabled: true };
        confirm = h;
      },
      sendNotification: vi.fn().mockResolvedValue(undefined),
    } as any;
    const wrapper = dynamicWrapper(
      fn, server, { mock: provider() }, priceInfo, 'testTool',
      new InMemoryStateStore(), {}, clientInfo, silent()
    );
    return { wrapper, server, confirm: (extra: any) => confirm({}, extra) };
  }

  it('serves the retry from the stored result and runs the tool once', async () => {
    const ctl = new AbortController();
    const { fn, runs } = droppingTool(ctl);
    const { wrapper, confirm } = build(fn);

    await wrapper({ q: 1 }, {});
    expect(text(await confirm({ signal: ctl.signal }))).toBe(ABORT_TEXT);

    const retry = await confirm({});
    expect(text(retry)).toBe('run #1');
    expect(runs).toHaveLength(1);
  });

  it('holds the result back while the retry is itself disconnected', async () => {
    const ctl = new AbortController();
    const { fn, runs } = droppingTool(ctl);
    const { wrapper, confirm } = build(fn);

    await wrapper({ q: 1 }, {});
    await confirm({ signal: ctl.signal });
    expect(text(await confirm({ signal: AbortSignal.abort() }))).toBe(ABORT_TEXT);
    expect(text(await confirm({}))).toBe('run #1');
    expect(runs).toHaveLength(1);
  });

  it('cleans up the payment session and the confirm tool once delivered', async () => {
    const ctl = new AbortController();
    const { fn } = droppingTool(ctl);
    const { wrapper, server, confirm } = build(fn);

    await wrapper({ q: 1 }, {});
    await confirm({ signal: ctl.signal });
    // Kept while the caller has not had it.
    expect(PAYMENTS.has('pay_1')).toBe(true);

    await confirm({});
    expect(PAYMENTS.has('pay_1')).toBe(false);
    expect(server._registeredTools['confirm_testTool_pay_1']).toBeUndefined();
    expect(server.sendNotification).toHaveBeenCalled();

    // And a further retry finds the session gone, rather than running again.
    expect((await confirm({})).status).toBe('error');
  });
});
