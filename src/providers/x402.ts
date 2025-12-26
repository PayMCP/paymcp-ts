import { Logger } from "../types/logger.js";
import { type CreatePaymentResult } from "../types/payment.js";
import { generateCdpBearerJwt } from "../utils/crypto.js";
import { BasePaymentProvider } from "./base.js";
import { randomUUID } from "node:crypto";

const DEFAULT_USDC_MULTIPLIER = 1_000_000; // 6 decimals
const DEFAULT_ASSET = "USDC";
const DEFAULT_NETWORK = "eip155:8453";
const FACILITATOR_BASE = "https://api.cdp.coinbase.com/platform/v2/x402";

const assetsMap: Record<string, string> = {
    "eip155:8453:USDC": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // Base USDC
    "eip155:84532:USDC": "0x036CbD53842c5426634e7929541eC2318f3dCF7e" // Base Sepolia USDC
};

const v1_network_map: Record<string, string> = {
    "eip155:8453": "base",
    "eip155:84532": "base-sepolia",
    "base":"base",
    "base-sepolia": "base-sepolia"
}

const v2_network_map: Record<string, string> = {
    "eip155:8453": "eip155:8453",
    "eip155:84532": "eip155:84532",
    "base": "eip155:8453",
    "base-sepolia": "eip155:84532"
}

interface ResourceInfo {
    url: string;
    description: string;
    mimeType: string;
}

interface CreateAuthHeadersProps {
    host?: string;
    path?: string;
    method?: string
}

interface FacilitatorConfig {
    url?: string;
    apiKeyId?: string;
    apiKeySecret?: string;
    createAuthHeaders?: (opts?: CreateAuthHeadersProps) => Record<string, string> | undefined;
}

export interface X402ProviderOpts {
    payTo: string;
    asset?: string;
    multiplier?: number;
    logger?: Logger;
    network?: string;
    domainName?: string;
    domainVersion?: string;
    resourceInfo?: ResourceInfo;
    facilitator?: FacilitatorConfig;
    x402Version?: number;
}

export class X402Provider extends BasePaymentProvider {

    private payTo: string;
    private network = DEFAULT_NETWORK;
    private multiplier = DEFAULT_USDC_MULTIPLIER;
    private asset = assetsMap[`${DEFAULT_NETWORK}:${DEFAULT_ASSET}`];
    private domainName = DEFAULT_ASSET; // USDC
    private domainVersion = "2"; // Circle USDC uses version "2"
    private facilitator: FacilitatorConfig = {
        url: FACILITATOR_BASE,
    }
    private resourceInfo;
    private x402Version = 2;

    constructor(opts: X402ProviderOpts) {
        super("", opts.logger);
        this.payTo = opts.payTo;
        if (opts.multiplier) this.multiplier = opts.multiplier;

        // Network first (it affects which default asset address we should use)
        if (opts.network) this.network = opts.network;

        // Asset:
        // - If opts.asset is a symbol like "USDC", resolve via assetsMap for the chosen network.
        // - If opts.asset is already an address, keep it as-is.
        // - If opts.asset is not provided, pick the network-appropriate default (e.g. Base Sepolia USDC).
        if (opts.asset) {
            this.asset = assetsMap[`${this.network}:${opts.asset}`] ?? opts.asset;
        } else {
            this.asset = assetsMap[`${this.network}:${DEFAULT_ASSET}`];
        }
        if (opts.facilitator?.url) {
            this.facilitator.url = opts.facilitator?.url;
        }
        if (opts.facilitator?.createAuthHeaders) {
            this.facilitator.createAuthHeaders = opts.facilitator.createAuthHeaders;
        } else if (opts.facilitator?.apiKeyId && opts.facilitator?.apiKeySecret) {
            this.facilitator.apiKeyId = opts.facilitator.apiKeyId;
            this.facilitator.apiKeySecret = opts.facilitator?.apiKeySecret;
            this.facilitator.createAuthHeaders = this._createAuthHeadersForCDP;
        }
        if (opts.resourceInfo) {
            this.resourceInfo = opts.resourceInfo;
        }

        if (opts.x402Version) {
            this.x402Version = opts.x402Version;
        }

        if (opts.domainName) this.domainName = opts.domainName;
        if (opts.domainVersion) this.domainVersion = opts.domainVersion;
        this.logger.debug("[X402Provider] ready");
    }

    _createAuthHeadersForCDP = (opts?: CreateAuthHeadersProps) => {
        if (this.facilitator.apiKeyId && this.facilitator.apiKeySecret) {
            try {
                const token = generateCdpBearerJwt({
                    apiKeyId: this.facilitator.apiKeyId,
                    apiKeySecret: this.facilitator.apiKeySecret,
                    requestHost: opts?.host,
                    requestMethod: opts?.method,
                    requestPath: opts?.path,
                });
                return { Authorization: `Bearer ${token}` };
            } catch (err) {
                this.logger.error("[PayMCP] Can;'t generate CDP token. Proceeding without Authentication.", err);
            }
        }
        return undefined
    }

    async createPayment(
        amount: number,
        _currency: string, //ignored
        description: string
    ): Promise<CreatePaymentResult> {

        const challengeId = randomUUID();

        // x402 expects integer amounts in the token's smallest units (e.g. USDC has 6 decimals).
        // Keep it as a string to avoid floating-point issues.
        const amountStr = BigInt(Math.round(amount * this.multiplier)).toString();

        const paymentRequired = this.x402Version === 1
            ? this.getPaymentRequirementsV1(amountStr)
            : this.getPaymentRequirementsV2(challengeId, amountStr, description);

        this.logger.info?.("[PayMCP] Payment required",JSON.stringify(paymentRequired,null,4))

        this.logger.debug(`[X402Provider] createPayment ${challengeId}`);
        return {
            paymentId: challengeId,
            paymentUrl: "",
            paymentData: paymentRequired
        };
    }

    getPaymentRequirementsV1 = (amountStr: string) => {
        return {
            x402Version: 1,
            ...(this.resourceInfo ? { resourceInfo: this.resourceInfo } : {}),
            accepts: [
                {
                    scheme: "exact",
                    network: v1_network_map[this.network] ?? this.network,
                    asset: this.asset,
                    payTo: this.payTo,
                    maxTimeoutSeconds: 300,
                    maxAmountRequired: amountStr,
                    resource: this.resourceInfo?.url ?? "https://paymcp.info", //resource is required for V1
                    description: this.resourceInfo?.description ?? "Premium processing fee", //description is required for V1
                    mimeType: this.resourceInfo?.mimeType ?? "application/json",
                    extra: {
                        name: this.domainName,
                        version: this.domainVersion
                    },
                },
            ],
        };
    }

    getPaymentRequirementsV2=(challengeId: string,  amountStr: string, description: string)=>{
        return {
            "x402Version": this.x402Version,
            "error": "Payment required",
            ...this.resourceInfo ? {
                "resourceInfo": this.resourceInfo
            } : {},
            "accepts": [
                {
                    "scheme": "exact",
                    "x402Version": this.x402Version,
                    "network": v2_network_map[this.network] ?? this.network,
                    "amount": amountStr,
                    "asset": this.asset,
                    "payTo": this.payTo,
                    "maxTimeoutSeconds": 300,
                    "extra": {
                        "name": this.domainName,
                        "version": this.domainVersion,
                        "challengeId": challengeId,
                        "description": description
                    }
                }
            ]
        }
    }

    async getPaymentStatus(paymentSignatureB64: string): Promise<string> {
        const sig = JSON.parse(
            Buffer.from(paymentSignatureB64, "base64").toString("utf8")
        );

        if (!sig.payload.authorization.to || sig.payload.authorization.to !== this.payTo) {
            this.logger.warn?.(`[X402Provider] getPaymentStatus invalid payTo ${sig.payload.authorization.to}`);
            return 'error';
        }

        let headers: Record<string, string> = {
            "Content-Type": "application/json",
        };

        if (this.facilitator.createAuthHeaders) {
            const host = new URL(this.facilitator.url ?? FACILITATOR_BASE).host;
            const authHeaders = this.facilitator.createAuthHeaders({
                host,
                method: "POST",
                path: "/platform/v2/x402/verify",
            });
            if (authHeaders) headers = { ...headers, ...authHeaders };
        }

        const body = {
                x402Version: sig.x402Version,
                paymentPayload: sig,
                paymentRequirements: sig?.x402Version === 1 
                    ? this.getPaymentRequirementsV1(sig?.payload?.authorization?.value)?.accepts[0]
                    : this.getPaymentRequirementsV2(sig.accepted?.extra?.challengeId, sig?.payload?.authorization?.value, sig.accepted?.extra?.description)?.accepts[0] 
        };

        const verifyRes = await fetch(`${this.facilitator.url}/verify`, {
            method: "POST",
            headers,
            body: JSON.stringify(body)
        });
        if (!verifyRes.ok) {
            const errText = await verifyRes.text();
            this.logger.error(`[PayMCP] x402 verify failed: ${errText}`);
            return "error"
        }

        const verifyJson = await verifyRes.json();
        this.logger.debug("[PayMCP] verify result", verifyJson)

        if (!verifyJson.isValid) {
            this.logger.error(`[PayMCP] x402 verification failed: ${verifyJson.invalidReason}`);
            return "error"
        }

        if (this.facilitator.createAuthHeaders) {
            const host = new URL(this.facilitator.url ?? FACILITATOR_BASE).host;
            const authHeaders = this.facilitator.createAuthHeaders({
                host,
                method: "POST",
                path: "/platform/v2/x402/settle",
            });
            if (authHeaders) headers = { ...headers, ...authHeaders };
        }
        const settleRes = await fetch(`${this.facilitator.url}/settle`, {
            method: "POST",
            headers,
            body: JSON.stringify(body)
        });

        if (!settleRes.ok) {
            const errText = await settleRes.text();
            this.logger.error(`[PayMCP] x402 settle failed: ${errText}`);
            return "error"
        }
        const settleJson = await settleRes.json();
        this.logger.debug("[PayMCP] settle result", settleJson)

        if (!settleJson.success) {
            this.logger.error(`[PayMCP] x402 settle failed: ${settleJson.errorReason}`);
            return "error"
        }

        return "paid";

    }

}