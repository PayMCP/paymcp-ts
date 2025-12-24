import { Logger } from "../types/logger.js";
import { type CreatePaymentResult } from "../types/payment.js";
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

interface ResourceInfo {
  url: string;
  description: string;
  mimeType: string;
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
    facilitator?: {
        url?: string;
        apiKey?: string | undefined;
    }
}

export class X402Provider extends BasePaymentProvider {

    private payTo: string;
    private network = DEFAULT_NETWORK;
    private multiplier = DEFAULT_USDC_MULTIPLIER;
    private asset = assetsMap[`${DEFAULT_NETWORK}:${DEFAULT_ASSET}`];
    private domainName = DEFAULT_ASSET; // USDC
    private domainVersion = "2"; // Circle USDC uses version "2"
    private facilitator = {
        url: FACILITATOR_BASE,
        apiKey: ""
    }
    private resourceInfo;

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
        if (opts.facilitator?.apiKey) {
            this.facilitator.apiKey = opts.facilitator.apiKey;
        }
        if (opts.resourceInfo) {
            this.resourceInfo = opts.resourceInfo;
        }

        if (opts.domainName) this.domainName = opts.domainName;
        if (opts.domainVersion) this.domainVersion = opts.domainVersion;
        this.logger.debug("[X402Provider] ready");
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

        const paymentRequired = {
            "x402Version": 2,
            "error": "Payment required",
            ...this.resourceInfo ? {
                "resourceInfo": this.resourceInfo
            }:{},
            "accepts": [
                {
                    "scheme": "exact",
                    "network": this.network,
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

        this.logger.debug(`[X402Provider] createPayment ${challengeId}`);
        return {
            paymentId: challengeId,
            paymentUrl: "",
            paymentData: paymentRequired
        };
    }

    async getPaymentStatus(paymentSignatureB64: string): Promise<string> {
        const sig = JSON.parse(
            Buffer.from(paymentSignatureB64, "base64").toString("utf8")
        );

        if (!sig.payload.authorization.to || sig.payload.authorization.to !== this.payTo) {
            this.logger.warn?.(`[X402Provider] getPaymentStatus invalid payTo ${sig.payload.authorization.to}`);
            return 'error';
        }

        const headers: Record<string, string> = {
            "Content-Type": "application/json",
        };

        if (this.facilitator.apiKey) {
            headers["Authorization"] = `Bearer ${this.facilitator.apiKey}`;
        }

        const body={
                x402Version: sig.x402Version,
                paymentPayload: sig,
                paymentRequirements: {
                    "x402Version": 2,
                    "scheme": "exact",
                    "network": this.network,
                    "error": "Payment required",
                    "accepts": [sig.accepted],
                    "extra": sig.accepted?.extra,
                    "asset":this.asset,
                    "payTo": this.payTo,
                    "amount": sig.accepted.amount
                }
            }

        const verifyRes = await fetch(`${this.facilitator.url}/verify`, {
            method: "POST",
            headers,
            body: JSON.stringify(body)
        });
        if (!verifyRes.ok) {
            const errText=await verifyRes.text();
            this.logger.error(`[PayMCP] x402 verify failed: ${errText}`);
            return "error"
        }

        const settleRes = await fetch(`${this.facilitator.url}/settle`, {
            method: "POST",
            headers,
            body: JSON.stringify(body)
        });

        if (!settleRes.ok) {
            const errText=await settleRes.text();
            this.logger.error(`[PayMCP] x402 settle failed: ${errText}`);
            return "error"
        }
        const settleJson = await settleRes.json();
        this.logger.log("[PayMCP] settle result",settleJson)

        if (!settleJson.success) {
            this.logger.error(`[PayMCP] x402 settle failed: ${settleJson.errorReason}`);
            return "error"
        }

        return "paid";

    }

}