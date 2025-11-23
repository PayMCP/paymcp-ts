import { type Logger } from "../types/logger.js";
import { type CreatePaymentResult } from "../types/payment.js";
import {
  BasePaymentProvider,
} from "./base.js";

const BASE_URL = "https://api.stripe.com/v1";

export interface StripeSubscriptionPlan {
  /**
   * Logical plan identifier for this subscription plan.
   * For Stripe, this is based on the underlying product.id when available,
   * otherwise it falls back to the Stripe price.id.
   */
  planId: string;
  title: string;
  description?: string | null;
  currency: string;
  /**
   * Price in major currency units (e.g. dollars), not Stripe cents.
   */
  price: number | null;
  interval?: string | null; // month, year, etc.
}

export interface StripeUserSubscription {
  id: string; // subscription id
  status: string;
  /**
   * Logical plan identifier for this subscription.
   * For Stripe, this corresponds to the underlying product.id or price.id.
   */
  planId: string;
  currency: string;
  /**
   * Price in major currency units (e.g. dollars) for the primary subscription item,
   * if available.
   */
  price: number | null;
  interval?: string | null;
  /**
   * Convenience ISO date string for when the subscription was created.
   */
  createdAt: string | null;
  /**
   * True if the subscription is set to cancel at the end of the current period.
   */
  cancelAtPeriodEnd: boolean;
  /**
   * ISO date string for when the subscription is scheduled to be cancelled
   * (derived from Stripe's cancel_at when available).
   */
  cancelAtDate: string | null;
  /**
   * ISO date string for when the subscription actually ended (derived from ended_at when available).
   */
  endedAtDate: string | null;
}

/**
 * Stripe Checkout provider.
 *
 * Creates a Checkout Session (mode=payment) with inline price_data and returns (id, url)
 */
export interface StripeProviderOpts {
  apiKey: string;
  successUrl?: string;
  cancelUrl?: string;
  logger?: Logger;
}

export class StripeProvider extends BasePaymentProvider {
  private successUrl: string;
  private cancelUrl: string;

  constructor(opts: StripeProviderOpts) {
    super(opts.apiKey, opts.logger);
    this.successUrl =
      opts.successUrl ??
      "https://yoururl.com/success?session_id={CHECKOUT_SESSION_ID}";
    this.cancelUrl = opts.cancelUrl ?? "https://yoururl.com/cancel";
    this.logger.debug("[StripeProvider] ready");
  }

  /**
   * Stripe expects a form-encoded body (we inherit from BasePaymentProvider with
   * application/x-www-form-urlencoded standard). 
   */
  protected override buildHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    };
  }

  /**
   * Create Checkout Session.
   *
   * Important parameters:
   * - mode=payment (one-time) or other depending on scenario; here it's payment.  [oai_citation:11‡Stripe Docs](https://docs.stripe.com/api/checkout/sessions/create) [oai_citation:12‡Stripe Docs](https://docs.stripe.com/payments/checkout/how-checkout-works)
   * - success_url, cancel_url (mandatory redirects).  [oai_citation:13‡Stripe Docs](https://docs.stripe.com/api/checkout/sessions/create) [oai_citation:14‡Stripe Docs](https://docs.stripe.com/payments/checkout/how-checkout-works)
   * - line_items[0][price_data][currency], [unit_amount], [product_data][name] — inline price.  [oai_citation:15‡Stripe Docs](https://docs.stripe.com/payments/checkout/migrating-prices) [oai_citation:16‡Stripe Docs](https://docs.stripe.com/api/checkout/sessions/create)
   */
  async createPayment(
    amount: number,
    currency: string,
    description: string
  ): Promise<CreatePaymentResult> {
    const cents = this.toStripeAmount(amount, currency);
    this.logger.debug(
      `[StripeProvider] createPayment ${amount} ${currency} (${cents}) "${description}"`
    );

    const data: Record<string, string | number> = {
      mode: "payment",
      success_url: this.successUrl,
      cancel_url: this.cancelUrl,
      "line_items[0][price_data][currency]": currency.toLowerCase(),
      "line_items[0][price_data][unit_amount]": cents,
      "line_items[0][price_data][product_data][name]": description,
      "line_items[0][quantity]": 1,
    };

    const session = await this.request<any>(
      "POST",
      `${BASE_URL}/checkout/sessions`,
      data
    );

    if (!session?.id || !session?.url) {
      throw new Error(
        "[StripeProvider] Invalid response from /checkout/sessions (missing id/url)"
      );
    }
    return { paymentId: session.id, paymentUrl: session.url };
  }

  /**
   * Get payment status by session.id.
   * Stripe returns a Session object with a 'payment_status' field (e.g., 'paid', 'unpaid').  [oai_citation:17‡Stripe Docs](https://docs.stripe.com/api/checkout/sessions/retrieve) [oai_citation:18‡Stripe Docs](https://docs.stripe.com/payments/checkout/how-checkout-works)
   */
  async getPaymentStatus(paymentId: string): Promise<string> {
    this.logger.debug(`[StripeProvider] getPaymentStatus ${paymentId}`);
    const session = await this.request<any>(
      "GET",
      `${BASE_URL}/checkout/sessions/${paymentId}`
    );
    // Return as is; mapping to unified status can be done later.
    return String(session?.payment_status ?? "unknown");
  }


  /**
   * Get subscriptions:
   * - current subscriptions for a given userId (by searching subscription metadata.userId)
   * - available subscription plans (active recurring prices).
   *
   * NOTE: This uses Stripe's subscriptions search API:
   *   GET /v1/subscriptions/search?query=metadata['userId']:'...'
   * and prices API:
   *   GET /v1/prices?active=true&expand[]=data.product
   */
  async getSubscriptions(
    userId: string,
    email?: string
  ): Promise<{
    current_subscriptions: StripeUserSubscription[];
    available_subscriptions: StripeSubscriptionPlan[];
  }> {
    this.logger.debug(`[StripeProvider] getSubscriptions for userId=${userId}`);

    const [available, current] = await Promise.all([
      this.listAvailableSubscriptionPlans(),
      this.listUserSubscriptions(userId, email),
    ]);

    return {
      current_subscriptions: current,
      available_subscriptions: available,
    };
  }

  /**
   * Start a subscription for a given user and plan.
   *
   * Instead of creating the Subscription directly (which requires a default payment
   * method on the customer), we create a Checkout Session in mode=subscription and
   * return its URL so the user can complete the flow in the browser.
   *
   * We:
   *  - find or create a Stripe Customer for this user (by userId/email)
   *  - create a Checkout Session with mode=subscription and line_items[0].price = planId
   *  - set subscription_data[metadata][userId] so that the resulting Subscription
   *    is linked back to our userId
   */
  async startSubscription(
    planId: string,
    userId: string,
    email?: string,
  ): Promise<{ message: string; checkoutUrl: string; sessionId: string; planId: string }> {
    this.logger.debug(
      `[StripeProvider] startSubscription planId=${planId} userId=${userId} email=${email ?? "n/a"}`,
    );

    // First, check if there is an existing subscription for this plan that is
    // currently active/trialing but marked to cancel at the end of the period.
    // In that case, we simply resume it instead of creating a new subscription.
    const existing = await this.listUserSubscriptions(userId, email);

    const resumable = existing.find((sub) => {
      const status = sub.status.toLowerCase();
      return (
        sub.planId === planId &&
        sub.cancelAtPeriodEnd &&
        (status === "active" || status === "trialing")
      );
    });

    if (resumable) {
      this.logger.debug(
        `[StripeProvider] Resuming existing subscription ${resumable.id} for userId=${userId} planId=${planId}`,
      );

      await this.request<any>(
        "POST",
        `${BASE_URL}/subscriptions/${resumable.id}`,
        {
          cancel_at_period_end: "false",
        },
      );

      return {
        message:
          "Existing subscription was scheduled to be canceled at period end and has been reactivated. Billing will continue as normal.",
        planId,
        sessionId: "",
        checkoutUrl: "",
      };
    }

    // Otherwise, create a new Checkout Session for a fresh subscription.
    const customerId = await this.findOrCreateCustomer(userId, email);

    const data: Record<string, string> = {
      mode: "subscription",
      success_url: this.successUrl,
      cancel_url: this.cancelUrl,
      customer: customerId,
      "line_items[0][price]": planId,
      "line_items[0][quantity]": "1",
      // Ensure the resulting subscription carries our userId in metadata
      "subscription_data[metadata][userId]": userId,
    };

    const session = await this.request<any>(
      "POST",
      `${BASE_URL}/checkout/sessions`,
      data,
    );

    if (!session?.id || !session?.url) {
      throw new Error(
        "[StripeProvider] Invalid response from /checkout/sessions (missing id/url)",
      );
    }

    return {
      message:
        "Subscription checkout session created. Please follow the link to set up your subscription, complete the payment flow, and then confirm when you are done.",
      // Echo the requested planId back to the caller; Stripe does not return planId on the session.
      planId,
      sessionId: String(session.id),
      checkoutUrl: String(session.url),
    };
  }

  /**
   * Cancel a subscription for a given user.
   *
   * We:
   *  - fetch the subscription
   *  - verify that subscription.metadata.userId matches the provided userId
   *  - update the subscription with cancel_at_period_end=true so that it remains
   *    active until the end of the current billing period
   *  - return information about when access will actually end
   */
  async cancelSubscription(
    subscriptionId: string,
    userId: string,
  ): Promise<{ message: string; canceled: boolean; currentPeriodEnd: number | null; endDate: string | null }> {
    this.logger.debug(
      `[StripeProvider] cancelSubscription subscriptionId=${subscriptionId} userId=${userId}`,
    );

    // Fetch the subscription first to validate ownership
    const sub = await this.request<any>(
      "GET",
      `${BASE_URL}/subscriptions/${subscriptionId}`,
    );

    const metaUserId = sub?.metadata?.userId ?? sub?.metadata?.user_id;
    if (metaUserId && metaUserId !== userId) {
      throw new Error(
        `[StripeProvider] cannot cancel subscription ${subscriptionId}: metadata.userId=${metaUserId} does not match userId=${userId}`,
      );
    }

    // Schedule cancellation at the end of the current period instead of immediate cancel.
    const updated = await this.request<any>(
      "POST",
      `${BASE_URL}/subscriptions/${subscriptionId}`,
      {
        cancel_at_period_end: "true",
      },
    );

    const currentPeriodEnd =
      typeof updated.current_period_end === "number"
        ? updated.current_period_end
        : typeof sub.current_period_end === "number"
          ? sub.current_period_end
          : null;

    const endDate =
      currentPeriodEnd != null
        ? new Date(currentPeriodEnd * 1000).toISOString()
        : null;

    this.logger.debug(
      `[StripeProvider] subscription ${subscriptionId} cancellation scheduled; currentPeriodEnd=${currentPeriodEnd}, endDate=${endDate}`,
    );

    return {
      message: `subscription ${subscriptionId} cancellation scheduled; currentPeriodEnd=${currentPeriodEnd}, endDate=${endDate}`,
      canceled: true,
      currentPeriodEnd,
      endDate,
    };
  }



  /**
   * List available subscription plans (active recurring prices).
   */
  private async listAvailableSubscriptionPlans(): Promise<StripeSubscriptionPlan[]> {
    this.logger.debug("[StripeProvider] listAvailableSubscriptionPlans");

    const params = new URLSearchParams({
      active: "true",
      limit: "100",
      "expand[]": "data.product",
    });

    const res = await this.request<any>(
      "GET",
      `${BASE_URL}/prices?${params.toString()}`,
    );

    const data = Array.isArray(res?.data) ? res.data : [];

    return data
      .filter((price: any) => price.recurring && price.active && price.product?.active)
      .map((price: any) => {
        const product = price.product ?? {};
        const planId = String(price.id);
        const rawAmount = price.unit_amount;
        const majorAmount =
          typeof rawAmount === "number" ? rawAmount / 100 : null;

        return {
          planId,
          title: String(product.name ?? ""),
          description: product.description ?? null,
          currency: String(price.currency),
          // Price in major currency units (e.g. dollars)
          price: majorAmount,
          interval: price.recurring?.interval ?? null,
        } as StripeSubscriptionPlan;
      });
  }

  /**
   * List subscriptions for a user by their Stripe customer.
   *
   * We:
   *  - resolve (or create) a Customer for the given userId via findOrCreateCustomer
   *  - list subscriptions with /v1/subscriptions?customer=cus_xxx&status=all
   *  - expand data.items.data.price to map plan details
   */
  private async listUserSubscriptions(
    userId: string,
    email?: string
  ): Promise<StripeUserSubscription[]> {
    this.logger.debug(
      `[StripeProvider] listUserSubscriptions userId=${userId} (${email})`,
    );

    // Resolve the Stripe customer for this userId (reusing existing if present).
    const customerId = await this.findOrCreateCustomer(userId, email);

    const params = new URLSearchParams({
      customer: customerId,
      status: "all",
      limit: "100",
      // We only expand price here to avoid deep expansion limits; product details,
      // if needed, are handled safely in mapStripeSubscription.
      "expand[]": "data.items.data.price",
    });

    const res = await this.request<any>(
      "GET",
      `${BASE_URL}/subscriptions?${params.toString()}`,
    );

    const data = Array.isArray(res?.data) ? res.data : [];

    return data.map((sub: any) => this.mapStripeSubscription(sub));
  }

  /**
   * Find or create a Stripe Customer for the given user.
   *
   * Strategy:
   *  - if email is provided, try to find an existing customer by email
   *  - otherwise, or if not found, create a new customer with metadata.userId
   */
  private async findOrCreateCustomer(
    userId: string,
    email?: string,
  ): Promise<string> {
    this.logger.debug(
      `[StripeProvider] findOrCreateCustomer userId=${userId} email=${email ?? "n/a"}`,
    );


    // 1) If we have an email, try to find by email via /customers?email=...
    if (email) {
      const params = new URLSearchParams({
        email,
        limit: "1",
      });

      const res = await this.request<any>(
        "GET",
        `${BASE_URL}/customers?${params.toString()}`,
      );

      if (Array.isArray(res?.data) && res.data.length > 0) {
        const customer = res.data[0];
        this.logger.debug(
          `[StripeProvider] reusing existing customer via email: ${customer.id}`,
        );
        return String(customer.id);
      }
    }

    // 2) If no email or user not found, try to find an existing customer by our own userId in metadata
    const searchParams = new URLSearchParams({
      query: `metadata['userId']:'${userId}'`,
      limit: "1",
    });

    const searchRes = await this.request<any>(
      "GET",
      `${BASE_URL}/customers/search?${searchParams.toString()}`,
    );

    if (Array.isArray(searchRes?.data) && searchRes.data.length > 0) {
      const existing = searchRes.data[0];
      this.logger.debug(
        `[StripeProvider] reusing existing customer via metadata.userId: ${existing.id}`,
      );
      return String(existing.id);
    }



    // 3) Otherwise, create a new customer and always store our userId in metadata
    const body: Record<string, string> = {
      "metadata[userId]": userId,
    };

    if (email) {
      body["email"] = email;
    }

    const customer = await this.request<any>(
      "POST",
      `${BASE_URL}/customers`,
      body,
    );

    if (!customer?.id) {
      throw new Error("[StripeProvider] failed to create customer");
    }

    this.logger.debug(
      `[StripeProvider] created new customer ${customer.id} for userId=${userId}`,
    );

    return String(customer.id);
  }

  /**
   * Map a Stripe Subscription object into our StripeUserSubscription type.
   * Expects items[0].price.product to be expanded.
   */
  private mapStripeSubscription(sub: any): StripeUserSubscription {
    const items = Array.isArray(sub?.items?.data) ? sub.items.data : [];
    const first = items[0]?.price;

    const priceObj = first ?? {};

    // Expose a single logical planId to callers.
    // Use the Stripe price id here so it aligns with planId from available plans.
    const planId = String(priceObj.id ?? "");

    // Price in major currency units (e.g. dollars) for the primary item.
    const rawAmount = priceObj.unit_amount;
    const majorAmount =
      typeof rawAmount === "number" ? rawAmount / 100 : null;

    // Creation time as a single ISO string
    let createdAt: string | null = null;
    if (typeof sub.created === "number") {
      createdAt = new Date(sub.created * 1000).toISOString();
    } else if (typeof sub.created === "string") {
      const parsed = Number(sub.created);
      if (Number.isFinite(parsed)) {
        createdAt = new Date(parsed * 1000).toISOString();
      }
    }

    // Cancellation-related fields
    const cancelAtPeriodEnd: boolean = !!sub.cancel_at_period_end;

    let cancelAt: number | null = null;
    if (typeof sub.cancel_at === "number") {
      cancelAt = sub.cancel_at;
    } else if (typeof sub.cancel_at === "string") {
      const parsed = Number(sub.cancel_at);
      cancelAt = Number.isFinite(parsed) ? parsed : null;
    }

    let endedAt: number | null = null;
    if (typeof sub.ended_at === "number") {
      endedAt = sub.ended_at;
    } else if (typeof sub.ended_at === "string") {
      const parsed = Number(sub.ended_at);
      endedAt = Number.isFinite(parsed) ? parsed : null;
    }

    const cancelAtDate =
      cancelAt != null ? new Date(cancelAt * 1000).toISOString() : null;
    const endedAtDate =
      endedAt != null ? new Date(endedAt * 1000).toISOString() : null;

    return {
      id: String(sub.id),
      status: String(sub.status ?? "unknown"),
      planId,
      currency: String(priceObj.currency ?? ""),
      price: majorAmount,
      interval: priceObj.recurring?.interval ?? null,
      createdAt,
      cancelAtPeriodEnd,
      cancelAtDate,
      endedAtDate,
    };
  }

  /**
   * Convert amount to "smallest currency unit" as required by Stripe (unit_amount).
   * For many currencies it's amount * 100, but for "zero-decimal" currencies, a special map is needed (TODO).
   * Docs: unit_amount is passed in the smallest currency units / "cents".  [oai_citation:19‡Stripe Docs](https://docs.stripe.com/api/checkout/sessions/create) [oai_citation:20‡Stripe Docs](https://docs.stripe.com/payments/checkout/migrating-prices)
   */
  private toStripeAmount(amount: number, _currency: string): number {
    // TODO: zero-decimal currency handling
    return Math.round(amount * 100);
  }
}