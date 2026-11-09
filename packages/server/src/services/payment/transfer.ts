import { getClient } from './flutterwave-client';
import { FlutterwaveError, mapFlwError } from './errors';
import { assertDialable } from '../../utils/dialable';

export interface TransferToWalletInput {
  phone: string;
  amount: number;
  narration: string;
  reference: string;
}

export interface TransferToWalletResult {
  flwTransferId: string | null;
  status: 'PENDING' | 'SUCCESS';
}

interface RawTransferResponse {
  status?: string;
  message?: string;
  data?: {
    id?: number | string;
    status?: string;
    reference?: string;
  };
}

export async function transferToWallet(
  input: TransferToWalletInput,
): Promise<TransferToWalletResult> {
  // DECRYPT v3 L4 — account_number IS this number. Sending ciphertext
  // here is a payout that can never land; fail before the gateway call so
  // the batch records a cause instead of a provider rejection.
  assertDialable(input.phone, 'transferToWallet.account_number');

  const flw = getClient();

  const payload = {
    account_bank: 'MPS',
    account_number: input.phone,
    amount: input.amount,
    currency: 'RWF',
    narration: input.narration,
    reference: input.reference,
    beneficiary_name: 'Bimoto Driver',
  };

  let raw: RawTransferResponse;
  try {
    raw = (await flw.Transfer.initiate(payload)) as RawTransferResponse;
  } catch (err) {
    throw mapFlwError(err);
  }

  if (!raw || raw.status === 'error') {
    const reason = raw?.message ?? 'transfer initiation failed';
    if (/invalid.*(account|wallet|msisdn|phone)/i.test(reason)) {
      throw new FlutterwaveError('INVALID_WALLET', { flwReason: reason });
    }
    throw new FlutterwaveError('VALIDATION_ERROR', { flwReason: reason });
  }

  const data = raw.data ?? {};
  const remoteStatus = (data.status ?? raw.status ?? 'pending').toLowerCase();
  const status: TransferToWalletResult['status'] =
    remoteStatus === 'successful' || remoteStatus === 'success'
      ? 'SUCCESS'
      : 'PENDING';

  return {
    flwTransferId: data.id != null ? String(data.id) : null,
    status,
  };
}

export interface TransferStatusResult {
  status: 'SUCCESS' | 'FAILED' | 'PENDING';
}

/**
 * Fetches the gateway-side status of an initiated transfer. Used by the
 * payout reconciliation job to settle DriverPayoutBatch rows the webhook
 * never confirmed. Only `data.status` decides the outcome — the response
 * envelope's own `status` ("success") merely means the fetch call worked.
 */
export async function fetchTransferStatus(
  flwTransferId: string,
): Promise<TransferStatusResult> {
  const flw = getClient();

  let raw: RawTransferResponse;
  try {
    raw = (await flw.Transfer.fetch({ id: flwTransferId })) as RawTransferResponse;
  } catch (err) {
    throw mapFlwError(err);
  }

  if (!raw || raw.status === 'error') {
    throw new FlutterwaveError('VALIDATION_ERROR', {
      flwReason: raw?.message ?? 'transfer fetch failed',
    });
  }

  const remoteStatus = (raw.data?.status ?? '').toLowerCase();
  if (remoteStatus === 'successful' || remoteStatus === 'success') {
    return { status: 'SUCCESS' };
  }
  if (remoteStatus === 'failed' || remoteStatus === 'failure' || remoteStatus === 'reversed') {
    return { status: 'FAILED' };
  }
  return { status: 'PENDING' };
}
