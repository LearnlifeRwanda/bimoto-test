// PAY-TRUTH G2 — the bounded end of 'keep-match'.
//
// A declined charge on the interactive path no longer tears the match
// down: the journey stays MATCHED, the escrow stays FAILED, and the
// customer can charge that same escrow again from the screen they are
// already on (services/escrow.service.ts, ChargeFailureDisposition).
// That is only honest while the customer is still there.
//
// A customer who closes the app after a decline would otherwise leave the
// motari holding a MATCHED journey that will never be paid — a motari
// riding to a pickup for a fare that does not exist is the worst outcome
// this dispatch can produce. So the grace window is bounded: once it
// passes with the escrow still FAILED, this job performs the release the
// interactive path deliberately skipped, and the driver goes back on the
// market.
//
// It is deliberately conservative in both directions:
//   * it only ever touches escrows that are STILL FAILED and journeys
//     that are STILL MATCHED, both re-asserted as update predicates, so a
//     customer who retried successfully is never released out from under
//     their own ride;
//   * it changes no escrow row and writes no audit entry — the escrow is
//     already FAILED and its CHARGE_FAILED entry already records the
//     'keep-match' disposition. Nothing about the money changes here;
//     only the match does.

import * as Sentry from '@sentry/node';
import prisma from '../prisma';
import { EscrowStatus } from '@bimoto/shared';
import { releaseUnpaidMatch } from '../services/escrow.service';
import { withJobLock } from '../services/job-lock';

const TICK_MS = 60 * 1000;

// How long a customer gets to pay again before the motari is released.
// Long enough to top up a MoMo wallet and tap Try again (the reason the
// window exists at all); short enough that a driver who was told "you are
// matched" is not sent across Kigali on a fare nobody has paid for.
export const UNPAID_MATCH_GRACE_MS = 10 * 60 * 1000;

export async function runOnce(now: number = Date.now()): Promise<number> {
  const cutoff = new Date(now - UNPAID_MATCH_GRACE_MS);

  const stranded = await prisma.escrow.findMany({
    where: {
      status: EscrowStatus.FAILED,
      // lastChargeAttemptAt is stamped by createEscrowTx and refreshed by
      // every /initiate attempt, so the window restarts on each try —
      // a customer who is actively retrying is never reaped mid-attempt.
      lastChargeAttemptAt: { lt: cutoff },
      journey: { status: 'MATCHED' },
    },
    select: { id: true, journeyId: true },
  });

  let released = 0;
  for (const escrow of stranded) {
    try {
      if (await releaseUnpaidMatch(escrow.id, escrow.journeyId)) {
        released += 1;
        console.warn(
          `[UNPAID-MATCH] Released journey ${escrow.journeyId} — escrow ${escrow.id} ` +
            `still FAILED after the grace window; the driver is back on the market.`,
        );
      }
    } catch (err) {
      // One stranded row must not block its siblings.
      console.error(`[UNPAID-MATCH] Release failed for escrow ${escrow.id}:`, err);
      if (process.env.SENTRY_DSN) {
        Sentry.captureException(err, { extra: { escrowId: escrow.id } });
      }
    }
  }
  return released;
}

let intervalId: NodeJS.Timeout | null = null;

export function startUnpaidMatchReaperJob(): void {
  console.log(
    `[UNPAID-MATCH] Starting unpaid-match reaper (60s tick, ${
      UNPAID_MATCH_GRACE_MS / 60000
    }min grace)`,
  );
  intervalId = setInterval(() => {
    withJobLock('unpaid-match-reaper.job', () => runOnce()).catch((err) => {
      console.error('[UNPAID-MATCH] Top-level tick failed:', err);
      if (process.env.SENTRY_DSN) Sentry.captureException(err);
    });
  }, TICK_MS);
}

export function stopUnpaidMatchReaperJob(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

export { runOnce as runUnpaidMatchReaperOnce };
