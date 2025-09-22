# Payment Flows

## Two-Step Flow (Default)

```typescript
PaymentFlow.TWO_STEP
```

1. Call tool → Get payment link
2. Pay → Get payment ID
3. Confirm → Tool executes

## Elicitation Flow

```typescript
PaymentFlow.ELICITATION
```

1. Call tool → Payment UI opens
2. Pay → Tool auto-executes

Requires client support.