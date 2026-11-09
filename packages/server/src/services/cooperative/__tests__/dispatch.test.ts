// Cooperative dispatch service tests — exercise the happy path and
// the rejection paths (driver scope / state / customer / price).
// Verifies that the bid is created with dispatchedByLeaderId set
// and a COOPERATIVE_DISPATCH AdminAction row is produced.

const cooperativeRows = new Map<string, any>();
const userRows = new Map<string, any>();
const driverProfileRows = new Map<string, any>();
const journeyRows = new Map<string, any>();
const bidRows = new Map<string, any>();
const adminActionRows: any[] = [];

const tx = {
  cooperative: {
    findUnique: jest.fn(async ({ where }: any) => cooperativeRows.get(where.id) ?? null),
  },
  user: {
    findUnique: jest.fn(async ({ where }: any) => userRows.get(where.id) ?? null),
  },
  driverProfile: {
    findUnique: jest.fn(async ({ where }: any) => {
      if (where.userId) {
        for (const r of driverProfileRows.values()) {
          if (r.userId === where.userId) return r;
        }
        return null;
      }
      return driverProfileRows.get(where.id) ?? null;
    }),
  },
  journey: {
    create: jest.fn(async ({ data }: any) => {
      const id = `j-${journeyRows.size + 1}`;
      const row = { id, ...data, createdAt: new Date(), updatedAt: new Date() };
      journeyRows.set(id, row);
      return row;
    }),
  },
  bid: {
    create: jest.fn(async ({ data }: any) => {
      const id = `b-${bidRows.size + 1}`;
      const row = { id, ...data, createdAt: new Date(), updatedAt: new Date() };
      bidRows.set(id, row);
      return row;
    }),
  },
  adminAction: {
    findFirst: jest.fn(async () =>
      adminActionRows.length === 0 ? null : adminActionRows[adminActionRows.length - 1],
    ),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: `aa-${adminActionRows.length + 1}`, ...data };
      adminActionRows.push(row);
      return row;
    }),
  },
};

jest.mock('../../../prisma', () => ({
  __esModule: true,
  default: {
    ...tx,
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  },
}));

import prisma from '../../../prisma';
import {
  dispatchBidOnBehalf,
  DispatchValidationError,
} from '../dispatch.service';
import { AuthorizationError } from '../scope';

const ferwId = 'coop-ferw';
const coopId = 'coop-coop';
const marieUserId = 'marie';
const jeanUserId = 'u-jean';
const pascalDriverUserId = 'u-pascal';
const sarahUserId = 'u-sarah';

const baseDispatch = {
  leaderUserId: marieUserId,
  cooperativeId: ferwId,
  driverId: jeanUserId,
  customerId: sarahUserId,
  pickupLat: -1.95,
  pickupLng: 30.06,
  destinationLat: -1.96,
  destinationLng: 30.07,
  vehiclePreference: 'MOTO',
};

beforeEach(() => {
  cooperativeRows.clear();
  userRows.clear();
  driverProfileRows.clear();
  journeyRows.clear();
  bidRows.clear();
  adminActionRows.length = 0;

  cooperativeRows.set(ferwId, { id: ferwId, name: 'FERWACOTAMO', commissionRate: 0 });
  cooperativeRows.set(coopId, { id: coopId, name: 'COOPACTRA', commissionRate: 0.05 });

  userRows.set(marieUserId, { id: marieUserId, role: 'COOPERATIVE_LEADER', cooperativeId: ferwId });
  userRows.set(jeanUserId, { id: jeanUserId, role: 'DRIVER', frozenAt: null });
  userRows.set(pascalDriverUserId, { id: pascalDriverUserId, role: 'DRIVER', frozenAt: null });
  userRows.set(sarahUserId, { id: sarahUserId, role: 'CUSTOMER', frozenAt: null });

  driverProfileRows.set('dp-jean', {
    id: 'dp-jean',
    userId: jeanUserId,
    cooperativeId: ferwId,
    vehicleType: 'MOTO',
    isOnline: true,
    verificationStatus: 'VERIFIED',
    active: true,
  });
  driverProfileRows.set('dp-pascal', {
    id: 'dp-pascal',
    userId: pascalDriverUserId,
    cooperativeId: coopId,
    vehicleType: 'MOTO',
    isOnline: true,
    verificationStatus: 'VERIFIED',
    active: true,
  });
});

describe('dispatchBidOnBehalf', () => {
  test('happy path: journey + bid + AdminAction created, both notified', async () => {
    const result = await dispatchBidOnBehalf(prisma as any, {
      ...baseDispatch,
      priceRwf: 1500,
    });
    expect(result.journeyId).toBeDefined();
    expect(result.bidId).toBeDefined();
    expect(result.priceRwf).toBe(1500);
    expect(result.notifiedDriver).toBe(true);
    expect(result.notifiedCustomer).toBe(true);

    const bid = bidRows.get(result.bidId);
    expect(bid.dispatchedByLeaderId).toBe(marieUserId);
    expect(bid.driverId).toBe(jeanUserId);
    expect(bid.status).toBe('PENDING');

    expect(adminActionRows).toHaveLength(1);
    expect(adminActionRows[0].action).toBe('COOPERATIVE_DISPATCH');
    expect(adminActionRows[0].targetType).toBe('JOURNEY');
  });

  test('driver in another cooperative → AuthorizationError, no journey/bid', async () => {
    await expect(
      dispatchBidOnBehalf(prisma as any, {
        ...baseDispatch,
        driverId: pascalDriverUserId,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(journeyRows.size).toBe(0);
    expect(bidRows.size).toBe(0);
  });

  test('driver frozen → DispatchValidationError driver-frozen', async () => {
    userRows.get(jeanUserId).frozenAt = new Date();
    await expect(
      dispatchBidOnBehalf(prisma as any, baseDispatch),
    ).rejects.toMatchObject({ code: 'driver-frozen' });
  });

  test('driver offline → DispatchValidationError driver-offline', async () => {
    driverProfileRows.get('dp-jean').isOnline = false;
    await expect(
      dispatchBidOnBehalf(prisma as any, baseDispatch),
    ).rejects.toMatchObject({ code: 'driver-offline' });
  });

  test('driver not verified → DispatchValidationError driver-not-verified', async () => {
    driverProfileRows.get('dp-jean').verificationStatus = 'PENDING';
    await expect(
      dispatchBidOnBehalf(prisma as any, baseDispatch),
    ).rejects.toMatchObject({ code: 'driver-not-verified' });
  });

  test('customer doesn\'t exist → DispatchValidationError customer-not-found', async () => {
    await expect(
      dispatchBidOnBehalf(prisma as any, {
        ...baseDispatch,
        customerId: 'ghost',
      }),
    ).rejects.toMatchObject({ code: 'customer-not-found' });
  });

  test('priceRwf not provided → estimatePrice midpoint used', async () => {
    const result = await dispatchBidOnBehalf(prisma as any, baseDispatch);
    expect(result.priceRwf).toBeGreaterThan(0);
    const bid = bidRows.get(result.bidId);
    expect(bid.price).toBe(result.priceRwf);
  });

  test('priceRwf=0 → DispatchValidationError invalid-price', async () => {
    await expect(
      dispatchBidOnBehalf(prisma as any, { ...baseDispatch, priceRwf: 0 }),
    ).rejects.toMatchObject({ code: 'invalid-price' });
  });

  test('vehicle mismatch → DispatchValidationError vehicle-mismatch', async () => {
    await expect(
      dispatchBidOnBehalf(prisma as any, {
        ...baseDispatch,
        vehiclePreference: 'BIKE',
      }),
    ).rejects.toMatchObject({ code: 'vehicle-mismatch' });
  });

  test('etaMinutes provided is honoured', async () => {
    const result = await dispatchBidOnBehalf(prisma as any, {
      ...baseDispatch,
      priceRwf: 2000,
      etaMinutes: 12,
    });
    expect(result.etaMinutes).toBe(12);
    const bid = bidRows.get(result.bidId);
    expect(bid.etaMinutes).toBe(12);
  });
});
