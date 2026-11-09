// R3-PAYMENT-CARD-CLIENT — client-side card-charge helper.
//
// Drives the Flutterwave Inline widget for the card-payment bid-accept
// flow: loads the FLW v3 script on demand, opens the checkout widget for
// the escrow created by `POST /api/journeys/:id/accept-bid-card`, and on
// a successful card charge verifies it server-side via
// `POST /api/payments/initiate-card` (which flips the escrow to HELD).
//
// The `settled` guard makes the widget outcome single-shot: FLW can fire
// both `callback` (success) and `onclose` (the customer closing the
// frame afterwards); only the first wins, so the verify POST never
// double-fires. The server's /initiate-card is also idempotent on the
// escrow (already-HELD → 409), so this is belt-and-suspenders.

import { apiFetch } from '../lib/api';
import { useSimulationStore } from '../stores/simulation.store';
import { openSimulatedCardCheckout } from './simulated-card-widget';

export type CardCheckout = {
  escrowId: string;
  txRef: string;
  amount: number;
};

// ---------------------------------------------------------------------------
// PAY-TRUTH G3 — the MoMo retry rail, finally wired.
//
// POST /api/payments/initiate has existed and worked since before the
// pilot and had no client caller anywhere (docs/wiring-map.md:267). It
// takes a FAILED escrow, mints a fresh txRef and charges again against the
// SAME escrow row — the only recovery a journey can have, because
// Escrow.journeyId is unique. What it could never do on its own was
// rescue anything, because the failure path used to tear the match down
// before the customer could reach it (docs/payment-failure-matrix.md R6).
// PAY-TRUTH G2 stopped the teardown; this is the thumb that reaches it.
// ---------------------------------------------------------------------------

/** The gateway's own reason for a decline, as `detail` on the 502 body. */
export type PaymentFailureCode =
  | 'INSUFFICIENT_FUNDS'
  | 'INVALID_WALLET'
  | 'VALIDATION_ERROR'
  | 'TIMEOUT'
  | 'GATEWAY_DOWN'
  | 'NETWORK_ERROR'
  | 'NOT_FOUND'
  | 'VERIFICATION_FAILED'
  | 'AMOUNT_MISMATCH'
  | 'TXID_MISMATCH'
  | 'UNKNOWN';

export class PaymentRetryError extends Error {
  /** HTTP status the retry endpoint answered with. */
  readonly status: number;
  /** Server error code, e.g. 'CHARGE_FAILED' / 'ESCROW_NOT_RETRIABLE'. */
  readonly code: string;
  /** The gateway reason behind a CHARGE_FAILED, when the server sent one. */
  readonly detail: PaymentFailureCode | null;

  constructor(status: number, code: string, detail: string | null) {
    super(`payment retry failed: ${status} ${code}${detail ? ` (${detail})` : ''}`);
    this.name = 'PaymentRetryError';
    this.status = status;
    this.code = code;
    this.detail = (detail as PaymentFailureCode) ?? null;
  }
}

export type RetryMomoResult = {
  /** HELD = the money is held. PENDING = a USSD push is on its way. */
  status: 'HELD' | 'PENDING';
  txRef: string;
  warning?: 'no_gateway_keys' | 'transient_error';
};

/**
 * Charge the customer's Mobile Money again for an escrow that failed.
 *
 * Deliberately does NOT go through `apiErrorFromResponse`: the taxonomy in
 * lib/api.ts collapses a 502 to kind SERVER and drops the body, and the
 * body's `detail` is the only place the gateway says WHY — the difference
 * between "top up your MoMo" and "check the number on your account". The
 * page needs that to name the failure in passenger words.
 */
export async function retryMomoCharge(escrowId: string): Promise<RetryMomoResult> {
  const res = await apiFetch('/api/payments/initiate', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify({ escrowId }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new PaymentRetryError(
      res.status,
      body?.error?.code ?? 'CHARGE_FAILED',
      body?.error?.detail ?? null,
    );
  }

  return res.json();
}

/**
 * Read the escrow's CURRENT status and txRef.
 *
 * Load-bearing for the switch-to-card path: every MoMo retry mints a fresh
 * txRef, and the card widget must charge against whatever reference the
 * escrow holds NOW — `/initiate-card` verifies against `escrow.txRef` and
 * has nothing to verify otherwise. Reading it here is what keeps the two
 * rails from fighting over one escrow.
 */
export async function fetchEscrowStatus(escrowId: string): Promise<{
  status: string;
  txRef: string | null;
  lastUpdatedAt: string;
  // SETTLE-UP G3 — the gateway's own code for the most recent declined
  // charge, read off the escrow's latest CHARGE_FAILED audit entry.
  // Null unless the escrow is FAILED, so a returning customer can be
  // told WHY instead of only THAT.
  failureReason?: string | null;
}> {
  const res = await apiFetch(`/api/payments/${escrowId}/status`, {
    credentials: 'include',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new PaymentRetryError(res.status, body?.error?.code ?? 'ESCROW_STATUS_FAILED', null);
  }
  return res.json();
}

type ChargeWithCardArgs = {
  cardCheckout: CardCheckout;
  customer: { email: string; phone: string; name: string };
  // Fired exactly once, after the widget reports a successful charge and
  // immediately before the server-side verify round-trip — the caller's
  // hook for a "Verifying payment…" signal. Never fired on the cancel /
  // no-tx-id / script-failure paths, which reject before this point.
  onVerifying?: () => void;
};

const FLW_SCRIPT_SRC = 'https://checkout.flutterwave.com/v3.js';

export async function chargeWithCard(
  args: ChargeWithCardArgs,
): Promise<{ status: 'HELD' | 'PENDING' }> {
  // PAY-TRUTH G4 — in simulated mode the checkout is the in-app stand-in,
  // not Flutterwave's. Everything else in this function is untouched: the
  // same promise, the same single-shot `settled` guard, the same verify
  // round-trip against the same endpoint. The point is to exercise this
  // code path, not to route around it — a card path proven by a bypass is
  // not proven at all.
  const simulated = useSimulationStore.getState().paymentsMode === 'simulated';

  // Fail fast with a clear, surfaceable code when the public key was
  // never provisioned for this build — the widget would otherwise throw
  // a confusing internal error. The BidListPage handler maps this to a
  // "use Mobile Money" toast.
  const publicKey = import.meta.env.VITE_FLW_PUBLIC_KEY;
  if (!simulated && !publicKey) {
    throw new Error('CARD_WIDGET_NO_PUBLIC_KEY');
  }

  // 1. Ensure the FLW Inline JS is loaded (idempotent). Skipped in
  //    simulated mode — there is no vendor script to fetch, and a pilot
  //    phone in Kigali must not be made to reach checkout.flutterwave.com
  //    for a payment that is not real.
  if (!simulated) {
    await loadFlwInlineScript();
  }

  // 2. Open the widget and await its outcome.
  const flwTxId = await new Promise<string>((resolve, reject) => {
    let settled = false;
    const checkout = simulated
      ? (openSimulatedCardCheckout as (config: Record<string, unknown>) => void)
      : window.FlutterwaveCheckout;
    if (!checkout) {
      reject(new Error('CARD_WIDGET_SCRIPT_LOAD_FAILED'));
      return;
    }
    checkout({
      public_key: publicKey ?? 'simulated',
      tx_ref: args.cardCheckout.txRef,
      amount: args.cardCheckout.amount,
      currency: 'RWF',
      payment_options: 'card,applepay,googlepay',
      customer: {
        email: args.customer.email,
        phone_number: args.customer.phone,
        name: args.customer.name,
      },
      callback: (resp: { transaction_id?: string | number; tx_id?: string | number }) => {
        if (settled) return;
        settled = true;
        const txId = String(resp?.transaction_id ?? resp?.tx_id ?? '');
        if (!txId) {
          reject(new Error('CARD_WIDGET_NO_TX_ID'));
          return;
        }
        resolve(txId);
      },
      onclose: () => {
        if (settled) return;
        settled = true;
        reject(new Error('CARD_WIDGET_CANCELLED'));
      },
    });
  });

  // 3. Verify the charge server-side; the server flips the escrow to HELD.
  args.onVerifying?.();
  // AUTH-REFRESH G2 — the card widget can sit open for minutes, easily
  // outliving the 15-minute access token; apiFetch refreshes and
  // retries, so the verify never fails on a stale token.
  const verifyRes = await apiFetch(`/api/payments/initiate-card`, {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify({
      escrowId: args.cardCheckout.escrowId,
      flwTxId,
    }),
  });

  if (!verifyRes.ok) {
    const errData = await verifyRes.json().catch(() => ({}));
    throw new Error(errData?.error?.code ?? 'CARD_VERIFY_FAILED');
  }

  const data = await verifyRes.json();
  return { status: data.status };
}

function loadFlwInlineScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.FlutterwaveCheckout) {
      resolve();
      return;
    }
    const existing = document.querySelector(
      `script[src="${FLW_SCRIPT_SRC}"]`,
    );
    if (existing) {
      // Another caller already injected the script; wait for it.
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () =>
        reject(new Error('CARD_WIDGET_SCRIPT_LOAD_FAILED')),
      );
      return;
    }
    const script = document.createElement('script');
    script.src = FLW_SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('CARD_WIDGET_SCRIPT_LOAD_FAILED'));
    document.head.appendChild(script);
  });
}

declare global {
  interface Window {
    FlutterwaveCheckout?: (config: Record<string, unknown>) => void;
  }
}
