
export enum PaymentFlow {
    ELICITATION = "ELICITATION",
    TWO_STEP = "TWO_STEP",
    PROGRESS = "PROGRESS",
    OOB = "OOB",
    LIST_CHANGE = "LIST_CHANGE"
    // TODO: OOB
}

export interface CreatePaymentResult {
  paymentId: string;
  paymentUrl: string; 
}