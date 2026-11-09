import { getClient } from './flutterwave-client';
import { assertDialable } from '../../utils/dialable';
import { FlutterwaveError, mapFlwError } from './errors';
import { verifyTransaction, VerifyResult } from './verify';
import { assertAmlCheck } from '../aml';

export interface ChargeMomoInput {
  phone: string;
  amount: number;
  txRef: string;
  narration: string;
  customerEmail?: string;
  // Optional for back-compat with older callers (test fixtures, dev tools);
  // when present, AML hard-cap and soft-flag checks fire before the gateway.
  customerId?: string;
  escrowId?: string;
}

export interface ChargeMomoResult {
  flwTxId: string | null;
  status: 'PENDING' | 'SUCCESS';
  walletNameOnReceipt?: string;
}

interface RawChargeResponse {
  status?: string;
  message?: string;
  data?: {
    id?: number | string;
    status?: string;
    flw_ref?: string;
    customer?: { name?: string };
    meta?: { authorization?: { mode?: string } };
  };
}

export async function chargeMomo(input: ChargeMomoInput): Promise<ChargeMomoResult> {
  // AML hard-cap + soft-flag check fires BEFORE any gateway interaction.
  // Hard breach throws AmlError(403); soft flag is best-effort and proceeds.
  if (input.customerId) {
    await assertAmlCheck({
      userId: input.customerId,
      amount: input.amount,
      action: 'CHARGE',
      escrowId: input.escrowId,
      metadata: { txRef: input.txRef, narration: input.narration },
    });
  }

  // DECRYPT v3 L4 — phone_number receives the USSD push, and the pseudo
  // email below is derived from the same value.
  assertDialable(input.phone, 'chargeMomo.phone_number');

  const flw = getClient();

  const payload = {
    tx_ref: input.txRef,
    order_id: input.txRef,
    amount: String(input.amount),
    currency: 'RWF',
    email: input.customerEmail ?? `${normalisePhone(input.phone)}@bimoto.local`,
    phone_number: input.phone,
    fullname: 'Bimoto Customer',
    narration: input.narration,
  };

  let raw: RawChargeResponse;
  try {
    raw = (await flw.MobileMoney.rwanda(payload)) as RawChargeResponse;
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
  const flwTxId = data.id != null ? String(data.id) : null;
  const remoteStatus = (data.status ?? raw.status ?? 'pending').toLowerCase();
  const status: ChargeMomoResult['status'] =
    remoteStatus === 'successful' || remoteStatus === 'success'
      ? 'SUCCESS'
      : 'PENDING';

  return {
    flwTxId,
    status,
    walletNameOnReceipt: data.customer?.name ?? undefined,
  };
}

function normalisePhone(phone: string): string {
  return phone.replace(/[^0-9]/g, '');
}

// ---------------------------------------------------------------------------
// Card charges (R3-PAYMENT-CARD-SERVER)
//
// Unlike MoMo, the server does NOT initiate a card charge. The customer enters
// their card in the Flutterwave Inline Widget (client-side); the widget charges
// and hands the client an `flwTxId`. The client posts that id here, and the
// server's job is to VERIFY the transaction against the gateway before letting
// the escrow flip to HELD. The server never trusts the client-reported outcome:
// a forged `flwTxId`, a tampered amount, or a mismatched transaction id are all
// rejected before any escrow transition.
// ---------------------------------------------------------------------------

export interface ChargeCardInput {
  // The flwTxId comes from the client widget's success callback.
  flwTxId: string;
  // The reference the client passed to the widget — matches escrow.txRef and is
  // what we verify against on the gateway.
  txRef: string;
  // Expected amount in RWF; we assert the gateway charged exactly this.
  amount: number;
  // Optional for back-compat with older callers; when present, AML hard-cap and
  // soft-flag checks fire before the gateway, same as chargeMomo.
  customerId?: string;
  escrowId?: string;
}

export interface ChargeCardResult {
  flwTxId: string;
  status: 'SUCCESS' | 'PENDING' | 'FAILED';
  // Card brand and last 4 digits for the receipt (when the gateway returns them).
  cardBrand?: string;
  cardLast4?: string;
}

export async function chargeCard(input: ChargeCardInput): Promise<ChargeCardResult> {
  // AML hard-cap + soft-flag check fires BEFORE any gateway interaction, exactly
  // as chargeMomo does. Hard breach throws AmlError(403); soft flag proceeds.
  if (input.customerId) {
    await assertAmlCheck({
      userId: input.customerId,
      amount: input.amount,
      action: 'CHARGE',
      escrowId: input.escrowId,
      metadata: { txRef: input.txRef, flwTxId: input.flwTxId },
    });
  }

  // E2E test escape hatch: when E2E_FAKE_PAYMENTS=1 is set (per the workflow
  // env in .github/workflows/e2e.yml), skip the live FLW gateway verify and
  // return a synthetic SUCCESS. Mirrors the chargeMomo skip pattern used by
  // bid.service.ts to drive escrow PENDING→HELD without real gateway keys.
  // This guard is positioned AFTER the AML check above, so AML regression
  // coverage is preserved end-to-end even under E2E_FAKE_PAYMENTS.
  if (process.env.E2E_FAKE_PAYMENTS === '1') {
    return {
      flwTxId: input.flwTxId,
      status: 'SUCCESS',
      cardBrand: 'VISA',
      cardLast4: '4242',
    };
  }

  // Re-verify with FLW directly. verifyTransaction queries by tx_ref
  // (Transaction.verify_by_tx) and maps the gateway status to a canonical form.
  let verified: VerifyResult;
  try {
    verified = await verifyTransaction(input.txRef);
  } catch (err) {
    throw mapFlwError(err);
  }

  // A NOT_FOUND or FAILED gateway status means the client-reported success is
  // not real — never flip the escrow on the strength of a client-supplied id.
  if (verified.status === 'NOT_FOUND' || verified.status === 'FAILED') {
    throw new FlutterwaveError('VERIFICATION_FAILED', {
      flwReason: `verify returned ${verified.status} for ${input.txRef}`,
      retryable: false,
    });
  }

  if (verified.status === 'PENDING') {
    return {
      flwTxId: verified.flwTxId ?? input.flwTxId,
      status: 'PENDING',
      cardBrand: verified.cardBrand,
      cardLast4: verified.cardLast4,
    };
  }

  // SUCCESS — guard against client tampering before reporting success.
  // 1) Amount: the user could tamper with the widget amount in dev tools.
  if (verified.amount != null && verified.amount !== input.amount) {
    throw new FlutterwaveError('AMOUNT_MISMATCH', {
      flwReason: `expected ${input.amount}, gateway charged ${verified.amount}`,
      retryable: false,
    });
  }
  // 2) Transaction id: the gateway's id for this tx_ref must match the id the
  //    client claims it got from the widget (defends against id forgery).
  if (verified.flwTxId && verified.flwTxId !== input.flwTxId) {
    throw new FlutterwaveError('TXID_MISMATCH', {
      flwReason: `client tx id ${input.flwTxId} != gateway tx id ${verified.flwTxId}`,
      retryable: false,
    });
  }

  return {
    flwTxId: verified.flwTxId ?? input.flwTxId,
    status: 'SUCCESS',
    cardBrand: verified.cardBrand,
    cardLast4: verified.cardLast4,
  };
}
