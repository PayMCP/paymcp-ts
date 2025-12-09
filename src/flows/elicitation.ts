// lib/ts/paymcp/src/flows/elicitation.ts
import type { PaidWrapperFactory, ToolHandler } from "../types/flows.js";
import type { McpServerLike } from "../types/mcp.js";
import type { BasePaymentProvider } from "../providers/base.js";
import type { PriceConfig, ToolExtraLike } from "../types/config.js";
import { Logger } from "../types/logger.js";
import { normalizeStatus } from "../utils/payment.js";
import { paymentPromptMessage } from "../utils/messages.js";
import { StateStore } from "../types/state.js";
import { runElicitationLoop } from "../utils/elicitation.js";

/**
 * Wrap a tool handler with an *elicitation-based* payment flow:
 * 1. Create a payment session.
 * 2. Ask the user (via ctx.elicit) to confirm / complete payment.
 * 3. Poll provider for payment status.
 * 4. If paid -> call the original tool handler.
 * 5. If canceled -> return a structured canceled response.
 * 6. If still unpaid after N attempts -> return pending status so the caller can retry.
 */
export const makePaidWrapper: PaidWrapperFactory = (
  func,
  _server: McpServerLike,
  provider: BasePaymentProvider,
  priceInfo: PriceConfig,
  toolName: string,
  stateStore: StateStore,
  _config: any,
  getClientInfo: () => { name: string, capabilities: Record<string, any> },
  logger?: Logger
) => {
  const log: Logger = logger ?? (provider as any).logger ?? console;

  async function wrapper(paramsOrExtra: any, maybeExtra?: ToolExtraLike) {
    log.debug?.(`[PayMCP:Elicitation] wrapper invoked for tool=${toolName} argsLen=${arguments.length}`);

    // The MCP TS SDK calls tool callbacks as either (args, extra) when an inputSchema is present,
    // or (extra) when no inputSchema is defined. We normalize here. citeturn5view0
    const hasArgs = arguments.length === 2;
    log.debug?.(`[PayMCP:Elicitation] hasArgs=${hasArgs}`);
    const toolArgs = hasArgs ? paramsOrExtra : undefined;
    const extra: ToolExtraLike = hasArgs ? (maybeExtra as ToolExtraLike) : (paramsOrExtra as ToolExtraLike);

    const clientInfo = getClientInfo();

    const elicitSupported = typeof (extra as any)?.sendRequest === "function";
    if (!elicitSupported) {
      log.warn?.(`[PayMCP:Elicitation] client lacks sendRequest(); falling back to error result.`);
      return {
        content: [{ type: "text", text: "Client does not support the selected payment flow." }],
        annotations: { payment: { status: "error", reason: "elicitation_not_supported" } },
        status: "error",
        message: "Client does not support the selected payment flow",
      };
    }

    let paymentStatus: string | undefined;
    let paymentId: string | undefined;
    let paymentUrl: string | undefined;
    let nonfinishedpaymentrecord = extra.sessionId ? await stateStore.get(`${toolName}_${extra.sessionId}`) : null;
    let nonfinishedpayment: { paymentId: string, paymentUrl: string } | null = null;



    if (nonfinishedpaymentrecord) {
      try {
        paymentStatus = await provider.getPaymentStatus((nonfinishedpaymentrecord as any).args?.paymentId);
        paymentStatus = normalizeStatus(paymentStatus);
        nonfinishedpayment = nonfinishedpaymentrecord.args;//reuse payment details
      } catch (err) {
        log.warn?.(`[PayMCP:Elicitation] failed to get status for existing payment: ${String(err)}`);
        await stateStore.delete(`${toolName}_${extra.sessionId}`);
        return {
          content: [{ type: "text", text: "Unable to contact payment provider. Please try again later." }],
          annotations: { payment: { status: "error", reason: "provider_unreachable" } },
          status: "error",
          message: "Unable to contact payment provider. Please try again later."
        };
      }
      if (paymentStatus === 'paid') {
        paymentId = nonfinishedpayment?.paymentId;
      } else if (paymentStatus === 'pending' && (Date.now() - new Date(nonfinishedpaymentrecord.ts).getTime() < 60 * 60 * 1000)) { //if status is pending and less than an hour passed
        paymentId = nonfinishedpayment?.paymentId;
        paymentUrl = nonfinishedpayment?.paymentUrl;
        log.debug(`[PayMCP:Elicitation] reused payment id=${paymentId} url=${paymentUrl}`);
      } else {
        await stateStore.delete(`${toolName}_${extra.sessionId}`); //delete old payment info
      }
    }

    if (paymentStatus !== 'paid') {
      if (!paymentId || !paymentUrl) {
        const newpayment = await provider.createPayment(
          priceInfo.amount,
          priceInfo.currency,
          `${toolName}() execution fee`
        );
        paymentId = newpayment.paymentId;
        paymentUrl = newpayment.paymentUrl;
        await stateStore.set(String(`${toolName}_${extra.sessionId}`), { paymentId, paymentUrl });
        log.debug(`[PayMCP:Elicitation] created payment id=${paymentId} url=${paymentUrl}`);
      }

      // Run elicitation loop (client confirms payment)
      let userAction: "accept" | "decline" | "cancel" | "unknown" = "unknown";

      try {
        log.debug?.(`[PayMCP:Elicitation] starting elicitation loop for paymentId=${paymentId}`);
        const loopResult = await runElicitationLoop(
          extra,
          paymentPromptMessage(paymentUrl, priceInfo.amount, priceInfo.currency),
          provider,
          paymentId,
          paymentUrl,
          5,
          clientInfo.capabilities?.elicitation?.url ? true : false,
          log
        );
        log.debug?.(`[PayMCP:Elicitation] elicitation loop returned action=${loopResult.action} status=${loopResult.status}`);
        userAction = loopResult.action;
        paymentStatus = loopResult.status;
      } catch (err) {
        log.warn?.(`[PayMCP:Elicitation] elicitation loop error: ${String(err)}`);
        userAction = "unknown";
      }

      // 3. Double‑check with provider just in case
      log.debug?.(`[PayMCP:Elicitation] provider status check (initial=${paymentStatus ?? "none"})`);
      if (paymentStatus === undefined || paymentStatus === null || paymentStatus === "") {
        try {
          paymentStatus = await provider.getPaymentStatus(paymentId);
          log.debug?.(`[PayMCP:Elicitation] provider.getPaymentStatus(${paymentId}) -> ${paymentStatus}`);
          paymentStatus = normalizeStatus(paymentStatus);
        } catch {
          paymentStatus = "unknown";
        }
      }
      if (paymentStatus === "unsupported" /* or loopResult.status === "unsupported" */) {
        await stateStore.delete(`${toolName}_${extra.sessionId}`);
        return {
          content: [{ type: "text", text: "Client does not support the selected payment flow." }],
          annotations: { payment: { status: "error", reason: "elicitation_not_supported" } },
          status: "error",
          message: "Client does not support the selected payment flow.",
        };
      }
      if (normalizeStatus(paymentStatus) === "canceled" || userAction === "cancel") {
        await stateStore.delete(`${toolName}_${extra.sessionId}`);
        log.info?.(`[PayMCP:Elicitation] payment canceled by user or provider (status=${paymentStatus}, action=${userAction})`);
        return {
          content: [{ type: "text", text: "Payment canceled by user." }],
          annotations: { payment: { status: "canceled", payment_id: paymentId } },
          payment_url: paymentUrl,
          status: "canceled",
          message: "Payment canceled by user",
        };
      }
    }


    if (normalizeStatus(paymentStatus) === "paid") {
      log.info?.(`[PayMCP:Elicitation] payment confirmed; invoking original tool ${toolName}`);
      const toolResult = await callOriginal(func, toolArgs, extra);
      // Ensure toolResult has required MCP 'content' field; if not, synthesize text.
      if (!toolResult || !Array.isArray((toolResult as any).content)) {
        return {
          content: [{ type: "text", text: "Tool completed after payment." }],
          annotations: { payment: { status: "paid", payment_id: paymentId } },
          raw: toolResult,
        };
      }
      // augment annotation
      try {
        (toolResult as any).annotations = {
          ...(toolResult as any).annotations,
          payment: { status: "paid", payment_id: paymentId },
        };
      } catch { /* ignore */ }
      await stateStore.delete(`${toolName}_${extra.sessionId}`);
      return toolResult;
    }


    // Otherwise payment not yet received
    log.info?.(`[PayMCP:Elicitation] payment still pending after elicitation attempts; returning pending result.`);
    return {
      content: [{ type: "text", text: "Payment not yet received. Open the link and try again." }],
      annotations: { payment: { status: "pending", payment_id: paymentId, next_step: toolName } },
      payment_url: paymentUrl,
      status: "pending",
      message: "Payment not yet received. Open the link and try again.",
      payment_id: String(paymentId),
      next_step: toolName,
    };
  }

  return wrapper as unknown as ToolHandler;
};

/** Safely invoke the original tool handler preserving args. */
async function callOriginal(func: ToolHandler, args: any | undefined, extra: ToolExtraLike) {
  if (args !== undefined) {
    return await func(args, extra);
  } else {
    return await func(extra);
  }
}
