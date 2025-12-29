// RESUBMIT flow: first call creates payment and returns payment_url + payment_id; second call (with payment_id) executes the tool once payment is confirmed.

import type { PaidWrapperFactory, ToolHandler } from "../types/flows.js";
import { Logger } from "../types/logger.js";
import { ToolExtraLike } from "../types/config.js";
import { callOriginal } from "../utils/tool.js";



export class McpError extends Error {
    constructor(
        public readonly code: number,
        message: string,
        public readonly data?: unknown
    ) {
        super(`MCP error ${code}: ${message}`);
        this.name = 'McpError';
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


        let paymentSigB64 = extra.requestInfo?.headers?.['payment-signature'] ?? extra.requestInfo?.headers?.['x-payment'];

        if (!paymentSigB64 && extra?._meta?.["x402/payment"]) { //mcp clients may put payment in _meta/"x402/payment" - (https://github.com/coinbase/x402/blob/main/specs/transports-v2/mcp.md)
            paymentSigB64 = Buffer.from(JSON.stringify(extra._meta["x402/payment"]), "utf8").toString("base64");
        }

        const clientInfo = await getClientInfo(extra.sessionId as string);

        if (!paymentSigB64) {
            const { paymentId, paymentData } = await provider.createPayment(
                priceInfo.amount,
                priceInfo.currency,
                `${toolName}() execution fee`
            );
            let challengeId: string = "";
            if (paymentData?.x402Version === 1) {
                if (!clientInfo) throw ("Session ID is not found");
                challengeId = `${clientInfo.sessionId}-${toolName}`; //x402 v1 payment response doesn't return payment Requirements and can't set any extra data. So, the only way to save paymentData is to use session
            } else {
                challengeId = paymentData?.accepts?.[0]?.extra?.challengeId;
            }

            if (!challengeId) {
                throw new Error("Payment provider did not return challengeId in payment requirements");
            }
            // Store by challengeId so the follow-up request (PAYMENT-SIGNATURE) can be verified statelessly across instances
            await stateStore.set(String(challengeId), { paymentData });

            return {
                error: {
                    message: `Payment required`,
                    code: 402,
                    data: paymentData,
                }, isError: true
            }
        }

        const sig = JSON.parse(
            Buffer.from(paymentSigB64, "base64").toString("utf8")
        );



        const challengeId = sig.accepted?.extra?.challengeId ?? `${clientInfo.sessionId}-${toolName}`

        const normAddr = (a: any) => (typeof a === "string" ? a.toLowerCase() : "");

        const storedData = challengeId ? await stateStore.get(String(challengeId)) : null;
        if (!storedData?.args?.paymentData) {
            throw new Error("Unknown challenge ID");
        }

        const x402v = sig.x402Version;
        const networkStr = sig?.x402Version === 1 ? sig?.network : sig?.accepted?.network;
        const isSolana = typeof networkStr === "string" && networkStr.startsWith("solana");
        const payToAddress = sig?.x402Version === 1
            ? sig?.payload?.authorization?.to
            : (isSolana ? sig?.accepted?.payTo : sig?.payload?.authorization?.to);
        const expected = storedData.args.paymentData.accepts.find((pt:any)=> (pt.network === networkStr && normAddr(payToAddress) === normAddr(pt.payTo)));
        
        if (!expected) {
            log.debug("[PayMCP]",storedData.args.paymentData.accepts, networkStr, payToAddress)
            throw new Error("Cannot locate accepted payment mehtod");
        }
        const got = x402v === 1
            ? getPaymentFieldsForV1(sig, challengeId)
            : sig.accepted;
        if (!expected || !got) {
            throw new Error("Invalid payment data for signature verification");
        }

        const mismatch: string[] = [];
        if (String(expected.amount ?? expected.maxAmountRequired) !== String(got.amount)) mismatch.push("amount");
        if (String(expected.network) !== String(got.network)) mismatch.push("network");
        if (x402v !== 1 && normAddr(expected.asset) !== normAddr(got.asset)) mismatch.push("asset");
        if (normAddr(expected.payTo) !== normAddr(got.payTo)) mismatch.push("payTo");
        if (x402v !== 1 && String(expected.extra?.challengeId) !== String(got.extra?.challengeId)) mismatch.push("challengeId");

        if (mismatch.length) {
            log?.warn?.("[PayMCP] Incorrect signature", { mismatch, expected, got });
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

        throw (`Payment is not confirmed yet.\nAsk user to complete payment and retry.\nPayment ID: ${challengeId}`);
    }

    const getPaymentFieldsForV1 = (sig: any, challengeId: string) => {
        return {
            amount: sig.payload?.authorization?.value,
            network: sig.network,
            payTo: sig.payload?.authorization?.to,
        }
    }

    return wrapper as unknown as ToolHandler;
};
