

# PayMCP (Node / TypeScript)

**Provider‑agnostic payment layer for MCP (Model Context Protocol) tools and agents.**

`paymcp` is a lightweight SDK that helps you add monetization to your MCP‑based tools, servers, or agents. It supports multiple payment providers and integrates seamlessly with MCP's tool / resource interface.

> This is the **Node / TypeScript** port of the original Python `paymcp` library.  
> Conceptually the same: you mark tools as paid and choose a payment flow.  
> Implementation details differ (no decorators; price lives in `registerTool()` config).

---

## 🔧 Features

- ✅ Add **per‑tool `price` config** when you register MCP tools to enable payments.
- 🔁 Choose between different **payment flows** (Two‑Step confirm, Elicitation, Progress wait).
- 🔌 Pluggable support for providers like **Walleot**, **Stripe**, and more.
- ⚙️ Easy **drop‑in patch**: `installPayMCP(server, options)` — no need to rewrite tools.
- 🛡 Verified server‑side with your payment provider before tool logic runs.

---

## 🧭 Payment Flows

The `paymentFlow` option controls how the user is guided through payment. Pick what fits your UX & client capabilities.

### `PaymentFlow.TWO_STEP` (default)
Splits the tool into two MCP methods.

1. **Initiate**: original tool returns a `payment_url` + `payment_id` + `next_step` (e.g. `confirm_add_payment`).
2. **Confirm**: dynamically registered tool verifies payment (server‑side) and, if paid, runs the original logic.

Works in almost all clients (even very simple ones).

---

### `PaymentFlow.ELICITATION`
When the tool is called, PayMCP sends the user a payment link via MCP **elicitation** (if the client supports the capability). The user can Accept / Cancel inline; once paid, the original tool runs in the same call. Falls back to a pending response if elicitation is unsupported.

---

### `PaymentFlow.PROGRESS`
Keeps the tool call open, shows a payment link, and streams **progress updates** while polling the provider in the background. Automatically returns the tool result when payment clears (or error / timeout).

---

### `PaymentFlow.OOB` *(Out‑of‑Band)*
Reserved for asynchronous / deferred flows. Not yet implemented.

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

Requires Node 18+, an MCP server (official SDK or compatible), and at least one payment provider API key.

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

installPayMCP(server, {
  providers: {
    "provider_name": {"apiKey": "your-api-key-here"},
  },
  paymentFlow: PaymentFlow.ELICITATION, // or TWO_STEP / PROGRESS
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

Start your MCP transport (stdio / http / ws) as usual. Any MCP client that connects will see the tool (and—depending on flow—be prompted to pay).

> **Demo server:** For a complete setup (Express + Streamable HTTP), see the example repo: [node-paymcp-server-demo](https://github.com/blustAI/node-paymcp-server-demo).

---

## Providers: alternative styles (optional)

**Instances instead of config (advanced):**
```ts
import { installPayMCP, PaymentFlow } from "paymcp";
import { WalleotProvider, CoinbaseProvider } from "paymcp/providers";

installPayMCP(server, {
  providers: [
    new WalleotProvider({ apiKey: process.env.WALLEOT_API_KEY ?? "" }),
    new CoinbaseProvider({ apiKey: process.env.COINBASE_COMMERCE_API_KEY ?? "" }),
  ],
  paymentFlow: PaymentFlow.TWO_STEP,
});
// Note: right now the first configured provider is used.
```

**Custom provider (minimal):**  
Any provider must implement `createPayment(...)` and `getPaymentStatus(...)`.
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

---

## 👥 Multi-User Session Isolation

PayMCP supports concurrent users with independent payment states using the LIST_CHANGE flow:

- **Per-session server instances**: Each session gets a NEW McpServer instance (following MCP SDK pattern)
- **Session context**: Use `runWithSession()` wrapper for proper AsyncLocalStorage context
- **Concurrent isolation**: Multiple users can initiate payments simultaneously without state interference
- **Verified**: 100% pass rate on multi-user isolation test scenarios

**Example**: User A initiates a payment → their tools are hidden. User B's tools remain visible and unaffected. When User A confirms, their tools are restored without affecting User B.

**Important for demo servers**: Wrap request handling with `runWithSession()`:
```typescript
import { runWithSession } from 'paymcp';

app.post('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string;
    await runWithSession(sessionId, async () => {
        await transport.handleRequest(req, res, req.body);
    });
});
```

---

## 🧩 Supported Providers

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
interface PaymentProvider {
  createPayment(
    amount: number,
    currency: string,
    description: string
  ): Promise<{ paymentId: string; paymentUrl: string }>;

  getPaymentStatus(paymentId: string): Promise<string>; // \"paid\" | \"pending\" | \"canceled\" | ...
}
```

See `src/providers/walleot.ts` and `src/providers/stripe.ts` for examples. Add yours and either pass an **instance directly** (recommended), or export it in the provider map and pass config to `installPayMCP()`.

---

## ⚠️ Notes & Caveats

- **In‑memory state**: Two‑Step flow stores pending args in a process‑local Map. Use Redis (or similar) in production if you need durability or horizontal scaling.
- **Always include `content` in tool results** to satisfy strict MCP clients (Pydantic validation).

---

## 📄 License

MIT License