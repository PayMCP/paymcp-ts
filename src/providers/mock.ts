/**
 * Mock Payment Provider for Testing.
 *
 * Provides a flexible mock payment provider that generates payment IDs with
 * embedded status hints, allowing tests to control expected payment behavior
 * without environment variables or setup configuration.
 *
 * Key Features:
 * - Payment IDs include status prefix (e.g., mock_paid_abc123, mock_failed_xyz789)
 * - Status automatically determined from payment_id prefix
 * - No environment variables needed for basic testing
 * - Supports auto-confirm transitions (pending → paid)
 * - Instant failure/success scenarios for comprehensive testing
 *
 * Payment ID Format: mock_{status}_{random_hex}[_{delay_ms}]
 * - Basic: mock_paid_abc123 (immediate "paid" status)
 * - With delay: mock_paid_abc123_2000 (returns "pending" for 2000ms, then "paid")
 *
 * Supported statuses: paid, pending, failed, cancelled, expired, timeout
 */

import { randomUUID } from "crypto";
import { BasePaymentProvider } from "./base.js";
import { type CreatePaymentResult } from "../types/payment.js";
import { type Logger } from "../types/logger.js";

interface MockProviderConfig {
  apiKey?: string;
  logger?: Logger;
  defaultStatus?: string;
  autoConfirm?: boolean;
  confirmDelay?: number;
}

interface PaymentData {
  status: string;
  createdAt: number;
  amount: number;
  currency: string;
  description: string;
  metadata: Record<string, any>;
}

/**
 * Mock payment provider for testing PayMCP flows.
 *
 * Payment IDs are generated with status hints embedded in the ID itself:
 * - Format: mock_{status}_{random_hex}[_{delay_ms}]
 * - Example: mock_paid_abc123 always returns "paid" status
 * - Example: mock_failed_xyz789 always returns "failed" status
 * - Example: mock_paid_abc123_2000 returns "pending" for 2 seconds, then "paid"
 *
 * This design eliminates the need for environment variable configuration
 * in test scenarios, making tests more self-documenting and deterministic.
 *
 * Supported payment statuses:
 * - paid: Instant success
 * - pending: Payment awaiting confirmation
 * - failed: Payment failed
 * - cancelled: User cancelled payment
 * - expired: Payment session expired
 * - timeout: Payment processing timed out
 *
 * Delay simulation (optional):
 * - Append _{milliseconds} to simulate processing time
 * - Payment returns "pending" until delay elapses
 * - Then automatically transitions to target status
 *
 * Configuration (optional, for legacy compatibility):
 * - defaultStatus: Status to use when creating payments (default: "paid")
 * - autoConfirm: Auto-transition pending → paid after delay (default: false)
 * - confirmDelay: Seconds to wait before auto-confirming (default: 0)
 *
 * Environment variables (legacy, optional):
 * - MOCK_PAYMENT_DEFAULT_STATUS: "paid", "pending", "failed", "cancelled", "expired"
 * - MOCK_PAYMENT_AUTO_CONFIRM: "true"/"false"
 * - MOCK_PAYMENT_CONFIRM_DELAY: seconds to wait before auto-confirming
 */
export class MockPaymentProvider extends BasePaymentProvider {
  private payments: Map<string, PaymentData> = new Map();
  private defaultStatus: string;
  private autoConfirm: boolean;
  private confirmDelay: number;

  constructor(config: MockProviderConfig = {}) {
    super(config.apiKey || "mock", config.logger);

    // Configuration
    this.defaultStatus = config.defaultStatus ||
      process.env.MOCK_PAYMENT_DEFAULT_STATUS ||
      "paid";

    this.autoConfirm = config.autoConfirm !== undefined
      ? config.autoConfirm
      : (process.env.MOCK_PAYMENT_AUTO_CONFIRM || "false").toLowerCase() === "true";

    this.confirmDelay = config.confirmDelay !== undefined
      ? config.confirmDelay
      : parseFloat(process.env.MOCK_PAYMENT_CONFIRM_DELAY || "0");

    this.logger?.info?.(
      `MockPaymentProvider initialized: ` +
      `defaultStatus=${this.defaultStatus}, ` +
      `autoConfirm=${this.autoConfirm}, ` +
      `confirmDelay=${this.confirmDelay}`
    );
  }

  /**
   * Create a mock payment with status hint embedded in payment_id.
   *
   * The payment_id format is: mock_{status}_{random_hex}
   * This allows tests to control expected status without environment variables.
   *
   * @param amount - Payment amount
   * @param currency - Currency code (e.g., "USD")
   * @param description - Payment description
   * @returns Object containing paymentId and paymentUrl
   *
   * @example
   * ```typescript
   * const provider = new MockPaymentProvider({ defaultStatus: "paid" });
   * const { paymentId } = await provider.createPayment(1.00, "USD", "test");
   * // paymentId will be like: mock_paid_a1b2c3d4e5f6g7h8
   * ```
   */
  async createPayment(
    amount: number,
    currency: string,
    description: string
  ): Promise<CreatePaymentResult> {
    // Determine initial status
    const initialStatus = this.autoConfirm ? "pending" : this.defaultStatus;

    // Generate payment ID with status prefix hint
    const randomSuffix = randomUUID().replace(/-/g, "").slice(0, 16);
    const paymentId = `mock_${initialStatus}_${randomSuffix}`;

    // Store payment data
    this.payments.set(paymentId, {
      status: initialStatus,
      createdAt: Date.now(),
      amount,
      currency,
      description,
      metadata: {}
    });

    // Generate mock payment URL
    const paymentUrl = `https://mock-payment.local/pay/${paymentId}`;

    this.logger?.info?.(
      `Created mock payment: ${paymentId} ` +
      `($${amount} ${currency}, status=${initialStatus})`
    );

    return { paymentId, paymentUrl };
  }

  /**
   * Get mock payment status with prefix-based hint detection.
   *
   * Priority order:
   * 1. Internal storage (if payment exists and was manually modified)
   * 2. Payment ID prefix hint (mock_{status}_{hex})
   * 3. Unknown payment returns "expired"
   *
   * This allows tests to create deterministic payment statuses by controlling
   * the payment_id prefix without needing environment variable configuration,
   * while still supporting manual status overrides via setPaymentStatus().
   *
   * @param paymentId - Payment identifier (e.g., "mock_paid_abc123" or "mock_abc123")
   * @returns Payment status: "paid", "pending", "failed", "cancelled", "expired", "timeout"
   *
   * @example
   * ```typescript
   * provider.getPaymentStatus("mock_paid_abc123");  // Returns "paid"
   * provider.getPaymentStatus("mock_failed_xyz789");  // Returns "failed"
   * provider.getPaymentStatus("mock_timeout_slow_response");  // Returns "timeout"
   * provider.getPaymentStatus("mock_unknown_id");  // Returns "expired"
   * ```
   */
  async getPaymentStatus(paymentId: string): Promise<string> {
    // If payment exists in storage, use stored status (allows manual overrides)
    const payment = this.payments.get(paymentId);

    if (payment) {
      let currentStatus = payment.status;

      // Handle auto-confirm logic
      if (this.autoConfirm && currentStatus === "pending") {
        const elapsed = (Date.now() - payment.createdAt) / 1000; // Convert to seconds
        if (elapsed >= this.confirmDelay) {
          // Auto-confirm the payment
          payment.status = "paid";
          currentStatus = "paid";
          this.logger?.info?.(`Auto-confirmed payment: ${paymentId}`);
        }
      }

      this.logger?.debug?.(`Payment status check: ${paymentId} = ${currentStatus}`);
      return currentStatus;
    }

    // Parse status hint from payment_id prefix (for external/unknown payment IDs)
    // Format: mock_{status}_{random}[_{delay_ms}]
    if (paymentId.startsWith("mock_")) {
      const parts = paymentId.split("_");
      if (parts.length >= 3) {
        const statusHint = parts[1];  // Extract: mock_paid_xxx -> "paid"
        const validStatuses = ["paid", "pending", "failed", "cancelled", "expired", "timeout"];

        if (validStatuses.includes(statusHint)) {
          // Check for delay specification in last segment
          // Format: mock_paid_abc123_1000 (1000ms delay before returning "paid")
          if (parts.length >= 4 && /^\d+$/.test(parts[parts.length - 1])) {
            const delayMs = parseInt(parts[parts.length - 1], 10);
            const delaySeconds = delayMs / 1000.0;

            // Create temporary payment entry to track timing
            if (!this.payments.has(paymentId)) {
              this.payments.set(paymentId, {
                status: "pending",  // Start as pending
                createdAt: Date.now(),
                amount: 0,
                currency: "USD",
                description: "",
                metadata: { targetStatus: statusHint, delay: delaySeconds }
              });
              this.logger?.debug?.(
                `Created delayed payment: ${paymentId} -> '${statusHint}' after ${delayMs}ms`
              );
            }

            // Check if delay has elapsed
            const payment = this.payments.get(paymentId)!;
            const elapsed = (Date.now() - payment.createdAt) / 1000; // Convert to seconds

            if (elapsed >= delaySeconds) {
              // Delay elapsed, return target status
              payment.status = statusHint;
              this.logger?.debug?.(
                `Delay elapsed for ${paymentId}: returning '${statusHint}'`
              );
              return statusHint;
            } else {
              // Still waiting, return pending
              const remainingMs = Math.round((delaySeconds - elapsed) * 1000);
              this.logger?.debug?.(
                `Delay in progress for ${paymentId}: ${remainingMs}ms remaining`
              );
              return "pending";
            }
          } else {
            // No delay, return status immediately
            this.logger?.debug?.(
              `Payment status from prefix hint: ${paymentId} = ${statusHint}`
            );
            return statusHint;
          }
        }
      }
    }

    // Unknown payment
    this.logger?.warn?.(`Payment not found: ${paymentId}`);
    return "expired";  // Unknown payments treated as expired
  }

  /**
   * Manually set payment status (for testing).
   *
   * @param paymentId - Payment identifier
   * @param status - New status to set
   */
  setPaymentStatus(paymentId: string, status: string): void {
    const payment = this.payments.get(paymentId);

    if (payment) {
      payment.status = status;
      this.logger?.info?.(`Updated payment status: ${paymentId} = ${status}`);
    } else {
      this.logger?.warn?.(`Cannot set status for unknown payment: ${paymentId}`);
    }
  }

  /**
   * Get full payment details (for testing/debugging).
   *
   * @param paymentId - Payment identifier
   * @returns Full payment data object
   */
  getPaymentDetails(paymentId: string): PaymentData | undefined {
    return this.payments.get(paymentId);
  }

  /**
   * Clear all stored payments (for testing).
   */
  clearPayments(): void {
    this.payments.clear();
    this.logger?.info?.("Cleared all mock payments");
  }
}