// R3-N-1 — per-reason cancel attribution + validation tests.
//
// Verifies:
//   - default reason (no body) increments customer.cancellationCount
//   - DRIVER_NO_SHOW from customer increments driver.noShowCount only,
//     leaving customer.cancellationCount untouched (the dispatch's
//     primary user-stated requirement)
//   - elapsed-time gates reject too-early calls
//   - startedAt-set rejects DRIVER_NO_SHOW
//   - wrong-caller-for-reason returns 403
//   - DRIVER_LATE applies +0.5 to both parties' lateMarkCount
//   - DRIVER_WRONG_VEHICLE increments wrongVehicleCount
//   - SAFETY_CONCERN stores reason but applies no counters
//   - CUSTOMER_NO_SHOW from driver attributes to customer.noShowCount
//   - DRIVER_CAN_NOT_MAKE_IT increments driverInitiatedCancellationCount
//   - BOTH_NO_SHOW from a user is rejected (system-only)
//   - cancelledAt + cancelReason are persisted on Journey

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    journey: { findUnique: jest.fn(), update: jest.fn() },
    user: { update: jest.fn() },
    $transaction: jest.fn(),
  },
}));

// SENDER-MATCH-2 — the refund now JOINS the cancellation transaction via the
// tx-accepting variant (#184's *Tx pattern) instead of committing ahead of it
// in a transaction of its own. This mock gained refundEscrowTx; refundEscrow
// stays declared so its absence from the call log is itself an assertion.
jest.mock('../services/escrow.service', () => ({
  refundEscrow: jest.fn().mockResolvedValue({}),
  refundEscrowTx: jest.fn().mockResolvedValue({}),
}));

jest.mock('../services/scheduled-rides', () => ({
  bumpScheduledCancellationCount: jest.fn().mockResolvedValue({}),
  validateScheduledFor: jest.fn(),
  validatePickupCoords: jest.fn(),
  computeBidWindowTimes: jest.fn(),
}));

jest.mock('../services/journey-state-transitions', () => ({
  onJourneyExitsRequested: jest.fn(),
}));

jest.mock('../config', () => ({
  config: {
    DATABASE_URL: 'test',
    JWT_SECRET: 'test-jwt-secret-at-least-16-chars',
    JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-16-chars',
    ENCRYPTION_KEY: 'a'.repeat(64),
    PORT: 3000,
    CLIENT_URL: 'http://localhost:5173',
    NODE_ENV: 'test',
    SKIP_DRIVER_VERIFICATION: true,
  },
}));

import prisma from '../prisma';
import { CancelReason } from '@prisma/client';
import { cancelJourney } from '../services/journey.service';
import * as escrowService from '../services/escrow.service';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockEscrow = escrowService as jest.Mocked<typeof escrowService>;

function buildMatchedJourney(
  overrides: Partial<{
    matchedMinutesAgo: number;
    startedAt: Date | null;
    customerId: string;
    driverId: string | null;
    escrow: any;
    bookingMode: string;
  }> = {},
) {
  const matchedMs = (overrides.matchedMinutesAgo ?? 10) * 60 * 1000;
  return {
    id: 'j1',
    customerId: overrides.customerId ?? 'c1',
    driverId: overrides.driverId === undefined ? 'd1' : overrides.driverId,
    status: 'MATCHED',
    bookingMode: overrides.bookingMode ?? 'IMMEDIATE',
    matchedAt: new Date(Date.now() - matchedMs),
    startedAt: overrides.startedAt === undefined ? null : overrides.startedAt,
    escrow: overrides.escrow ?? { id: 'e1' },
  };
}

function setupTxCapture() {
  const userUpdates: any[] = [];
  const journeyUpdates: any[] = [];
  (mockPrisma.$transaction as jest.Mock).mockImplementation(async (fn: any) => {
    const tx = {
      user: { update: jest.fn(async (args: any) => userUpdates.push(args)) },
      journey: {
        update: jest.fn(async (args: any) => {
          journeyUpdates.push(args);
          return { ...args.data, id: 'j1' };
        }),
      },
    };
    return fn(tx);
  });
  return { userUpdates, journeyUpdates };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('cancelJourney — R3-N-1 per-reason attribution', () => {
  test('default reason (no arg) increments caller cancellationCount and refunds escrow', async () => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue(buildMatchedJourney());
    const { userUpdates } = setupTxCapture();

    await cancelJourney('j1', 'c1');

    // SENDER-MATCH-2 — same refund, now inside the transaction: the tx client
    // first, the already-loaded escrow row second, the actor third.
    expect(mockEscrow.refundEscrowTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'e1' }),
      'c1',
    );
    expect(mockEscrow.refundEscrow).not.toHaveBeenCalled();
    expect(userUpdates).toHaveLength(1);
    expect(userUpdates[0]).toEqual({
      where: { id: 'c1' },
      data: { cancellationCount: { increment: 1 } },
    });
  });

  test('DRIVER_NO_SHOW from customer increments driver.noShowCount, NOT customer.cancellationCount', async () => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue(
      buildMatchedJourney({ matchedMinutesAgo: 10 }),
    );
    const { userUpdates } = setupTxCapture();

    await cancelJourney('j1', 'c1', CancelReason.DRIVER_NO_SHOW);

    // R3-N-4 — applyCancelAttribution now reads back the post-increment
    // count via select so the graduated-penalty function can evaluate
    // the threshold ladder atomically.
    expect(userUpdates).toHaveLength(1);
    expect(userUpdates[0]).toEqual({
      where: { id: 'd1' },
      data: { noShowCount: { increment: 1 } },
      select: { noShowCount: true },
    });
    // The customer's cancellation count must NOT be touched.
    expect(userUpdates.some((u) => u.where.id === 'c1')).toBe(false);
  });

  test('DRIVER_NO_SHOW rejects when journey.startedAt is set', async () => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue(
      buildMatchedJourney({ matchedMinutesAgo: 10, startedAt: new Date() }),
    );

    await expect(
      cancelJourney('j1', 'c1', CancelReason.DRIVER_NO_SHOW),
    ).rejects.toMatchObject({ code: 'JOURNEY_STARTED_CANNOT_BE_NO_SHOW' });
  });

  test('DRIVER_NO_SHOW rejects when elapsed < 8 min since matchedAt', async () => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue(
      buildMatchedJourney({ matchedMinutesAgo: 3 }),
    );

    await expect(
      cancelJourney('j1', 'c1', CancelReason.DRIVER_NO_SHOW),
    ).rejects.toMatchObject({ code: 'TOO_EARLY_FOR_NO_SHOW' });
  });

  test('DRIVER_NO_SHOW rejects when caller is the driver (wrong caller)', async () => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue(
      buildMatchedJourney({ matchedMinutesAgo: 10 }),
    );

    await expect(
      cancelJourney('j1', 'd1', CancelReason.DRIVER_NO_SHOW),
    ).rejects.toMatchObject({ code: 'WRONG_CALLER_FOR_REASON', statusCode: 403 });
  });

  test('DRIVER_LATE applies +0.5 lateMarkCount to both parties', async () => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue(
      buildMatchedJourney({ matchedMinutesAgo: 15 }),
    );
    const { userUpdates } = setupTxCapture();

    await cancelJourney('j1', 'c1', CancelReason.DRIVER_LATE);

    expect(userUpdates).toHaveLength(2);
    expect(userUpdates).toContainEqual({
      where: { id: 'd1' },
      data: { lateMarkCount: { increment: 0.5 } },
    });
    expect(userUpdates).toContainEqual({
      where: { id: 'c1' },
      data: { lateMarkCount: { increment: 0.5 } },
    });
  });

  test('DRIVER_WRONG_VEHICLE increments driver.wrongVehicleCount', async () => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue(
      buildMatchedJourney({ matchedMinutesAgo: 5 }),
    );
    const { userUpdates } = setupTxCapture();

    await cancelJourney('j1', 'c1', CancelReason.DRIVER_WRONG_VEHICLE);

    expect(userUpdates).toEqual([
      { where: { id: 'd1' }, data: { wrongVehicleCount: { increment: 1 } } },
    ]);
  });

  test('SAFETY_CONCERN applies no counts but persists cancelReason on Journey', async () => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue(
      buildMatchedJourney({ matchedMinutesAgo: 1 }),
    );
    const { userUpdates, journeyUpdates } = setupTxCapture();

    await cancelJourney('j1', 'c1', CancelReason.SAFETY_CONCERN);

    expect(userUpdates).toHaveLength(0);
    expect(journeyUpdates[0].data.cancelReason).toBe(CancelReason.SAFETY_CONCERN);
    expect(journeyUpdates[0].data.cancelledAt).toBeInstanceOf(Date);
  });

  test('CUSTOMER_NO_SHOW from driver increments customer.noShowCount', async () => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue(
      buildMatchedJourney({ matchedMinutesAgo: 10 }),
    );
    const { userUpdates } = setupTxCapture();

    await cancelJourney('j1', 'd1', CancelReason.CUSTOMER_NO_SHOW);

    expect(userUpdates).toEqual([
      { where: { id: 'c1' }, data: { noShowCount: { increment: 1 } } },
    ]);
  });

  test('CUSTOMER_NO_SHOW rejects when caller is the customer', async () => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue(
      buildMatchedJourney({ matchedMinutesAgo: 10 }),
    );

    await expect(
      cancelJourney('j1', 'c1', CancelReason.CUSTOMER_NO_SHOW),
    ).rejects.toMatchObject({ code: 'WRONG_CALLER_FOR_REASON' });
  });

  test('DRIVER_CAN_NOT_MAKE_IT increments driver.driverInitiatedCancellationCount', async () => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue(
      buildMatchedJourney({ matchedMinutesAgo: 0 }),
    );
    const { userUpdates } = setupTxCapture();

    await cancelJourney('j1', 'd1', CancelReason.DRIVER_CAN_NOT_MAKE_IT);

    expect(userUpdates).toEqual([
      {
        where: { id: 'd1' },
        data: { driverInitiatedCancellationCount: { increment: 1 } },
      },
    ]);
  });

  test('DRIVER_CAN_NOT_MAKE_IT rejects when caller is the customer', async () => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue(
      buildMatchedJourney({ matchedMinutesAgo: 0 }),
    );

    await expect(
      cancelJourney('j1', 'c1', CancelReason.DRIVER_CAN_NOT_MAKE_IT),
    ).rejects.toMatchObject({ code: 'WRONG_CALLER_FOR_REASON' });
  });

  test('BOTH_NO_SHOW from a user is rejected as system-only', async () => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue(
      buildMatchedJourney({ matchedMinutesAgo: 30 }),
    );

    await expect(
      cancelJourney('j1', 'c1', CancelReason.BOTH_NO_SHOW),
    ).rejects.toMatchObject({ code: 'BOTH_NO_SHOW_IS_SYSTEM_ONLY' });
  });

  test('cancelJourney sets Journey.cancelledAt and Journey.cancelReason', async () => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue(buildMatchedJourney());
    const { journeyUpdates } = setupTxCapture();

    await cancelJourney('j1', 'c1', CancelReason.CUSTOMER_CHANGED_MIND);

    expect(journeyUpdates).toHaveLength(1);
    expect(journeyUpdates[0].where).toEqual({ id: 'j1' });
    expect(journeyUpdates[0].data.status).toBe('CANCELLED');
    expect(journeyUpdates[0].data.cancelReason).toBe(CancelReason.CUSTOMER_CHANGED_MIND);
    expect(journeyUpdates[0].data.cancelledAt).toBeInstanceOf(Date);
  });

  test('rejects when caller is neither customer nor driver', async () => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue(buildMatchedJourney());

    await expect(
      cancelJourney('j1', 'stranger', CancelReason.CUSTOMER_CHANGED_MIND),
    ).rejects.toMatchObject({ code: 'NOT_JOURNEY_PARTICIPANT', statusCode: 403 });
  });

  test('rejects when journey not found', async () => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(
      cancelJourney('missing', 'c1'),
    ).rejects.toMatchObject({ code: 'JOURNEY_NOT_FOUND', statusCode: 404 });
  });
});
