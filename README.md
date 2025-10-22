

# PayMCP (Node / TypeScript)

**Provider‑agnostic payment layer for MCP (Model Context Protocol) tools and agents.**

`paymcp` is a lightweight SDK that helps you add monetization to your MCP‑based tools, servers, or agents. It supports multiple payment providers and integrates seamlessly with MCP's tool/resource interface.

See the [full documentation](https://paymcp.info).

---

## 🔧 Features

- ✅ Add **per‑tool `price` config** when you register MCP tools to enable payments.
- 🔁 Choose between different **payment flows**.
- 🔌 Built-in support for major providers ([see list](#supported-providers)) — plus a pluggable interface to add your own.
- ⚙️ Easy **drop‑in integration**: `installPayMCP(server, options)` — no need to rewrite tools.
- 🛡 Server‑side verification with your payment provider runs before the tool logic.

---

## 🧭 Payment Flows

The `paymentFlow` option controls how the user is guided through payment. Choose what fits your UX and client capabilities.

### `PaymentFlow.TWO_STEP` (default)
Splits original tool into two MCP methods.

1. **Initiate**: original tool returns a `payment_url` + `payment_id` + `next_step` (e.g. `confirm_payment`).
2. **Confirm**: dynamically registered tool verifies payment (server‑side) and, if paid, runs the original logic.

Works in almost all clients (even very simple ones).

---

### `PaymentFlow.ELICITATION`
When the tool is called, PayMCP sends the user a payment link via MCP **elicitation** (if the client supports the capability). The user can Accept / Cancel inline; once paid, the original tool runs in the same call. 

---

### `PaymentFlow.PROGRESS`
Keeps the tool call open, shows a payment link, and streams **progress updates** while polling the provider in the background. Automatically returns the tool result when payment clears (or error / timeout).

---

### `PaymentFlow.DYNAMIC_TOOLS` 
Steer the client and the LLM by changing the visible tool set at specific points in the flow (e.g., temporarily expose `confirm_payment_*`), thereby guiding the next valid action. 

---

> When in doubt, start with **`TWO_STEP`** — highest compatibility.

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
import { installPayMCP, PaymentFlow } from "paymcp";
import { StripeProvider } from 'paymcp/providers';

installPayMCP(server, {
  providers: [new StripeProvider({ apiKey: "sk_test_..." })],
  paymentFlow: PaymentFlow.TWO_STEP, // optional, TWO_STEP / ELICITATION / PROGRESS / DYNAMIC_TOOLS
});
```

> The first provider listed is used by default for priced tools. Multi‑provider selection coming soon.

### 3. Register a paid tool

Specify a `price` object in the tool config you pass to `registerTool()`.

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

---


## 🧩 Supported Providers

Built-in support is available for the following providers. You can also [write a custom provider](#writing-a-custom-provider).

- ✅ [Adyen](https://www.adyen.com)
- ✅ [Coinbase Commerce](https://commerce.coinbase.com)
- ✅ [PayPal](https://paypal.com)
- ✅ [Stripe](https://stripe.com)
- ✅ [Square](https://squareup.com)
- ✅ [Walleot](https://walleot.com/developers)

- 🔜 More providers welcome! Open an issue or PR.

---

## 🔌 Writing a Custom Provider

Every provider implements two methods:

```ts
import type { BasePaymentProvider } from "paymcp/providers";

class MyProvider implements BasePaymentProvider {
  constructor(private opts: { apiKey: string }) {}

  async createPayment(amount: number, currency: string, description: string) {
    // return { paymentId, paymentUrl }
    return { paymentId: "demo-1", paymentUrl: "https://example.com/pay" };
  }

  async getPaymentStatus(paymentId: string) {
    return "paid";
  }
}

installPayMCP(server, { providers: [ new MyProvider({ apiKey: "..." }) ] });
```

See `src/providers/walleot.ts` and `src/providers/stripe.ts` for examples. 

---


## 💾 State Storage 

By default, when using the `TWO_STEP` payment flow, PayMCP stores pending tool arguments (for confirming payment) **in memory** using a process-local `Map`. This is **not durable** and will not work across server restarts or multiple server instances (no horizontal scaling).

To enable durable and scalable state storage, you can provide a custom `StateStore` implementation. PayMCP includes a built-in `RedisStateStore`, which works with any Redis-compatible client.

#### Example: Using Redis for State Storage

```ts
import { createClient } from "redis";
import { installPayMCP, RedisStateStore } from "paymcp";

const redisClient = createClient({ url: "redis://localhost:6379" });
await redisClient.connect();

installPayMCP(server, {
  providers: [ /* ... */ ],
  paymentFlow: PaymentFlow.TWO_STEP,
  stateStore: new RedisStateStore(redisClient),
});
```

> Any client that implements `set`, `get`, and `del` (such as [`node-redis`](https://github.com/redis/node-redis), [`ioredis`](https://github.com/luin/ioredis), or a mock) can be used with `RedisStateStore`.

---

## 🔒 Security Notice

PayMCP is NOT compatible with STDIO mode deployments where end users download and run MCP servers locally. This would expose your payment provider API keys to end users, creating serious security vulnerabilities.


## 📄 License

MIT License