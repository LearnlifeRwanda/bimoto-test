import { randomUUID } from 'crypto';
import type { FlwClient } from './flutterwave-client';
import { config } from '../../config';

// PREPROTO-SIM G2 — an in-process FlwClient whose responses are shaped so
// every existing consumer (charge.ts, verify.ts, refund.ts, transfer.ts,
// jobs/reconciliation/gateway-query.ts) takes its SUCCESS path unchanged.
// Only the gateway is faked: escrow transitions, commission math, driver
// credits and payout batches all run the real code against these responses.

function simId(): string {
  return `sim-${randomUUID()}`;
}

// PAY-TRUTH G4 — the simulated gateway can now fail.
//
// Until this dispatch buildSimulatedClient() succeeded unconditionally,
// so under PAYMENTS_MODE=simulated — the mode the Kigali pilot runs in —
// there was no charge failure a tester could produce. That is why every
// row of docs/payment-failure-matrix.md had to be reproduced with an
// out-of-repo harness, and why three APKs shipped with a money path
// exercised only along its happy case.
//
// The faults below are thrown as AXIOS-SHAPED errors, exactly as
// flutterwave-node-v3 surfaces a real gateway refusal, so errors.ts
// mapFlwError classifies them through its real branches
// (INSUFFICIENT_FUNDS / INVALID_WALLET / VALIDATION_ERROR / TIMEOUT /
// GATEWAY_DOWN, and their retryable flags). Nothing above the SDK seam
// is simulated: the routes, the escrow transitions, the audit chain and
// the retry surface all run their production code.
export type SimulatedFailureMode =
  | 'none'
  | 'insufficient_funds'
  | 'invalid_wallet'
  | 'declined'
  | 'timeout'
  | 'gateway_down';

// Initialised from config; overridable in-process so a test can walk the
// whole failure matrix without restarting the server. Production sets it
// once, from the environment, and never touches it again.
let failureMode: SimulatedFailureMode = 'none';
let initialised = false;

function currentMode(): SimulatedFailureMode {
  if (!initialised) {
    failureMode = (config.SIMULATED_FAILURE_MODE ?? 'none') as SimulatedFailureMode;
    initialised = true;
  }
  return failureMode;
}

export function setSimulatedFailureMode(mode: SimulatedFailureMode): void {
  failureMode = mode;
  initialised = true;
}

export function getSimulatedFailureMode(): SimulatedFailureMode {
  return currentMode();
}

function axiosLike(status: number, message: string): Error {
  const err = new Error(`Request failed with status code ${status}`) as Error & {
    response?: { status: number; data: { status: string; message: string } };
  };
  err.response = { status, data: { status: 'error', message } };
  return err;
}

/** Throws the configured fault, or returns for the success path. */
function applyFailureMode(): void {
  switch (currentMode()) {
    case 'insufficient_funds':
      throw axiosLike(400, 'Insufficient funds in customer wallet');
    case 'invalid_wallet':
      throw axiosLike(400, 'Invalid wallet: no such MSISDN');
    case 'declined':
      throw axiosLike(400, 'Transaction declined by provider');
    case 'timeout': {
      const err = new Error('timeout of 30000ms exceeded') as Error & { code?: string };
      err.code = 'ECONNABORTED';
      throw err;
    }
    case 'gateway_down':
      throw axiosLike(503, 'Service Unavailable');
    case 'none':
    default:
      return;
  }
}

export function buildSimulatedClient(): FlwClient {
  return {
    // No server code path calls Charge directly (cards are charged in the
    // client widget and verified server-side via Transaction.verify_by_tx).
    Charge: {},

    MobileMoney: {
      // charge.ts maps data.status 'successful' → SUCCESS and requires a
      // non-null data.id to flip the escrow HELD in-request.
      rwanda: async (payload: { tx_ref?: string }) => {
        applyFailureMode();
        return {
          status: 'success',
          message: 'Simulated MoMo charge approved',
          data: {
            id: simId(),
            status: 'successful',
            tx_ref: payload?.tx_ref,
            flw_ref: simId(),
            customer: { name: 'Simulated Wallet' },
          },
        };
      },
    },

    Transaction: {
      // verify.ts maps this to VerifyResult SUCCESS. `id` and `amount` are
      // DELIBERATELY absent: chargeCard's anti-tamper checks compare them
      // against client-supplied values when present, and a synthetic id or
      // amount here would trip TXID_MISMATCH/AMOUNT_MISMATCH on a charge
      // that never went through a gateway at all.
      verify_by_tx: async ({ tx_ref }: { tx_ref: string }) => {
        // PAY-TRUTH G4 — the CARD rail's failure seam. A card charge is
        // never initiated server-side; the only thing the server does is
        // verify, so a simulated card decline has to surface here. A
        // 'declined' mode answers with a failed transaction (which
        // chargeCard turns into VERIFICATION_FAILED, exactly as a forged
        // or genuinely-failed card would); the transport faults throw.
        if (currentMode() === 'declined') {
          return {
            status: 'success',
            message: 'Simulated transaction verified',
            data: { status: 'failed', tx_ref, customer: { name: 'Simulated Card' } },
          };
        }
        applyFailureMode();
        return {
          status: 'success',
          message: 'Simulated transaction verified',
          data: {
            status: 'successful',
            tx_ref,
            customer: { name: 'Simulated Wallet' },
          },
        };
      },

      refund: async ({ amount }: { id: string; amount: number }) => ({
        status: 'success',
        message: 'Simulated refund completed',
        data: {
          id: simId(),
          status: 'completed',
          amount_refunded: amount,
        },
      }),

      // Reconciliation sweep: simulated charges settle synchronously (the
      // escrow is HELD before the response returns), so the gateway-side
      // ledger the reconciler would cross-check is always empty.
      fetch_multiple_transactions: async () => ({
        status: 'success',
        message: 'Simulated transaction list',
        data: [],
        meta: { page_info: { total_pages: 1, current_page: 1, total: 0 } },
      }),
    },

    Transfer: {
      // transfer.ts maps data.status 'successful' → SUCCESS, so simulated
      // driver payouts clear immediately.
      initiate: async (payload: { reference?: string }) => ({
        status: 'success',
        message: 'Simulated transfer completed',
        data: {
          id: simId(),
          status: 'successful',
          reference: payload?.reference,
        },
      }),

      fetch: async ({ id }: { id: string }) => ({
        status: 'success',
        message: 'Simulated transfer fetched',
        data: { id, status: 'successful' },
      }),
    },
  };
}
