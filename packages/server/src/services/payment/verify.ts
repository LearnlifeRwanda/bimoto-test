import { getClient } from './flutterwave-client';
import { FlutterwaveError, mapFlwError } from './errors';

export type VerifyStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'NOT_FOUND';

export interface VerifyResult {
  status: VerifyStatus;
  amount?: number;
  walletName?: string;
  flwTxId?: string;
  // Present on card transactions — used for the receipt (e.g. "VISA ••4242").
  cardBrand?: string;
  cardLast4?: string;
}

interface RawVerifyResponse {
  status?: string;
  message?: string;
  data?: {
    id?: number | string;
    status?: string;
    amount?: number | string;
    customer?: { name?: string };
    tx_ref?: string;
    // FLW returns card metadata on card charges; absent for MoMo.
    card?: { type?: string; last_4digits?: string };
  };
}

export async function verifyTransaction(txRef: string): Promise<VerifyResult> {
  const flw = getClient();

  let raw: RawVerifyResponse;
  try {
    raw = (await flw.Transaction.verify_by_tx({ tx_ref: txRef })) as RawVerifyResponse;
  } catch (err) {
    const mapped = mapFlwError(err);
    if (mapped.code === 'NOT_FOUND') {
      return { status: 'NOT_FOUND' };
    }
    throw mapped;
  }

  if (!raw || raw.status === 'error') {
    // Flutterwave returns status:"error" with message "No transaction was
    // found for this id" when the tx hasn't reached the gateway yet — treat
    // as NOT_FOUND so the poller can apply its own timeout.
    if (/no transaction/i.test(raw?.message ?? '')) {
      return { status: 'NOT_FOUND' };
    }
    throw new FlutterwaveError('VALIDATION_ERROR', {
      flwReason: raw?.message ?? 'verify failed',
    });
  }

  const data = raw.data ?? {};
  const remoteStatus = (data.status ?? '').toLowerCase();
  const status: VerifyStatus =
    remoteStatus === 'successful' || remoteStatus === 'success'
      ? 'SUCCESS'
      : remoteStatus === 'failed' || remoteStatus === 'cancelled'
      ? 'FAILED'
      : 'PENDING';

  return {
    status,
    amount: data.amount != null ? Number(data.amount) : undefined,
    walletName: data.customer?.name ?? undefined,
    flwTxId: data.id != null ? String(data.id) : undefined,
    cardBrand: data.card?.type ?? undefined,
    cardLast4: data.card?.last_4digits ?? undefined,
  };
}
