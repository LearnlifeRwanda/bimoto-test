jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    journey: { findMany: jest.fn() },
    driverConflictOverride: { create: jest.fn() },
  },
}));

import {
  findConflictingScheduledRides,
  assertNoBlockingConflict,
  recordConflictOverride,
} from '../services/scheduled-rides/conflict-detection';
import prisma from '../prisma';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

beforeEach(() => jest.clearAllMocks());

describe('scheduled-rides/conflict-detection', () => {
  describe('findConflictingScheduledRides', () => {
    test('queries with ±30min window around proposed scheduledFor', async () => {
      (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue([]);
      const proposed = { scheduledFor: new Date('2026-05-04T14:00:00Z') };
      await findConflictingScheduledRides('d1', proposed);
      const call = (mockPrisma.journey.findMany as jest.Mock).mock.calls[0][0];
      expect(call.where.driverId).toBe('d1');
      const lo = call.where.scheduledFor.gte.getTime();
      const hi = call.where.scheduledFor.lte.getTime();
      expect(hi - lo).toBe(60 * 60 * 1000);
      expect(proposed.scheduledFor.getTime() - lo).toBe(30 * 60 * 1000);
    });

    test('only matches SCHEDULED bookingMode and active statuses', async () => {
      (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue([]);
      const proposed = { scheduledFor: new Date('2026-05-04T14:00:00Z') };
      await findConflictingScheduledRides('d1', proposed);
      const call = (mockPrisma.journey.findMany as jest.Mock).mock.calls[0][0];
      expect(call.where.bookingMode).toBe('SCHEDULED');
      expect(call.where.status.in).toEqual(['SCHEDULED', 'REQUESTED', 'MATCHED']);
    });
  });

  describe('assertNoBlockingConflict', () => {
    test('returns hasConflict false when driver has no overlapping commitments', async () => {
      (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue([]);
      const result = await assertNoBlockingConflict(
        'd1',
        { scheduledFor: new Date('2026-05-04T14:00:00Z') },
      );
      expect(result.hasConflict).toBe(false);
      expect(result.conflictingRides).toEqual([]);
    });

    test('returns hasConflict true with rides when overlapping rides exist', async () => {
      (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue([{ id: 'j1' }, { id: 'j2' }]);
      const result = await assertNoBlockingConflict(
        'd1',
        { scheduledFor: new Date('2026-05-04T14:00:00Z') },
      );
      expect(result.hasConflict).toBe(true);
      expect(result.conflictingRides).toHaveLength(2);
    });

    test('does not throw — soft-block by design', async () => {
      (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue([{ id: 'j1' }]);
      await expect(
        assertNoBlockingConflict('d1', { scheduledFor: new Date() }),
      ).resolves.toBeDefined();
    });
  });

  describe('recordConflictOverride', () => {
    test('creates an override audit row', async () => {
      (mockPrisma.driverConflictOverride.create as jest.Mock).mockResolvedValue({});
      await recordConflictOverride('d1', 'sched1', 'conflict1');
      expect(mockPrisma.driverConflictOverride.create).toHaveBeenCalledWith({
        data: { driverId: 'd1', scheduledRideId: 'sched1', conflictingRideId: 'conflict1' },
      });
    });
  });
});
