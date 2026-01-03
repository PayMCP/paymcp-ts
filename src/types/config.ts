import { BasePaymentProvider} from "../providers/base.js";
import type { ProviderConfig } from "../providers/index.js";
import { Logger } from "./logger.js";
import { Mode, PaymentFlow } from "./payment.js";
import { StateStore } from "./state.js";

export interface PriceConfig {
    amount: number;
    currency: string; // ISO 4217 (USD, EUR, etc.)
}

export interface SubscriptionConfig {
    plan: string | string[] | undefined;
}

export interface PayToolConfig extends Record<string, any> {
    price?: PriceConfig;
    title?: string;
    description?: string;
    inputSchema?: unknown;
}

export interface PayMCPOptions {
    // Accept either a map of provider configs/instances or an array of provider instances.
    providers: ProviderConfig | BasePaymentProvider[];
    /**
        * @deprecated Use `mode` instead.
        * @see {@link Mode}
    */
    paymentFlow?: PaymentFlow;
    mode?: Mode,
    retrofitExisting?: boolean;
    stateStore?: StateStore;
    logger?: Logger
}

export interface ToolExtraLike {
    // Provided by Protocol to tool handlers. See Server.setRequestHandler in the TS SDK. citeturn5view0
    sendRequest?: (req: { method: string; params?: any }, resultSchema?: unknown) => Promise<any>;
    sendNotification?: (note: { method: string; params?: any }) => Promise<any>;
    sessionId?: string;
    requestId?: number | string;
    _meta?: Record<string,any>;
    signal?: AbortSignal;
    authInfo?: {
        token: string,
        userId?: string,
        email?: string
    };
    requestInfo?: {
        headers?: {
            "payment-signature"? : string
            "x-payment"? : string
        }
    }
    reportProgress?: (args: { progress?: number; total?: number; message?: string; }) => Promise<void> | void;
}

export interface ClientInfo {
    name: string;
    sessionId?:string;
    capabilities: Record<string,any>
}