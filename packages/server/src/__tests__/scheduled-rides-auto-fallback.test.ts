jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    bid: { findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    journey: { findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn(),
  },
}));

import {
  pickLowestValidBid,
  executeAutoFallback,
  findScheduledJourneysReadyForAutoFallback,
} from '../services/scheduled-rides/auto-fallback';
import prisma from '../prisma';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

beforeEach(() => {
  jest.clearAllMocks();
  (mockPrisma.$transaction as jest.Mock).mockImplementation(async (cb: any) =>
    cb(mockPrisma),
  );
});

describe('scheduled-rides/auto-fallback', () => {
  describe('pickLowestValidBid', () => {
    test('returns lowest-priced bid whose ETA fits before scheduledFor', async () => {
      const future = new Date(Date.now() + 60 * 60 * 1000);
      (mockPrisma.bid.findMany as jest.Mock).mockResolvedValue([
        { id: 'b1', price: 1000, etaMinutes: 10, driverId: 'd1' },
        { id: 'b2', price: 1500, etaMinutes: 20, driverId: 'd2' },
      ]);
      const bid = await pickLowestValidBid({ id: 'j1', scheduledFor: future });
      expect(bid?.id).toBe('b1');
    });

    test('skips bids whose ETA does not fit', async () => {
      const future = new Date(Date.now() + 10 * 60 * 1000);
      (mockPrisma.bid.findMany as jest.Mock).mockResolvedValue([
        { id: 'b1', price: 1000, etaMinutes: 60, driverId: 'd1' },
        { id: 'b2', price: 1500, etaMinutes: 5, driverId: 'd2' },
      ]);
      const bid = await pickLowestValidBid({ id: 'j1', scheduledFor: future });
      expect(bid?.id).toBe('b2');
    });

    test('returns null when no bids exist', async () => {
      (mockPrisma.bid.findMany as jest.Mock).mockResolvedValue([]);
      const bid = await pickLowestValidBid({
        id: 'j1',
        scheduledFor: new Date(Date.now() + 60 * 60 * 1000),
      });
      expect(bid).toBeNull();
    });

    test('returns null when scheduledFor is null', async () => {
      const bid = await pickLowestValidBid({ id: 'j1', scheduledFor: null });
      expect(bid).toBeNull();
    });
  });

  describe('executeAutoFallback', () => {
    test('matches lowest valid bid and transitions journey to MATCHED', async () => {
      const future = new Date(Date.now() + 60 * 60 * 1000);
      (mockPrisma.bid.findMany as jest.Mock).mockResolvedValue([
        { id: 'b1', price: 1000, etaMinutes: 5, driverId: 'd1' },
      ]);
      (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({ id: 'j1' });
      (mockPrisma.bid.update as jest.Mock).mockResolvedValue({});
      (mockPrisma.bid.updateMany as jest.Mock).mockResolvedValue({});
      (mockPrisma.journey.update as jest.Mock).mockResolvedValue({});

      const r = await executeAutoFallback({ id: 'j1', scheduledFor: future });
      expect(r.matched).toBe(true);
      expect(r.matchedBid?.id).toBe('b1');
      expect((mockPrisma.journey.update as jest.Mock).mock.calls[0][0].data.status).toBe('MATCHED');
      expect((mockPrisma.journey.update as jest.Mock).mock.calls[0][0].data.driverId).toBe('d1');
    });

    test('returns matched:false when no valid bid', async () => {
      const future = new Date(Date.now() + 60 * 60 * 1000);
      (mockPrisma.bid.findMany as jest.Mock).mockResolvedValue([]);
      const r = await executeAutoFallback({ id: 'j1', scheduledFor: future });
      expect(r.matched).toBe(false);
    });
  });

  describe('findScheduledJourneysReadyForAutoFallback', () => {
    test('queries REQUESTED + SCHEDULED + autoFallbackAt <= now + driverId null', async () => {
      (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue([]);
      const now = new Date('2026-05-04T13:30:00Z');
      await findScheduledJourneysReadyForAutoFallback(now);
      const call = (mockPrisma.journey.findMany as jest.Mock).mock.calls[0][0];
      expect(call.where.status).toBe('REQUESTED');
      expect(call.where.bookingMode).toBe('SCHEDULED');
      expect(call.where.autoFallbackAt.lte).toEqual(now);
      expect(call.where.driverId).toBeNull();
    });
  });
});
