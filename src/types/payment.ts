
export enum Mode {
    ELICITATION = "ELICITATION",
    TWO_STEP = "TWO_STEP",
    PROGRESS = "PROGRESS",
    OOB = "OOB",
    DYNAMIC_TOOLS = "DYNAMIC_TOOLS",
    RESUBMIT = "RESUBMIT"
    // TODO: OOB
}

export const PaymentFlow = Mode; // Alias for backward compatibility; PaymentFlow will be deprecated in future versions
export type PaymentFlow = Mode;

export interface CreatePaymentResult {
  paymentId: string;
  paymentUrl: string; 
}
