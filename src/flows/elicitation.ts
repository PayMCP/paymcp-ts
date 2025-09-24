// lib/ts/paymcp/src/flows/elicitation.ts
import type { PaidWrapperFactory, ToolHandler } from '../types/flows.js';
import type { McpServerLike } from '../types/mcp.js';
import type { BasePaymentProvider } from '../providers/base.js';
import type { PriceConfig, ToolExtraLike } from '../types/config.js';
import { Logger } from '../types/logger.js';
import { normalizeStatus } from '../utils/payment.js';
import { paymentPromptMessage } from '../utils/messages.js';
import { SessionManager } from '../session/manager.js';
import type { SessionData } from '../session/types.js';
import { SessionKey } from '../session/types.js';
import { extractSessionId } from '../utils/session.js';
import { z } from 'zod';

// Used for extra.sendRequest() result validation; accept any response shape.
const Z_ANY = z.any();

// Session storage for payment args
const sessionStorage = SessionManager.getStorage();

/**
 * Minimal "blank" schema: request no structured fields.
 * Many clients (e.g., FastMCP Python) will surface Accept / Decline / Cancel UI only.
 * This mirrors the Python `ctx.elicit(..., response_type=None)` pattern.
 */
const SimpleActionSchema = {
  type: 'object',
  properties: {},
  required: [],
} as const;

/**
 * Wrap a tool handler with an *elicitation-based* payment flow:
 * 1. Create a payment session.
 * 2. Ask the user (via ctx.elicit) to confirm / complete payment.
 * 3. Poll provider for payment status.
 * 4. If paid -> call the original tool handler.
 * 5. If canceled -> return a structured canceled response.
 * 6. If still unpaid after N attempts -> return pending status WITHOUT adding tools.
 *
 * This is a pure elicitation flow - no confirmation tools are added.
 */
export const makePaidWrapper: PaidWrapperFactory = (
  func,
  server: McpServerLike,
  provider: BasePaymentProvider,
  priceInfo: PriceConfig,
  toolName: string,
  logger?: Logger
) => {
  const log: Logger = logger ?? console;

  // No tool registration here - pure elicitation flow

  async function wrapper(paramsOrExtra: unknown, maybeExtra?: ToolExtraLike) {
    log.debug?.(
      `[PayMCP:Elicitation] wrapper invoked for tool=${toolName} argsLen=${arguments.length}`
    );

    // The MCP TS SDK calls tool callbacks as either (args, extra) when an inputSchema is present,
    // or (extra) when no inputSchema is defined. We normalize here. citeturn5view0
    const hasArgs = arguments.length === 2;
    log.debug?.(`[PayMCP:Elicitation] hasArgs=${hasArgs}`);
    const toolArgs = hasArgs ? paramsOrExtra : undefined;
    const extra: ToolExtraLike = hasArgs
      ? (maybeExtra as ToolExtraLike)
      : (paramsOrExtra as ToolExtraLike);

    const elicitSupported =
      typeof (extra as ToolExtraLike & { sendRequest?: Function })?.sendRequest === 'function';
    if (!elicitSupported) {
      log.warn?.(`[PayMCP:Elicitation] client lacks sendRequest(); falling back to error result.`);
      return {
        content: [
          {
            type: 'text',
            text: 'Client does not support the selected payment flow.',
          },
        ],
        annotations: {
          payment: { status: 'error', reason: 'elicitation_not_supported' },
        },
        status: 'error',
        message: 'Client does not support the selected payment flow',
      };
    }

    // Check if there's a payment_id in params (retry scenario)
    const retryPaymentId = (toolArgs as any)?._payment_id || (toolArgs as any)?.payment_id;
    if (retryPaymentId) {
      log.debug?.(`[PayMCP:Elicitation] Retry detected for payment_id=${retryPaymentId}`);
      // Check payment status for retry
      try {
        const status = await provider.getPaymentStatus(retryPaymentId);
        if (normalizeStatus(status) === 'paid') {
          log.info?.(`[PayMCP:Elicitation] Payment ${retryPaymentId} already paid, executing tool`);
          // Clean up session after successful retry
          const providerName = provider.getName();
          const mcpSessionId = extractSessionId(extra, log);
          const retrySessionKey = new SessionKey(
            providerName,
            String(retryPaymentId),
            mcpSessionId
          );
          await sessionStorage.delete(retrySessionKey);
          // Remove payment_id from args before calling original function
          if (toolArgs && typeof toolArgs === 'object') {
            const cleanArgs = { ...toolArgs };
            delete (cleanArgs as any)._payment_id;
            delete (cleanArgs as any).payment_id;
            return await callOriginal(func, cleanArgs, extra);
          }
          return await callOriginal(func, toolArgs, extra);
        } else if (normalizeStatus(status) === 'canceled') {
          log.info?.(`[PayMCP:Elicitation] Payment ${retryPaymentId} was canceled`);
          return {
            content: [{ type: 'text', text: 'Previous payment was canceled.' }],
            annotations: { payment: { status: 'canceled' } },
            status: 'canceled',
            message: 'Previous payment was canceled',
          };
        }
      } catch (e) {
        log.warn?.(`[PayMCP:Elicitation] Could not check retry payment status: ${String(e)}`);
        // Continue with new payment
      }
    }

    // 1. Create payment session
    const { paymentId, paymentUrl } = await provider.createPayment(
      priceInfo.amount,
      priceInfo.currency,
      `${toolName}() execution fee`
    );
    log.debug?.(`[PayMCP:Elicitation] created payment id=${paymentId} url=${paymentUrl}`);

    // Store session for recovery (if client needs to retry after timeout)
    // But NOT for a confirmation tool - just for potential retry
    const providerName = provider.getName();
    // Extract MCP session ID from extra context if available
    const mcpSessionId = extractSessionId(extra, log);
    const sessionKey = new SessionKey(providerName, String(paymentId), mcpSessionId);
    const sessionData: SessionData = {
      args: { toolArgs, extra },
      ts: Date.now(),
      providerName: providerName,
      metadata: { toolName: toolName, forRetry: true },
    };
    await sessionStorage.set(sessionKey, sessionData, 300); // 5 minute TTL for retries
    log.debug?.(
      `[PayMCP:Elicitation] Stored session for potential retry of payment_id=${paymentId}`
    );

    // 2. Run elicitation loop (client confirms payment)
    let userAction: 'accept' | 'decline' | 'cancel' | 'unknown';
    let paymentStatus: string | undefined;

    try {
      log.debug?.(`[PayMCP:Elicitation] starting elicitation loop for paymentId=${paymentId}`);
      const loopResult = await runElicitationLoop(
        extra,
        paymentPromptMessage(paymentUrl, priceInfo.amount, priceInfo.currency),
        provider,
        paymentId,
        paymentUrl,
        5,
        log
      );
      log.debug?.(
        `[PayMCP:Elicitation] elicitation loop returned action=${loopResult.action} status=${loopResult.status}`
      );
      userAction = loopResult.action;
      paymentStatus = loopResult.status;
    } catch (err) {
      log.warn?.(`[PayMCP:Elicitation] elicitation loop error: ${String(err)}`);
      userAction = 'unknown';
    }

    // 3. Double‑check with provider just in case
    log.debug?.(`[PayMCP:Elicitation] provider status check (initial=${paymentStatus ?? 'none'})`);
    if (paymentStatus === undefined || paymentStatus === null || paymentStatus === '') {
      try {
        paymentStatus = await provider.getPaymentStatus(paymentId);
        log.debug?.(
          `[PayMCP:Elicitation] provider.getPaymentStatus(${paymentId}) -> ${paymentStatus}`
        );
        paymentStatus = normalizeStatus(paymentStatus);
      } catch {
        paymentStatus = 'unknown';
      }
    }

    if (paymentStatus === 'unsupported' /* или loopResult.status === "unsupported" */) {
      return {
        content: [
          {
            type: 'text',
            text: 'Client does not support the selected payment flow.',
          },
        ],
        annotations: {
          payment: { status: 'error', reason: 'elicitation_not_supported' },
        },
        status: 'error',
        message: 'Client does not support the selected payment flow.',
      };
    }

    if (normalizeStatus(paymentStatus) === 'paid' || userAction === 'accept') {
      log.info?.(`[PayMCP:Elicitation] payment confirmed; invoking original tool ${toolName}`);
      // Clean up session after successful payment
      await sessionStorage.delete(sessionKey);
      const toolResult = await callOriginal(func, toolArgs, extra);
      // Ensure toolResult has required MCP 'content' field; if not, synthesize text.
      if (!toolResult || !Array.isArray((toolResult as { content?: unknown[] }).content)) {
        return {
          content: [{ type: 'text', text: 'Tool completed after payment.' }],
          annotations: { payment: { status: 'paid', payment_id: paymentId } },
          raw: toolResult,
        };
      }
      // augment annotation
      try {
        (toolResult as { annotations?: Record<string, unknown> }).annotations = {
          ...(toolResult as { annotations?: Record<string, unknown> }).annotations,
          payment: { status: 'paid', payment_id: paymentId },
        };
      } catch {
        /* ignore */
      }
      return toolResult;
    }

    if (normalizeStatus(paymentStatus) === 'canceled' || userAction === 'cancel') {
      log.info?.(
        `[PayMCP:Elicitation] payment canceled by user or provider (status=${paymentStatus}, action=${userAction})`
      );
      // Clean up session on cancellation
      await sessionStorage.delete(sessionKey);
      return {
        content: [{ type: 'text', text: 'Payment canceled by user.' }],
        annotations: { payment: { status: 'canceled', payment_id: paymentId } },
        payment_url: paymentUrl,
        status: 'canceled',
        message: 'Payment canceled by user',
      };
    }

    // Otherwise payment not yet received
    log.info?.(
      `[PayMCP:Elicitation] payment still pending after elicitation attempts; returning pending result.`
    );
    // Return pending status WITHOUT a tool reference
    // Client can retry the original tool if needed
    return {
      content: [
        {
          type: 'text',
          text: 'Payment pending. Please complete payment and try the tool again.',
        },
      ],
      annotations: {
        payment: {
          status: 'pending',
          payment_id: paymentId,
        },
      },
      payment_url: paymentUrl,
      status: 'pending',
      message: 'Payment pending. Please complete payment and try the tool again.',
      payment_id: String(paymentId),
      // No next_step tool - client retries original tool
    };
  }

  return wrapper as unknown as ToolHandler;
};

interface ElicitLoopResult {
  action: 'accept' | 'decline' | 'cancel' | 'unknown';
  status: string; // raw provider status (e.g., paid, pending, canceled)
}

/**
 * Elicitation loop: prompt the user up to N times and poll the provider for status.
 * Returns one of: 'paid' | 'canceled' | 'pending'.
 *
 * Uses extra.sendRequest to send elicitation/create request.
 */
async function runElicitationLoop(
  extra: ToolExtraLike,
  message: string,
  provider: BasePaymentProvider,
  paymentId: string,
  paymentUrl: string,
  maxAttempts = 5,
  log: Logger = console
): Promise<ElicitLoopResult> {
  const RETRY_DELAY_MS = 3000; // 3 seconds between attempts

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Add delay between attempts (except for the first one) to handle ENG-114
    // where users may take 1-2 minutes to approve the payment
    if (attempt > 0) {
      log.debug?.(`[PayMCP:Elicitation] waiting ${RETRY_DELAY_MS}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
    }

    log.debug?.(`[PayMCP:Elicitation] loop attempt=${attempt + 1}/${maxAttempts}`);
    // Send an elicitation/create request. See MCP spec. citeturn1view2
    const req = {
      method: 'elicitation/create',
      params: {
        message,
        paymentId: paymentId,
        paymentUrl: paymentUrl,
        requestedSchema: SimpleActionSchema,
      },
    } as const;
    let elicitation: unknown;
    try {
      elicitation = await (extra.sendRequest
        ? extra.sendRequest(req, Z_ANY) // pass permissive schema; avoids undefined.parse crash
        : Promise.reject(new Error('No sendRequest()')));
    } catch (err: unknown) {
      log.warn?.(
        `[PayMCP:Elicitation] elicitation request failed (attempt=${attempt + 1}): ${String(err)}`
      );
      // fall through: we will still poll provider and possibly retry
      //elicitation = { action: "unknown" };
      if ((err as { code?: number })?.code === -32601 || /Method not found/i.test(String(err))) {
        log.warn?.(`[PayMCP:Elicitation] Returning unsupported error`);
        return { action: 'unknown', status: 'unsupported' };
      }
      return { action: 'unknown', status: normalizeStatus('error') };
    }

    // FastMCP Python returns either top-level `action` or result.action; accept both.
    const action =
      (elicitation && typeof elicitation === 'object'
        ? ((elicitation as { action?: string }).action ??
          (elicitation as { result?: { action?: string } }).result?.action)
        : undefined) ?? 'unknown';
    log.debug?.(`[PayMCP:Elicitation] elicitation response action=${action}`);

    log.debug?.(`Elicitation`, elicitation);

    // Always check provider status after each elicitation exchange.
    const status = await provider.getPaymentStatus(paymentId);
    log.debug?.(`[PayMCP:Elicitation] provider status during loop: ${status}`);

    if (action === 'cancel' || action === 'decline') {
      log.info?.(`[PayMCP:Elicitation] user canceled/declined during elicitation.`);
      return { action: 'cancel', status: normalizeStatus(status) };
    }

    if (normalizeStatus(status) === 'paid') {
      return { action: 'accept', status: 'paid' };
    }

    if (normalizeStatus(status) === 'canceled') {
      return { action: 'cancel', status: 'canceled' };
    }
    // otherwise: pending; fall through to next attempt after delay
  }
  // Exhausted attempts; still not paid.
  return { action: 'unknown', status: 'pending' };
}

/** Safely invoke the original tool handler preserving args. */
async function callOriginal(func: ToolHandler, args: unknown | undefined, extra: ToolExtraLike) {
  if (args !== undefined) {
    return await func(args, extra);
  } else {
    return await func(extra);
  }
}
