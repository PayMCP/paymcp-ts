import { z } from "zod";
import type { ToolExtraLike } from "../types/config.js";
import type { BasePaymentProvider } from "../providers/base.js";
import type { Logger } from "../types/logger.js";
import { normalizeStatus } from "./payment.js";
import { safeReportProgress } from "./progress.js";
import { randomUUID } from 'crypto';

// Used for extra.sendRequest() result validation; accept any response shape.
const Z_ANY = z.any();

/**
 * Minimal "blank" schema: request no structured fields.
 * Many clients (e.g., FastMCP Python) will surface Accept / Decline / Cancel UI only.
 */
const SimpleActionSchema = {
  type: "object",
  properties: {},
  required: [],
} as const;

export interface ElicitLoopResult {
  action: "accept" | "decline" | "cancel" | "unknown";
  status: string; // raw provider status (e.g., paid, pending, canceled)
}

/**
 * Elicitation loop: prompt the user up to N times and poll the provider for status.
 * Returns one of: 'paid' | 'canceled' | 'pending'.
 *
 * Uses extra.sendRequest to send elicitation/create request.
 */
export async function runElicitationLoop(
  extra: ToolExtraLike,
  message: string,
  provider: BasePaymentProvider,
  paymentId: string,
  paymentUrl: string,
  maxAttempts = 5,
  urlMode: Boolean = false,
  log: Logger = console
): Promise<ElicitLoopResult> {
  const signal: AbortSignal | undefined = (extra as any)?.signal;

  // For URL-mode elicitation we need a unique ID per elicitation, per MCP spec.
  const elicitationId = randomUUID();

  const waitWithAbort = async <T>(p: Promise<T>): Promise<T> => {
    if (!signal) return await p;
    if (signal.aborted) {
      log.debug("[PayMCP:Elicitation] aborting", signal)
      throw new Error(signal?.reason || "aborted");
    }

    let cleanup: (() => void) | undefined;
    const abortPromise = new Promise<never>((_, reject) => {
      const onAbort = () => {
        log.debug("[PayMCP:Elicitation] aborting", signal)
        reject(new Error(signal?.reason || "aborted"));
      }
      signal.addEventListener("abort", onAbort, { once: true });
      cleanup = () => signal.removeEventListener("abort", onAbort);
    });

    try {
      return await Promise.race([p, abortPromise]) as T;
    } finally {
      cleanup?.();
    }
  };

  const sendCompleteNotification = async () => {
    try {
      const send = (extra as any)?.sendNotification;
      if (!send) {
        log.debug?.(
          `[PayMCP:Elicitation] no sendNotification available; skipping notifications/elicitation/complete`
        );
        return;
      }

      await send({
        method: "notifications/elicitation/complete",
        params: { elicitationId },
      });
    } catch (err: any) {
      log.warn?.(
        `[PayMCP:Elicitation] failed to send notifications/elicitation/complete: ${String(err)}`
      );
    }
  }

  const waitWithProgressAndAbort = async <T>(p: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setInterval> | undefined;

    const stop = () => {
      if (timer) clearInterval(timer);
      timer = undefined;
    };

    // Start heartbeat immediately and every 3s
    const start = () => {
      safeReportProgress(extra, log, "Waiting for payment confirmation...", 5).catch(() => { });
      timer = setInterval(() => {
        safeReportProgress(extra, log, "Waiting for payment confirmation...", 5).catch(() => { });
      }, 3000);
    };

    start();
    try {
      return await waitWithAbort(p);
    } finally {
      stop();
    }
  };

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    log.debug?.(`[PayMCP:Elicitation] loop attempt=${attempt + 1}/${maxAttempts}`);
    // Send an elicitation/create request. See MCP spec.
    const req = {
      method: "elicitation/create",
      params: {
        message,
        elicitationId,
        ...(urlMode
          ? {
            mode: "url" as const,
            url: paymentUrl,
          }
          : {
            paymentId,
            paymentUrl,
            requestedSchema: SimpleActionSchema,
          }),
      },
    } as const;
    let elicitation: any;
    try {
      elicitation = await waitWithProgressAndAbort(extra.sendRequest
        ? extra.sendRequest(req, Z_ANY) // pass permissive schema; avoids undefined.parse crash
        : Promise.reject(new Error("No sendRequest()")));
    } catch (err: any) {
      if (err instanceof Error && err.message === "aborted") {
        log.warn?.(`[PayMCP:Elicitation] aborted (treating as timeout/pending) during elicitation request.`);
        return { action: "unknown", status: normalizeStatus("pending") };
      }
      if (err?.code === -32001 || /Request timed out/i.test(String(err))) {
        log.warn?.(`[PayMCP:Elicitation] Timeout`);
        return { action: "unknown", status: normalizeStatus("pending")};
      }
      if (err?.code === -32601 || /Method not found/i.test(String(err))) {
        log.warn?.(`[PayMCP:Elicitation] Returning unsupported error`);
        return { action: "unknown", status: "unsupported" };
      }
      log.warn?.(`[PayMCP:Elicitation] elicitation request failed (attempt=${attempt + 1}): ${String(err)}`);
      // fall through: we will still poll provider and possibly retry

      return { action: "unknown", status: normalizeStatus("error") };
    }

    // Some clients (e.g. FastMCP Python) returns either top-level `action` or result.action; accept both.
    const action = (elicitation && typeof elicitation === "object"
      ? (elicitation as any).action ?? (elicitation as any).result?.action
      : undefined) ?? "unknown";
    log.debug?.(`[PayMCP:Elicitation] elicitation response action=${action}`);

    log.debug?.(`Elicitation`, elicitation);

    // Always check provider status after each elicitation exchange.
    let status: string;
    try {
      status = await waitWithAbort(provider.getPaymentStatus(paymentId));
    } catch (err: any) {
      if (err instanceof Error && err.message === "aborted") {
        log.warn?.(`[PayMCP:Elicitation] aborted (treating as timeout/pending) during status check.`);
        return { action: "unknown", status: normalizeStatus("pending") };
      }
      throw err;
    }
    log.debug?.(`[PayMCP:Elicitation] provider status during loop: ${status}`);

    if (action === "cancel" || action === "decline") {
      log.info?.(`[PayMCP:Elicitation] user canceled/declined during elicitation.`);
      return { action: "cancel", status: normalizeStatus(status) };
    }

    if (normalizeStatus(status) === "paid") {
      if (urlMode) await sendCompleteNotification();
      return { action: "accept", status: "paid" };
    }
    // otherwise: pending; fall through to next attempt

  }
  // Exhausted attempts; still not paid.
  return { action: "unknown", status: "pending" };
}
