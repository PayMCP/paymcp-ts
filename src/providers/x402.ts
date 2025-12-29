import { Logger } from "../types/logger.js";
import { type CreatePaymentResult } from "../types/payment.js";
import { generateCdpBearerJwt } from "../utils/crypto.js";
import { BasePaymentProvider } from "./base.js";
import { randomUUID } from "node:crypto";

const DEFAULT_USDC_MULTIPLIER = 1_000_000; // 6 decimals
const DEFAULT_ASSET = "USDC";
const DEFAULT_NETWORK = "eip155:8453";
const DEFAULT_DOMAIN_NAME = "USD Coin";
const DEFAULT_DOMAIN_VERSION = "2"; // Circle USDC uses version "2"
const FACILITATOR_BASE = "https://api.cdp.coinbase.com/platform/v2/x402";

const assetsMap: Record<string, string> = {
    "eip155:8453:USDC": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // Base USDC
    "eip155:84532:USDC": "0x036CbD53842c5426634e7929541eC2318f3dCF7e" // Base Sepolia USDC
};

const v1_network_map: Record<string, string> = {
    "eip155:8453": "base",
    "eip155:84532": "base-sepolia",
    "base": "base",
    "base-sepolia": "base-sepolia",
    "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1": "solana-devnet",
    "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": "solana-mainnet",
    "solana-devnet": "solana-devnet",
    "solana-mainnet": "solana-mainnet"
}

const v2_network_map: Record<string, string> = {
    "eip155:8453": "eip155:8453",
    "eip155:84532": "eip155:84532",
    "base": "eip155:8453",
    "base-sepolia": "eip155:84532",
    "solana-devnet": "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    "solana-mainnet": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1": "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"
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

interface PayTo {
    address: string;
    network?: string;
    asset?: string;
    multiplier?: number;
    domainName?: string;
    domainVersion?: string;
    gasLimit?: string;
}

export interface X402ProviderOpts {
    payTo: PayTo[];
    logger?: Logger;
    resourceInfo?: ResourceInfo;
    facilitator?: FacilitatorConfig;
    x402Version?: number;
    gasLimit?: string;
}

export class X402Provider extends BasePaymentProvider {

    private payTo: PayTo[];
    private facilitator: FacilitatorConfig = {
        url: FACILITATOR_BASE,
    }
    private resourceInfo;
    private x402Version = 2;
    private feePayer:string | undefined;

    constructor(opts: X402ProviderOpts) {
        super("", opts.logger);
        this.payTo = opts.payTo.map((p) => {
            const network = p.network ?? DEFAULT_NETWORK;

            const norm: PayTo = {
                address: p.address,
                network,
                asset: (p.asset ? assetsMap[`${network}:${p.asset}`] : assetsMap[`${network}:${DEFAULT_ASSET}`]) ?? p.asset ,
                multiplier: p.multiplier ?? DEFAULT_USDC_MULTIPLIER,
                domainName: p.domainName ?? DEFAULT_DOMAIN_NAME,
                domainVersion: p.domainVersion ?? DEFAULT_DOMAIN_VERSION
            }
            if (network === "eip155:84532" && norm.domainName === 'USD Coin') norm.domainName = 'USDC';//base Sepolia need USDC
            return norm;
        });
        
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

        const feePayerRequired=this.payTo.filter(p=>p.network?.startsWith("solana"));
        if (feePayerRequired.length) this._updateFacilitatorFeePayer(feePayerRequired[0].network as string);


        this.logger.debug("[X402Provider] ready");
    }

    _updateFacilitatorFeePayer = async (network: string) => {
        let headers: Record<string, string> = {
            "Content-Type": "application/json",
        };

        if (this.facilitator.createAuthHeaders) {
            const host = new URL(this.facilitator.url ?? FACILITATOR_BASE).host;
            const authHeaders = this.facilitator.createAuthHeaders({
                host,
                method: "GET",
                path: "/platform/v2/x402/supported",
            });
            if (authHeaders) headers = { ...headers, ...authHeaders };
        }

        const supportedRes = await fetch(`${this.facilitator.url}/supported`, {
            method: "GET",
            headers
        });
        if (!supportedRes.ok) {
            const errText = await supportedRes.text();
            this.logger.error(`[PayMCP] x402 get facilitator feePayer failed for: ${errText}`);
            return;
        }

        const supportedJson = await supportedRes.json();

        const _network =
            this.x402Version === 1
                ? v1_network_map[network] ?? network
                : v2_network_map[network] ?? network;

        const kind = supportedJson.kinds?.find((k: any) =>
            k.scheme === "exact" &&
            k.x402Version === this.x402Version &&
            k.network === _network &&
            k.extra?.feePayer
        );

        this.feePayer = kind.extra.feePayer;
        this.logger.debug("[PayMCP] FeePayer for Solana", this.feePayer);
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

        const paymentRequired = this.x402Version === 1
            ? this.getPaymentRequirementsV1(amount)
            : this.getPaymentRequirementsV2(challengeId, amount, description);


        this.logger.debug(`[X402Provider] createPayment ${challengeId}`);
        return {
            paymentId: challengeId,
            paymentUrl: "",
            paymentData: paymentRequired
        };
    }

    getPaymentRequirementsV1 = (amount: number) => {
        return {
            x402Version: 1,
            ...(this.resourceInfo ? { resourceInfo: this.resourceInfo } : {}),
            accepts: this.payTo.map((p) => {
                // x402 expects integer amounts in the token's smallest units (e.g. USDC has 6 decimals).
                // Keep it as a string to avoid floating-point issues.
                const amountStr = toBaseUnits(amount,p.multiplier as number);
                return {
                    scheme: "exact",
                    network: v1_network_map[p.network as string] ?? p.network,
                    asset: p.asset,
                    payTo: p.address,
                    maxTimeoutSeconds: 900,
                    maxAmountRequired: amountStr,
                    resource: this.resourceInfo?.url ?? "https://paymcp.info", //resource is required for V1
                    description: this.resourceInfo?.description ?? "Premium processing fee", //description is required for V1
                    mimeType: this.resourceInfo?.mimeType ?? "application/json",
                    extra: {
                        name: p.domainName,
                        version: p.domainVersion,
                        ...this.feePayer ? {
                            feePayer: this.feePayer
                        } : {},
                        ...p.gasLimit ? {
                            gasLimit: p.gasLimit
                        } : {}
                    },
                }
            })
        };
    }

    getPaymentRequirementsV2 = (challengeId: string, amount: number, description: string) => {
        return {
            "x402Version": this.x402Version,
            "error": "Payment required",
            ...this.resourceInfo ? {
                "resourceInfo": this.resourceInfo
            } : {},
            accepts: this.payTo.map((p) => {
                // x402 expects integer amounts in the token's smallest units (e.g. USDC has 6 decimals).
                // Keep it as a string to avoid floating-point issues.
                const amountStr = toBaseUnits(amount,p.multiplier as number);
                return {
                    "scheme": "exact",
                    "x402Version": this.x402Version,
                    "network": v2_network_map[p.network as string] ?? p.network,
                    "amount": amountStr,
                    "asset": p.asset,
                    "payTo": p.address,
                    "maxTimeoutSeconds": 900,
                    "extra": {
                        "name": p.domainName,
                        "version": p.domainVersion,
                        "challengeId": challengeId,
                        "description": description,
                        ...this.feePayer ? {
                            feePayer: this.feePayer
                        } : {},
                        ...p.gasLimit ? {
                            gasLimit: p.gasLimit
                        } : {}
                    }
                }
            })
        }
    }

    async getPaymentStatus(paymentSignatureB64: string): Promise<string> {
        const sig = JSON.parse(
            Buffer.from(paymentSignatureB64, "base64").toString("utf8")
        );

        const amountStr =
            sig?.accepted?.amount ??
            sig?.payload?.authorization?.value ??
            sig?.payload?.authorization?.amount;

        if (!amountStr) {
            this.logger.error(`[PayMCP] Missing amount in payment signature payload`);
            return "error";
        }

        const networkStr = sig?.x402Version === 1 ? sig?.network : sig?.accepted?.network;
        const isSolana = typeof networkStr === "string" && networkStr.startsWith("solana");

        const payToAddress = sig?.x402Version === 1
            ? sig?.payload?.authorization?.to
            : (isSolana ? sig?.accepted?.payTo : sig?.payload?.authorization?.to);

        const choosenPayTo = this.payTo.find(pt => (networkStr === (sig?.x402Version===1 ? v1_network_map[pt.network as string] : v2_network_map[pt.network as string]) && payToAddress === pt.address));

        if (!choosenPayTo) {
            this.logger.warn?.(`[X402Provider] getPaymentStatus invalid payTo`);
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


        const paymentRequirementsAll = sig?.x402Version === 1
            ? this.getPaymentRequirementsV1(0)?.accepts
            : this.getPaymentRequirementsV2(
                sig.accepted?.extra?.challengeId,
                0,
                sig.accepted?.extra?.description
            )?.accepts;
        
        const paymentRequirements=paymentRequirementsAll.find((pt)=>(networkStr === (sig?.x402Version===1 ? v1_network_map[pt.network as string] : v2_network_map[pt.network as string])));
        if (!paymentRequirements) {
            this.logger.warn?.(`[PayMCP X402Provider] error locating requirements`);
            return 'error';
        }
        if (sig?.x402Version === 1)
            (paymentRequirements as any).maxAmountRequired=amountStr; //show  str amount
        else 
            (paymentRequirements as any).amount=amountStr; //show  str amount

        const body = {
            x402Version: sig.x402Version,
            paymentPayload: sig,
            paymentRequirements
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
            if (settleJson.errorReason === 'failed_to_execute_transfer') this.logger.warn?.(`[PayMCP] Make sure purchaser has enough gas to sign the transaction`);
            return "error"
        }

        return "paid";

    }

}


function toBaseUnits(
    amount: number,
    multiplier: number
): string {
    return BigInt(Math.round(amount * multiplier)).toString()
}