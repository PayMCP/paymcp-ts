import { ProviderInstances } from "../providers/index.js"
import { Logger } from "../types/logger.js";
import { StateStore } from "../types/state.js";

export const buildX402middleware = (providers: ProviderInstances, stateStore: StateStore, paidtools: Record<string, { amount: number, currency: string, description?: string }>, logger:Logger) => {
    return async (req: any, res: any, next: any) => {
        const rpcMethod = (req.body as any)?.method;
        if (rpcMethod === 'tools/call') {
            const provider = Object.values(providers)[0];
            const providername = Object.keys(providers)[0];
            if (providername === 'x402') {
                const toolName = (req.body as any)?.params?.name ?? 'unknown';
                const priceInfo = paidtools[toolName];
                if (priceInfo) {
                    const paymentSig = (req.headers['payment-signature'] ?? req.headers['payment-signature'.toLowerCase()] ?? req.headers['PAYMENT-SIGNATURE'.toLowerCase()]) as string | undefined;
                    if (!paymentSig) {
                        const { paymentId, paymentData } = await provider.createPayment(priceInfo.amount, priceInfo.currency, priceInfo.description ?? "")
                        await stateStore.set(String(paymentId), { paymentData }); 
                        const paymentRequiredHeader = Buffer.from(JSON.stringify(paymentData)).toString("base64");
                        res.status(402);
                        res.setHeader('PAYMENT-REQUIRED', paymentRequiredHeader);
                        res.setHeader('Content-Type', 'application/json');
                        // Helpful for browsers/devtools; safe to keep.
                        //res.setHeader('Access-Control-Expose-Headers', 'PAYMENT-REQUIRED, Mcp-Session-Id');
                        logger.info?.("[PayMCP] sending x402 error")
                        return res.json({
                            jsonrpc: '2.0',
                            id: paymentId,
                            error: { code: 402, message: 'Payment required' },
                            hint: 'x402 clients should read PAYMENT-REQUIRED header and retry with PAYMENT-SIGNATURE',
                        });
                    }
                }
            } else {
                logger.warn?.("X402 middleware ignored for non-x402 provider");
            }
        }
        next();
    }
}