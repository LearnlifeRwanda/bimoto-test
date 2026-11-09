// R3-RECIPIENT-CONFIRM-2 — tests for the auto-confirm-recipient cron.
//
// Validates the filter conditions of processAutoConfirmRecipient:
//   - only GOODS_DROPOFF legs
//   - only COMPLETED legs
//   - only legs older than the 24h cutoff
//   - only legs with a contactPhone (recipient was actually notified)
//   - skips legs already acknowledged
//   - batches updates via updateMany (one DB round-trip regardless of count)
//   - returns the count of auto-confirmed legs

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    // The start function's boot run goes through withJobLock; grant the
    // advisory lock so the tick body executes.
    $transaction: jest.fn(async (cb: any) =>
      cb({ $queryRaw: async () => [{ acquired: true }] }),
    ),
    leg: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  },
}));

import prisma from '../prisma';
import {
  processAutoConfirmRecipient,
  startAutoConfirmRecipientJob,
  stopAutoConfirmRecipientJob,
} from '../jobs/auto-confirm-recipient.job';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

beforeEach(() => {
  jest.clearAllMocks();
  (mockPrisma.leg.findMany as jest.Mock).mockResolvedValue([]);
  (mockPrisma.leg.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
});

afterEach(() => {
  stopAutoConfirmRecipientJob();
});

describe('auto-confirm-recipient.job — R3-RECIPIENT-CONFIRM-2', () => {
  const now = new Date('2026-05-10T12:00:00Z');

  test('builds the findMany filter with the 24h cutoff + GOODS_DROPOFF + COMPLETED + null confirm + non-null contactPhone', async () => {
    (mockPrisma.leg.findMany as jest.Mock).mockResolvedValue([]);
    await processAutoConfirmRecipient(now);

    const filter = (mockPrisma.leg.findMany as jest.Mock).mock.calls[0][0];
    const expectedCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    expect(filter.where.type).toBe('GOODS_DROPOFF');
    expect(filter.where.status).toBe('COMPLETED');
    expect(filter.where.recipientConfirmedAt).toBeNull();
    expect(filter.where.contactPhone).toEqual({ not: null });
    expect(filter.where.completedAt).toEqual({ lt: expectedCutoff, not: null });
  });

  test('stamps legs older than 24h with AUTO_TIMEOUT status', async () => {
    (mockPrisma.leg.findMany as jest.Mock).mockResolvedValue([
      { id: 'leg-a' },
      { id: 'leg-b' },
    ]);
    (mockPrisma.leg.updateMany as jest.Mock).mockResolvedValue({ count: 2 });

    const count = await processAutoConfirmRecipient(now);

    expect(count).toBe(2);
    expect(mockPrisma.leg.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['leg-a', 'leg-b'] } },
      data: {
        recipientConfirmedAt: now,
        recipientConfirmStatus: 'AUTO_TIMEOUT',
      },
    });
  });

  test('returns 0 and skips updateMany when no candidates match', async () => {
    (mockPrisma.leg.findMany as jest.Mock).mockResolvedValue([]);
    const count = await processAutoConfirmRecipient(now);

    expect(count).toBe(0);
    expect(mockPrisma.leg.updateMany).not.toHaveBeenCalled();
  });

  test('batches multiple matches into a single updateMany call', async () => {
    (mockPrisma.leg.findMany as jest.Mock).mockResolvedValue(
      Array.from({ length: 7 }, (_, i) => ({ id: `leg-${i}` })),
    );
    (mockPrisma.leg.updateMany as jest.Mock).mockResolvedValue({ count: 7 });

    const count = await processAutoConfirmRecipient(now);

    expect(count).toBe(7);
    expect(mockPrisma.leg.updateMany).toHaveBeenCalledTimes(1);
  });

  test('startAutoConfirmRecipientJob is idempotent (calling twice does not create two intervals)', () => {
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    startAutoConfirmRecipientJob();
    const callsAfterFirst = setIntervalSpy.mock.calls.length;
    startAutoConfirmRecipientJob();
    const callsAfterSecond = setIntervalSpy.mock.calls.length;

    expect(callsAfterSecond).toBe(callsAfterFirst);
    setIntervalSpy.mockRestore();
  });

  test('stopAutoConfirmRecipientJob clears the interval and allows restart', () => {
    startAutoConfirmRecipientJob();
    stopAutoConfirmRecipientJob();

    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    startAutoConfirmRecipientJob();
    expect(setIntervalSpy).toHaveBeenCalled();
    setIntervalSpy.mockRestore();
  });
});
