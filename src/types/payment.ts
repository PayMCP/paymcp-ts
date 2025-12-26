
export enum Mode {
    AUTO = "AUTO",
    ELICITATION = "ELICITATION",
    TWO_STEP = "TWO_STEP",
    PROGRESS = "PROGRESS",
    DYNAMIC_TOOLS = "DYNAMIC_TOOLS",
    RESUBMIT = "RESUBMIT",
    X402 = "X402"
}

/** @deprecated Use Mode instead.*/
export const PaymentFlow = Mode; // Alias for backward compatibility; PaymentFlow will be deprecated in future versions
/** @deprecated Use Mode instead.*/
export type PaymentFlow = Mode;

export interface CreatePaymentResult {
  paymentId: string;
  paymentUrl: string; 
  paymentData?: any;
}
