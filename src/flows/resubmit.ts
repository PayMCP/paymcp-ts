// RESUBMIT flow: first call creates payment and returns payment_url + payment_id; second call (with payment_id) executes the tool once payment is confirmed.

import type { PaidWrapperFactory, ToolHandler } from "../types/flows.js";
import { Logger } from "../types/logger.js";
import { ToolExtraLike } from "../types/config.js";
import { normalizeStatus } from "../utils/payment.js";
import { StateStore } from "../types/state.js";

export const makePaidWrapper: PaidWrapperFactory = (
    func,
    _server,
    provider,
    priceInfo,
    toolName,
    stateStore,
    _config,
    logger,
) => {
    const log: Logger = logger ?? (provider as any).logger ?? console;

    if (!stateStore) {
        throw new Error(`StateStore is required for RESUBMIT flow but not provided for tool ${toolName}`);
    }

    if (!priceInfo?.amount || !priceInfo?.currency) {
        throw new Error(`Invalid price info for tool ${toolName}`);
    }

    async function wrapper(paramsOrExtra: any, maybeExtra?: ToolExtraLike) {
        log?.debug?.(
            `[PayMCP:Resubmit] wrapper invoked for tool=${toolName} argsLen=${arguments.length}`
        );

        // Normalize (args, extra) vs (extra) call shapes (SDK calls tool cb this way).
        const hasArgs = arguments.length === 2;
        const toolArgs = hasArgs ? paramsOrExtra : undefined;
        const extra: ToolExtraLike = hasArgs
            ? (maybeExtra as ToolExtraLike)
            : (paramsOrExtra as ToolExtraLike);

        const existedPaymentId = toolArgs?.payment_id;

        if (!existedPaymentId) {
            // Create payment session
            const { paymentId, paymentUrl } = await provider.createPayment(
                priceInfo.amount,
                priceInfo.currency,
                `${toolName}() execution fee`
            );

            // Store state for later retrieval
            await stateStore.set(String(paymentId), toolArgs);

            log?.debug?.(
                `[PayMCP:Resubmit] created payment id=${paymentId} url=${paymentUrl}`
            );

            const err = new Error(
                `Payment required to execute this tool.\nFollow the link to complete payment and retry with payment_id.\n\nPayment link: ${paymentUrl}\nPayment ID: ${paymentId}`
            );
            (err as any).code = 402;
            (err as any).error = "payment_required";
            (err as any).data = {
                payment_id: paymentId,
                payment_url: paymentUrl,
                retry_instructions: "Follow the link, complete payment, then retry with payment_id.",
                annotations: { payment: { status: "required", payment_id: paymentId } }
            };
            throw err;
        }

        // LOCK: Acquire per-payment-id lock to prevent concurrent access
        // This fixes both ENG-215 (race condition) and ENG-214 (payment loss)
        return await stateStore.lock(existedPaymentId, async () => {
            log?.debug?.(`[PayMCP:Resubmit] Lock acquired for payment_id=${existedPaymentId}`);

            // Get state (don't delete yet)
            const stored = await stateStore.get(existedPaymentId);
            log?.info?.(`[PayMCP:Resubmit] State retrieved: ${stored !== undefined}`);

            if (!stored) {
                log?.warn?.(`[PayMCP:Resubmit] No state found for payment_id=${existedPaymentId}`);
                const err = new Error("Unknown or expired payment_id.");
                (err as any).code = 404;
                (err as any).error = "payment_id_not_found";
                (err as any).data = {
                    payment_id: existedPaymentId,
                    retry_instructions: "Payment ID not found or already used. Get a new link by calling this tool without payment_id.",
                };
                throw err;
            }

            // Check payment status with provider
            const raw = await provider.getPaymentStatus(existedPaymentId);
            const status = normalizeStatus(raw);
            log?.debug?.(`[PayMCP:Resubmit] paymentId ${existedPaymentId}, poll status=${raw} -> ${status}`);

            if (['canceled', 'failed'].includes(status)) {
                // Keep state so user can retry after resolving payment issue
                log?.info?.(`[PayMCP:Resubmit] Payment ${status}, state kept for retry`);

                const err = new Error(
                    `Payment ${status}. User must complete payment to proceed.\nPayment ID: ${existedPaymentId}`
                );
                (err as any).code = 402;
                (err as any).error = `payment_${status}`;
                (err as any).data = {
                    payment_id: existedPaymentId,
                    retry_instructions: `Payment ${status}. Retry with the same payment_id after resolving the issue, or get a new link by calling this tool without payment_id.`,
                    annotations: { payment: { status, payment_id: existedPaymentId } }
                };
                throw err;
            }

            if (status === "pending") {
                // Keep state so user can retry after payment completes
                log?.info?.(`[PayMCP:Resubmit] Payment pending, state kept for retry`);

                const err = new Error(
                    `Payment is not confirmed yet.\nAsk user to complete payment and retry.\nPayment ID: ${existedPaymentId}`
                );
                (err as any).code = 402;
                (err as any).error = "payment_pending";
                (err as any).data = {
                    payment_id: existedPaymentId,
                    retry_instructions: "Wait for confirmation, then retry this tool with payment_id.",
                    annotations: { payment: { status, payment_id: existedPaymentId } }
                };
                throw err;
            }

            if (status !== "paid") {
                // Keep state for unknown status
                log?.info?.(`[PayMCP:Resubmit] Unknown payment status: ${status}, state kept for retry`);

                const err = new Error(
                    `Unrecognized payment status: ${status}.\nRetry once payment is confirmed.\nPayment ID: ${existedPaymentId}`
                );
                (err as any).code = 402;
                (err as any).error = "payment_unknown";
                (err as any).data = {
                    payment_id: existedPaymentId,
                    retry_instructions: "Check payment status and retry once confirmed.",
                    annotations: { payment: { status, payment_id: existedPaymentId } }
                };
                throw err;
            }

            // Payment confirmed - execute tool BEFORE deleting state
            log?.info?.(`[PayMCP:Resubmit] payment confirmed; invoking original tool ${toolName}`);

            // Execute tool (may fail - state not deleted yet)
            const toolResult = await callOriginal(func, toolArgs, extra);

            // Tool succeeded - now delete state to enforce single-use
            await stateStore.delete(existedPaymentId);
            log?.info?.(`[PayMCP:Resubmit] Tool executed successfully, state deleted (single-use enforced)`);

            // Ensure toolResult has required MCP 'content' field; if not, synthesize text.
            if (!toolResult || !Array.isArray((toolResult as any).content)) {
                return {
                    content: [{ type: "text", text: "Tool completed after payment." }],
                    annotations: { payment: { status: "paid", payment_id: existedPaymentId } },
                    raw: toolResult,
                };
            }
            // augment annotation
            try {
                (toolResult as any).annotations = {
                    ...(toolResult as any).annotations,
                    payment: { status: "paid", payment_id: existedPaymentId },
                };
            } catch { /* ignore */ }
            return toolResult;
        }); // End of lock
    }

    return wrapper as unknown as ToolHandler;
};

// ---------------------------------------------------------------------------
// Helper: safely invoke the original tool handler preserving args shape
// ---------------------------------------------------------------------------
async function callOriginal(
    func: ToolHandler,
    args: any | undefined,
    extra: ToolExtraLike
) {
    if (args !== undefined) {
        return await func(args, extra);
    } else {
        return await func(extra);
    }
}