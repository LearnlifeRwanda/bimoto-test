// R3-N-4 — customer redispatch service tests.

jest.mock('../prisma', () => {
  const journeyCreate = jest.fn();
  return {
    __esModule: true,
    default: {
      journey: {
        findUnique: jest.fn(),
        update: jest.fn(),
        create: journeyCreate,
      },
      user: { findUnique: jest.fn(), update: jest.fn() },
      // R3-LEGS — redispatchJourney delegates to createJourney, which
      // wraps journey.create + legs.createMany in $transaction. Invoke
      // the callback so journey is the real created row.
      $transaction: jest.fn(async (cb: any) => {
        const tx = {
          journey: { create: journeyCreate },
          leg: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
        };
        return cb(tx);
      }),
    },
  };
});

jest.mock('../services/escrow.service', () => ({
  refundEscrow: jest.fn().mockResolvedValue({}),
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

jest.mock('../services/discovery/feed-filter', () => ({
  filterJourneysByCascade: (_p: any, j: any) => j,
}));

jest.mock('../services/discovery/supply-broadcast', () => ({
  scheduleCascadeBroadcasts: jest.fn(),
}));

jest.mock('../services/customer-modes/suggest-up-scheduler', () => ({
  scheduleSuggestUpEmits: jest.fn(),
}));

jest.mock('../socket', () => ({
  emitToJourney: jest.fn(),
  getIO: () => null,
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
import { redispatchJourney } from '../services/journey.service';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

function buildOriginal(
  overrides: Partial<{
    cancelReason: CancelReason | null;
    status: string;
    cancelledAt: Date | null;
    customerId: string;
    redispatches: any[];
  }> = {},
) {
  return {
    id: 'j-orig',
    customerId: overrides.customerId ?? 'c1',
    type: 'PASSENGER',
    status: overrides.status ?? 'CANCELLED',
    pickupLat: -1.95,
    pickupLng: 30.06,
    pickupName: 'Origin',
    destinationLat: -1.96,
    destinationLng: 30.07,
    destinationName: 'Dest',
    vehiclePreference: null,
    wishPrice: 1500,
    goodsFragile: false,
    cancelReason:
      overrides.cancelReason === undefined
        ? CancelReason.DRIVER_NO_SHOW
        : overrides.cancelReason,
    cancelledAt:
      overrides.cancelledAt === undefined
        ? new Date(Date.now() - 5 * 60 * 1000)
        : overrides.cancelledAt,
    redispatches: overrides.redispatches ?? [],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
    id: 'c1',
    isFlagged: false,
  });
  (mockPrisma.user.update as jest.Mock).mockResolvedValue({});
  (mockPrisma.journey.create as jest.Mock).mockResolvedValue({
    id: 'j-fresh',
    customerId: 'c1',
    status: 'REQUESTED',
  });
  (mockPrisma.journey.update as jest.Mock).mockImplementation(
    async ({ where, data }: any) => ({ id: where.id, ...data }),
  );
});

describe('redispatchJourney — R3-N-4 customer re-discovery', () => {
  test('happy path: spawns a fresh REQUESTED journey and stamps redispatchedFromId', async () => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue(
      buildOriginal(),
    );

    const result = await redispatchJourney('j-orig', 'c1');

    expect(mockPrisma.journey.create).toHaveBeenCalled();
    const createArgs = (mockPrisma.journey.create as jest.Mock).mock.calls[0][0];
    expect(createArgs.data.pickupLat).toBe(-1.95);
    expect(createArgs.data.pickupName).toBe('Origin');
    expect(createArgs.data.destinationName).toBe('Dest');
    expect(createArgs.data.bookingMode).toBe('IMMEDIATE');
    // Stamp redispatchedFromId on the fresh row.
    expect(mockPrisma.journey.update).toHaveBeenCalledWith({
      where: { id: 'j-fresh' },
      data: { redispatchedFromId: 'j-orig' },
    });
    expect(result).toMatchObject({ redispatchedFromId: 'j-orig' });
  });

  test('rejects when caller is not the original customer', async () => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue(
      buildOriginal({ customerId: 'other' }),
    );

    await expect(redispatchJourney('j-orig', 'c1')).rejects.toMatchObject({
      code: 'NOT_JOURNEY_CUSTOMER',
      statusCode: 403,
    });
    expect(mockPrisma.journey.create).not.toHaveBeenCalled();
  });

  test('rejects when original is not CANCELLED', async () => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue(
      buildOriginal({ status: 'MATCHED' }),
    );

    await expect(redispatchJourney('j-orig', 'c1')).rejects.toMatchObject({
      code: 'NOT_CANCELLED',
      statusCode: 400,
    });
  });

  test('rejects when cancelReason is not DRIVER_NO_SHOW', async () => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue(
      buildOriginal({ cancelReason: CancelReason.CUSTOMER_CHANGED_MIND }),
    );

    await expect(redispatchJourney('j-orig', 'c1')).rejects.toMatchObject({
      code: 'NOT_A_NO_SHOW',
      statusCode: 400,
    });
  });

  test('rejects past the 30-min redispatch window', async () => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue(
      buildOriginal({
        cancelledAt: new Date(Date.now() - 31 * 60 * 1000),
      }),
    );

    await expect(redispatchJourney('j-orig', 'c1')).rejects.toMatchObject({
      code: 'REDISPATCH_WINDOW_CLOSED',
      statusCode: 400,
    });
  });

  test('rejects when already redispatched (one redispatch per cancel)', async () => {
    (mockPrisma.journey.findUnique as jest.Mock).mockResolvedValue(
      buildOriginal({ redispatches: [{ id: 'j-existing-redispatch' }] }),
    );

    await expect(redispatchJourney('j-orig', 'c1')).rejects.toMatchObject({
      code: 'ALREADY_REDISPATCHED',
      statusCode: 400,
    });
    expect(mockPrisma.journey.create).not.toHaveBeenCalled();
  });
});
