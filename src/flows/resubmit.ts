// RESUBMIT flow: first call creates payment and returns payment_url + payment_id; second call (with payment_id) executes the tool once payment is confirmed.

import type { PaidWrapperFactory, ToolHandler } from "../types/flows.js";
import { Logger } from "../types/logger.js";
import { ToolExtraLike } from "../types/config.js";
import { normalizeStatus } from "../utils/payment.js";
import { AbortWatcher } from "../utils/abortWatcher.js";
import { callOriginal } from "../utils/tool.js";

// ---------------------------------------------------------------------------
// Helper: Create payment error with consistent structure
// ---------------------------------------------------------------------------
interface PaymentErrorOptions {
    message: string;
    code: number;
    error: string;
    paymentId: string;
    retryInstructions: string;
    status?: string;
    paymentUrl?: string;
}

function createPaymentError(options: PaymentErrorOptions): never {
    const err = new Error(options.message);
    (err as any).code = options.code;
    (err as any).error = options.error;
    (err as any).data = {
        payment_id: options.paymentId,
        retry_instructions: options.retryInstructions,
        ...(options.paymentUrl && { payment_url: options.paymentUrl }),
        annotations: {
            payment: {
                status: options.status ?? "unknown",
                payment_id: options.paymentId,
            },
        },
    };
    throw err;
}

// ---------------------------------------------------------------------------
// Helper: Validate payment status and throw appropriate errors
// ---------------------------------------------------------------------------
function validatePaymentStatus(status: string, paymentId: string, log?: Logger): void {
    if (["canceled", "failed"].includes(status)) {
        log?.info?.(`[PayMCP:Resubmit] Payment ${status}, state kept for retry`);
        createPaymentError({
            message: `Payment ${status}. User must complete payment to proceed.\nPayment ID: ${paymentId}`,
            code: 402,
            error: `payment_${status}`,
            paymentId,
            retryInstructions: `Payment ${status}. Retry with the same payment_id after resolving the issue, or get a new link by calling this tool without payment_id.`,
            status,
        });
    }

    if (status === "pending") {
        log?.info?.(`[PayMCP:Resubmit] Payment pending, state kept for retry`);
        createPaymentError({
            message: `Payment is not confirmed yet.\nAsk user to complete payment and retry.\nPayment ID: ${paymentId}`,
            code: 402,
            error: "payment_pending",
            paymentId,
            retryInstructions: "Wait for confirmation, then retry this tool with payment_id.",
            status,
        });
    }

    if (status !== "paid") {
        log?.info?.(`[PayMCP:Resubmit] Unknown payment status: ${status}, state kept for retry`);
        createPaymentError({
            message: `Unrecognized payment status: ${status}.\nRetry once payment is confirmed.\nPayment ID: ${paymentId}`,
            code: 402,
            error: "payment_unknown",
            paymentId,
            retryInstructions: "Check payment status and retry once confirmed.",
            status,
        });
    }
}

export const makePaidWrapper: PaidWrapperFactory = (
    func,
    _server,
    providers,
    priceInfo,
    toolName,
    stateStore,
    _config,
    _getClientInfo,
    logger,
) => {
    const provider = Object.values(providers)[0];
    if (!provider) {
        throw new Error(`[PayMCP] No payment provider configured (tool: ${toolName}).`);
    }
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
        const abortWatcher = new AbortWatcher((extra as any)?.signal, log);

        try {
            const existedPaymentId = toolArgs?.payment_id;

            if (!existedPaymentId) {
                // Create payment session
                const { paymentId, paymentUrl } = await provider.createPayment(
                    priceInfo.amount,
                    priceInfo.currency,
                    `${toolName}() execution fee`
                );

                // Store state for later retrieval (wrapped to distinguish undefined args from missing state)
                await stateStore.set(String(paymentId), { args: toolArgs });

                log?.debug?.(
                    `[PayMCP:Resubmit] created payment id=${paymentId} url=${paymentUrl}`
                );

                createPaymentError({
                    message: `Payment required to execute this tool.\nFollow the link to complete payment and retry with payment_id.\n\nPayment link: ${paymentUrl}\nPayment ID: ${paymentId}`,
                    code: 402,
                    error: "payment_required",
                    paymentId: String(paymentId),
                    paymentUrl,
                    retryInstructions: "Follow the link, complete payment, then retry with payment_id.",
                    status: "required",
                });
            }

            // LOCK: Acquire per-payment-id lock to prevent concurrent access
            // This fixes both ENG-215 (race condition) and ENG-214 (payment loss)
            return await stateStore.lock(existedPaymentId, async () => {
                log?.debug?.(`[PayMCP:Resubmit] Lock acquired for payment_id=${existedPaymentId}`);

                // Get state (don't delete yet)
                const storedData = await stateStore.get(existedPaymentId);
                log?.info?.(`[PayMCP:Resubmit] State retrieved: ${storedData !== undefined}`);

                if (!storedData) {
                    log?.warn?.(`[PayMCP:Resubmit] No state found for payment_id=${existedPaymentId}`);
                    createPaymentError({
                        message: "Unknown or expired payment_id.",
                        code: 404,
                        error: "payment_id_not_found",
                        paymentId: existedPaymentId,
                        retryInstructions: "Payment ID not found or already used. Get a new link by calling this tool without payment_id.",
                    });
                }

                // Unwrap the stored args
                const stored = storedData.args;

                // Check payment status with provider
                const raw = await provider.getPaymentStatus(existedPaymentId);
                const status = normalizeStatus(raw);
                log?.debug?.(`[PayMCP:Resubmit] paymentId ${existedPaymentId}, poll status=${raw} -> ${status}`);

                // Validate payment status (throws if not "paid")
                validatePaymentStatus(status, existedPaymentId, log);

                // Payment confirmed - execute tool BEFORE deleting state
                log?.info?.(`[PayMCP:Resubmit] payment confirmed; invoking original tool ${toolName}`);

                // Execute tool with ORIGINAL args (may fail - state not deleted yet)
                const toolResult = await callOriginal(func, toolArgs, extra);

                if (abortWatcher.aborted) {
                    log?.warn?.(`[PayMCP:Resubmit] aborted after payment confirmation but before returning tool result.`);
                    return {
                        content: [{ type: "text", text: "Connection aborted. Call the tool again to retrieve the result." }],
                        annotations: { payment: { status: "paid", payment_id: existedPaymentId } },
                        payment_id: existedPaymentId,
                        status: "pending",
                        message: "Connection aborted. Call the tool again to retrieve the result.",
                    };
                }

                // Tool succeeded - now delete state to enforce single-use
                await stateStore.delete(existedPaymentId);
                log?.info?.(`[PayMCP:Resubmit] Tool executed successfully, state deleted (single-use enforced)`);

                // Return original tool result without modification
                return toolResult;
            }); // End of lock
        } finally {
            abortWatcher.dispose();
        }
    }

    return wrapper as unknown as ToolHandler;
};

