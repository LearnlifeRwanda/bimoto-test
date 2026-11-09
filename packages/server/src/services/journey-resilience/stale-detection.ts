import prisma from '../../prisma';
import { JourneyStatus } from '@bimoto/shared';

const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const ASSUMED_AVERAGE_SPEED_KM_PER_HOUR = 20;
const SAFETY_MULTIPLIER = 1.5;
const NO_GPS_HEARTBEAT_WINDOW_MS = 10 * 60 * 1000;

/**
 * Distance-aware stale threshold. Falls back to a fixed 15min floor for
 * very short rides or rides with no estimatedDistance.
 */
export function computeStaleThresholdMs(estimatedDistanceKm: number | null | undefined): number {
  if (estimatedDistanceKm == null || estimatedDistanceKm <= 0) {
    return FIFTEEN_MIN_MS;
  }
  const distanceBasedMs =
    (estimatedDistanceKm / ASSUMED_AVERAGE_SPEED_KM_PER_HOUR) *
    60 *
    60 *
    1000 *
    SAFETY_MULTIPLIER;
  return Math.max(FIFTEEN_MIN_MS, distanceBasedMs);
}

/**
 * Returns IN_PROGRESS journeys whose stale-threshold elapsed AND have no
 * GPS heartbeat in the last NO_GPS_HEARTBEAT_WINDOW_MS.
 */
export async function findStaleInProgressJourneys(now: Date) {
  const fifteenMinAgo = new Date(now.getTime() - FIFTEEN_MIN_MS);
  const heartbeatCutoff = new Date(now.getTime() - NO_GPS_HEARTBEAT_WINDOW_MS);

  const candidates = (await prisma.journey.findMany({
    where: {
      status: JourneyStatus.IN_PROGRESS,
      startedAt: { lt: fifteenMinAgo },
    },
  })) ?? [];

  const stale = [];
  for (const j of candidates) {
    if (!j.startedAt) continue;
    const threshold = computeStaleThresholdMs(j.estimatedDistance ?? null);
    if (now.getTime() - j.startedAt.getTime() < threshold) continue;

    const recentPing = await prisma.gpsPoint.findFirst({
      where: {
        journeyId: j.id,
        timestamp: { gt: heartbeatCutoff },
      },
      select: { id: true },
    });
    if (recentPing) continue;

    stale.push(j);
  }
  return stale;
}

/**
 * Re-checks the journey is still IN_PROGRESS + still stale (race defense),
 * then delegates to journey.service.systemInterruptJourney for the
 * transition + audit + reconciliation-opening side effects.
 */
export async function assertStaleAndInterrupt(journeyId: string): Promise<void> {
  const fresh = await prisma.journey.findUnique({ where: { id: journeyId } });
  if (!fresh || fresh.status !== JourneyStatus.IN_PROGRESS) return;
  if (!fresh.startedAt) return;

  const threshold = computeStaleThresholdMs(fresh.estimatedDistance ?? null);
  if (Date.now() - fresh.startedAt.getTime() < threshold) return;

  const heartbeatCutoff = new Date(Date.now() - NO_GPS_HEARTBEAT_WINDOW_MS);
  const recentPing = await prisma.gpsPoint.findFirst({
    where: { journeyId, timestamp: { gt: heartbeatCutoff } },
    select: { id: true },
  });
  if (recentPing) return;

  // Lazy require avoids circular import with journey.service.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { systemInterruptJourney } = require('../journey.service') as {
    systemInterruptJourney: (id: string, reason: string) => Promise<void>;
  };
  await systemInterruptJourney(journeyId, 'STALE_NO_GPS_HEARTBEAT');
}
