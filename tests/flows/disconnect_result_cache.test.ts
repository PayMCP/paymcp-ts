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

/** A store that cannot delete: the flow must still hand over the paid result. */
function storeRefusingDeletes(): StateStore {
  const inner = new InMemoryStateStore();
  return {
    set: (key, args, options) => inner.set(key, args, options),
    get: (key) => inner.get(key),
    delete: async () => { throw new Error('redis down'); },
    lock: (key, fn) => inner.lock(key, fn),
  };
}

/** A store that drops result keys but cannot delete the payment record. */
function storeKeepingPaymentState(): StateStore {
  const inner = new InMemoryStateStore();
  return {
    set: (key, args, options) => inner.set(key, args, options),
    get: (key) => inner.get(key),
    delete: async (key) => {
      if (!key.startsWith('paymcp:result:')) throw new Error('redis down');
      return inner.delete(key);
    },
    lock: (key, fn) => inner.lock(key, fn),
  };
}

/**
 * A tool that honours its abort signal: it cancels the request and then throws,
 * which is what a well-behaved tool does once the signal actually reaches it.
 */
function cancellationAwareTool(controller: AbortController) {
  const runs: string[] = [];
  const fn = vi.fn(async (...args: any[]) => {
    runs.push(`run #${runs.length + 1}`);
    const requestExtra = args[args.length - 1];
    if (runs.length === 1) {
      controller.abort('client cancelled');
      if (requestExtra?.signal?.aborted) throw new Error('aborted by caller');
    }
    return { content: [{ type: 'text', text: runs[runs.length - 1] }] };
  });
  return { fn, runs };
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

  // The very failure the guarded delete fixes elsewhere: resubmit never clears
  // its cached result, so an unguarded delete here made the paid result
  // unreachable for as long as the store could not delete.
  it('still hands over the result when the store cannot delete', async () => {
    const store = storeRefusingDeletes();
    const ctl = new AbortController();
    const { fn, runs } = droppingTool(ctl);
    const log = silent();
    const wrapper = resubmitWrapper(
      fn, {} as any, { mock: provider() }, priceInfo, 'testTool', store, {}, clientInfo, log
    );

    const pid = await initiate(wrapper);
    expect(text(await wrapper({ payment_id: pid }, { signal: ctl.signal }))).toBe(ABORT_TEXT);
    expect(text(await wrapper({ payment_id: pid }, {}))).toBe('run #1');
    // And again, rather than throwing the same store error forever.
    expect(text(await wrapper({ payment_id: pid }, {}))).toBe('run #1');
    expect(runs).toHaveLength(1);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to clear spent payment state'));
  });

  // The ordinary path: nothing disconnected, the tool ran, and the single-use
  // delete failed. The caller is still owed what they paid for.
  it('returns the result of an undisturbed call when the store cannot delete', async () => {
    const store = storeRefusingDeletes();
    const fn = vi.fn(async () => ({ content: [{ type: 'text', text: 'done' }] }));
    const log = silent();
    const wrapper = resubmitWrapper(
      fn, {} as any, { mock: provider() }, priceInfo, 'testTool', store, {}, clientInfo, log
    );

    const pid = await initiate(wrapper);
    expect(text(await wrapper({ payment_id: pid }, {}))).toBe('done');
    expect(fn).toHaveBeenCalledTimes(1);
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
  // The confirm tool has an inputSchema, so the SDK calls it as (params, extra).
  function build(store: StateStore, fn: any, tool = 'testTool') {
    let confirm: any;
    const server = { tools: new Map(), registerTool: (_n: string, _c: any, h: any) => { confirm = h; } } as any;
    const wrapper = twoStepWrapper(
      fn, server, { mock: provider() }, priceInfo, tool, store, {}, clientInfo, silent()
    );
    return {
      wrapper,
      confirm: ({ signal, ...params }: any) => confirm(params, { signal }),
    };
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

  // The confirm handler used to hand the params object on in place of the
  // request's extra, so the paid tool got no session and no abort signal.
  it('gives the paid tool the confirm request\'s own extra', async () => {
    const store = new InMemoryStateStore();
    const seen: any[] = [];
    const fn = vi.fn(async (...args: any[]) => {
      seen.push(args);
      return { content: [{ type: 'text', text: 'ok' }] };
    });
    let confirm: any;
    const server = { tools: new Map(), registerTool: (_n: string, _c: any, h: any) => { confirm = h; } } as any;
    const wrapper = twoStepWrapper(
      fn, server, { mock: provider() }, priceInfo, 'testTool', store, {}, clientInfo, silent()
    );

    const init: any = await wrapper({ q: 1 }, {});
    const confirmExtra = { sessionId: 'sess1', signal: undefined, sendRequest: vi.fn() };
    await confirm({ payment_id: init.structured_content.payment_id }, confirmExtra);

    const [toolArgs, toolExtra] = seen[0];
    expect(toolArgs).toEqual({ q: 1 });
    expect(toolExtra).toBe(confirmExtra);
    expect(toolExtra).not.toHaveProperty('payment_id');
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

  // Giving the paid tool a live signal means a tool that honours it throws on
  // cancellation - and the stored args are consumed before it runs.
  it('keeps the payment usable when the paid tool throws on cancellation', async () => {
    const store = new InMemoryStateStore();
    const ctl = new AbortController();
    const { fn, runs } = cancellationAwareTool(ctl);
    const { wrapper, confirm } = build(store, fn);

    const init: any = await wrapper({ q: 1 }, {});
    const pid = init.structured_content.payment_id;

    await expect(confirm({ payment_id: pid, signal: ctl.signal })).rejects.toThrow('aborted by caller');
    // The caller paid and received nothing, so the payment is still theirs.
    expect(text(await confirm({ payment_id: pid }))).toBe('run #2');
    expect(runs).toHaveLength(2);
  });

  // `lock` is part of the StateStore contract, but a hand-written store from a
  // JavaScript consumer may not have one. Throwing would abandon a payment the
  // user may already have made.
  it('still runs the tool when the store has no lock()', async () => {
    const inner = new InMemoryStateStore();
    const lockless: any = {
      set: (k: string, a: any, o: any) => inner.set(k, a, o),
      get: (k: string) => inner.get(k),
      delete: (k: string) => inner.delete(k),
    };
    const fn = vi.fn(async () => ({ content: [{ type: 'text', text: 'done' }] }));
    let confirm: any;
    const server = { tools: new Map(), registerTool: (_n: string, _c: any, h: any) => { confirm = h; } } as any;
    const log = silent();
    const wrapper = twoStepWrapper(
      fn, server, { mock: provider() }, priceInfo, 'testTool', lockless, {}, clientInfo, log
    );

    const init: any = await wrapper({ q: 1 }, {});
    const served = await confirm({ payment_id: init.structured_content.payment_id }, {});
    expect(text(served)).toBe('done');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('no lock()'));
  });

  // Without the per-payment lock both confirms read the stored args, both see
  // the payment as paid, and both run the tool.
  it('runs the tool once when two confirms race on one payment', async () => {
    const store = new InMemoryStateStore();
    const runs: number[] = [];
    const fn = vi.fn(async () => {
      runs.push(runs.length + 1);
      // Yield, so a second confirm can interleave if nothing serialises them.
      await new Promise((r) => setTimeout(r, 5));
      return { content: [{ type: 'text', text: `run #${runs.length}` }] };
    });
    const { wrapper, confirm } = build(store, fn);

    const init: any = await wrapper({ q: 1 }, {});
    const pid = init.structured_content.payment_id;

    const [a, b] = await Promise.all([
      confirm({ payment_id: pid }),
      confirm({ payment_id: pid }),
    ]);
    expect(runs).toHaveLength(1);
    // One call gets the result; the other is told the payment is spent.
    const served = [a, b].filter((r) => text(r) === 'run #1');
    expect(served).toHaveLength(1);
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

  // Failing to clear the spent payment record must not cost the caller the
  // result they paid for, and must not buy a second execution.
  it('still hands over the result when the store cannot delete', async () => {
    const store = storeRefusingDeletes();
    const ctl = new AbortController();
    const { fn, runs } = droppingTool(ctl);
    const log = silent();
    const wrapper = progressWrapper(
      fn, {} as any, { mock: provider() }, priceInfo, 'testTool', store, {}, clientInfo, log
    );
    await seedPaid(store);

    expect(text(await wrapper({ q: 1 }, extra(ctl.signal)))).toBe(ABORT_TEXT);
    expect(text(await wrapper({ q: 1 }, extra()))).toBe('run #1');
    expect(runs).toHaveLength(1);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to clear spent payment state'));
  });

  it('returns the result of an undisturbed call when the store cannot delete', async () => {
    const store = storeRefusingDeletes();
    const fn = vi.fn(async () => ({ content: [{ type: 'text', text: 'done' }] }));
    const wrapper = progressWrapper(
      fn, {} as any, { mock: provider() }, priceInfo, 'testTool', store, {}, clientInfo, silent()
    );
    await seedPaid(store);
    expect(text(await wrapper({ q: 1 }, extra()))).toBe('done');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  // Known limitation, pinned so a change of behaviour is noticed: when the
  // spent payment record cannot be removed, it survives and the next call
  // reuses it - a free run of the paid tool. See the issue linked from the
  // pull request; the alternative is taking the result away from someone who
  // has paid for it, which is worse.
  it('leaves a reusable payment behind when only that delete fails', async () => {
    const store = storeKeepingPaymentState();
    const ctl = new AbortController();
    const { fn, runs } = droppingTool(ctl);
    const createPayment = vi.fn().mockResolvedValue({ paymentId: 'pay_1', paymentUrl: 'https://pay/1' });
    const wrapper = progressWrapper(
      fn, {} as any, { mock: { createPayment, getPaymentStatus: vi.fn().mockResolvedValue('paid') } as any },
      priceInfo, 'testTool', store, {}, clientInfo, silent()
    );
    await seedPaid(store);

    await wrapper({ q: 1 }, extra(ctl.signal));            // paid, ran, dropped
    expect(text(await wrapper({ q: 1 }, extra()))).toBe('run #1');  // served
    expect(text(await wrapper({ q: 1 }, extra()))).toBe('run #2');  // free run
    expect(runs).toHaveLength(2);
    expect(createPayment).not.toHaveBeenCalled();
  });

  it('serves the same result again when no delete lands at all', async () => {
    const store = storeRefusingDeletes();
    const ctl = new AbortController();
    const { fn, runs } = droppingTool(ctl);
    const wrapper = progressWrapper(
      fn, {} as any, { mock: provider() }, priceInfo, 'testTool', store, {}, clientInfo, silent()
    );
    await seedPaid(store);

    await wrapper({ q: 1 }, extra(ctl.signal));
    expect(text(await wrapper({ q: 1 }, extra()))).toBe('run #1');
    // Nothing could be cleared, so the entry is still there - the caller gets
    // their result again rather than the tool running a second time.
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

  it('still hands over the result when the store cannot delete', async () => {
    const store = storeRefusingDeletes();
    const ctl = new AbortController();
    const { fn, runs } = droppingTool(ctl);
    const log = silent();
    const wrapper = elicitationWrapper(
      fn, {} as any, { mock: provider() }, priceInfo, 'testTool', store, {}, clientInfo, log
    );
    await seedPaid(store);

    expect(text(await wrapper({ q: 1 }, extra(ctl.signal)))).toBe(ABORT_TEXT);
    expect(text(await wrapper({ q: 1 }, extra()))).toBe('run #1');
    expect(runs).toHaveLength(1);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to clear spent payment state'));
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

  // Registered without an inputSchema, so the SDK calls it with the request
  // extra as its only argument.
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
    return { wrapper, server, confirm: (extra: any) => confirm(extra) };
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

  // The watcher used to be built outside the try, so the returns above it -
  // unknown payment, still-aborted, and the cached hand-off - never reached
  // `finally { dispose() }`. Harmless while the signal was always undefined.
  it('releases the abort listener on the cached-result paths', async () => {
    const ctl = new AbortController();
    const { fn } = droppingTool(ctl);
    const { wrapper, confirm } = build(fn);
    await wrapper({ q: 1 }, {});
    await confirm({ signal: ctl.signal });

    /** A signal that records whether its listener was taken off again. */
    const watched = () => {
      const listeners: any = { add: 0, remove: 0 };
      return {
        listeners,
        signal: {
          aborted: false,
          addEventListener: () => { listeners.add++; },
          removeEventListener: () => { listeners.remove++; },
        },
      };
    };

    const served = watched();
    expect(text(await confirm({ signal: served.signal }))).toBe('run #1');
    expect(served.listeners.add).toBe(1);
    expect(served.listeners.remove).toBe(1);

    // And on the path where the payment session is already gone.
    const unknown = watched();
    expect((await confirm({ signal: unknown.signal })).status).toBe('error');
    expect(unknown.listeners.add).toBe(1);
    expect(unknown.listeners.remove).toBe(1);
  });

  // A host that is not the official SDK may call the confirm tool with no
  // arguments. Handing `undefined` to the paid tool makes any tool that touches
  // its extra throw - after the payment session has been consumed, so the paid
  // result would be lost outright.
  it('never hands the paid tool a non-object as its extra', async () => {
    for (const call of [
      (c: any) => c(),
      (c: any) => c(undefined),
      (c: any) => c('nonsense'),
      (c: any) => c(7),
    ]) {
      const seen: any[] = [];
      const fn = vi.fn(async (...args: any[]) => {
        seen.push(args);
        // A tool that reads its extra, the way a real one does.
        const e = args[args.length - 1];
        return { content: [{ type: 'text', text: String(e?.sessionId ?? 'no-session') }] };
      });
      let confirm: any;
      const server = {
        tools: new Map(),
        _registeredTools: {} as any,
        registerTool: (_n: string, _c: any, h: any) => { confirm = h; },
        sendNotification: vi.fn().mockResolvedValue(undefined),
      } as any;
      const wrapper = dynamicWrapper(
        fn, server, { mock: provider() }, priceInfo, 'testTool',
        new InMemoryStateStore(), {}, clientInfo, silent()
      );
      await wrapper({ q: 1 }, { sessionId: 'sess1' });

      const served = await call(confirm);
      // The call completes and the tool ran, rather than erroring out with the
      // payment already spent.
      expect(served.status).not.toBe('error');
      expect(fn).toHaveBeenCalledTimes(1);
      const passedExtra = seen[0][seen[0].length - 1];
      expect(passedExtra === null || typeof passedExtra !== 'object').toBe(false);
      PAYMENTS.clear();
    }
  });

  it('releases the abort listener on the hasResult-and-still-aborted path', async () => {
    const ctl = new AbortController();
    const { fn } = droppingTool(ctl);
    const { wrapper, confirm } = build(fn);
    await wrapper({ q: 1 }, {});
    await confirm({ signal: ctl.signal });

    const listeners = { add: 0, remove: 0 };
    const signal: any = {
      aborted: true,
      addEventListener: () => { listeners.add++; },
      removeEventListener: () => { listeners.remove++; },
    };
    expect(text(await confirm({ signal }))).toBe(ABORT_TEXT);
    expect(listeners.add).toBe(1);
    expect(listeners.remove).toBe(1);
  });

  // The cached result is the only copy: anything that throws between dropping
  // the session and returning would take it with it.
  it('hands over the result even if announcing the tool list throws', async () => {
    const ctl = new AbortController();
    const { fn } = droppingTool(ctl);
    let confirm: any;
    const server = {
      tools: new Map(),
      _registeredTools: {} as any,
      registerTool: (name: string, _c: any, h: any) => { server._registeredTools[name] = { enabled: true }; confirm = h; },
      sendNotification: vi.fn(() => { throw new Error('transport gone'); }),
    } as any;
    const log = silent();
    const wrapper = dynamicWrapper(
      fn, server, { mock: provider() }, priceInfo, 'testTool',
      new InMemoryStateStore(), {}, clientInfo, log
    );

    await wrapper({ q: 1 }, {});
    expect(text(await confirm({}, { signal: ctl.signal }))).toBe(ABORT_TEXT);
    expect(text(await confirm({}, {}))).toBe('run #1');
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('announce the tool list change'));
  });


  it('hands over an undisturbed result even if announcing the tool list throws', async () => {
    const fn = vi.fn(async () => ({ content: [{ type: 'text', text: 'done' }] }));
    let confirm: any;
    const server = {
      tools: new Map(),
      _registeredTools: {} as any,
      registerTool: (name: string, _c: any, h: any) => { server._registeredTools[name] = { enabled: true }; confirm = h; },
      sendNotification: vi.fn(() => { throw new Error('transport gone'); }),
    } as any;
    const log = silent();
    const wrapper = dynamicWrapper(
      fn, server, { mock: provider() }, priceInfo, 'testTool',
      new InMemoryStateStore(), {}, clientInfo, log
    );

    await wrapper({ q: 1 }, {});
    expect(text(await confirm({}, {}))).toBe('done');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  // Falling back to the initiating request's extra must not inherit its signal:
  // that request has already ended, and an aborted one would make every confirm
  // look cancelled, so the result is cached and never handed over.
  it('does not inherit a spent signal when falling back to the initiating extra', async () => {
    let runs = 0;
    const fn = vi.fn(async () => { runs++; return { content: [{ type: 'text', text: `run #${runs}` }] }; });
    let confirm: any;
    const server = {
      tools: new Map(),
      _registeredTools: {} as any,
      registerTool: (name: string, _c: any, h: any) => { server._registeredTools[name] = { enabled: true }; confirm = h; },
      sendNotification: vi.fn().mockResolvedValue(undefined),
    } as any;
    const wrapper = dynamicWrapper(
      fn, server, { mock: provider() }, priceInfo, 'testTool',
      new InMemoryStateStore(), {}, clientInfo, silent()
    );

    // The initiating request carried a signal that is already spent, and the
    // host calls the confirm tool with no arguments at all.
    await wrapper({ q: 1 }, { sessionId: 'sess1', signal: AbortSignal.abort() });
    expect(text(await confirm())).toBe('run #1');
    expect(runs).toBe(1);
  });

  it('keeps the payment session when the paid tool throws on cancellation', async () => {
    const ctl = new AbortController();
    const { fn, runs } = cancellationAwareTool(ctl);
    const { wrapper, confirm } = build(fn);

    await wrapper({ q: 1 }, {});
    const failed = await confirm({ signal: ctl.signal });
    expect(failed.status).toBe('error');
    // The session is back, so the retry is not told the payment is unknown.
    expect(PAYMENTS.has('pay_1')).toBe(true);
    expect(text(await confirm({}))).toBe('run #2');
    expect(runs).toHaveLength(2);
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

// ---------------------------------------------------------------------------
// The strict half: deletes that run before any money has moved
// ---------------------------------------------------------------------------
// `discardSpentState` is deliberately lenient, and just as deliberately not
// used for state dropped before the caller has paid for anything. A failure
// there has to reach them, so the flow does not carry on as if the record were
// gone. These assert the store's own error by its type - a test that only
// checks "it threw" passes on a loosened delete too, because the code just
// past these deletes throws its own error anyway.
describe('deletes before any payment must not be swallowed', () => {
  class StoreUnavailable extends Error {}

  /** Fails only on the keys named, so one delete can be singled out. */
  function storeFailingDeleteOf(match: (key: string) => boolean): StateStore {
    const inner = new InMemoryStateStore();
    return {
      set: (key, args, options) => inner.set(key, args, options),
      get: (key) => inner.get(key),
      delete: async (key) => {
        if (match(key)) throw new StoreUnavailable('redis unavailable');
        return inner.delete(key);
      },
      lock: (key, fn) => inner.lock(key, fn),
    };
  }

  const sessionExtra = () => ({
    sessionId: 'sess1',
    sendRequest: vi.fn().mockResolvedValue({ action: 'cancel' }),
  }) as any;

  it('ELICITATION surfaces it when dropping a canceled payment', async () => {
    const store = storeFailingDeleteOf((k) => k === 'testTool_sess1');
    const fn = vi.fn();
    const wrapper = elicitationWrapper(
      fn, {} as any,
      { mock: { createPayment: vi.fn().mockResolvedValue({ paymentId: 'pay_1', paymentUrl: 'u' }), getPaymentStatus: vi.fn().mockResolvedValue('canceled') } as any },
      priceInfo, 'testTool', store, {}, clientInfo, silent()
    );

    // The user cancels, so the payment record is dropped before anyone pays.
    await expect(wrapper({ q: 1 }, sessionExtra())).rejects.toBeInstanceOf(StoreUnavailable);
    expect(fn).not.toHaveBeenCalled();
  });

  it('PROGRESS surfaces it when dropping a stale payment it cannot reuse', async () => {
    const store = storeFailingDeleteOf((k) => k === 'testTool_sess1');
    // A record whose payment the provider no longer recognises, so the flow
    // drops it and starts over - again, before anyone has paid.
    await store.set('testTool_sess1', { paymentId: 'pay_old', paymentUrl: 'u' });
    const fn = vi.fn();
    const wrapper = progressWrapper(
      fn, {} as any,
      { mock: { createPayment: vi.fn().mockResolvedValue({ paymentId: 'pay_1', paymentUrl: 'u' }), getPaymentStatus: vi.fn().mockRejectedValue(new Error('unknown payment')) } as any },
      priceInfo, 'testTool', store, {}, clientInfo, silent()
    );

    await expect(wrapper({ q: 1 }, { sessionId: 'sess1' } as any)).rejects.toBeInstanceOf(StoreUnavailable);
    expect(fn).not.toHaveBeenCalled();
  });

});
