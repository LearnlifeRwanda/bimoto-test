jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    user: { update: jest.fn(), findUnique: jest.fn() },
    journey: { count: jest.fn() },
  },
}));

import {
  bumpScheduledCancellationCount,
  getRecentScheduledCancellations,
  getReputationPenaltyForBidPriority,
  SCHEDULED_CANCEL_FLAG_THRESHOLD,
} from '../services/scheduled-rides/cancellation-reputation';
import prisma from '../prisma';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

beforeEach(() => jest.clearAllMocks());

describe('scheduled-rides/cancellation-reputation', () => {
  describe('bumpScheduledCancellationCount', () => {
    test('increments and returns new count without flagging when under threshold', async () => {
      (mockPrisma.user.update as jest.Mock).mockResolvedValue({ scheduledCancellationCount: 1 });
      (mockPrisma.journey.count as jest.Mock).mockResolvedValue(1);
      const result = await bumpScheduledCancellationCount('u1');
      expect(result.newCount).toBe(1);
      expect(result.isFlagged).toBe(false);
      expect(result.threshold).toBe(SCHEDULED_CANCEL_FLAG_THRESHOLD);
      expect(mockPrisma.user.update).toHaveBeenCalledTimes(1);
    });

    test('flags user when recent cancellations >= threshold', async () => {
      (mockPrisma.user.update as jest.Mock).mockResolvedValue({ scheduledCancellationCount: 5 });
      (mockPrisma.journey.count as jest.Mock).mockResolvedValue(SCHEDULED_CANCEL_FLAG_THRESHOLD);
      const result = await bumpScheduledCancellationCount('u1');
      expect(result.isFlagged).toBe(true);
      expect(mockPrisma.user.update).toHaveBeenCalledTimes(2);
      expect((mockPrisma.user.update as jest.Mock).mock.calls[1][0].data.isFlagged).toBe(true);
    });
  });

  describe('getRecentScheduledCancellations', () => {
    test('counts cancellations in the rolling window', async () => {
      (mockPrisma.journey.count as jest.Mock).mockResolvedValue(2);
      const r = await getRecentScheduledCancellations('u1', 7);
      expect(r).toBe(2);
      const call = (mockPrisma.journey.count as jest.Mock).mock.calls[0][0];
      expect(call.where.customerId).toBe('u1');
      expect(call.where.bookingMode).toBe('SCHEDULED');
      expect(call.where.status).toBe('CANCELLED');
      expect(call.where.updatedAt.gte).toBeInstanceOf(Date);
    });
  });

  describe('getReputationPenaltyForBidPriority', () => {
    test('returns 1.0 for non-flagged users', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({ isFlagged: false });
      expect(await getReputationPenaltyForBidPriority('u1')).toBe(1.0);
    });

    test('returns 0.5 for flagged users', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({ isFlagged: true });
      expect(await getReputationPenaltyForBidPriority('u1')).toBe(0.5);
    });

    test('returns 1.0 if user not found', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      expect(await getReputationPenaltyForBidPriority('u1')).toBe(1.0);
    });
  });
});
