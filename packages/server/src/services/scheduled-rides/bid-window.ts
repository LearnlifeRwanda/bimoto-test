import prisma from '../../prisma';
import { AppError } from '../../middleware/error-handler';
import { JourneyStatus, BookingMode } from '@bimoto/shared';

export interface BidWindowJourney {
  status: string;
  bookingMode: string | null;
  bidWindowOpensAt: Date | null;
  autoFallbackAt: Date | null;
}

export function isJourneyInBidWindow(journey: BidWindowJourney, now: Date = new Date()): boolean {
  if (journey.bookingMode !== BookingMode.SCHEDULED) return true;
  if (journey.status !== JourneyStatus.REQUESTED) return false;
  if (!journey.bidWindowOpensAt || !journey.autoFallbackAt) return false;
  const t = now.getTime();
  return t >= journey.bidWindowOpensAt.getTime() && t < journey.autoFallbackAt.getTime();
}

export function assertBidWindowOpen(journey: BidWindowJourney, now: Date = new Date()): void {
  if (journey.bookingMode !== BookingMode.SCHEDULED) return;
  if (!journey.bidWindowOpensAt || !journey.autoFallbackAt) {
    throw new AppError(409, 'BID_WINDOW_NOT_OPEN', 'errors.bidWindowNotOpen');
  }
  const t = now.getTime();
  if (journey.status === JourneyStatus.SCHEDULED || t < journey.bidWindowOpensAt.getTime()) {
    throw new AppError(409, 'BID_WINDOW_NOT_YET_OPEN', 'errors.bidWindowNotYetOpen');
  }
  if (t >= journey.autoFallbackAt.getTime()) {
    throw new AppError(409, 'BID_WINDOW_CLOSED', 'errors.bidWindowClosed');
  }
  if (journey.status !== JourneyStatus.REQUESTED) {
    throw new AppError(409, 'BID_WINDOW_NOT_OPEN', 'errors.bidWindowNotOpen');
  }
}

export function findScheduledJourneysReadyForBidWindow(now: Date = new Date()) {
  return prisma.journey.findMany({
    where: {
      status: JourneyStatus.SCHEDULED,
      bookingMode: BookingMode.SCHEDULED,
      bidWindowOpensAt: { lte: now },
    },
  });
}
