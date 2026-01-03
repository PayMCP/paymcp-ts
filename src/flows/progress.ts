// Progress payment flow: keep the tool call open, periodically poll the payment
// provider, and stream progress updates back to the client until payment
// completes (or is canceled / times out). 

import { paymentPromptMessage } from "../utils/messages.js";
import type { PaidWrapperFactory, ToolHandler } from "../types/flows.js";
import { Logger } from "../types/logger.js";
import { ToolExtraLike } from "../types/config.js";
import { normalizeStatus } from "../utils/payment.js";
import { safeReportProgress } from "../utils/progress.js";
import { AbortWatcher } from "../utils/abortWatcher.js";
import { StateStore } from "../types/state.js";
import { callOriginal } from "../utils/tool.js";


export const DEFAULT_POLL_MS = 3_000; // poll provider every 3s
export const MAX_WAIT_MS = 15 * 60 * 1000; // give up after 15 minutes
const PENDING_TTL_MS = 60 * 60 * 1000; // reuse pending payment for up to 1h

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));



export const makePaidWrapper: PaidWrapperFactory = (
    func,
    _server,
    providers,
    priceInfo,
    toolName,
    stateStore: StateStore,
    _config,
    _getClientInfo,
    logger,
) => {
    const provider = Object.values(providers)[0];
    if (!provider) {
        throw new Error(`[PayMCP] No payment provider configured (tool: ${toolName}).`);
    }
    const log: Logger = logger ?? (provider as any).logger ?? console;

    async function wrapper(paramsOrExtra: any, maybeExtra?: ToolExtraLike) {
        log?.debug?.(
            `[PayMCP:Progress] wrapper invoked for tool=${toolName} argsLen=${arguments.length}`
        );

        // Normalize (args, extra) vs (extra) call shapes (SDK calls tool cb this way).
        const hasArgs = arguments.length === 2;
        const toolArgs = hasArgs ? paramsOrExtra : undefined;
        const extra: ToolExtraLike = hasArgs
            ? (maybeExtra as ToolExtraLike)
            : (paramsOrExtra as ToolExtraLike);
        const abortWatcher = new AbortWatcher((extra as any)?.signal, log);
        const sessionKey = extra?.sessionId ? `${toolName}_${extra.sessionId}` : undefined;
        let paymentId: string | undefined;
        let paymentUrl: string | undefined;
        let status = "pending";

        try {
            // Reuse existing payment if pending and not too old
            if (stateStore && sessionKey) {
                const existing = await stateStore.get(sessionKey);
                if (existing?.args?.paymentId) {
                    const age = Date.now() - existing.ts;
                    try {
                        const rawExisting = await provider.getPaymentStatus(existing.args.paymentId);
                        const normExisting = normalizeStatus(rawExisting);
                        if (normExisting === "paid") {
                            paymentId = existing.args.paymentId;
                            paymentUrl = existing.args.paymentUrl;
                            status = "paid";
                            log?.debug?.(`[PayMCP:Progress] reused paid payment id=${paymentId} url=${paymentUrl}`);
                        } else if (normExisting === "pending" && age < PENDING_TTL_MS) {
                            paymentId = existing.args.paymentId;
                            paymentUrl = existing.args.paymentUrl;
                            status = "pending";
                            log?.debug?.(`[PayMCP:Progress] reused pending payment id=${paymentId} url=${paymentUrl}`);
                        } else {
                            await stateStore.delete(sessionKey);
                        }
                    } catch (err) {
                        log?.warn?.(`[PayMCP:Progress] failed to reuse existing payment: ${String(err)}`);
                        await stateStore.delete(sessionKey);
                    }
                }
            }
            // -----------------------------------------------------------------------
            // 1. Create payment session
            // -----------------------------------------------------------------------
            if (!paymentId || !paymentUrl) {
                const payment = await provider.createPayment(
                    priceInfo.amount,
                    priceInfo.currency,
                    `${toolName}() execution fee`
                );
                paymentId = payment.paymentId;
                paymentUrl = payment.paymentUrl;
                status = "pending";
                log?.debug?.(
                    `[PayMCP:Progress] created payment id=${paymentId} url=${paymentUrl}`
                );
                if (stateStore && sessionKey) {
                    await stateStore.set(sessionKey, { paymentId, paymentUrl });
                }
            }

            // -----------------------------------------------------------------------
            // 2. Initial progress message (0%) with payment link
            // -----------------------------------------------------------------------
            await safeReportProgress(
                extra,
                log,
                paymentPromptMessage(paymentUrl, priceInfo.amount, priceInfo.currency),
                0,
                100
            );

            // -----------------------------------------------------------------------
            // 3. Poll provider until paid / canceled / timeout
            // -----------------------------------------------------------------------
            const start = Date.now();
            let elapsed = 0;

            while (elapsed < MAX_WAIT_MS && status !== "paid") {
                if (abortWatcher.aborted) {
                    log?.warn?.(
                        `[PayMCP:Progress] aborted by client while waiting for payment.`
                    );
                    return {
                        content: [{ type: "text", text: "Payment aborted. Call the tool again to continue." }],
                        annotations: { payment: { status: "pending", payment_id: paymentId } },
                        status: "pending",
                        message: "Payment aborted. Call the tool again to continue.",
                        payment_id: paymentId,
                        payment_url: paymentUrl,
                    };
                }

                await delay(DEFAULT_POLL_MS);
                elapsed = Date.now() - start;

                const raw = await provider.getPaymentStatus(paymentId);
                status = normalizeStatus(raw);
                log?.debug?.(
                    `[PayMCP:Progress] poll status=${raw} -> ${status} elapsed=${elapsed}ms`
                );

                if (status === "paid") {
                    await safeReportProgress (
                        extra,
                        log,
                        "Payment received — running tool…",
                        100,
                        100
                    );
                    break;
                }

                if (status === "canceled") {
                    if (stateStore && sessionKey) await stateStore.delete(sessionKey);
                    await safeReportProgress(
                        extra,
                        log,
                        `Payment ${raw} — aborting.`,
                        0,
                        100
                    );
                    return {
                        content: [{ type: "text", text: "Payment canceled." }],
                        annotations: { payment: { status: "canceled", payment_id: paymentId } },
                        status: "canceled",
                        message: "Payment canceled",
                        payment_id: paymentId,
                        payment_url: paymentUrl,
                    };
                }

                // still pending — emit heartbeat (elapsed ratio up to 99%)
                const pct = Math.min(Math.floor((elapsed / MAX_WAIT_MS) * 99), 99);
                await safeReportProgress(
                    extra,
                    log,
                    `Waiting for payment… (${Math.round(elapsed / 1000)}s elapsed):\n ${paymentUrl}`,
                    pct,
                    100
                );
            }

            if (status !== "paid") {
                // Timed out waiting for payment
                if (stateStore && sessionKey) await stateStore.delete(sessionKey);
                log?.warn?.(
                    `[PayMCP:Progress] timeout waiting for payment paymentId=${paymentId}`
                );
                return {
                    content: [{ type: "text", text: "Payment timeout reached; aborting." }],
                    annotations: {
                        payment: { status: "error", reason: "timeout", payment_id: paymentId },
                    },
                    status: "error",
                    message: "Payment timeout reached; aborting",
                    payment_id: paymentId,
                    payment_url: paymentUrl,
                };
            }

            // -----------------------------------------------------------------------
            // 4. Payment succeeded -> invoke wrapped tool handler
            // -----------------------------------------------------------------------
            log.info?.(`[PayMCP:Progress] payment confirmed; invoking original tool ${toolName}`);
            const toolResult = await callOriginal(func, toolArgs, extra);
            if (abortWatcher.aborted) {
                log?.warn?.(`[PayMCP:Progress] aborted after payment confirmation but before returning tool result.`);
                return {
                    content: [{ type: "text", text: "Connection aborted. Call the tool again to retrieve the result." }],
                    annotations: { payment: { status: "paid", payment_id: paymentId } },
                    payment_id: paymentId,
                    payment_url: paymentUrl,
                    status: "pending",
                    message: "Connection aborted. Call the tool again to retrieve the result.",
                };
            }
            // augment annotation
            if (toolResult && typeof toolResult === "object") {
                try {
                    (toolResult as any).annotations = {
                        ...(toolResult as any).annotations,
                        payment: { status: "paid", payment_id: paymentId },
                    };
                } catch { /* ignore */ }
            }
            if (stateStore && sessionKey) await stateStore.delete(sessionKey);
            return toolResult;
        } finally {
            abortWatcher.dispose();
        }
    }

    return wrapper as unknown as ToolHandler;
};

