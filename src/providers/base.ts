import { Logger } from '../types/logger.js';
import { type CreatePaymentResult } from '../types/payment.js';

export abstract class BasePaymentProvider {
  protected apiKey: string;
  protected logger: Logger;

  constructor(apiKey: string, logger?: Logger) {
    this.apiKey = apiKey;
    this.logger = logger ?? console;
  }

  /** Get provider name for session management */
  abstract getName(): string;

  /** Default headers (can be overridden). */
  protected buildHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    };
  }

  /**
   * Basic HTTP helper using fetch().
   * Can be replaced with axios if desired.
   */
  protected async request<T = unknown>(method: string, url: string, data?: unknown): Promise<T> {
    const headers = this.buildHeaders();
    const init: RequestInit = { method: method.toUpperCase(), headers };

    if (method.toUpperCase() === 'GET') {
      // Simple implementation: query string
      if (data && typeof data === 'object' && data !== null) {
        const dataRecord = data as Record<string, string>;
        if (Object.keys(dataRecord).length) {
          const qs = new URLSearchParams(dataRecord).toString();
          url += (url.includes('?') ? '&' : '?') + qs;
        }
      }
    } else {
      if (headers['Content-Type'] === 'application/json') {
        init.body = JSON.stringify(data ?? {});
      } else {
        const dataObj =
          data && typeof data === 'object' && data !== null
            ? (data as Record<string, unknown>)
            : {};
        init.body = new URLSearchParams(
          Object.fromEntries(Object.entries(dataObj).map(([k, v]) => [k, String(v)]))
        );
      }
    }

    let resp: Response;
    try {
      resp = await fetch(url, init);
    } catch (err) {
      this.logger.error(`[BasePaymentProvider] Network error ${method} ${url}`, err);
      throw err;
    }

    if (!resp.ok) {
      const body = await resp.text();
      this.logger.error(`[BasePaymentProvider] HTTP ${resp.status} ${method} ${url}: ${body}`);
      throw new Error(`HTTP ${resp.status} ${url}`);
    }

    const json = (await resp.json()) as T;
    this.logger.debug(`[BasePaymentProvider] HTTP ${method} ${url} ->`, resp.status, json);
    return json;
  }

  /** Create payment. Return (id, url). */
  abstract createPayment(
    amount: number,
    currency: string,
    description: string
  ): Promise<CreatePaymentResult>;

  /** Check status. */
  abstract getPaymentStatus(paymentId: string): Promise<string>;
}
