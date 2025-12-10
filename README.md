# PayMCP (Node / TypeScript)

**Provider‑agnostic payment layer for MCP (Model Context Protocol) tools and agents.**

`paymcp` is a lightweight SDK that helps you add monetization to your MCP‑based tools, servers, or agents. Pick per‑tool pricing (pay‑per‑request) or subscription gating while still using MCP's native tool/resource interface.

See the [full documentation](https://paymcp.info).

---

## 🔧 Features

- ✅ Add **per‑tool `price` config** when you register MCP tools to enable pay‑per‑request billing.
- ✅ Gate tools behind **active subscriptions** (when your provider supports them) with built‑in helper tools.
- 🔁 Pay‑per‑request flows support multiple **modes** (TWO_STEP / RESUBMIT / ELICITATION / PROGRESS / DYNAMIC_TOOLS).
- 🔌 Built-in support for major providers ([see list](#supported-providers)) — plus a pluggable interface to add your own.
- ⚙️ Easy **drop‑in integration**: `installPayMCP(server, options)` — no need to rewrite tools.
- 🛡 Server‑side verification with your payment provider runs before the tool logic.

Two ways to charge (choose per tool):
- **Pay‑per‑request** — add `price`; uses the payment `mode` flows below.
- **Subscription‑gated** — add `subscription.plan`; works with providers that support subscriptions.

---

## 📦 Install

```bash
npm install paymcp
# or
pnpm add paymcp
# or
yarn add paymcp
```

Requires Node.js 18+, an MCP server (official SDK or compatible), and at least one payment provider API key.

---

## 🚀 Quickstart

### 1. Create (or import) your MCP server

```ts
import { Server } from "@modelcontextprotocol/sdk/server";
const server = new Server({ name: "my-ai-agent", version: "0.0.1" });
```

### 2. Install PayMCP

```ts
import { installPayMCP, Mode } from "paymcp";
import { StripeProvider } from 'paymcp/providers';

installPayMCP(server, {
  // Use a provider that matches your monetization: Stripe supports subscriptions; others are pay-per-request only.
  providers: [new StripeProvider({ apiKey: "sk_test_..." })],
  mode: Mode.TWO_STEP, // optional, TWO_STEP / RESUBMIT / ELICITATION / PROGRESS / DYNAMIC_TOOLS
});
```


> The first provider listed is used by default for priced tools. Multi‑provider selection coming soon.

### 3. Choose how to charge (pick one per tool)

#### Option A — Pay‑per‑request

Add a `price` object to the tool config. Use `price` **or** `subscription` (mutually exclusive per tool).

```ts
import { z } from "zod";

server.registerTool(
  "add",
  {
    title: "Add",
    description: "Add two numbers. This is a paid function.",
    inputSchema: {
      a: z.number(),
      b: z.number(),
    },
    price: { amount: 0.19, currency: "USD" },
  },
  async ({ a, b }, extra) => {
    // `extra` is required by the PayMCP tool signature — include it even if unused
    return {
      content: [{ type: "text", text: String(a + b) }],
    };
  }
);
```

> **Demo server:** For a complete setup (Express + Streamable HTTP), see the example repo: [node-paymcp-server-demo](https://github.com/blustAI/node-paymcp-server-demo).

#### Option B — Subscription

Add a `subscription` block with the required plan (e.g. Stripe Price ID). Subscriptions work only with providers that implement them.

User authentication is **your** responsibility. Authenticate however you like and pass user info to PayMCP:
- Provide `authInfo.userId` and optionally `authInfo.email` (preferred), or
- Provide `authInfo.token` that contains `sub` (and optionally `email`) in its JWT payload.

See https://modelcontextprotocol.io/docs/tutorials/security/authorization for authentication implementation example.

PayMCP does **not** validate or verify the token; it only parses it to extract `userId`/`email`. Include `email` if you have it to improve provider matching.

```ts
server.registerTool(
  "generate_report",
  {
    title: "Generate report",
    description: "Requires an active Pro subscription.",
    subscription: { plan: "price_pro_monthly" }, // or array of accepted plan ids
  },
  async (extra) => {
    return { content: [{ type: "text", text: "Your report" }] };
  }
);
```

When you register the first subscription‑protected tool, PayMCP auto‑registers helper tools:

- `list_subscriptions` — current subscriptions + available plans for the user.
- `start_subscription` — accepts `planId` to create (or resume) a subscription.
- `cancel_subscription` — accepts `subscriptionId` to cancel at period end.

---


## 🧩 Supported Providers

Built-in support is available for the following providers. You can also [write a custom provider](#writing-a-custom-provider).


- ✅ [Stripe](https://stripe.com) — pay‑per‑request + subscriptions
- ✅ [Adyen](https://www.adyen.com) — pay‑per‑request
- ✅ [Coinbase Commerce](https://commerce.coinbase.com) — pay‑per‑request
- ✅ [PayPal](https://paypal.com) — pay‑per‑request
- ✅ [Square](https://squareup.com) — pay‑per‑request
- ✅ [Walleot](https://walleot.com/developers) — pay‑per‑request

- 🔜 More providers welcome! Open an issue or PR.

---

## 🔌 Writing a Custom Provider

Every provider implements two methods for pay‑per‑request and three optional methods for subscription management:

```ts
import { BasePaymentProvider } from "paymcp/providers";

class MyProvider extends BasePaymentProvider {
  constructor(apiKey: string) {
    super(apiKey);
  }

  async createPayment(amount: number, currency: string, description: string) {
    // return { paymentId, paymentUrl }
    return { paymentId: "demo-1", paymentUrl: "https://example.com/pay" };
  }

  async getPaymentStatus(paymentId: string) {
    return "paid"; // or "pending" | "failed"
  }

  // Optional: subscriptions
  async getSubscriptions(userId: string, email?: string) {
    return {
      current_subscriptions: [], // list of current user subscriptions
      available_subscriptions: [], // list of available plans
    };
  }

  // Optional: subscriptions
  async startSubscription(planId: string, userId: string, email?: string) {
    return {
      message: "Subscription created",
      sessionId: "SESSION_ID",
      checkoutUrl: "https://example.com/checkout",
    };
  }

  // Optional: subscriptions
  async cancelSubscription(subscriptionId: string, userId: string, email?: string) {
    return {
      message: "Subscription cancellation scheduled",
      canceled: true,
      endDate: "2025-12-31T00:00:00Z",
    };
  }
}

installPayMCP(server, { providers: [ new MyProvider("api_key") ] });
```

See `src/providers/walleot.ts` and `src/providers/stripe.ts` for examples. 

---


## 💾 State Storage 

By default, PayMCP stores pending tool arguments (for confirming payment) **in memory** using a process-local `Map`. This is **not durable** and will not work across server restarts or multiple server instances (no horizontal scaling).

To enable durable and scalable state storage, you can provide a custom `StateStore` implementation. PayMCP includes a built-in `RedisStateStore`, which works with any Redis-compatible client.

#### Example: Using Redis for State Storage

```ts
import { createClient } from "redis";
import { installPayMCP, RedisStateStore } from "paymcp";

const redisClient = createClient({ url: "redis://localhost:6379" });
await redisClient.connect();

installPayMCP(server, {
  providers: [ /* ... */ ],
  mode: Mode.TWO_STEP,
  stateStore: new RedisStateStore(redisClient),
});
```

> Any client that implements `set`, `get`, and `del` (such as [`node-redis`](https://github.com/redis/node-redis), [`ioredis`](https://github.com/luin/ioredis), or a mock) can be used with `RedisStateStore`.

---

## 🧭 Modes (pay‑per‑request only)

The `mode` option controls how the user is guided through pay‑per‑request payment flows. Choose what fits your UX and client capabilities.

### `Mode.TWO_STEP` (default)
Splits the original tool into two MCP methods.

1. **Initiate**: original tool returns a `payment_url` + `payment_id` + `next_step` (e.g. `confirm_payment`).
2. **Confirm**: dynamically registered tool verifies payment (server‑side) and, if paid, runs the original logic.

Works in almost all clients (even very simple ones).

### `Mode.RESUBMIT`

Adds an optional `payment_id` to the original tool signature.

- **First call**: invoked without `payment_id` → PayMCP returns a `payment_url` + `payment_id` and instructs a retry after payment.
- **Second call**: invoked with the returned `payment_id` → PayMCP verifies payment server‑side and, if paid, executes the original tool logic.

Similar compatibility to TWO_STEP, but with a simpler surface.

### `Mode.ELICITATION`
PayMCP sends the user a payment link via MCP **elicitation** (if the client supports the capability). The user can Accept / Cancel inline; once paid, the original tool runs in the same call.

### `Mode.PROGRESS`
Keeps the tool call open, shows a payment link, and streams **progress updates** while polling the provider in the background. Automatically returns the tool result when payment clears (or error / timeout).

### `Mode.DYNAMIC_TOOLS`
Steer the client and the LLM by changing the visible tool set at specific points in the flow (e.g., temporarily expose `confirm_payment_*`), thereby guiding the next valid action.

> When in doubt, start with **`TWO_STEP`** — highest compatibility.

---

## 🔒 Security Notice

PayMCP is NOT compatible with STDIO mode deployments where end users download and run MCP servers locally. This would expose your payment provider API keys to end users, creating serious security vulnerabilities.


## 📄 License

MIT License
