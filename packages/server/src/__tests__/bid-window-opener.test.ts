jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    journey: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

jest.mock('../socket', () => ({
  emitToJourney: jest.fn(),
}));

import { processBidWindowOpener } from '../jobs/bid-window-opener.job';
import prisma from '../prisma';
import { emitToJourney } from '../socket';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

beforeEach(() => {
  jest.clearAllMocks();
  (mockPrisma.journey.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
});

describe('bid-window-opener job', () => {
  test('opens at exactly 60-min-before scheduledFor', async () => {
    const scheduledFor = new Date('2026-05-04T14:00:00Z');
    const opensAt = new Date(scheduledFor.getTime() - 60 * 60 * 1000);
    const now = new Date(opensAt.getTime());

    (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'j1',
        status: 'SCHEDULED',
        scheduledFor,
        bidWindowOpensAt: opensAt,
        autoFallbackAt: new Date(scheduledFor.getTime() - 30 * 60 * 1000),
      },
    ]);

    const opened = await processBidWindowOpener(now);
    expect(opened).toBe(1);
    expect(mockPrisma.journey.updateMany).toHaveBeenCalledWith({
      where: { id: 'j1', status: 'SCHEDULED' },
      data: { status: 'REQUESTED' },
    });
    expect(emitToJourney).toHaveBeenCalledWith(
      'j1',
      'scheduled-ride-bid-window-opened',
      expect.any(Object),
    );
  });

  test('idempotent: re-running after journey already transitioned is a no-op', async () => {
    (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue([
      { id: 'j1', status: 'REQUESTED', scheduledFor: new Date(), bidWindowOpensAt: new Date(), autoFallbackAt: new Date() },
    ]);
    const opened = await processBidWindowOpener();
    expect(opened).toBe(0);
    expect(mockPrisma.journey.updateMany).not.toHaveBeenCalled();
  });

  test('catches missed windows on restart (multiple journeys ready)', async () => {
    (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue([
      { id: 'j1', status: 'SCHEDULED', scheduledFor: new Date(), bidWindowOpensAt: new Date(), autoFallbackAt: new Date() },
      { id: 'j2', status: 'SCHEDULED', scheduledFor: new Date(), bidWindowOpensAt: new Date(), autoFallbackAt: new Date() },
    ]);
    const opened = await processBidWindowOpener();
    expect(opened).toBe(2);
  });

  test('skips journey if updateMany count is 0 (race-protected)', async () => {
    (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue([
      { id: 'j1', status: 'SCHEDULED', scheduledFor: new Date(), bidWindowOpensAt: new Date(), autoFallbackAt: new Date() },
    ]);
    (mockPrisma.journey.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    const opened = await processBidWindowOpener();
    expect(opened).toBe(0);
    expect(emitToJourney).not.toHaveBeenCalled();
  });

  test('errors per journey do not break the loop', async () => {
    (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue([
      { id: 'j1', status: 'SCHEDULED', scheduledFor: new Date(), bidWindowOpensAt: new Date(), autoFallbackAt: new Date() },
      { id: 'j2', status: 'SCHEDULED', scheduledFor: new Date(), bidWindowOpensAt: new Date(), autoFallbackAt: new Date() },
    ]);
    (mockPrisma.journey.updateMany as jest.Mock)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ count: 1 });
    const opened = await processBidWindowOpener();
    expect(opened).toBe(1);
  });
});
