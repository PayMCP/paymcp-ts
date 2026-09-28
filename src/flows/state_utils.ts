// Shared state helpers for the payment flows.
//
// When a paid tool has already run but the client dropped before receiving the
// result, the caller has been charged for an execution they never saw. These
// helpers keep that result so the retry can be answered from it instead of
// running the tool a second time.

import { createHash, randomUUID } from "crypto";
import type { Logger } from "../types/logger.js";
import type { StateStore } from "../types/state.js";

// Namespaces for cached results. Flows keyed by a caller-supplied payment id and
// flows keyed by (tool, session) must never be able to address each other's
// entries: the payment id comes from the client, so without this a caller could
// name another flow's state key and be handed its result. The namespace literal
// sits immediately after a fixed prefix so the two spaces cannot collide.
export const RESULT_NS_PAYMENT = "payment";
export const RESULT_NS_SESSION = "session";

export type ResultNamespace = typeof RESULT_NS_PAYMENT | typeof RESULT_NS_SESSION;

/** What a `peek` found, if anything. */
export interface CachedResult {
    hasResult: boolean;
    /** The value the caller should be handed back. */
    result?: unknown;
    /** Identifies the stored entry, so whoever serves it can clear exactly that one. */
    token?: string;
}

/** The shape we write into the store under a result key. */
interface ResultPayload {
    result: unknown;
    tool: string;
    token: string;
    fingerprint?: string;
}

function resultKey(namespace: ResultNamespace, key: string): string {
    return `paymcp:result:${namespace}:${key}`;
}

/**
 * Describe a thrown value for a log line: its type, no stack trace.
 *
 * A cache miss is not a fault in the call being made, so the stack is noise.
 * The type is not: `String(new Error())` on its own says nothing about what
 * went wrong, and a subclass that never sets `name` reports itself as "Error".
 */
function describeError(err: unknown): string {
    try {
        if (err instanceof Error) {
            const type = err.constructor?.name || err.name || "Error";
            return err.message ? `${type}: ${err.message}` : type;
        }
        return `${typeof err}: ${String(err)}`;
    } catch {
        return "unprintable error";
    }
}

/**
 * A call that cannot be described gets a value unique to that call.
 *
 * It must not be a constant: a constant would make every such call match every
 * other one, and they would be served each other's results.
 */
function unfingerprintable(): string {
    return `unfingerprintable:${randomUUID()}`;
}

/**
 * Render a value as a string that is stable across calls with equal arguments.
 *
 * `JSON.stringify` is not enough on its own: it does not order object keys, so
 * `{a:1,b:2}` and `{b:2,a:1}` - the same call - would not match, and it throws
 * on cycles and BigInt.
 */
function canonicalize(value: unknown, seen: WeakSet<object>): string {
    if (value === null) return "null";

    switch (typeof value) {
        case "undefined":
            return "undefined";
        case "boolean":
            return String(value);
        case "number":
            // NaN and the infinities have no JSON form.
            return Number.isFinite(value) ? JSON.stringify(value) : `number:${String(value)}`;
        case "bigint":
            return `bigint:${String(value)}`;
        case "string":
            return JSON.stringify(value);
        case "symbol":
            return `symbol:${String(value.description ?? "")}`;
        case "function":
            return `function:${(value as { name?: string }).name ?? ""}`;
    }

    const obj = value as object;
    // Only a cycle back through the current branch is collapsed; a value that
    // merely appears twice is described twice, which is what distinguishes it.
    if (seen.has(obj)) return "[Circular]";
    seen.add(obj);
    try {
        if (Array.isArray(obj)) {
            return `[${obj.map((item) => canonicalize(item, seen)).join(",")}]`;
        }
        if (obj instanceof Date) {
            return `date:${obj.getTime()}`;
        }
        const keys = Object.keys(obj).sort();
        const entries = keys.map(
            (k) => `${JSON.stringify(k)}:${canonicalize((obj as Record<string, unknown>)[k], seen)}`
        );
        return `{${entries.join(",")}}`;
    } finally {
        seen.delete(obj);
    }
}

/**
 * Identify the call a result belongs to.
 *
 * Flows keyed by (tool, session) reuse one key across every call the session
 * makes to that tool, so a cached result has to be pinned to the arguments it
 * was produced for - otherwise the next call, with different arguments, would
 * be answered with the previous call's result.
 *
 * This runs on every call, including calls that never disconnect, so it never
 * throws: an input it cannot describe just fails to match anything.
 *
 * The request `extra` is deliberately not part of this. It carries the abort
 * signal and the session plumbing, which differ on every request, so including
 * it would stop a genuine retry from ever matching.
 */
export function callFingerprint(toolArgs?: unknown): string {
    try {
        const canonical = canonicalize(toolArgs, new WeakSet());
        return createHash("sha256").update(canonical).digest("hex");
    } catch {
        return unfingerprintable();
    }
}

/**
 * Persist the result of a paid tool call so a retry can return it.
 *
 * Called when the client disconnects after the tool has run: the caller has
 * already been charged, so the result must survive until they ask for it again.
 * Returns false when there is nothing to store into, or when the store cannot
 * hold this result - the caller then keeps its previous behaviour and the tool
 * runs again on retry.
 */
export async function saveCompletedResult(
    stateStore: StateStore | undefined,
    key: string | undefined,
    result: unknown,
    namespace: ResultNamespace,
    tool: string,
    fingerprint?: string,
    log?: Logger
): Promise<boolean> {
    if (!stateStore || key === undefined || key === null) return false;

    const payload: ResultPayload = { result, tool, token: randomUUID() };
    if (fingerprint !== undefined) payload.fingerprint = fingerprint;

    try {
        // The value is handed over as it is rather than checked first: an
        // in-memory store keeps the object, while a durable store serialises to
        // JSON and refuses what it cannot represent. Only the store knows which.
        await stateStore.set(resultKey(namespace, String(key)), payload);
        return true;
    } catch (err) {
        log?.warn?.(
            `[PayMCP] Failed to cache tool result for ${key}; a retry will execute the tool again: ${describeError(err)}`
        );
        return false;
    }
}

/**
 * Report whether a completed result is cached for this call.
 *
 * The returned token identifies the stored entry itself, so whoever hands the
 * result back can clear exactly what they served and nothing else.
 *
 * A payment id identifies a payment, not a tool, and every paid tool reads the
 * same namespace - so the tool that produced the result has to match too,
 * otherwise one tool would answer with another tool's output.
 */
export async function peekCompletedResult(
    stateStore: StateStore | undefined,
    key: string | undefined,
    namespace: ResultNamespace,
    tool: string,
    fingerprint?: string,
    log?: Logger
): Promise<CachedResult> {
    const miss: CachedResult = { hasResult: false };
    if (!stateStore || key === undefined || key === null) return miss;

    let entry: { args: any; ts: number } | undefined;
    try {
        entry = await stateStore.get(resultKey(namespace, String(key)));
    } catch (err) {
        log?.warn?.(`[PayMCP] Failed to read cached tool result for ${key}: ${describeError(err)}`);
        return miss;
    }

    // Only a well-formed entry counts as a cached result: anything else means
    // there is nothing to hand back and the tool still has to run.
    const payload = entry?.args;
    if (!payload || typeof payload !== "object" || !("result" in payload)) return miss;

    if (payload.tool !== tool) {
        log?.debug?.(`[PayMCP] Cached result for ${key} belongs to another tool; ignoring it.`);
        return miss;
    }

    if (fingerprint !== undefined && payload.fingerprint !== fingerprint) {
        log?.debug?.(`[PayMCP] Cached result for ${key} belongs to a different call; ignoring it.`);
        return miss;
    }

    return { hasResult: true, result: payload.result, token: payload.token };
}

/**
 * Drop the cached result identified by `token`, and only that one.
 *
 * Session-keyed flows share one key across every call the session makes to a
 * tool, and they hold no lock: between reading a result and clearing it,
 * another call can cache its own under the same key - including one for the
 * very same arguments. Clearing by key alone would throw away a result someone
 * has already paid for, so the entry has to be the same entry.
 *
 * The check is read-then-delete, which these stores cannot do atomically: an
 * entry written between the two calls is still deleted. That window is one
 * round trip, where clearing by key alone left it open across the caller's own
 * awaits, but it is narrowed rather than closed.
 */
export async function clearCompletedResult(
    stateStore: StateStore | undefined,
    key: string | undefined,
    namespace: ResultNamespace,
    token?: string,
    log?: Logger
): Promise<void> {
    if (!stateStore || key === undefined || key === null) return;

    const fullKey = resultKey(namespace, String(key));

    try {
        const entry = await stateStore.get(fullKey);
        const payload = entry?.args;
        const stored =
            payload && typeof payload === "object" ? (payload as ResultPayload).token : undefined;
        // A caller holding no token clears nothing: the entry belongs to
        // whoever was handed its token, not to this call.
        if (stored !== token) {
            log?.debug?.(`[PayMCP] Cached result for ${key} is no longer the one served; keeping it.`);
            return;
        }
        await stateStore.delete(fullKey);
    } catch (err) {
        log?.warn?.(`[PayMCP] Failed to clear cached tool result for ${key}: ${describeError(err)}`);
    }
}
