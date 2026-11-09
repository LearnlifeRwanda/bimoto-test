// SERVICES/CUSTOMER-MODES/SUGGEST-UP-SCHEDULER.TS
//
// Dispatch K3 — schedules Socket.io 'suggest-up:available' emits at
// the configured tier thresholds (T1=60s, T2=120s) after journey
// creation. Cancellable via cancelSuggestUpEmits when the journey
// transitions to MATCHED (auto-accept fired or customer manually
// accepted).
//
// V1 deliberately uses in-process setTimeout (mirroring K1's
// supply-broadcast pattern). On server restart, in-flight timers are
// lost — acceptable because:
//   - The customer can always POST /api/journeys/:id/suggest-up
//     manually within the cascade window.
//   - The cascade runs ~6 minutes worst-case so the impact window is
//     small.
//   - V2 may move this to a cron-driven scheduler.
//
// Each emit re-checks the journey's current status before sending —
// guards against the race where journey went MATCHED between the
// timer firing and the emit landing.

import type { PrismaClient } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';
import { SOCKET_EVENTS } from '@bimoto/shared';
import {
  SUGGEST_UP_TIER_1_AT_SECONDS,
  SUGGEST_UP_TIER_2_AT_SECONDS,
  SUGGEST_UP_TIER_1_AMOUNT_RWF,
  SUGGEST_UP_TIER_2_AMOUNT_RWF,
} from './config';

interface ScheduledEntry {
  timers: NodeJS.Timeout[];
}

const scheduledTimers = new Map<string, ScheduledEntry>();

async function safeEmitTier(
  prisma: PrismaClient,
  io: SocketIOServer | null,
  journeyId: string,
  customerId: string,
  amounts: number[],
): Promise<void> {
  // Re-check status before emitting. Guards the race where the
  // journey already MATCHED (auto-accepted or manual) between the
  // timer arming and now.
  let journey: { status: string; suggestUpCount: number } | null = null;
  try {
    journey = await prisma.journey.findUnique({
      where: { id: journeyId },
      select: { status: true, suggestUpCount: true },
    });
  } catch (err) {
    console.warn('[K3] suggest-up-scheduler-status-check-failed', {
      journeyId,
      err: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  if (!journey || journey.status !== 'REQUESTED') {
    return;
  }
  if (io) {
    io.to(`user:${customerId}`).emit(SOCKET_EVENTS.SUGGEST_UP_AVAILABLE, {
      journeyId,
      amounts,
      alreadyTakenCount: journey.suggestUpCount ?? 0,
    });
  }
}

export function scheduleSuggestUpEmits(
  journeyId: string,
  customerId: string,
  io: SocketIOServer | null,
  prisma: PrismaClient,
): void {
  // Cancel any pre-existing timers for this journeyId — defensive
  // against re-creation racing with a stale schedule.
  cancelSuggestUpEmits(journeyId);

  const timers: NodeJS.Timeout[] = [];

  const t1 = setTimeout(() => {
    safeEmitTier(prisma, io, journeyId, customerId, [
      SUGGEST_UP_TIER_1_AMOUNT_RWF,
    ]).catch((err) => {
      console.warn('[K3] suggest-up-tier-1-emit-failed', {
        journeyId,
        err: err instanceof Error ? err.message : String(err),
      });
    });
  }, SUGGEST_UP_TIER_1_AT_SECONDS * 1000);
  if (typeof t1.unref === 'function') t1.unref();
  timers.push(t1);

  const t2 = setTimeout(() => {
    safeEmitTier(prisma, io, journeyId, customerId, [
      SUGGEST_UP_TIER_1_AMOUNT_RWF,
      SUGGEST_UP_TIER_2_AMOUNT_RWF,
    ]).catch((err) => {
      console.warn('[K3] suggest-up-tier-2-emit-failed', {
        journeyId,
        err: err instanceof Error ? err.message : String(err),
      });
    });
  }, SUGGEST_UP_TIER_2_AT_SECONDS * 1000);
  if (typeof t2.unref === 'function') t2.unref();
  timers.push(t2);

  scheduledTimers.set(journeyId, { timers });
}

export function cancelSuggestUpEmits(journeyId: string): void {
  const entry = scheduledTimers.get(journeyId);
  if (!entry) return;
  for (const t of entry.timers) clearTimeout(t);
  scheduledTimers.delete(journeyId);
}

export function _resetForTests(): void {
  for (const entry of scheduledTimers.values()) {
    for (const t of entry.timers) clearTimeout(t);
  }
  scheduledTimers.clear();
}

export function _hasScheduledTimersForTests(journeyId: string): boolean {
  return scheduledTimers.has(journeyId);
}
