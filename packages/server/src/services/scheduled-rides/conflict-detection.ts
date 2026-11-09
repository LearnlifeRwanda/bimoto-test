import prisma from '../../prisma';
import { JourneyStatus, BookingMode } from '@bimoto/shared';

const CONFLICT_WINDOW_MS = 30 * 60 * 1000;

export interface ProposedRide {
  scheduledFor: Date;
}

export async function findConflictingScheduledRides(
  driverId: string,
  proposedRide: ProposedRide,
): Promise<any[]> {
  const center = proposedRide.scheduledFor.getTime();
  const lo = new Date(center - CONFLICT_WINDOW_MS);
  const hi = new Date(center + CONFLICT_WINDOW_MS);

  return prisma.journey.findMany({
    where: {
      driverId,
      bookingMode: BookingMode.SCHEDULED,
      status: { in: [JourneyStatus.SCHEDULED, JourneyStatus.REQUESTED, JourneyStatus.MATCHED] },
      scheduledFor: { gte: lo, lte: hi },
    },
  });
}

export async function assertNoBlockingConflict(
  driverId: string,
  proposedRide: ProposedRide,
  _options: { allowOverride: boolean } = { allowOverride: true },
): Promise<{ hasConflict: boolean; conflictingRides: any[] }> {
  const conflictingRides = await findConflictingScheduledRides(driverId, proposedRide);
  return { hasConflict: conflictingRides.length > 0, conflictingRides };
}

export async function recordConflictOverride(
  driverId: string,
  scheduledRideId: string,
  conflictingRideId: string,
): Promise<void> {
  await prisma.driverConflictOverride.create({
    data: { driverId, scheduledRideId, conflictingRideId },
  });
}
