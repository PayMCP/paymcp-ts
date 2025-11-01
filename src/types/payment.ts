
export enum PaymentFlow {
    ELICITATION = "ELICITATION",
    TWO_STEP = "TWO_STEP",
    PROGRESS = "PROGRESS",
    OOB = "OOB",
    DYNAMIC_TOOLS = "DYNAMIC_TOOLS",
    RESUBMIT = "RESUBMIT"
    // TODO: OOB
}

export interface CreatePaymentResult {
  paymentId: string;
  paymentUrl: string; 
}
