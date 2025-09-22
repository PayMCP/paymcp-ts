# API Reference

## Main Functions

### installPayMCP

```typescript
installPayMCP(
  server: McpServer,
  options: {
    providers: ProvidersConfig,
    paymentFlow?: PaymentFlow
  }
)
```

### Tool Registration

```typescript
server.registerTool(
  "tool_name",
  {
    title: "Tool Title",
    inputSchema: { /* JSON schema */ },
    price: { amount: 5.0, currency: "USD" }
  },
  async (args, extra) => {  // extra is required!
    return {
      content: [{
        type: "text",
        text: "Result"
      }]
    };
  }
);
```

### PaymentFlow Enum

```typescript
PaymentFlow.TWO_STEP      // Default
PaymentFlow.ELICITATION
PaymentFlow.PROGRESS      // Coming soon
PaymentFlow.OOB          // Planned
```

## Custom Provider

```typescript
import { BasePaymentProvider } from 'paymcp/providers';

class CustomProvider extends BasePaymentProvider {
  getName(): string {
    return "custom";
  }

  async createPayment(amount, currency, description) {
    // Return { payment_id, payment_url }
    return {
      payment_id: "pay_123",
      payment_url: "https://pay.example.com"
    };
  }

  async getPaymentStatus(paymentId) {
    // Return "paid", "pending", or "failed"
    return "paid";
  }
}
```

## Custom Storage

```typescript
import { SessionStorage } from 'paymcp/session';

class RedisStorage implements SessionStorage {
  async get(key: string): Promise<any> { }
  async set(key: string, value: any, ttl?: number): Promise<void> { }
  async delete(key: string): Promise<void> { }
  async has(key: string): Promise<boolean> { }
}
```

## Extra Parameter

Required for all priced tools:

```typescript
async (args, extra) => {  // extra is required!
  // extra.payment_id available after payment
  return result;
}
```