// RESUBMIT flow: first call creates payment and returns payment_url + payment_id; second call (with payment_id) executes the tool once payment is confirmed.

import type { PaidWrapperFactory, ToolHandler } from "../types/flows.js";
import { Logger } from "../types/logger.js";
import { ToolExtraLike } from "../types/config.js";
import { normalizeStatus } from "../utils/payment.js";

export const makePaidWrapper: PaidWrapperFactory = (
    func,
    _server,
    provider,
    priceInfo,
    toolName,
    _stateStore,
    _config,
    logger,
) => {
    const log: Logger = logger ?? (provider as any).logger ?? console;

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

        const raw = await provider.getPaymentStatus(existedPaymentId);
        const status = normalizeStatus(raw);
        log?.debug?.(`[PayMCP:Resubmit] paymentId ${existedPaymentId}, poll status=${raw} -> ${status}`);

        if (['canceled', 'failed'].includes(status)) {
            const err = new Error(
                `Payment ${status}. User must complete payment to proceed.\nPayment ID: ${existedPaymentId}`
            );
            (err as any).code = 402;
            (err as any).error = `payment_${status}`;
            (err as any).data = {
                payment_id: existedPaymentId,
                retry_instructions: "User canceled or failed payment. If they want to continue, get the new link by calling this tool without payment_id.",
                annotations: { payment: { status, payment_id: existedPaymentId } }
            };
            throw err;
        }
        if (status === "pending") {
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
        } else if (status !== "paid") {
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


        // Payment succeeded -> invoke wrapped tool handler
        log.info?.(`[PayMCP:Resubmit] payment confirmed; invoking original tool ${toolName}`);
        const toolResult = await callOriginal(func, toolArgs, extra);
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