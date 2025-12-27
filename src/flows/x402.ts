// RESUBMIT flow: first call creates payment and returns payment_url + payment_id; second call (with payment_id) executes the tool once payment is confirmed.

import type { PaidWrapperFactory, ToolHandler } from "../types/flows.js";
import { Logger } from "../types/logger.js";
import { ToolExtraLike } from "../types/config.js";
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
    data?: any;
    headers?: string[];
}

function createPaymentError(options: PaymentErrorOptions): never {
    const err = new Error(options.message);
    (err as any).code = options.code;
    (err as any).error = options.error;
    if (options.data) (err as any).data = options.data
    else (err as any).data = {
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
    if (options.headers) (err as any).headers = options.headers;

    throw err;
}


export const makePaidWrapper: PaidWrapperFactory = (
    func,
    _server,
    providers,
    priceInfo,
    toolName,
    stateStore,
    _config,
    getClientInfo,
    logger,
) => {
    const provider = Object.values(providers)[0];
    if (!provider) {
        throw new Error(`[PayMCP] No payment provider configured (tool: ${toolName}).`);
    }
    const log: Logger = logger ?? (provider as any).logger ?? console;

    if (!stateStore) {
        throw new Error(`StateStore is required for RESUBMIT x402 flow but not provided for tool ${toolName}`);
    }

    if (!priceInfo?.amount || !priceInfo?.currency) {
        throw new Error(`Invalid price info for tool ${toolName}`);
    }

    async function wrapper(paramsOrExtra: any, maybeExtra?: ToolExtraLike) {
        log?.debug?.(
            `[PayMCP:x402] wrapper invoked for tool=${toolName} argsLen=${arguments.length}`
        );


        // Normalize (args, extra) vs (extra) call shapes (SDK calls tool cb this way).
        const hasArgs = arguments.length === 2;
        const toolArgs = hasArgs ? paramsOrExtra : undefined;
        const extra: ToolExtraLike = hasArgs
            ? (maybeExtra as ToolExtraLike)
            : (paramsOrExtra as ToolExtraLike);
        //const abortWatcher = new AbortWatcher((extra as any)?.signal, log);


        const paymentSigB64 = extra.requestInfo?.headers?.['payment-signature'] ?? extra.requestInfo?.headers?.['x-payment'];

        if (!paymentSigB64) { //that shouldn't be possible if x402middlware installed. If not - return json-rpc error just in case
            const { paymentId, paymentData } = await provider.createPayment(
                priceInfo.amount,
                priceInfo.currency,
                `${toolName}() execution fee`
            );
            const challengeId = paymentData?.accepts?.[0]?.extra?.challengeId;
            if (!challengeId) {
                throw new Error("Payment provider did not return challengeId in payment requirements");
            }
            // Store by challengeId so the follow-up request (PAYMENT-SIGNATURE) can be verified statelessly across instances
            await stateStore.set(String(challengeId), { paymentData });
            createPaymentError(paymentData);
        }

        const sig = JSON.parse(
            Buffer.from(paymentSigB64, "base64").toString("utf8")
        );

        log.debug("[PayMCP] decoded signature",sig)

        const clientInfo = getClientInfo();

        const challengeId = sig.accepted?.extra?.challengeId ?? `${clientInfo.sessionId}-${toolName}`

        log.log("[PayMCP getting paymentData from ", `${clientInfo.sessionId}-${toolName}`)

        const storedData = challengeId ? await stateStore.get(String(challengeId)) : null;
        if (!storedData?.args?.paymentData) {
            throw new Error("Unknown challenge ID");
        }

        const x402v = sig.x402Version;
        const expected = storedData.args.paymentData.accepts?.[0];
        const got = x402v === 1
            ? getPaymentFieldsForV1(sig, challengeId)
            : sig.accepted;
        if (!expected || !got) {
            throw new Error("Invalid payment data for signature verification");
        }

        const normAddr = (a: any) => (typeof a === "string" ? a.toLowerCase() : "");

        const mismatch: string[] = [];
        if (String(expected.amount ?? expected.maxAmountRequired) !== String(got.amount)) mismatch.push("amount");
        if (String(expected.network) !== String(got.network)) mismatch.push("network");
        if (x402v !== 1 && normAddr(expected.asset) !== normAddr(got.asset)) mismatch.push("asset");
        if (normAddr(expected.payTo) !== normAddr(got.payTo)) mismatch.push("payTo");
        if (x402v !== 1 && String(expected.extra?.challengeId) !== String(got.extra?.challengeId)) mismatch.push("challengeId");

        if (mismatch.length) {
            logger?.warn?.("[PayMCP] Incorrect signature", { mismatch, expected, got });
            throw new Error("Incorrect signature");
        }

        const payment_status = await provider.getPaymentStatus(paymentSigB64);

        if (payment_status === 'error') {
            await stateStore.delete(String(challengeId));
            throw new Error("Payment failed");
        }

        if (payment_status === 'paid') {
            await stateStore.delete(String(challengeId));
            const toolResult = await callOriginal(func, toolArgs, extra);
            return toolResult;
        }

        createPaymentError({
            message: `Payment is not confirmed yet.\nAsk user to complete payment and retry.\nPayment ID: ${challengeId}`,
            code: 402,
            error: "payment_pending",
            paymentId: challengeId,
            retryInstructions: "Wait for confirmation, then retry this tool.",
            status,
        });
    }

    const getPaymentFieldsForV1 = (sig: any, challengeId:string) => {
        return {
            amount: sig.payload?.authorization?.value,
            network: sig.network,
            payTo: sig.payload?.authorization?.to,
        }
    }

    return wrapper as unknown as ToolHandler;
};
