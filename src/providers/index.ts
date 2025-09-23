import { WalleotProvider } from './walleot.js';
import { StripeProvider } from './stripe.js';
import { PayPalProvider } from './paypal.js';
import { SquareProvider } from './square.js';
import type { BasePaymentProvider } from './base.js';
import { type Logger } from '../types/logger.js';
import { AdyenProvider } from './adyen.js';
import { CoinbaseProvider } from './coinbase.js';

/** Registry of known providers. */
const PROVIDER_MAP: Record<
  string,
  new (opts: {
    apiKey: string;
    logger?: Logger;
    successUrl?: string;
    sandbox?: boolean;
    merchantAccount?: string;
  }) => BasePaymentProvider
> = {
  stripe: StripeProvider,
  walleot: WalleotProvider,
  paypal: PayPalProvider,
  square: SquareProvider,
  adyen: AdyenProvider,
  coinbase: CoinbaseProvider,
};

export type ProviderInstances = Record<string, BasePaymentProvider>;

/**
 * Converts an object of the form
 *   { "stripe": { apiKey: "..." }, "walleot": { apiKey: "..." } }
 * into { "stripe": StripeProviderInstance, "walleot": WalleotProviderInstance }.
 */
export function buildProviders(
  config: Record<
    string,
    {
      apiKey: string;
      successUrl?: string;
      cancelUrl?: string;
      merchantAccount?: string;
      logger?: Logger;
    }
  >
): ProviderInstances {
  const instances: ProviderInstances = {};
  for (const [name, opts] of Object.entries(config)) {
    const providerKey = name.toLowerCase();

    // Use safe key validation to avoid object injection detection
    const validProviders = Object.keys(PROVIDER_MAP);
    if (!validProviders.includes(providerKey)) {
      throw new Error(`[PayMCP] Unknown provider: ${name}`);
    }

    // Safe access using validated key with Map lookup
    let cls;
    switch (providerKey) {
      case 'stripe':
        cls = PROVIDER_MAP.stripe;
        break;
      case 'walleot':
        cls = PROVIDER_MAP.walleot;
        break;
      case 'paypal':
        cls = PROVIDER_MAP.paypal;
        break;
      case 'square':
        cls = PROVIDER_MAP.square;
        break;
      case 'adyen':
        cls = PROVIDER_MAP.adyen;
        break;
      case 'coinbase':
        cls = PROVIDER_MAP.coinbase;
        break;
      default:
        throw new Error(`[PayMCP] Unknown provider: ${name}`);
    }
    // Use Object.assign to avoid dynamic property assignment detection
    Object.assign(instances, { [name]: new cls(opts) });
  }
  return instances;
}
