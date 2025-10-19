/**
 * LIST_CHANGE payment flow implementation.
 *
 * FLOW OVERVIEW:
 * Dynamically changes the exposed MCP toolset by hiding/showing tools:
 * 1. Initial: Only original tool visible (e.g., "generate_mock")
 * 2. Payment initiated: Hide original, show confirm tool, emit list_changed notification
 * 3. Payment completed: Remove confirm, restore original, emit list_changed notification
 *
 * MULTI-USER ISOLATION:
 * Uses per-session HIDDEN_TOOLS Map to maintain independent tool visibility for concurrent users.
 * Session ID from AsyncLocalStorage (via getCurrentSession()) ensures each user sees only their
 * own hidden/visible tools. Without this, User A's payment would hide tools for User B.
 *
 * CONFIRMATION TOOL NAMING:
 * Uses FULL payment ID in tool name: `confirm_{toolName}_{paymentId}`
 * Example: "confirm_generate_mock_mock_paid_abc12345"
 * This differs from TWO_STEP flow which uses generic `confirm_{toolName}_payment`
 *
 * SESSION ID FALLBACK:
 * Falls back to random UUID when getCurrentSession() returns undefined (server doesn't support
 * session tracking). This still provides multi-user isolation by giving each request a unique ID.
 */
import type {
  PaidWrapperFactory,
  ToolResponse,
  PendingArgument
} from '../types/flows.js';
import type { BasePaymentProvider } from '../providers/base.js';
import type { Logger } from '../types/logger.js';
import { getCurrentSession } from '../core/sessionContext.js';

// Storage for pending arguments and hidden tools
// Per-session storage using AsyncLocalStorage for multi-user support
const PENDING_ARGS = new Map<string, PendingArgument>();
const HIDDEN_TOOLS = new Map<string, Map<string, any>>();  // sessionId -> Map<toolName, toolState>
const SESSION_PAYMENTS = new Map<string, string>();  // paymentId -> sessionId
const CONFIRMATION_TOOLS = new Map<string, string>();  // confirmToolName -> sessionId

// Cleanup old pending args after 10 minutes
const CLEANUP_INTERVAL = 10 * 60 * 1000;

export const makePaidWrapper: PaidWrapperFactory = (
  func,
  server,
  provider,
  priceInfo,
  toolName,
  stateStore,
  logger
) => {
  const getLogger = (): Logger | undefined => {
    return logger || (provider as any)?.logger;
  };

  /**
   * Wrapper function that implements LIST_CHANGE flow.
   * Hides original tool, shows confirmation tool, then restores state.
   */
  return async function listChangeWrapper(
    paramsOrExtra?: any,
    maybeExtra?: any
  ): Promise<ToolResponse> {
    const log = getLogger();
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
      // Use FULL payment ID for confirmation tool name
      const confirmName = `confirm_${toolName}_${pidStr}`;

      // Get current session ID from AsyncLocalStorage
      // Fallback to random UUID for unsupported servers (multi-user isolation)
      const sessionId = getCurrentSession() || crypto.randomUUID();

      log?.info?.(`[list_change] Session ${sessionId}: Hiding tool: ${toolName}`);
      log?.info?.(`[list_change] Session ${sessionId}: Registering confirmation tool: ${confirmName}`);

      // Store arguments for later execution
      PENDING_ARGS.set(pidStr, {
        args: toolArgs,
        ts: Date.now()
      });

      // Store payment -> session mapping
      SESSION_PAYMENTS.set(pidStr, sessionId);

      // Store confirmation tool -> session mapping
      CONFIRMATION_TOOLS.set(confirmName, sessionId);

      // STEP 1: Hide the original tool for this session
      // Initialize session's hidden tools map if needed
      if (!HIDDEN_TOOLS.has(sessionId)) {
        HIDDEN_TOOLS.set(sessionId, new Map());
      }
      const sessionHiddenTools = HIDDEN_TOOLS.get(sessionId)!;

      // Store tool state for this session
      if ((server as any)._registeredTools && (server as any)._registeredTools[toolName]) {
        const registeredTool = (server as any)._registeredTools[toolName];
        sessionHiddenTools.set(toolName, { enabled: registeredTool.enabled });
        log?.debug?.(`[list_change] Session ${sessionId}: Stored tool state for ${toolName}`);
      } else if ((server as any).tools && (server as any).tools.has(toolName)) {
        // Fallback for older SDK versions
        const originalTool = (server as any).tools.get(toolName);
        sessionHiddenTools.set(toolName, originalTool);
        log?.debug?.(`[list_change] Session ${sessionId}: Stored tool state for ${toolName} (legacy)`);
      }

      // STEP 2: Register confirmation tool (parameterless, omit inputSchema)
      (server as any).registerTool(
        confirmName,
        {
          title: `Confirm payment for ${toolName}`,
          description: `Confirm payment ${pidStr} and execute ${toolName}()`
        },
        async (_params: any, confirmExtra?: any): Promise<ToolResponse> => {
          log?.info?.(`[list_change_confirm] Confirming payment_id=${pidStr}`);

          // Retrieve stored arguments
          const pendingData = PENDING_ARGS.get(pidStr);
          if (!pendingData) {
            log?.error?.(`[list_change_confirm] No pending args for payment_id=${pidStr}`);
            return {
              content: [{
                type: "text",
                text: `Unknown or expired payment ID: ${pidStr}`
              }]
            };
          }

          try {
            // Check payment status with provider
            const status = await provider.getPaymentStatus(paymentId);
            log?.debug?.(`[list_change_confirm] Payment status: ${status}`);

            if (status !== "paid") {
              return {
                content: [{
                  type: "text",
                  text: `Payment not completed. Status: ${status}\nPayment URL: ${paymentUrl}`
                }]
              };
            }

            // Payment successful - execute original function
            log?.info?.(`[list_change_confirm] Payment confirmed, executing ${toolName}`);

            // Clean up stored arguments
            PENDING_ARGS.delete(pidStr);

            // Execute original tool with stored arguments
            let result: ToolResponse;
            if (hasArgs) {
              result = await func(pendingData.args, confirmExtra || extra);
            } else {
              result = await func(confirmExtra || extra);
            }

            // STEP 3: Restore original tool and remove confirmation tool
            // Get session ID from payment mapping
            const confirmSessionId = SESSION_PAYMENTS.get(pidStr) || 'global';
            log?.info?.(`[list_change] Session ${confirmSessionId}: Restoring tool: ${toolName}`);
            log?.info?.(`[list_change] Session ${confirmSessionId}: Removing confirmation tool: ${confirmName}`);

            // Restore original tool for this session
            const sessionHiddenTools = HIDDEN_TOOLS.get(confirmSessionId);
            if (sessionHiddenTools && sessionHiddenTools.has(toolName)) {
              // Remove from session's hidden tools
              sessionHiddenTools.delete(toolName);
              log?.debug?.(`[list_change] Session ${confirmSessionId}: Restored tool ${toolName}`);

              // Clean up empty session map
              if (sessionHiddenTools.size === 0) {
                HIDDEN_TOOLS.delete(confirmSessionId);
              }
            }

            // Clean up payment -> session mapping
            SESSION_PAYMENTS.delete(pidStr);

            // Clean up confirmation tool -> session mapping
            CONFIRMATION_TOOLS.delete(confirmName);

            // Remove confirmation tool by disabling it
            if ((server as any)._registeredTools && (server as any)._registeredTools[confirmName]) {
              (server as any)._registeredTools[confirmName].enabled = false;
              log?.debug?.(`[list_change] Confirmation tool ${confirmName} disabled`);
              // Also delete it entirely since it's temporary
              delete (server as any)._registeredTools[confirmName];
              log?.debug?.(`[list_change] Confirmation tool ${confirmName} deleted`);
            } else if ((server as any).tools && (server as any).tools.has(confirmName)) {
              // Fallback for older SDK versions
              (server as any).tools.delete(confirmName);
              log?.debug?.(`[list_change] Confirmation tool ${confirmName} removed (legacy)`);
            }

            // STEP 4: Emit tools/list_changed notification
            // Fire-and-forget pattern to avoid blocking the confirmation response
            if ((server as any).sendNotification) {
              (server as any).sendNotification({
                method: "notifications/tools/list_changed"
              }).then(() => {
                log?.debug?.(`[list_change] Emitted tools/list_changed notification`);
              }).catch((err: any) => {
                log?.warn?.(`[list_change] Failed to emit notification: ${err}`);
              });
            }

            return result;

          } catch (error) {
            log?.error?.(`[list_change_confirm] Error checking payment: ${error}`);

            // On error, restore state for this session
            const errorSessionId = SESSION_PAYMENTS.get(pidStr) || 'global';
            const sessionHiddenTools = HIDDEN_TOOLS.get(errorSessionId);
            if (sessionHiddenTools?.has(toolName)) {
              sessionHiddenTools.delete(toolName);
              if (sessionHiddenTools.size === 0) {
                HIDDEN_TOOLS.delete(errorSessionId);
              }
            }
            SESSION_PAYMENTS.delete(pidStr);
            CONFIRMATION_TOOLS.delete(confirmName);

            return {
              content: [{
                type: "text",
                text: `Error confirming payment: ${error instanceof Error ? error.message : String(error)}`
              }]
            };
          }
        }
      );

      // STEP 5: Emit tools/list_changed notification (fire-and-forget)
      if ((server as any).sendNotification) {
        (server as any).sendNotification({
          method: "notifications/tools/list_changed"
        }).then(() => {
          log?.debug?.(`[list_change] Emitted tools/list_changed notification`);
        }).catch((err: any) => {
          log?.warn?.(`[list_change] Failed to emit notification: ${err}`);
        });
      }

      // Prepare response message
      const message = `Please complete payment of ${priceInfo.amount} ${priceInfo.currency} at:\n${paymentUrl}`;

      return {
        content: [{
          type: "text",
          text: `${message}\n\nAfter completing payment, call tool: ${confirmName}`
        }],
        payment_url: paymentUrl,
        payment_id: pidStr,
        next_tool: confirmName
      };

    } catch (error) {
      log?.error?.(`[list_change] Error in payment flow: ${error}`);
      return {
        content: [{
          type: "text",
          text: `Failed to initiate payment: ${error instanceof Error ? error.message : String(error)}`
        }]
      };
    }
  };
};

// Cleanup old pending arguments periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of PENDING_ARGS.entries()) {
    if (now - data.ts > CLEANUP_INTERVAL) {
      PENDING_ARGS.delete(key);
    }
  }
}, CLEANUP_INTERVAL);

// Export for testing and list filtering in PayMCP
export { PENDING_ARGS, HIDDEN_TOOLS, SESSION_PAYMENTS, CONFIRMATION_TOOLS };