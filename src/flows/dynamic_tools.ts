/**
 * DYNAMIC_TOOLS flow: dynamically hide/show tools per-session during payment.
 *
 * MCP SDK Compatibility: Patches MCP SDK internals because:
 * 1. SDK has no post-init capability registration API (v1.x)
 * 2. SDK has no dynamic per-session tool filtering hooks (v1.x)
 *
 * Monitor: https://github.com/modelcontextprotocol/typescript-sdk for future APIs.
 * If SDK adds hooks/filters, we can remove patches and use official APIs.
 */
import type { PaidWrapperFactory, ToolHandler } from '../types/flows.js';
import type { McpServerLike } from '../types/mcp.js';
import type { BasePaymentProvider } from '../providers/base.js';
import type { PriceConfig } from '../types/config.js';
import type { Logger } from '../types/logger.js';
import type { StateStore } from '../types/state.js';
import { randomUUID } from 'crypto';

// State: payment_id -> (session_id, args, timestamp)
interface PaymentSession {
  sessionId: string;
  args: any;
  ts: number;
}

const PAYMENTS = new Map<string, PaymentSession>();  // paymentId -> PaymentSession
const HIDDEN_TOOLS = new Map<string, Map<string, any>>();  // sessionId -> {toolName -> state}
const CONFIRMATION_TOOLS = new Map<string, string>();  // confirmToolName -> sessionId

// Cleanup old pending args after 10 minutes
const CLEANUP_INTERVAL = 10 * 60 * 1000;

// Helper: cleanup session's hidden tools
function cleanupSessionTool(sessionId: string, toolName: string) {
  const sessionHidden = HIDDEN_TOOLS.get(sessionId);
  if (sessionHidden) {
    sessionHidden.delete(toolName);
    if (sessionHidden.size === 0) HIDDEN_TOOLS.delete(sessionId);
  }
}

export const makePaidWrapper: PaidWrapperFactory = (
  func: ToolHandler,
  server: McpServerLike,
  provider: BasePaymentProvider,
  priceInfo: PriceConfig,
  toolName: string,
  stateStore: StateStore,
  logger?: Logger
) => {
  async function dynamicToolsWrapper(paramsOrExtra?: any, maybeExtra?: any) {
    const hasArgs = arguments.length === 2;
    const toolArgs = hasArgs ? paramsOrExtra : undefined;
    const extra = hasArgs ? maybeExtra : paramsOrExtra;

    try {
      // Create payment with provider
      const { paymentId, paymentUrl } = await provider.createPayment(
        priceInfo.amount,
        priceInfo.currency,
        `${toolName} execution fee`
      );

      const pidStr = String(paymentId);
      const confirmName = `confirm_${toolName}_${pidStr}`;
      // Get session ID from extra parameter (blustAI suggestion), fallback to random UUID
      const sessionId = extra?.sessionId || randomUUID();

      // Store state: payment session, hide tool, track confirm tool
      PAYMENTS.set(pidStr, {
        sessionId,
        args: toolArgs,
        ts: Date.now()
      });
      CONFIRMATION_TOOLS.set(confirmName, sessionId);

      // Hide tool for this session
      if (!HIDDEN_TOOLS.has(sessionId)) HIDDEN_TOOLS.set(sessionId, new Map());
      const sessionHidden = HIDDEN_TOOLS.get(sessionId)!;

      if ((server as any)._registeredTools?.[toolName]) {
        sessionHidden.set(toolName, { enabled: (server as any)._registeredTools[toolName].enabled });
      } else if ((server as any).tools?.has(toolName)) {
        sessionHidden.set(toolName, (server as any).tools.get(toolName));
      }

      // Register confirmation tool (parameterless, omit inputSchema)
      (server as any).registerTool(
        confirmName,
        {
          title: `Confirm payment for ${toolName}`,
          description: `Confirm payment ${pidStr} and execute ${toolName}()`
        },
        async (_params: any, confirmExtra?: any) => {
          const payment = PAYMENTS.get(pidStr);
          if (!payment) {
            return {
              content: [{
                type: "text",
                text: `Inform user: Payment session ${pidStr} is unknown or has expired. They may need to initiate a new payment.`
              }],
              status: "error",
              message: "Payment session unknown or expired - inform user to start new payment",
              payment_id: pidStr
            };
          }

          try {
            const status = await provider.getPaymentStatus(paymentId);
            if (status !== "paid") {
              return {
                content: [{
                  type: "text",
                  text: `Inform user: Payment not yet completed. Current status: ${status}. Ask them to complete payment at: ${paymentUrl}`
                }],
                status: "error",
                message: `Payment status '${status}' - ask user to complete payment`,
                payment_id: pidStr
              };
            }

            // Execute original, cleanup state
            PAYMENTS.delete(pidStr);
            const result = hasArgs
              ? await func(payment.args, confirmExtra || extra)
              : await func(confirmExtra || extra);

            cleanupSessionTool(payment.sessionId, toolName);

            // Remove confirmation tool
            if ((server as any)._registeredTools?.[confirmName]) {
              delete (server as any)._registeredTools[confirmName];
            } else if ((server as any).tools?.has(confirmName)) {
              (server as any).tools.delete(confirmName);
            }
            CONFIRMATION_TOOLS.delete(confirmName);

            // Emit tools/list_changed notification (fire-and-forget)
            (server as any).sendNotification?.({
              method: "notifications/tools/list_changed"
            }).catch(() => {});

            return result;

          } catch (error) {
            cleanupSessionTool(payment.sessionId, toolName);
            return {
              content: [{
                type: "text",
                text: `Inform user: Unable to confirm payment due to technical error: ${error instanceof Error ? error.message : String(error)}. Ask them to retry or contact support.`
              }],
              status: "error",
              message: "Technical error confirming payment - inform user to retry",
              payment_id: pidStr
            };
          }
        }
      );

      // Emit tools/list_changed notification (fire-and-forget)
      (server as any).sendNotification?.({
        method: "notifications/tools/list_changed"
      }).catch(() => {});

      return {
        content: [{
          type: "text",
          text: `Ask user to complete payment of ${priceInfo.amount} ${priceInfo.currency} at: ${paymentUrl}\n\nAfter completing payment, call tool: ${confirmName}`
        }],
        payment_url: paymentUrl,
        payment_id: pidStr,
        next_tool: confirmName
      };

    } catch (error) {
      return {
        content: [{
          type: "text",
          text: `Inform user: Unable to initiate payment due to technical error: ${error instanceof Error ? error.message : String(error)}. Ask them to retry or contact support.`
        }],
        status: "error",
        message: "Technical error initiating payment - inform user to retry"
      };
    }
  }

  return dynamicToolsWrapper as unknown as ToolHandler;
};

// Cleanup old payments periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of PAYMENTS.entries()) {
    if (now - data.ts > CLEANUP_INTERVAL) PAYMENTS.delete(key);
  }
}, CLEANUP_INTERVAL);

/**
 * Setup: patches server for per-session tool filtering.
 *
 * WHY: MCP SDK has no post-init capability registration API (v1.x).
 * We must patch server.connect to register tools/list handler after connection.
 */
export function setup(server: any): void {
  const originalConnect = server.connect?.bind(server);
  if (!originalConnect || (server.connect as any)._paymcp_dynamic_tools_patched) return;

  server.connect = async function(...args: any[]) {
    const result = await originalConnect(...args);
    patchToolListing(server);
    return result;
  };
  (server.connect as any)._paymcp_dynamic_tools_patched = true;
}

/**
 * Patches tools/list handler to filter per-session hidden tools.
 *
 * WHY: MCP SDK has no API for dynamic per-session tool visibility.
 * We must patch tools/list handler to filter based on session state.
 *
 * SDK PR: COULD submit feature request for list_tools(context) hook/filter.
 * However, this is payment-specific logic. SDK should stay generic.
 * Current approach: well-isolated, documented, testable monkey-patch.
 */
function patchToolListing(server: any): void {
  const handlers = (server.server ?? server)._requestHandlers;
  if (!handlers?.has('tools/list')) return;

  const original = handlers.get('tools/list');
  handlers.set('tools/list', async (request: any, extra: any) => {
    const result = await original(request, extra);
    const sessionId = extra?.sessionId;

    // If no session context, check if there are any hidden tools at all
    if (!sessionId) {
      // If there are no hidden tools or confirmation tools, return as-is
      if (HIDDEN_TOOLS.size === 0 && CONFIRMATION_TOOLS.size === 0) return result;
      // If there ARE hidden tools but no session, don't hide anything (safer)
      return result;
    }

    const sessionHidden = HIDDEN_TOOLS.get(sessionId);
    if (!sessionHidden && !CONFIRMATION_TOOLS.size) return result;

    return {
      ...result,
      tools: result.tools.filter((t: any) =>
        !sessionHidden?.has(t.name) &&
        (!CONFIRMATION_TOOLS.has(t.name) || CONFIRMATION_TOOLS.get(t.name) === sessionId)
      )
    };
  });
}

// Export for testing and list filtering
export { PAYMENTS, HIDDEN_TOOLS, CONFIRMATION_TOOLS };
