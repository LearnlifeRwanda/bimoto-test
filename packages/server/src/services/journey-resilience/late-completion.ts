import prisma from '../../prisma';
import { haversineDistance } from '../../utils/geo';

const DEFAULT_DARK_WINDOW_MS = 10 * 60 * 1000;
const END_PROXIMITY_THRESHOLD_KM = 2.0;

export type LateCompletionVerdict =
  | { accept: true; reason: 'GPS_DARK_PERIOD' | 'NORMAL' }
  | { accept: false; reason: 'TOO_FAR_NOT_DARK' };

/**
 * Returns true when there is no GpsPoint for journeyId with timestamp > now - beforeMs.
 */
export async function wasDriverDarkBefore(
  journeyId: string,
  beforeMs: number = DEFAULT_DARK_WINDOW_MS,
): Promise<boolean> {
  const cutoff = new Date(Date.now() - beforeMs);
  const recent = await prisma.gpsPoint.findFirst({
    where: { journeyId, timestamp: { gt: cutoff } },
    select: { id: true },
  });
  return recent == null;
}

/**
 * Decides whether a driver's End Journey call should be accepted given
 * GPS proximity and a "phone was dark" check. Returns:
 *   - {accept: true, reason: 'NORMAL'} when GPS proximity passes
 *   - {accept: true, reason: 'GPS_DARK_PERIOD'} when the driver phone was
 *     dark for the prior window (and the journey has actually been running
 *     long enough for that to be possible)
 *   - {accept: false, reason: 'TOO_FAR_NOT_DARK'} otherwise
 *
 * If lat/lng are not provided, GPS proximity is skipped and the decision
 * rests on the dark check alone.
 */
export async function assertLateCompletionAcceptable(
  journey: { id: string; destinationLat: number; destinationLng: number; startedAt?: Date | null },
  lat?: number | null,
  lng?: number | null,
): Promise<LateCompletionVerdict> {
  if (lat != null && lng != null) {
    const distance = haversineDistance(lat, lng, journey.destinationLat, journey.destinationLng);
    if (distance <= END_PROXIMITY_THRESHOLD_KM) {
      return { accept: true, reason: 'NORMAL' };
    }
  }

  // Only treat "no recent ping" as a real dark period if the journey has
  // been running long enough that 10+ minutes of darkness is plausible.
  const startedAt = journey.startedAt;
  if (startedAt && Date.now() - startedAt.getTime() >= DEFAULT_DARK_WINDOW_MS) {
    const dark = await wasDriverDarkBefore(journey.id);
    if (dark) return { accept: true, reason: 'GPS_DARK_PERIOD' };
  }

  return { accept: false, reason: 'TOO_FAR_NOT_DARK' };
}

/**
 * Sets Journey.lateCompletion=true. Accepts an optional Prisma client
 * (transaction or default) so the caller can roll the write into the same
 * transaction as the END_JOURNEY status change.
 */
export async function markJourneyLateCompletion(
  journeyId: string,
  client: any = prisma,
): Promise<void> {
  await client.journey.update({
    where: { id: journeyId },
    data: { lateCompletion: true },
  });
}
