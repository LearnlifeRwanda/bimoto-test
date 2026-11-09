import { getClient } from './flutterwave-client';
import { FlutterwaveError, mapFlwError } from './errors';

export interface RefundMomoInput {
  flwTxId: string;
  amount: number;
  escrowId?: string; // optional, for logging/audit context
  reason?: string; // optional, for gateway audit
}

export interface RefundMomoResult {
  flwRefundTxId: string | null;
  status: 'PENDING' | 'SUCCESS';
  gatewayMessage?: string;
}

interface RawRefundResponse {
  status?: string;
  message?: string;
  data?: {
    id?: number | string;
    status?: string;
    amount_refunded?: number;
  };
}

/**
 * Refund a previously-confirmed Flutterwave transaction.
 *
 * Idempotency: Flutterwave's Transaction.refund deduplicates by the
 * source `id` (the original charge's flwTxId). Calling refund twice with
 * the same id returns the existing refund record rather than creating a
 * duplicate, so callers may rely on this for retry safety.
 *
 * Side effects: NONE on the database. This is a pure gateway wrapper —
 * DB state changes are the caller's responsibility (see
 * decide(RESOLVED_REFUND) in journey-reconciliation.ts).
 *
 * Mirrors chargeMomo (./charge.ts) in shape and error handling.
 */
export async function refundMomo(input: RefundMomoInput): Promise<RefundMomoResult> {
  const flw = getClient();

  let raw: RawRefundResponse;
  try {
    raw = (await flw.Transaction.refund({
      id: input.flwTxId,
      amount: input.amount,
    })) as RawRefundResponse;
  } catch (err) {
    throw mapFlwError(err);
  }

  if (!raw || raw.status === 'error') {
    throw new FlutterwaveError('VALIDATION_ERROR', {
      flwReason: raw?.message ?? 'unknown gateway error',
      retryable: false,
    });
  }

  const data = raw.data ?? {};
  const remoteStatus = String(data.status ?? raw.status ?? 'pending').toLowerCase();
  const status: RefundMomoResult['status'] =
    remoteStatus === 'successful' ||
    remoteStatus === 'success' ||
    remoteStatus === 'completed'
      ? 'SUCCESS'
      : 'PENDING';

  return {
    flwRefundTxId: data.id != null ? String(data.id) : null,
    status,
    gatewayMessage: raw.message,
  };
}
