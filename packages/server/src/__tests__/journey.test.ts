import { JourneyStatus } from '@bimoto/shared';

// Mock prisma before importing services
jest.mock('../prisma', () => {
  const journeyCreate = jest.fn();
  const db: any = {
    journey: {
      create: journeyCreate,
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    driverProfile: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    escrow: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    message: {
      create: jest.fn(),
    },
    gpsPoint: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    // R3-LEGS — createJourney now wraps journey.create + legs.createMany
    // in $transaction.
    // MONEY-ATOMIC G2/G3 — confirmJourney, disputeJourney and endJourney
    // now do their writes inside $transaction too, so the tx handed to the
    // callback proxies EVERY model through to the same top-level mocks
    // (same jest.fn instances), and existing assertions on
    // `mockPrisma.journey.update` / `mockPrisma.user.update` keep working
    // unchanged whether the call came from inside a transaction or not.
    $transaction: jest.fn(async (cb: any) => {
      const tx = {
        ...db,
        journey: { ...db.journey, create: journeyCreate },
        leg: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
      };
      return cb(tx);
    }),
  };
  return { __esModule: true, default: db };
});

jest.mock('../services/escrow.service', () => ({
  releaseEscrow: jest.fn().mockResolvedValue({}),
  refundEscrow: jest.fn().mockResolvedValue({}),
  freezeEscrow: jest.fn().mockResolvedValue({}),
  // MONEY-ATOMIC — the tx-accepting variants the journey service now
  // composes instead of the standalones.
  releaseEscrowTx: jest.fn().mockResolvedValue({}),
  freezeEscrowTx: jest.fn().mockResolvedValue({}),
}));

jest.mock('../services/escrow-audit.service', () => ({
  appendAuditEntry: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/journey-validation.service', () => ({
  validateJourneyPlausibility: jest.fn().mockResolvedValue({ valid: true, flags: [] }),
}));

import prisma from '../prisma';
import * as journeyService from '../services/journey.service';
import * as escrowService from '../services/escrow.service';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Journey Service', () => {
  describe('createJourney', () => {
    test('creates a journey with REQUESTED status and increments totalRequests', async () => {
      const mockJourney = {
        id: 'j1',
        customerId: 'c1',
        status: JourneyStatus.REQUESTED,
        type: 'PASSENGER',
        pickupLat: -1.95,
        pickupLng: 29.87,
        pickupName: 'Kigali Heights',
        destinationLat: -1.96,
        destinationLng: 29.88,
        destinationName: 'Kimironko Market',
      };

      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'c1', isFlagged: false });
      (mockPrisma.journey.create as jest.Mock).mockResolvedValue(mockJourney);
      (mockPrisma.user.update as jest.Mock).mockResolvedValue({});

      const result = await journeyService.createJourney('c1', {
        type: 'PASSENGER' as any,
        pickupLat: -1.95,
        pickupLng: 29.87,
        pickupName: 'Kigali Heights',
        destinationLat: -1.96,
        destinationLng: 29.88,
        destinationName: 'Kimironko Market',
        goodsFragile: false,
      });

      expect(result.status).toBe(JourneyStatus.REQUESTED);
      expect(mockPrisma.journey.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { totalRequests: { increment: 1 } },
      });
    });
  });

  describe('startJourney', () => {
    test('transitions MATCHED journey to IN_PROGRESS', async () => {
      (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
        id: 'j1',
        driverId: 'd1',
        status: JourneyStatus.MATCHED,
        pickupLat: -1.95,
        pickupLng: 29.87,
        destinationLat: -1.96,
        destinationLng: 29.88,
      });
      (mockPrisma.journey.update as jest.Mock).mockResolvedValue({
        id: 'j1',
        status: JourneyStatus.IN_PROGRESS,
      });
      (mockPrisma.driverProfile.update as jest.Mock).mockResolvedValue({});

      // Pass coordinates within 1km of pickup
      const result = await journeyService.startJourney('j1', 'd1', -1.9501, 29.8701);

      expect(result.status).toBe(JourneyStatus.IN_PROGRESS);
      expect(mockPrisma.journey.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'j1' },
          data: expect.objectContaining({ status: JourneyStatus.IN_PROGRESS }),
        }),
      );
    });

    test('rejects if driver is not the assigned driver', async () => {
      (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
        id: 'j1',
        driverId: 'd1',
        status: JourneyStatus.MATCHED,
      });

      await expect(journeyService.startJourney('j1', 'wrong-driver', -1.95, 29.87))
        .rejects.toThrow('errors.notAssignedDriver');
    });

    test('rejects if journey not found', async () => {
      (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(journeyService.startJourney('j1', 'd1', -1.95, 29.87))
        .rejects.toThrow('errors.journeyNotFound');
    });
  });

  describe('endJourney', () => {
    test('transitions IN_PROGRESS journey to AWAITING_CONFIRMATION', async () => {
      (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
        id: 'j1',
        driverId: 'd1',
        status: JourneyStatus.IN_PROGRESS,
        type: 'PASSENGER',
        recipientPhone: null,
        destinationLat: -1.96,
        destinationLng: 29.88,
      });
      (mockPrisma.journey.update as jest.Mock).mockResolvedValue({
        id: 'j1',
        status: JourneyStatus.AWAITING_CONFIRMATION,
        type: 'PASSENGER',
        recipientPhone: null,
      });
      (mockPrisma.driverProfile.update as jest.Mock).mockResolvedValue({});

      // Within 2km of destination
      const result = await journeyService.endJourney('j1', 'd1', -1.961, 29.881);

      expect(result.status).toBe(JourneyStatus.AWAITING_CONFIRMATION);
    });

    // MONEY-ATOMIC G3 — D-6. Marking a journey late and incrementing the
    // driver's lateCompletionCount used to be separate statements: a
    // failure between them left the journey flagged lateCompletion while
    // the counter the penalty ladder reads never moved. Neither commits
    // now unless both do.
    test('a failure after the end stamp leaves neither the stamp nor the late counter committed', async () => {
      const committed: any[] = [];
      (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
        id: 'j1',
        driverId: 'd1',
        status: JourneyStatus.IN_PROGRESS,
        type: 'PASSENGER',
        recipientPhone: null,
        startedAt: new Date(Date.now() - 60 * 60 * 1000),
        destinationLat: -1.96,
        destinationLng: 29.88,
      });
      // No recent ping: the GPS-dark path.
      (mockPrisma.gpsPoint.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.$transaction as jest.Mock).mockImplementationOnce(async (cb: any) => {
        const staged: any[] = [];
        const tx: any = {
          journey: {
            update: async ({ data }: any) => {
              staged.push({ model: 'journey', data });
              return { id: 'j1', ...data };
            },
          },
          user: {
            update: async (args: any) => {
              staged.push({ model: 'user', args });
              // The counter write is where it breaks.
              throw new Error('user row locked');
            },
          },
          escrow: { findUnique: jest.fn().mockResolvedValue(null) },
        };
        try {
          const out = await cb(tx);
          committed.push(...staged); // COMMIT
          return out;
        } catch (err) {
          throw err; // ROLLBACK: staged writes are discarded
        }
      });

      // GPS-dark end (no coordinates) is the late path, the one that
      // writes both the lateCompletion stamp and the counter.
      await expect(journeyService.endJourney('j1', 'd1', null, null)).rejects.toThrow(
        'user row locked',
      );

      expect(committed).toHaveLength(0);
      // And nothing outside the transaction ran either — no location
      // refresh, no recipient SMS on a journey that never ended.
      expect(mockPrisma.driverProfile.update).not.toHaveBeenCalled();
    });
  });

  describe('confirmJourney', () => {
    test('transitions AWAITING_CONFIRMATION to COMPLETED and releases escrow', async () => {
      (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
        id: 'j1',
        customerId: 'c1',
        driverId: 'd1',
        status: JourneyStatus.AWAITING_CONFIRMATION,
      });
      (mockPrisma.journey.update as jest.Mock).mockResolvedValue({
        id: 'j1',
        status: JourneyStatus.COMPLETED,
      });
      (mockPrisma.user.update as jest.Mock).mockResolvedValue({});
      (mockPrisma.escrow.findUnique as jest.Mock).mockResolvedValue({
        id: 'e1',
        journeyId: 'j1',
        status: 'HELD',
        amount: 2000,
        driverId: 'd1',
      });

      const result = await journeyService.confirmJourney('j1', 'c1');

      expect(result.status).toBe(JourneyStatus.COMPLETED);
      // MONEY-ATOMIC G2 — the release now joins the confirmation's
      // transaction, so the composed *Tx variant is what gets called.
      expect(escrowService.releaseEscrowTx).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ id: 'e1', journeyId: 'j1' }),
        'c1',
      );
      expect(escrowService.releaseEscrow).not.toHaveBeenCalled();
      // Both customer and driver completedRides incremented
      expect(mockPrisma.user.update).toHaveBeenCalledTimes(2);
    });

    // MONEY-ATOMIC G2 — the defect this dispatch closes. The release used
    // to run after the journey was already stamped COMPLETED in its own
    // committed statement, so a failure in the escrow step left a terminal
    // COMPLETED journey with the money still HELD and no cron that ever
    // revisits a confirmed journey. Now the failure takes the status with
    // it, and the customer can simply confirm again.
    test('a failing escrow release leaves the journey NOT COMPLETED and the escrow HELD', async () => {
      const escrowRow = {
        id: 'e1',
        journeyId: 'j1',
        status: 'HELD',
        amount: 2000,
        driverId: 'd1',
      };
      // Stands in for the database: the transaction callback's writes are
      // only kept if the callback resolves, exactly as a real ROLLBACK.
      const committed: any[] = [];
      let journeyRow: any = {
        id: 'j1',
        customerId: 'c1',
        driverId: 'd1',
        status: JourneyStatus.AWAITING_CONFIRMATION,
      };

      (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue(journeyRow);
      (mockPrisma.escrow.findUnique as jest.Mock).mockResolvedValue(escrowRow);
      (mockPrisma.journey.update as jest.Mock).mockImplementation(async ({ data }: any) => {
        committed.push({ model: 'journey', data });
        return { ...journeyRow, ...data };
      });
      (mockPrisma.user.update as jest.Mock).mockImplementation(async (args: any) => {
        committed.push({ model: 'user', args });
        return {};
      });
      (mockPrisma.$transaction as jest.Mock).mockImplementationOnce(async (cb: any) => {
        const staged: any[] = [];
        const record = (model: string) => async (args: any) => {
          staged.push({ model, args });
          if (model === 'journey') return { ...journeyRow, ...args.data };
          return {};
        };
        const tx: any = {
          journey: { update: record('journey') },
          escrow: { findUnique: jest.fn().mockResolvedValue(escrowRow) },
          user: { update: record('user') },
        };
        try {
          const out = await cb(tx);
          committed.push(...staged); // COMMIT
          return out;
        } catch (err) {
          throw err; // ROLLBACK: staged writes are discarded
        }
      });
      (escrowService.releaseEscrowTx as jest.Mock).mockRejectedValueOnce(
        new Error('payout gateway unreachable'),
      );

      await expect(journeyService.confirmJourney('j1', 'c1')).rejects.toThrow(
        'payout gateway unreachable',
      );

      // Nothing committed: no COMPLETED stamp, no completedRides bumps.
      expect(committed).toHaveLength(0);
      // And the escrow is untouched — still HELD, still releasable on retry.
      expect(escrowRow.status).toBe('HELD');
      expect(journeyRow.status).toBe(JourneyStatus.AWAITING_CONFIRMATION);
    });

    test('rejects if user is not the customer', async () => {
      (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue({
        id: 'j1',
        customerId: 'c1',
        status: JourneyStatus.AWAITING_CONFIRMATION,
      });

      await expect(journeyService.confirmJourney('j1', 'wrong-user'))
        .rejects.toThrow('errors.notJourneyCustomer');
    });
  });
});
