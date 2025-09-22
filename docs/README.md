# PayMCP TypeScript Documentation

## Quick Start

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { installPayMCP, PaymentFlow } from 'paymcp';

const server = new McpServer({
    name: "My Server",
    version: "1.0.0"
});

installPayMCP(server, {
    providers: {
        "stripe": {"apiKey": "sk_test_..."}
    }
});

server.registerTool(
    "paid_tool",
    {
        title: "Paid Tool",
        inputSchema: { /* schema */ },
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

## Guides

- [Installation](installation.md)
- [Payment Flows](payment-flows.md)
- [Providers Setup](providers.md)
- [API Reference](api.md)
- [Testing Guide](testing.md)

## Examples

See `/examples` folder for complete examples.