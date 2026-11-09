import * as Sentry from '@sentry/node';
import { queryFlutterwaveTransactions } from './reconciliation/gateway-query';
import { diffGatewayVsLedger } from './reconciliation/ledger-diff';
import { alertOnDrift } from './reconciliation/alert';
import { FlutterwaveError } from '../services/payment';
import { withJobLock } from '../services/job-lock';

const TICK_MS = 6 * 60 * 60 * 1000;
const WINDOW_HOURS = 24;

export async function runReconciliationOnce(now: Date = new Date()): Promise<void> {
  const to = now;
  const from = new Date(to.getTime() - WINDOW_HOURS * 60 * 60 * 1000);
  let gatewayRecords;
  try {
    gatewayRecords = await queryFlutterwaveTransactions({ from, to });
  } catch (err) {
    if (err instanceof FlutterwaveError && err.code === 'NO_KEYS_CONFIGURED') {
      console.log('[RECONCILIATION] no FLW keys configured — skipping');
      return;
    }
    throw err;
  }

  const diff = await diffGatewayVsLedger({ gatewayRecords, since: from });
  console.log(
    `[RECONCILIATION] window=${from.toISOString()}..${to.toISOString()} ` +
      `gatewayRecords=${gatewayRecords.length} matches=${diff.matches} ` +
      `missingLedger=${diff.missingFromLedger.length} ` +
      `missingGateway=${diff.missingFromGateway.length} ` +
      `statusMismatch=${diff.statusMismatch.length}`,
  );
  await alertOnDrift(diff);
}

let intervalId: NodeJS.Timeout | null = null;

export function startReconciliationJob(): void {
  console.log('[RECONCILIATION] Starting gateway reconciliation job (every 6h, 24h window)');
  intervalId = setInterval(() => {
    // withJobLock: only the advisory-lock leader runs the tick when
    // overlapping server processes race (deploy, scale-out).
    withJobLock('reconciliation.job', () => runReconciliationOnce()).catch((err) => {
      console.error('[RECONCILIATION] Top-level tick failed:', err);
      if (process.env.SENTRY_DSN) Sentry.captureException(err);
    });
  }, TICK_MS);
}

export function stopReconciliationJob(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

export function _resetForTests(): void {
  // No internal state — provided for symmetry.
}
