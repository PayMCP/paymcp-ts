// Normalize diverse provider status strings to canonical values used by PayMCP.
type CanonicalStatus = 'paid' | 'canceled' | 'pending';
export function normalizeStatus(raw: unknown): CanonicalStatus {
  const s = String(raw ?? '').toLowerCase();
  if (
    [
      'paid',
      'succeeded',
      'success',
      'complete',
      'completed',
      'ok',
      'no_payment_required',
      'captured',
      'confirmed',
      'approved',
    ].includes(s)
  ) {
    return 'paid';
  }
  if (
    [
      'canceled',
      'cancelled',
      'void',
      'voided',
      'failed',
      'declined',
      'error',
      'expired',
      'refused',
      'rejected',
    ].includes(s)
  ) {
    return 'canceled';
  }
  return 'pending';
}
