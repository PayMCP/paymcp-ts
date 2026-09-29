// lib/ts/paymcp/src/flows/elicitation.ts
import type { PaidWrapperFactory, ToolHandler } from "../types/flows.js";
import type { McpServerLike } from "../types/mcp.js";
import type { ClientInfo, PriceConfig, ToolExtraLike } from "../types/config.js";
import { Logger } from "../types/logger.js";
import { normalizeStatus } from "../utils/payment.js";
import { paymentPromptMessage } from "../utils/messages.js";
import { StateStore } from "../types/state.js";
import { runElicitationLoop } from "../utils/elicitation.js";
import { AbortWatcher } from "../utils/abortWatcher.js";
import { callOriginal } from "../utils/tool.js";
import {
  RESULT_NS_SESSION,
  callFingerprint,
  discardSpentState,
  clearCompletedResult,
  peekCompletedResult,
  saveCompletedResult,
} from "./state_utils.js";

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
  providers,
  priceInfo: PriceConfig,
  toolName: string,
  stateStore: StateStore,
  _config: any,
  _getClientInfo: (sessionId:string)=>Promise<ClientInfo>,
  logger?: Logger
) => {
  const providerName = Object.keys(providers).find(p => p !== 'x402'); //first non-x402 provider
  const provider = (providerName ? providers[providerName] : undefined)!;
  if (!provider) {
    throw new Error(`[PayMCP] No payment provider configured (tool: ${toolName}).`);
  }
  const log: Logger = logger ?? (provider as any).logger ?? console;

  async function wrapper(paramsOrExtra: any, maybeExtra?: ToolExtraLike) {
    log.debug?.(`[PayMCP:Elicitation] wrapper invoked for tool=${toolName} argsLen=${arguments.length}`);

    // The MCP TS SDK calls tool callbacks as either (args, extra) when an inputSchema is present,
    // or (extra) when no inputSchema is defined. We normalize here. citeturn5view0
    const hasArgs = arguments.length === 2;
    log.debug?.(`[PayMCP:Elicitation] hasArgs=${hasArgs}`);
    const toolArgs = hasArgs ? paramsOrExtra : undefined;
    const extra: ToolExtraLike = hasArgs ? (maybeExtra as ToolExtraLike) : (paramsOrExtra as ToolExtraLike);
    const abortWatcher = new AbortWatcher((extra as any)?.signal, log);

    //const clientInfo = await getClientInfo(extra.sessionId);

    // The key a cached result lives under. Only set when the client gave us a
    // session: without one every caller would share a single key, and a paid
    // result could be handed to someone who did not pay for it.
    const sessionKey = extra?.sessionId ? `${toolName}_${extra.sessionId}` : undefined;
    // Identify this call, so a result cached under the session key is only ever
    // served back to the call that produced it. Computed for every call,
    // disconnecting or not, and never throws.
    const fingerprint = callFingerprint(toolArgs, log);

    try {
      // The tool already ran and was paid for, but the client dropped before
      // receiving the result: return the stored one instead of asking for
      // payment again or re-running the tool. Checked before anything else,
      // including client capabilities - the caller has already been charged.
      if (sessionKey) {
        const cached = await peekCompletedResult(
          stateStore, sessionKey, RESULT_NS_SESSION, toolName, fingerprint, log
        );
        if (cached.hasResult) {
          if (abortWatcher.aborted) {
            log.warn?.(`[PayMCP:Elicitation] Still disconnected; keeping cached result for the next retry`);
            return {
              content: [{ type: "text", text: "Connection aborted. Call the tool again to retrieve the result." }],
              status: "pending",
              message: "Connection aborted. Call the tool again to retrieve the result.",
            };
          }
          log.info?.(`[PayMCP:Elicitation] Returning cached result for sessionKey=${sessionKey}`);
          // Unlike the payment-keyed flows, this key is reused by later calls,
          // so the result is dropped once delivered - otherwise the next
          // identical call would be served from cache instead of being paid for.
          await clearCompletedResult(stateStore, sessionKey, RESULT_NS_SESSION, cached.token, log);
          // The spent payment record has to go, or the next call would reuse a
          // payment that has already been consumed - and here that means a free
          // run of the paid tool. But failing to remove it must not cost the
          // caller the result they paid for, so the hand-off wins and the
          // failure is only logged.
          await discardSpentState(stateStore, sessionKey, log);
          return cached.result;
        }
      }

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
            false, //for future use - clientInfo.capabilities?.elicitation?.url ? true : false,
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

        // Build the response before looking at the connection, so the value we
        // may cache is exactly the value the caller would have received - and so
        // a tool whose result needs synthesizing is still covered by the
        // disconnect check below rather than returning early past it.
        let response: any;
        if (!toolResult || !Array.isArray((toolResult as any).content)) {
          // Ensure the required MCP 'content' field is present; if not, synthesize text.
          response = {
            content: [{ type: "text", text: "Tool completed after payment." }],
            annotations: { payment: { status: "paid", payment_id: paymentId } },
            raw: toolResult,
          };
        } else {
          // augment annotation
          try {
            (toolResult as any).annotations = {
              ...(toolResult as any).annotations,
              payment: { status: "paid", payment_id: paymentId },
            };
          } catch { /* ignore */ }
          response = toolResult;
        }

        if (abortWatcher.aborted) {
          log.warn?.(`[PayMCP:Elicitation] aborted after payment confirmation but before returning tool result.`);
          await saveCompletedResult(
            stateStore, sessionKey, response, RESULT_NS_SESSION, toolName, fingerprint, log
          );
          return {
            content: [{ type: "text", text: "Connection aborted. Call the tool again to retrieve the result." }],
            annotations: { payment: { status: "paid", payment_id: paymentId } },
            payment_id: paymentId,
            payment_url: paymentUrl,
            status: "pending",
            message: "Connection aborted. Call the tool again to retrieve the result.",
          };
        }
        // The tool has already run; a store that cannot delete must not cost the
        // caller the result they paid for.
        await discardSpentState(stateStore, `${toolName}_${extra.sessionId}`, log);

        return response;
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
    } finally {
      abortWatcher.dispose();
    }
  }

  return wrapper as unknown as ToolHandler;
};
