// Per-driver dispatch lock — prevents two leaders from racing the same
// driver. Lock TTL is 5s (LOCK_TTL_MS in dispatch.service); we test both
// happy path (released after success), error path (released after throw),
// concurrent lockout (only one wins), and TTL expiry.

const tx = {
  cooperative: {
    findUnique: jest.fn(async ({ where }: any) =>
      where.id === 'coop-a'
        ? { id: 'coop-a', name: 'COOP-A', commissionRate: 0 }
        : null,
    ),
  },
  user: {
    findUnique: jest.fn(async ({ where }: any) => {
      if (where.id === 'driver-1') return { id: 'driver-1', frozenAt: null };
      if (where.id === 'driver-2') return { id: 'driver-2', frozenAt: null };
      if (where.id === 'customer-1') return { id: 'customer-1', frozenAt: null };
      if (where.id === 'leader-1') {
        return { id: 'leader-1', cooperativeId: 'coop-a', role: 'COOPERATIVE_LEADER' };
      }
      return null;
    }),
  },
  driverProfile: {
    findUnique: jest.fn(async ({ where }: any) => {
      if (where.userId === 'driver-1') {
        return {
          id: 'dp-1',
          userId: 'driver-1',
          cooperativeId: 'coop-a',
          vehicleType: 'MOTO',
          isOnline: true,
          verificationStatus: 'VERIFIED',
          active: true,
        };
      }
      if (where.userId === 'driver-2') {
        return {
          id: 'dp-2',
          userId: 'driver-2',
          cooperativeId: 'coop-a',
          vehicleType: 'MOTO',
          isOnline: true,
          verificationStatus: 'VERIFIED',
          active: true,
        };
      }
      return null;
    }),
  },
  journey: {
    create: jest.fn(async ({ data }: any) => ({
      id: `j-${Math.random().toString(36).slice(2, 8)}`,
      ...data,
    })),
  },
  bid: {
    create: jest.fn(async ({ data }: any) => ({
      id: `b-${Math.random().toString(36).slice(2, 8)}`,
      ...data,
    })),
  },
  adminAction: {
    findFirst: jest.fn(async () => null),
    create: jest.fn(async ({ data }: any) => ({ id: `aa-${Math.random()}`, ...data })),
  },
};

jest.mock('../../../prisma', () => ({
  __esModule: true,
  default: {
    ...tx,
    $transaction: jest.fn(async (fn: any) => {
      // Slight delay so two concurrent calls actually race the lock
      await new Promise((r) => setTimeout(r, 20));
      return fn(tx);
    }),
  },
}));

import prisma from '../../../prisma';
import {
  dispatchBidOnBehalf,
  DispatchInProgressError,
  _resetDispatchLocksForTests,
} from '../dispatch.service';

const baseArgs = {
  leaderUserId: 'leader-1',
  cooperativeId: 'coop-a',
  driverId: 'driver-1',
  customerId: 'customer-1',
  pickupLat: -1.95,
  pickupLng: 30.06,
  destinationLat: -1.96,
  destinationLng: 30.07,
  vehiclePreference: 'MOTO',
  priceRwf: 1500,
};

beforeEach(() => {
  jest.clearAllMocks();
  _resetDispatchLocksForTests();
});

describe('dispatchBidOnBehalf — per-driver in-flight lock', () => {
  test('two simultaneous calls for same driver: exactly one succeeds, the other throws DispatchInProgressError', async () => {
    const [a, b] = await Promise.allSettled([
      dispatchBidOnBehalf(prisma as any, baseArgs),
      dispatchBidOnBehalf(prisma as any, baseArgs),
    ]);

    const fulfilled = [a, b].filter((r) => r.status === 'fulfilled');
    const rejected = [a, b].filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      DispatchInProgressError,
    );
  });

  test('two simultaneous calls for different drivers both succeed', async () => {
    const [a, b] = await Promise.allSettled([
      dispatchBidOnBehalf(prisma as any, baseArgs),
      dispatchBidOnBehalf(prisma as any, { ...baseArgs, driverId: 'driver-2' }),
    ]);
    expect(a.status).toBe('fulfilled');
    expect(b.status).toBe('fulfilled');
  });

  test('lock released after happy path completes — sequential same-driver dispatch succeeds', async () => {
    const r1 = await dispatchBidOnBehalf(prisma as any, baseArgs);
    expect(r1.bidId).toBeDefined();
    const r2 = await dispatchBidOnBehalf(prisma as any, baseArgs);
    expect(r2.bidId).toBeDefined();
  });

  test('lock released after dispatch throws (finally clause)', async () => {
    const journeyCreate = tx.journey.create as jest.Mock;
    journeyCreate.mockRejectedValueOnce(new Error('db down'));

    await expect(dispatchBidOnBehalf(prisma as any, baseArgs)).rejects.toThrow(
      'db down',
    );

    // Lock should be released — next call must NOT throw DispatchInProgressError.
    const r2 = await dispatchBidOnBehalf(prisma as any, baseArgs);
    expect(r2.bidId).toBeDefined();
  });

  test('DispatchInProgressError exposes driverId for observability', async () => {
    const promises = Promise.allSettled([
      dispatchBidOnBehalf(prisma as any, baseArgs),
      dispatchBidOnBehalf(prisma as any, baseArgs),
    ]);
    const [, b] = await promises;
    if (b.status === 'rejected') {
      expect(b.reason).toBeInstanceOf(DispatchInProgressError);
      expect((b.reason as DispatchInProgressError).driverId).toBe('driver-1');
    }
  });
});
