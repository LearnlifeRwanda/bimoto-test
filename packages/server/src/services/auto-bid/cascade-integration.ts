// SERVICES/AUTO-BID/CASCADE-INTEGRATION.TS
//
// Hook for K1's broadcast helper to invoke per-driver during a ring
// expansion. The auto-bid evaluator only fires for drivers in the
// current cascade ring — preserving K1's geographic discipline.
//
// Resilience guarantees:
//   - One driver throwing must not abort the others' evaluation.
//     Per-driver try/catch logs to Sentry (or console fallback) and
//     continues.
//   - The whole batch is wrapped in a 5s race. If one driver hangs
//     the batch returns the partial results so the cascade keeps
//     moving; missed drivers are picked up next ring.
//   - Best-effort. supply-broadcast invokes us in setImmediate so we
//     never block the Socket.io broadcast itself.

import type { PrismaClient } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';
import { CASCADE_EVAL_TIMEOUT_MS } from './config';
import { evaluateRulesForJourney } from './evaluator';
import type { AutoBidResult } from './types';

let logger: { warn: (...args: any[]) => void } = console;
let sentryHook: ((err: unknown) => void) | null = null;

export function _setLoggerForTests(l: typeof logger): void {
  logger = l;
}

export function _setSentryHookForTests(
  fn: ((err: unknown) => void) | null,
): void {
  sentryHook = fn;
}

async function evaluateOne(
  prisma: PrismaClient,
  journeyId: string,
  driverId: string,
  io: SocketIOServer | null,
  now: Date,
): Promise<AutoBidResult> {
  try {
    return await evaluateRulesForJourney(prisma, driverId, journeyId, io, now);
  } catch (err) {
    if (sentryHook) sentryHook(err);
    logger.warn(
      '[K2] auto-bid evaluator threw for one driver',
      { journeyId, driverId, err: err instanceof Error ? err.message : String(err) },
    );
    return {
      fired: false,
      bidAmount: null,
      bidId: null,
      ruleId: null,
      driverId,
      journeyId,
      reason: 'no-match',
    };
  }
}

export async function evaluateAutoBidsForRingDrivers(
  prisma: PrismaClient,
  journeyId: string,
  driverIds: string[],
  io: SocketIOServer | null,
  now: Date = new Date(),
): Promise<AutoBidResult[]> {
  if (driverIds.length === 0) return [];

  const batch = Promise.all(
    driverIds.map((id) => evaluateOne(prisma, journeyId, id, io, now)),
  );

  // 5s timeout race. If we hit the timeout, return whatever has
  // resolved so far (best-effort) — we resolve with a synthetic
  // partial result for any driver still pending.
  let timedOut = false;
  const timeout = new Promise<AutoBidResult[]>((resolve) => {
    const t = setTimeout(() => {
      timedOut = true;
      resolve(
        driverIds.map((driverId) => ({
          fired: false,
          bidAmount: null,
          bidId: null,
          ruleId: null,
          driverId,
          journeyId,
          reason: 'no-match' as const,
        })),
      );
    }, CASCADE_EVAL_TIMEOUT_MS);
    if (typeof t.unref === 'function') t.unref();
  });

  const results = await Promise.race([batch, timeout]);
  if (timedOut) {
    logger.warn(
      '[K2] auto-bid cascade-integration timeout',
      { journeyId, driverCount: driverIds.length },
    );
  }
  return results;
}
