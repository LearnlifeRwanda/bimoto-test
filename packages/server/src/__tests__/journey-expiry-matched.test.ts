import { JourneyStatus, EscrowStatus } from '@bimoto/shared';

jest.mock('../prisma', () => {
  const db: any = {
    journey: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
    bid: {
      update: jest.fn(),
    },
    escrow: {
      update: jest.fn(),
    },
    // MONEY-ATOMIC G4 — the EXPIRED stamp and the REFUNDED escrow now share
    // one transaction per journey. The tx handed to the callback is this
    // same object, so every assertion below still reads the same jest.fn
    // call lists.
    $transaction: jest.fn(async (cb: any) => cb(db)),
  };
  return { __esModule: true, default: db };
});

jest.mock('../socket', () => ({
  emitToJourney: jest.fn(),
}));

import prisma from '../prisma';
import { emitToJourney } from '../socket';
import { processJourneyExpiry } from '../jobs/journey-expiry.job';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Journey Expiry Job - MATCHED journeys', () => {
  test('expires stale MATCHED journey and refunds escrow', async () => {
    // No REQUESTED journeys to expire
    (mockPrisma.journey.findMany as jest.Mock)
      .mockResolvedValueOnce([]) // REQUESTED query
      .mockResolvedValueOnce([   // MATCHED query
        {
          id: 'j-matched-1',
          status: JourneyStatus.MATCHED,
          driverId: 'd1',
          updatedAt: new Date(Date.now() - 60 * 60 * 1000), // 1 hour ago
          escrow: {
            id: 'e1',
            journeyId: 'j-matched-1',
            status: EscrowStatus.HELD,
          },
        },
      ]);

    (mockPrisma.journey.update as jest.Mock).mockResolvedValue({
      id: 'j-matched-1',
      status: JourneyStatus.EXPIRED,
    });
    (mockPrisma.escrow.update as jest.Mock).mockResolvedValue({
      id: 'e1',
      status: EscrowStatus.REFUNDED,
    });

    await processJourneyExpiry();

    // Journey should be expired
    expect(mockPrisma.journey.update).toHaveBeenCalledWith({
      where: { id: 'j-matched-1' },
      data: { status: JourneyStatus.EXPIRED },
    });

    // Escrow should be refunded
    expect(mockPrisma.escrow.update).toHaveBeenCalledWith({
      where: { journeyId: 'j-matched-1' },
      data: { status: 'REFUNDED' },
    });

    // Socket event should be emitted with driver_no_show reason
    expect(emitToJourney).toHaveBeenCalledWith('j-matched-1', 'journey-expired', expect.objectContaining({
      journeyId: 'j-matched-1',
      reason: 'driver_no_show',
    }));
  });

  test('does not refund escrow if it is not HELD', async () => {
    (mockPrisma.journey.findMany as jest.Mock)
      .mockResolvedValueOnce([]) // REQUESTED query
      .mockResolvedValueOnce([   // MATCHED query
        {
          id: 'j-matched-2',
          status: JourneyStatus.MATCHED,
          updatedAt: new Date(Date.now() - 60 * 60 * 1000),
          escrow: {
            id: 'e2',
            journeyId: 'j-matched-2',
            status: EscrowStatus.RELEASED,
          },
        },
      ]);

    (mockPrisma.journey.update as jest.Mock).mockResolvedValue({
      id: 'j-matched-2',
      status: JourneyStatus.EXPIRED,
    });

    await processJourneyExpiry();

    // Journey expired but escrow NOT refunded (was already RELEASED)
    expect(mockPrisma.journey.update).toHaveBeenCalled();
    expect(mockPrisma.escrow.update).not.toHaveBeenCalled();
  });

  // MONEY-ATOMIC G4 — D-5. The EXPIRED stamp and the refund were two
  // statements inside a catch that only logged. A failing refund left the
  // journey committed EXPIRED, and the next tick's `status: MATCHED`
  // filter no longer matched it: the customer's money stayed HELD forever.
  // Now the unit rolls back, the journey stays MATCHED, and the next tick
  // retries it.
  test('a failing refund rolls the whole unit back: the journey stays MATCHED, the sweep continues', async () => {
    const committed: any[] = [];
    (mockPrisma.journey.findMany as jest.Mock)
      .mockResolvedValueOnce([]) // REQUESTED query
      .mockResolvedValueOnce([   // MATCHED query
        {
          id: 'j-doomed',
          status: JourneyStatus.MATCHED,
          updatedAt: new Date(Date.now() - 60 * 60 * 1000),
          escrow: { id: 'e-doomed', journeyId: 'j-doomed', status: EscrowStatus.HELD },
        },
        {
          id: 'j-fine',
          status: JourneyStatus.MATCHED,
          updatedAt: new Date(Date.now() - 60 * 60 * 1000),
          escrow: { id: 'e-fine', journeyId: 'j-fine', status: EscrowStatus.HELD },
        },
      ]);

    (mockPrisma.$transaction as jest.Mock).mockImplementation(async (cb: any) => {
      const staged: any[] = [];
      const tx: any = {
        journey: {
          update: async ({ where, data }: any) => {
            staged.push({ model: 'journey', id: where.id, data });
            return { id: where.id, ...data };
          },
        },
        escrow: {
          update: async ({ where, data }: any) => {
            if (where.journeyId === 'j-doomed') {
              throw new Error('refund gateway unreachable');
            }
            staged.push({ model: 'escrow', id: where.journeyId, data });
            return { ...data };
          },
        },
      };
      try {
        const out = await cb(tx);
        committed.push(...staged); // COMMIT
        return out;
      } catch (err) {
        throw err; // ROLLBACK: staged writes are discarded
      }
    });
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});

    await processJourneyExpiry();

    // Nothing at all committed for the doomed journey — no EXPIRED stamp,
    // so the next tick's MATCHED filter still finds it.
    expect(committed.filter((w) => w.id === 'j-doomed')).toHaveLength(0);
    // …and the loop carried on: the next journey expired and refunded.
    expect(committed).toEqual([
      { model: 'journey', id: 'j-fine', data: { status: JourneyStatus.EXPIRED } },
      { model: 'escrow', id: 'j-fine', data: { status: 'REFUNDED' } },
    ]);
    // No journey-expired event for a journey that did not expire.
    expect(emitToJourney).not.toHaveBeenCalledWith('j-doomed', 'journey-expired', expect.anything());
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining('still MATCHED, will retry next tick'),
      expect.any(Error),
    );

    errorLog.mockRestore();
  });
});
