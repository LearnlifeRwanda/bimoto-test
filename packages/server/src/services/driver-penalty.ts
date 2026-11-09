// R3-N-4 — graduated driver penalty thresholds.
//
// Called from journey.service.applyCancelAttribution after a
// noShowCount increment lands. Reads the post-increment count and
// applies threshold-triggered consequences:
//   - WARNING_THRESHOLD (3): warning notification only
//   - SUSPENSION_24H_THRESHOLD (5): set User.suspendedUntil = now + 24h
//   - FLAG_THRESHOLD (10): set User.isFlagged + User.flagReason for
//     admin review
//
// Strictly idempotent: thresholds compare >= so subsequent no-shows
// past the same threshold won't re-suspend (existing suspendedUntil
// stands). Push notifications are NOT dispatched here — the function
// returns a DriverPenaltyOutcome so the caller can fire pushes
// AFTER the prisma.$transaction commits.

const WARNING_THRESHOLD = 3;
const SUSPENSION_24H_THRESHOLD = 5;
const SUSPENSION_24H_DURATION_MS = 24 * 60 * 60 * 1000;
const FLAG_THRESHOLD = 10;

// PILOT-GUARD Item 1(a) — same treatment as the scheduled-cancellation
// path: a flag carries the reason it was raised, so /admin/flagged can
// tell a ten-no-show driver from an AML hit without opening the row.
export const NO_SHOW_FLAG_REASON = 'DRIVER_NO_SHOWS_10';

export interface DriverPenaltyOutcome {
  driverId: string;
  newCount: number;
  suspendedUntil: Date | null;
  flagged: boolean;
  warningOnly: boolean;
}

export async function applyDriverPenaltyForNoShow(
  tx: any,
  driverId: string,
  newNoShowCount: number,
): Promise<DriverPenaltyOutcome> {
  const now = new Date();
  if (newNoShowCount >= FLAG_THRESHOLD) {
    await tx.user.update({
      where: { id: driverId },
      data: { isFlagged: true, flagReason: NO_SHOW_FLAG_REASON },
    });
    return {
      driverId,
      newCount: newNoShowCount,
      suspendedUntil: null,
      flagged: true,
      warningOnly: false,
    };
  }
  if (newNoShowCount >= SUSPENSION_24H_THRESHOLD) {
    const until = new Date(now.getTime() + SUSPENSION_24H_DURATION_MS);
    await tx.user.update({
      where: { id: driverId },
      data: { suspendedUntil: until },
    });
    return {
      driverId,
      newCount: newNoShowCount,
      suspendedUntil: until,
      flagged: false,
      warningOnly: false,
    };
  }
  if (newNoShowCount >= WARNING_THRESHOLD) {
    return {
      driverId,
      newCount: newNoShowCount,
      suspendedUntil: null,
      flagged: false,
      warningOnly: true,
    };
  }
  return {
    driverId,
    newCount: newNoShowCount,
    suspendedUntil: null,
    flagged: false,
    warningOnly: false,
  };
}

export const PENALTY_THRESHOLDS = {
  WARNING_THRESHOLD,
  SUSPENSION_24H_THRESHOLD,
  SUSPENSION_24H_DURATION_MS,
  FLAG_THRESHOLD,
} as const;
