# Provider Setup

## Stripe

```typescript
"stripe": {
  "apiKey": "sk_test_...",
  "successUrl": "https://example.com/success",
  "cancelUrl": "https://example.com/cancel"
}
```

Test card: `4242 4242 4242 4242`

## PayPal

```typescript
"paypal": {
  "clientId": "...",
  "clientSecret": "...",
  "sandbox": true
}
```

## Walleot

```typescript
"walleot": {
  "apiKey": "..."
}
```

Best for amounts under $2.

## Square

```typescript
"square": {
  "accessToken": "...",
  "locationId": "...",
  "environment": "sandbox"
}
```

## Environment Variables

Use `.env` file:
```bash
STRIPE_SECRET_KEY=sk_test_...
PAYPAL_CLIENT_ID=...
WALLEOT_API_KEY=...
```

Load in config:
```typescript
import * as dotenv from 'dotenv';

dotenv.config();

const providers = {
  "stripe": {
    "apiKey": process.env.STRIPE_SECRET_KEY
  }
};
```