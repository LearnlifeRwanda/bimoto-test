// Dashboard service tests — verify aggregate metrics, per-cooperative
// scoping, and financial commission application against an in-memory
// Prisma stub. The mock keeps two cooperatives (FERWACOTAMO and
// COOPACTRA) so cross-tenant leakage is provable.

const cooperativeRows = new Map<string, any>();
const userRows = new Map<string, any>();
const driverProfileRows = new Map<string, any>();
const journeyRows: any[] = [];
const amlFlagRows: any[] = [];

function matchInClause(value: any, clause: any) {
  if (!clause) return true;
  if (clause.in) return clause.in.includes(value);
  if (clause.gte) return new Date(value) >= new Date(clause.gte);
  if (clause.not !== undefined) return value !== clause.not;
  return value === clause;
}

const tx = {
  cooperative: {
    findUnique: jest.fn(async ({ where }: any) =>
      cooperativeRows.get(where.id) ?? null,
    ),
  },
  user: {
    findUnique: jest.fn(async ({ where }: any) => userRows.get(where.id) ?? null),
    findMany: jest.fn(async ({ where = {} }: any = {}) => {
      const arr = Array.from(userRows.values());
      if (where.id?.in) return arr.filter((u: any) => where.id.in.includes(u.id));
      return arr;
    }),
  },
  driverProfile: {
    findUnique: jest.fn(async ({ where }: any) =>
      driverProfileRows.get(where.id) ?? null,
    ),
    findMany: jest.fn(async ({ where = {}, take, skip }: any = {}) => {
      const arr = Array.from(driverProfileRows.values()).filter((p: any) => {
        if (where.cooperativeId !== undefined && p.cooperativeId !== where.cooperativeId)
          return false;
        if (where.isOnline !== undefined && p.isOnline !== where.isOnline)
          return false;
        return true;
      });
      const start = skip ?? 0;
      return arr.slice(start, take ? start + take : undefined);
    }),
  },
  journey: {
    findMany: jest.fn(async ({ where = {}, select }: any = {}) => {
      const rows = journeyRows.filter((j: any) => {
        if (where.driverId && !matchInClause(j.driverId, where.driverId)) return false;
        if (where.status && j.status !== where.status) return false;
        if (where.confirmedAt?.gte && new Date(j.confirmedAt ?? 0) < new Date(where.confirmedAt.gte))
          return false;
        if (where.createdAt?.gte && new Date(j.createdAt) < new Date(where.createdAt.gte))
          return false;
        return true;
      });
      if (select) {
        return rows.map((j: any) => {
          const r: any = {};
          for (const k of Object.keys(select)) if (select[k]) r[k] = j[k];
          return r;
        });
      }
      return rows;
    }),
    count: jest.fn(async ({ where = {} }: any = {}) => {
      return journeyRows.filter((j: any) => {
        if (where.driverId && !matchInClause(j.driverId, where.driverId)) return false;
        if (where.status && j.status !== where.status) return false;
        if (where.confirmedAt?.gte && new Date(j.confirmedAt ?? 0) < new Date(where.confirmedAt.gte))
          return false;
        return true;
      }).length;
    }),
  },
  amlFlag: {
    findMany: jest.fn(async ({ where = {} }: any = {}) =>
      amlFlagRows.filter((f: any) => f.userId === where.userId),
    ),
  },
};

jest.mock('../../../prisma', () => ({
  __esModule: true,
  default: tx,
}));

import prisma from '../../../prisma';
import {
  computeCooperativeDashboard,
  listCooperativeDrivers,
  getDriverDetail,
  computeFinancialSummary,
} from '../dashboard.service';
import { AuthorizationError } from '../scope';

const ferwId = 'coop-ferw';
const coopId = 'coop-coop';

beforeEach(() => {
  cooperativeRows.clear();
  userRows.clear();
  driverProfileRows.clear();
  journeyRows.length = 0;
  amlFlagRows.length = 0;

  cooperativeRows.set(ferwId, {
    id: ferwId,
    name: 'FERWACOTAMO',
    commissionRate: 0,
    active: true,
  });
  cooperativeRows.set(coopId, {
    id: coopId,
    name: 'COOPACTRA',
    commissionRate: 0.05,
    active: true,
  });

  // FERWACOTAMO drivers
  userRows.set('u-jean', {
    id: 'u-jean',
    nickname: 'Jean',
    phone: '+250788000001',
    isFlagged: false,
    frozenAt: null,
  });
  driverProfileRows.set('dp-jean', {
    id: 'dp-jean',
    userId: 'u-jean',
    cooperativeId: ferwId,
    cooperativeName: 'FERWACOTAMO',
    vehicleType: 'MOTO',
    isOnline: true,
    avgRating: 4.5,
    totalRides: 100,
    active: true,
    verificationStatus: 'VERIFIED',
  });

  userRows.set('u-paul', {
    id: 'u-paul',
    nickname: 'Paul',
    phone: '+250788000002',
    isFlagged: false,
    frozenAt: null,
  });
  driverProfileRows.set('dp-paul', {
    id: 'dp-paul',
    userId: 'u-paul',
    cooperativeId: ferwId,
    cooperativeName: 'FERWACOTAMO',
    vehicleType: 'MOTO',
    isOnline: false,
    avgRating: 4.0,
    totalRides: 60,
    active: true,
    verificationStatus: 'VERIFIED',
  });

  userRows.set('u-mike', {
    id: 'u-mike',
    nickname: 'Mike',
    phone: '+250788000003',
    isFlagged: true,
    frozenAt: null,
  });
  driverProfileRows.set('dp-mike', {
    id: 'dp-mike',
    userId: 'u-mike',
    cooperativeId: ferwId,
    cooperativeName: 'FERWACOTAMO',
    vehicleType: 'MOTO',
    isOnline: false,
    avgRating: 3.5,
    totalRides: 20,
    active: true,
    verificationStatus: 'VERIFIED',
  });

  // COOPACTRA driver
  userRows.set('u-pascal-d', {
    id: 'u-pascal-d',
    nickname: 'PascalD',
    phone: '+250788000099',
    isFlagged: false,
    frozenAt: null,
  });
  driverProfileRows.set('dp-pascal', {
    id: 'dp-pascal',
    userId: 'u-pascal-d',
    cooperativeId: coopId,
    cooperativeName: 'COOPACTRA',
    vehicleType: 'MOTO',
    isOnline: true,
    avgRating: 4.2,
    totalRides: 50,
    active: true,
    verificationStatus: 'VERIFIED',
  });

  const now = new Date('2026-05-05T12:00:00Z');
  // Today rides for Jean
  journeyRows.push({
    id: 'j1',
    driverId: 'u-jean',
    status: 'COMPLETED',
    confirmedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
    createdAt: new Date(now.getTime() - 3 * 60 * 60 * 1000),
    agreedPrice: 1500,
    commissionAmount: 150,
    pickupName: 'A',
    destinationName: 'B',
  });
  journeyRows.push({
    id: 'j2',
    driverId: 'u-jean',
    status: 'COMPLETED',
    confirmedAt: new Date(now.getTime() - 1 * 60 * 60 * 1000),
    createdAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
    agreedPrice: 2000,
    commissionAmount: 200,
    pickupName: 'C',
    destinationName: 'D',
  });
  // Last week ride for Paul (inside week, outside today)
  journeyRows.push({
    id: 'j3',
    driverId: 'u-paul',
    status: 'COMPLETED',
    confirmedAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
    createdAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
    agreedPrice: 1000,
    commissionAmount: 100,
    pickupName: 'E',
    destinationName: 'F',
  });
  // COOPACTRA ride (should NOT show up in FERWACOTAMO totals)
  journeyRows.push({
    id: 'j4',
    driverId: 'u-pascal-d',
    status: 'COMPLETED',
    confirmedAt: new Date(now.getTime() - 1 * 60 * 60 * 1000),
    createdAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
    agreedPrice: 5000,
    commissionAmount: 500,
    pickupName: 'X',
    destinationName: 'Y',
  });
});

const fixedNow = new Date('2026-05-05T12:00:00Z');

describe('computeCooperativeDashboard', () => {
  test('FERWACOTAMO with seeded data returns correct counts + earnings', async () => {
    const summary = await computeCooperativeDashboard(prisma as any, ferwId, 7, fixedNow);
    expect(summary.cooperativeId).toBe(ferwId);
    expect(summary.name).toBe('FERWACOTAMO');
    expect(summary.driverCount).toBe(3);
    expect(summary.activeDriverCount).toBe(3);
    expect(summary.onlineDriverCount).toBe(1);
    expect(summary.todayRideCount).toBe(2);
    expect(summary.todayEarningsRwf).toBe(3500);
    expect(summary.flaggedDriverCount).toBe(1);
    expect(summary.weekRideCount).toBe(3);
    expect(summary.averageRating).toBeCloseTo(4.0, 1);
  });

  test('Empty cooperative → all zeros, no errors', async () => {
    cooperativeRows.set('coop-empty', {
      id: 'coop-empty',
      name: 'EMPTY',
      commissionRate: 0,
    });
    const summary = await computeCooperativeDashboard(
      prisma as any,
      'coop-empty',
      7,
      fixedNow,
    );
    expect(summary.driverCount).toBe(0);
    expect(summary.todayRideCount).toBe(0);
    expect(summary.todayEarningsRwf).toBe(0);
    expect(summary.averageRating).toBeNull();
  });

  test('non-existent cooperativeId → AuthorizationError', async () => {
    await expect(
      computeCooperativeDashboard(prisma as any, 'ghost', 7, fixedNow),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe('listCooperativeDrivers', () => {
  test('returns ONLY FERWACOTAMO drivers (no COOPACTRA leakage)', async () => {
    const rows = await listCooperativeDrivers(prisma as any, ferwId, {
      limit: 50,
      offset: 0,
    });
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.cooperativeName === 'FERWACOTAMO')).toBe(true);
  });

  test('onlineOnly=true narrows correctly', async () => {
    const rows = await listCooperativeDrivers(prisma as any, ferwId, {
      limit: 50,
      offset: 0,
      onlineOnly: true,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].isOnline).toBe(true);
  });

  test('flaggedOnly=true narrows correctly', async () => {
    const rows = await listCooperativeDrivers(prisma as any, ferwId, {
      limit: 50,
      offset: 0,
      flaggedOnly: true,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].isFlagged).toBe(true);
  });
});

describe('getDriverDetail', () => {
  test('FERWACOTAMO driver → returns detail', async () => {
    const detail = await getDriverDetail(prisma as any, ferwId, 'dp-jean', 7, fixedNow);
    expect(detail.driver.userId).toBe('u-jean');
    expect(detail.recentEarnings.totalRwf).toBe(3500);
    expect(detail.recentJourneys.length).toBeGreaterThanOrEqual(1);
  });

  test('COOPACTRA driver via FERWACOTAMO scope → AuthorizationError', async () => {
    await expect(
      getDriverDetail(prisma as any, ferwId, 'dp-pascal', 7, fixedNow),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe('computeFinancialSummary', () => {
  test('0% commission rate (FERWACOTAMO default)', async () => {
    const summary = await computeFinancialSummary(prisma as any, ferwId, 7, fixedNow);
    expect(summary.totalRideRwf).toBe(4500);
    expect(summary.totalEarningsRwf).toBe(4050);
    expect(summary.totalCommissionRwf).toBe(0);
    expect(summary.perDriver.length).toBe(2);
  });

  test('5% commission rate (COOPACTRA fixture)', async () => {
    const summary = await computeFinancialSummary(prisma as any, coopId, 7, fixedNow);
    expect(summary.totalRideRwf).toBe(5000);
    expect(summary.totalEarningsRwf).toBe(4500);
    expect(summary.totalCommissionRwf).toBe(225);
  });

  test('window narrows totals — periodDays=1 excludes journey >1d ago', async () => {
    const summary = await computeFinancialSummary(prisma as any, ferwId, 1, fixedNow);
    // Only Jean's two same-day rides count; Paul's 3-day-old ride is excluded.
    expect(summary.totalRideRwf).toBe(3500);
  });
});
