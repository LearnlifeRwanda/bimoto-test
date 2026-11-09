import prisma from '../../prisma';
import { JourneyStatus, BookingMode, BidStatus } from '@bimoto/shared';

const ETA_BUFFER_MS = 5 * 60 * 1000;

export interface ScheduledJourney {
  id: string;
  scheduledFor: Date | null;
}

export async function pickLowestValidBid(journey: ScheduledJourney): Promise<any | null> {
  if (!journey.scheduledFor) return null;
  const bids = await prisma.bid.findMany({
    where: { journeyId: journey.id, status: BidStatus.PENDING },
    orderBy: { price: 'asc' },
  });
  const now = Date.now();
  const scheduledMs = journey.scheduledFor.getTime();
  for (const bid of bids) {
    const earliestArrival = now + bid.etaMinutes * 60 * 1000;
    if (earliestArrival <= scheduledMs + ETA_BUFFER_MS) {
      return bid;
    }
  }
  return null;
}

export async function executeAutoFallback(
  journey: ScheduledJourney,
): Promise<{ matched: boolean; matchedBid?: any }> {
  const bid = await pickLowestValidBid(journey);
  if (!bid) return { matched: false };

  const journeyRow = await prisma.journey.findUnique({ where: { id: journey.id } });
  if (!journeyRow) return { matched: false };

  await prisma.$transaction(async (tx: any) => {
    await tx.bid.update({
      where: { id: bid.id },
      data: { status: BidStatus.ACCEPTED },
    });
    await tx.bid.updateMany({
      where: { journeyId: journey.id, id: { not: bid.id }, status: BidStatus.PENDING },
      data: { status: BidStatus.DECLINED },
    });
    await tx.journey.update({
      where: { id: journey.id },
      data: {
        status: JourneyStatus.MATCHED,
        driverId: bid.driverId,
        agreedPrice: bid.price,
        matchedAt: new Date(),
      },
    });
  });

  return { matched: true, matchedBid: bid };
}

export function findScheduledJourneysReadyForAutoFallback(now: Date = new Date()) {
  return prisma.journey.findMany({
    where: {
      status: JourneyStatus.REQUESTED,
      bookingMode: BookingMode.SCHEDULED,
      autoFallbackAt: { lte: now },
      driverId: null,
    },
  });
}
