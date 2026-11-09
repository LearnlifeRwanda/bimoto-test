jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    journey: { findMany: jest.fn() },
  },
}));

import {
  isJourneyInBidWindow,
  assertBidWindowOpen,
  findScheduledJourneysReadyForBidWindow,
} from '../services/scheduled-rides/bid-window';
import { JourneyStatus, BookingMode } from '@bimoto/shared';
import { AppError } from '../middleware/error-handler';
import prisma from '../prisma';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

beforeEach(() => jest.clearAllMocks());

const scheduledFor = new Date('2026-05-04T14:00:00Z');
const opens = new Date(scheduledFor.getTime() - 60 * 60 * 1000);
const fallback = new Date(scheduledFor.getTime() - 30 * 60 * 1000);

describe('scheduled-rides/bid-window', () => {
  describe('isJourneyInBidWindow', () => {
    test('returns true for IMMEDIATE journeys regardless of timing (no enforcement)', () => {
      const j = {
        status: JourneyStatus.REQUESTED,
        bookingMode: BookingMode.IMMEDIATE,
        bidWindowOpensAt: null,
        autoFallbackAt: null,
      };
      expect(isJourneyInBidWindow(j, new Date())).toBe(true);
    });

    test('returns true when within window for SCHEDULED journey', () => {
      const j = {
        status: JourneyStatus.REQUESTED,
        bookingMode: BookingMode.SCHEDULED,
        bidWindowOpensAt: opens,
        autoFallbackAt: fallback,
      };
      const mid = new Date(opens.getTime() + 10 * 60 * 1000);
      expect(isJourneyInBidWindow(j, mid)).toBe(true);
    });

    test('returns false before window opens', () => {
      const j = {
        status: JourneyStatus.SCHEDULED,
        bookingMode: BookingMode.SCHEDULED,
        bidWindowOpensAt: opens,
        autoFallbackAt: fallback,
      };
      const before = new Date(opens.getTime() - 5 * 60 * 1000);
      expect(isJourneyInBidWindow(j, before)).toBe(false);
    });

    test('returns false at/after autoFallback', () => {
      const j = {
        status: JourneyStatus.REQUESTED,
        bookingMode: BookingMode.SCHEDULED,
        bidWindowOpensAt: opens,
        autoFallbackAt: fallback,
      };
      expect(isJourneyInBidWindow(j, fallback)).toBe(false);
    });
  });

  describe('assertBidWindowOpen', () => {
    test('throws BID_WINDOW_NOT_YET_OPEN before window', () => {
      const j = {
        status: JourneyStatus.SCHEDULED,
        bookingMode: BookingMode.SCHEDULED,
        bidWindowOpensAt: opens,
        autoFallbackAt: fallback,
      };
      const before = new Date(opens.getTime() - 1);
      try {
        assertBidWindowOpen(j, before);
        fail('should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(AppError);
        expect(e.code).toBe('BID_WINDOW_NOT_YET_OPEN');
      }
    });

    test('throws BID_WINDOW_CLOSED at fallback time', () => {
      const j = {
        status: JourneyStatus.REQUESTED,
        bookingMode: BookingMode.SCHEDULED,
        bidWindowOpensAt: opens,
        autoFallbackAt: fallback,
      };
      try {
        assertBidWindowOpen(j, fallback);
        fail('should have thrown');
      } catch (e: any) {
        expect(e.code).toBe('BID_WINDOW_CLOSED');
      }
    });

    test('does not throw within window', () => {
      const j = {
        status: JourneyStatus.REQUESTED,
        bookingMode: BookingMode.SCHEDULED,
        bidWindowOpensAt: opens,
        autoFallbackAt: fallback,
      };
      const mid = new Date(opens.getTime() + 10 * 60 * 1000);
      expect(() => assertBidWindowOpen(j, mid)).not.toThrow();
    });

    test('no-op for IMMEDIATE journeys', () => {
      const j = {
        status: JourneyStatus.REQUESTED,
        bookingMode: BookingMode.IMMEDIATE,
        bidWindowOpensAt: null,
        autoFallbackAt: null,
      };
      expect(() => assertBidWindowOpen(j, new Date())).not.toThrow();
    });
  });

  describe('findScheduledJourneysReadyForBidWindow', () => {
    test('queries SCHEDULED + bidWindowOpensAt <= now', async () => {
      (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue([]);
      await findScheduledJourneysReadyForBidWindow(scheduledFor);
      expect(mockPrisma.journey.findMany).toHaveBeenCalledWith({
        where: {
          status: JourneyStatus.SCHEDULED,
          bookingMode: BookingMode.SCHEDULED,
          bidWindowOpensAt: { lte: scheduledFor },
        },
      });
    });
  });
});
