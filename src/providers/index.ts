import { WalleotProvider } from "./walleot.js";
import { StripeProvider } from "./stripe.js";
import { PayPalProvider } from "./paypal.js";
import { SquareProvider } from "./square.js";
import type { BasePaymentProvider } from "./base.js";
import { type Logger } from "../types/logger.js";
import { AdyenProvider } from "./adyen.js";
import { CoinbaseProvider } from "./coinbase.js";
import { MockPaymentProvider } from "./mock.js";

export { WalleotProvider, StripeProvider, PayPalProvider, SquareProvider, AdyenProvider, CoinbaseProvider, MockPaymentProvider };
export type { BasePaymentProvider };

type ProviderCtor = new (opts: any) => BasePaymentProvider;
/** Registry of known providers. */
const PROVIDER_MAP: Record<string, ProviderCtor> = {
  stripe: StripeProvider,
  walleot: WalleotProvider,
  paypal: PayPalProvider,
  square: SquareProvider,
  adyen: AdyenProvider,
  coinbase: CoinbaseProvider,
  mock: MockPaymentProvider
};

function isProvider(x: unknown): x is BasePaymentProvider {
  return !!x && typeof (x as any).createPayment === "function" && typeof (x as any).getPaymentStatus === "function";
}

function keyFor(inst: any, fallback?: string): string {
  const name = (inst as any)?.slug ?? (inst as any)?.name ?? (inst as any)?.constructor?.name ?? fallback ?? "provider";
  return String(name).toLowerCase();
}

/** Allow advanced users/plugins to register additional provider classes at runtime. */
export function registerProvider(name: string, ctor: ProviderCtor): void {
  if (!name || typeof name !== "string") {
    throw new Error("[PayMCP] registerProvider: name must be a non-empty string");
  }
  PROVIDER_MAP[name.toLowerCase()] = ctor;
}

export type ProviderConfig = Record<
  string,
  BasePaymentProvider | { apiKey: string; successUrl?: string; cancelUrl?: string; merchantAccount?: string; sandbox?: boolean; logger?: Logger }
>;

export type ProviderInstances = Record<string, BasePaymentProvider>;

/**
 * Normalize providers into a map name -> instance.
 * Accepts either a mapping of names to options/instances, or an array of instances.
 */
export function buildProviders(
  configOrInstances: ProviderConfig | BasePaymentProvider[]
): ProviderInstances {
  const instances: ProviderInstances = {};

  // Case A: iterable of instances
  if (Array.isArray(configOrInstances)) {
    for (const inst of configOrInstances) {
      if (!isProvider(inst)) {
        throw new Error("[PayMCP] buildProviders: iterable contains a non-provider instance");
      }
      const key = keyFor(inst);
      instances[key] = inst;
    }
    return instances;
  }

  // Case B: mapping name -> options or instance
  for (const [name, value] of Object.entries(configOrInstances)) {
    if (isProvider(value)) {
      const key = name || keyFor(value);
      instances[key] = value;
      continue;
    }

    const ctor = PROVIDER_MAP[name.toLowerCase()];
    if (!ctor) {
      throw new Error(`[PayMCP] Unknown provider: ${name}`);
    }
    const obj = new ctor(value as any);
    if (!isProvider(obj)) {
      throw new Error(`[PayMCP] Constructed provider for '${name}' does not implement required methods`);
    }
    instances[name] = obj;
  }

  return instances;
}
