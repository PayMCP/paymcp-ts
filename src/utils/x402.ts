import { ProviderInstances } from "../providers/index.js"
import { ClientInfo } from "../types/config.js";
import { Logger } from "../types/logger.js";
import { StateStore } from "../types/state.js";
import { Mode } from "../types/payment.js";

export const buildX402middleware = (providers: ProviderInstances, stateStore: StateStore, paidtools: Record<string, { amount: number, currency: string, description?: string }>, mode:Mode, getClientInfo: (sessionId:string)=> Promise<ClientInfo>, logger:Logger) => {
    return async (req: any, res: any, next: any) => {
        const rpcMethod = (req.body as any)?.method;
        if (rpcMethod === 'tools/call') {
            const providername = Object.keys(providers).find(p=>p==='x402');
            const sessionId = req.headers['mcp-session-id'] as string;
            const clientInfo = await getClientInfo(sessionId);
            if (providername === 'x402' && (mode===Mode.X402 || (mode===Mode.AUTO && clientInfo.capabilities.x402))) {
                const provider = providers[providername];
                const toolName = (req.body as any)?.params?.name ?? 'unknown';
                const priceInfo = paidtools[toolName];
                if (priceInfo) {
                    const paymentSig = (req.headers['payment-signature'.toLowerCase()] ?? req.headers['PAYMENT-SIGNATURE'.toLowerCase()] ?? req.headers['X-PAYMENT'.toLowerCase()]) as string | undefined;
                    if (!paymentSig) {
                        const { paymentId, paymentData } = await provider.createPayment(priceInfo.amount, priceInfo.currency, priceInfo.description ?? "");
                        const x402version=paymentData.x402Version;
                        if (x402version===1) { //x402 v1 payment response doesn't return payment Requirements and can't set any extra data. So, the only way to save paymentData is to use session
                            if (!clientInfo.sessionId) {
                                return res.status(400).send("Error: No session id provided by MCP client");
                            }
                            await stateStore.set(`${clientInfo.sessionId}-${toolName}`, { paymentData }); 
                        } else {
                            await stateStore.set(String(paymentId), { paymentData }); 
                        }
                        const paymentRequiredHeader = Buffer.from(JSON.stringify(paymentData)).toString("base64");
                        res.status(402);
                        res.setHeader('PAYMENT-REQUIRED', paymentRequiredHeader);
                        res.setHeader('Content-Type', 'application/json');
                        // Helpful for browsers/devtools; safe to keep.
                        //res.setHeader('Access-Control-Expose-Headers', 'PAYMENT-REQUIRED, Mcp-Session-Id');
                        logger.info?.("[PayMCP] sending x402 error")
                        return res.json(paymentData);
                    }
                }
            } else {
                logger.warn?.("X402 middleware ignored for non-x402 provider");
            }
        }
        next();
    }
}