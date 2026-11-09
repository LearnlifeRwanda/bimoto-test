// __TESTS__/FUNNEL-METRICS.TEST.TS
//
// R3-FUNNEL-METRICS-DASHBOARD — smallest-wrongness anchor lives here:
// the active-driver-threshold test asserts the §8 invariant that the
// "Active" funnel stage equals drivers with >= ACTIVE_DRIVER_TRIP_THRESHOLD
// completed trips in the trailing ACTIVE_DRIVER_WINDOW_DAYS window.

jest.mock('../prisma', () => {
  const userRows: any[] = [];
  const driverProfileRows: any[] = [];
  const journeyRows: any[] = [];
  const syncEventRows: any[] = [];
  const syncRejectionRows: any[] = [];
  const driverScreenerRows: any[] = [];

  function matches(where: any, row: any, path: string[] = []): boolean {
    if (!where) return true;
    for (const [key, val] of Object.entries(where)) {
      const v = row[key];
      if (val === null) {
        if (v !== null && v !== undefined) return false;
      } else if (Array.isArray(val) || val instanceof Date) {
        if (v !== val) return false;
      } else if (typeof val === 'object') {
        const obj = val as Record<string, any>;
        if ('in' in obj) {
          if (!obj.in.includes(v)) return false;
        }
        if ('not' in obj) {
          if (obj.not === null && (v === null || v === undefined)) return false;
          if (obj.not !== null && v === obj.not) return false;
        }
        if ('gte' in obj && !(v instanceof Date && v.getTime() >= obj.gte.getTime())) {
          if (!(v && obj.gte && new Date(v).getTime() >= new Date(obj.gte).getTime())) return false;
        }
        if ('lt' in obj) {
          if (!(v && new Date(v).getTime() < new Date(obj.lt).getTime())) return false;
        }
        // R3-DRIVER-SCREENER — `where: { driverProfile: { userId: { in: [...] } } }`
        // for the screener-qualified scope mirrors the join filter.
        if ('userId' in obj && key === 'driverProfile') {
          const driverProfileUserId = row.__driverProfile?.userId;
          if (typeof obj.userId === 'object' && 'in' in obj.userId) {
            if (!obj.userId.in.includes(driverProfileUserId)) return false;
          }
        }
      } else {
        if (v !== val) return false;
      }
    }
    return true;
  }

  const prismaMock = {
    user: {
      count: jest.fn(async ({ where = {} }: any = {}) =>
        userRows.filter((u) => matches(where, u)).length,
      ),
    },
    driverProfile: {
      count: jest.fn(async ({ where = {} }: any = {}) =>
        driverProfileRows.filter((d) => matches(where, d)).length,
      ),
      findMany: jest.fn(async ({ where = {} }: any = {}) =>
        driverProfileRows
          .filter((d) => matches(where, d))
          .map((d) => ({ userId: d.userId })),
      ),
    },
    journey: {
      findMany: jest.fn(async ({ where = {}, select }: any = {}) => {
        const rows = journeyRows.filter((j) => matches(where, j));
        if (select?.bids || select?.legs) {
          return rows.map((j) => ({
            ...j,
            bids: j._bids ?? [],
            legs: j._legs ?? [],
          }));
        }
        return rows.map((j) => ({ ...j }));
      }),
    },
    syncEvent: {
      count: jest.fn(async ({ where = {} }: any = {}) =>
        syncEventRows.filter((s) => matches(where, s)).length,
      ),
    },
    syncRejection: {
      count: jest.fn(async ({ where = {} }: any = {}) =>
        syncRejectionRows.filter((s) => matches(where, s)).length,
      ),
    },
    driverScreener: {
      count: jest.fn(async ({ where = {} }: any = {}) =>
        driverScreenerRows.filter((s) => matches(where, s)).length,
      ),
    },
  };

  return {
    __esModule: true,
    default: prismaMock,
    _seed: {
      users: userRows,
      driverProfiles: driverProfileRows,
      journeys: journeyRows,
      syncEvents: syncEventRows,
      syncRejections: syncRejectionRows,
      driverScreeners: driverScreenerRows,
      reset() {
        userRows.length = 0;
        driverProfileRows.length = 0;
        journeyRows.length = 0;
        syncEventRows.length = 0;
        syncRejectionRows.length = 0;
        driverScreenerRows.length = 0;
      },
    },
  };
});

import {
  getFunnelMetrics,
  getFunnelMetricsCsv,
  _internal,
} from '../services/funnel-metrics.service';
import {
  ACTIVE_DRIVER_TRIP_THRESHOLD,
  FUNNEL_LOOKBACK_WEEKS,
} from '@bimoto/shared';
import { classifyCityBand } from '../services/funnel-metrics/city-band';

const prismaModule = jest.requireMock('../prisma') as {
  _seed: {
    users: any[];
    driverProfiles: any[];
    journeys: any[];
    syncEvents: any[];
    syncRejections: any[];
    driverScreeners: any[];
    reset: () => void;
  };
};

const seed = prismaModule._seed;

const WEEK_OF = '2026-W30'; // Monday 2026-07-20 Africa/Kigali
const weekStart = _internal.startOfIsoWeekUtc(WEEK_OF);
const weekEnd = new Date(weekStart.getTime() + 7 * 86_400_000);
const insideWeek = new Date(weekStart.getTime() + 2 * 86_400_000);

beforeEach(() => {
  seed.reset();
});

describe('funnel-metrics', () => {
  test('active driver threshold = 3 trips in last 7 days', async () => {
    // Four drivers with 0, 2, 3, 5 completed trips inside the active
    // window. Expect active === 2 (the >=3 drivers).
    const drivers = ['drv-0', 'drv-1', 'drv-2', 'drv-3'];
    const trips = [0, 2, 3, 5];
    for (let i = 0; i < drivers.length; i++) {
      for (let t = 0; t < trips[i]; t++) {
        seed.journeys.push({
          id: `j-${drivers[i]}-${t}`,
          customerId: 'cust-1',
          driverId: drivers[i],
          status: 'COMPLETED',
          confirmedAt: new Date(weekEnd.getTime() - 60_000),
          createdAt: insideWeek,
          discoveryStartedAt: insideWeek,
          pickupLat: -1.95,
          pickupLng: 30.08,
          recipientPhone: null,
          _bids: [],
          _legs: [],
        });
      }
    }
    const result = await getFunnelMetrics({ weekOf: WEEK_OF });
    expect(result.funnel.active[FUNNEL_LOOKBACK_WEEKS - 1]).toBe(2);
    expect(ACTIVE_DRIVER_TRIP_THRESHOLD).toBe(3);
  });

  test('city-band classifier returns correct bands for Kigali and Bugesera coordinates', () => {
    // kigali_dense bbox: -1.97..-1.93 lat, 30.05..30.12 lng
    expect(classifyCityBand(-1.95, 30.08)).toBe('kigali_dense');
    expect(classifyCityBand(-1.94, 30.10)).toBe('kigali_dense');
    // kigali_periphery bbox: -2.00..-1.92 lat, 30.02..30.16 lng minus dense
    expect(classifyCityBand(-1.99, 30.14)).toBe('kigali_periphery');
    expect(classifyCityBand(-1.93, 30.15)).toBe('kigali_periphery');
    // bugesera_corridor bbox: -2.20..-1.95 lat, 30.05..30.20 lng — but
    // priority order means the dense/periphery boxes win for overlap.
    expect(classifyCityBand(-2.15, 30.18)).toBe('bugesera_corridor');
    expect(classifyCityBand(-2.10, 30.07)).toBe('bugesera_corridor');
    // other fallback
    expect(classifyCityBand(0, 0)).toBe('other');
    expect(classifyCityBand(-3.0, 29.0)).toBe('other');
  });

  test('screener-qualified counts only drivers with a completed DriverScreener row', async () => {
    // Seed: 3 driver users, 2 with screener rows, 1 of those INELIGIBLE.
    // Expect screenerQualified = 1 (only the ELIGIBLE row counts).
    for (let i = 0; i < 3; i++) {
      seed.users.push({
        id: `u-${i}`,
        role: 'DRIVER',
        createdAt: new Date(weekStart.getTime() - 86_400_000),
      });
    }
    seed.driverScreeners.push(
      {
        id: 's-eligible',
        eligibilityResult: 'ELIGIBLE',
        completedAt: new Date(weekStart.getTime() - 60_000),
      },
      {
        id: 's-ineligible',
        eligibilityResult: 'INELIGIBLE',
        completedAt: new Date(weekStart.getTime() - 60_000),
      },
    );
    const result = await getFunnelMetrics({ weekOf: WEEK_OF });
    expect(result.funnel.screenerQualified[FUNNEL_LOOKBACK_WEEKS - 1]).toBe(1);
  });

  test('screener-qualified >= onboarded for any cohort with at least 1 onboarded driver', async () => {
    // §5 invariant — under fixtures where every onboarded driver has
    // also completed an eligible screener, screenerQualified always
    // covers (>= ) onboarded. Two onboarded drivers, three eligible
    // screener rows → invariant holds.
    for (let i = 0; i < 2; i++) {
      seed.users.push({
        id: `u-${i}`,
        role: 'DRIVER',
        createdAt: new Date(weekStart.getTime() - 86_400_000),
      });
      seed.driverProfiles.push({
        userId: `u-${i}`,
        verificationStatus: 'VERIFIED',
        cooperativeId: 'coop-1',
        verifiedAt: new Date(weekStart.getTime() - 60_000),
      });
    }
    for (let i = 0; i < 3; i++) {
      seed.driverScreeners.push({
        id: `s-${i}`,
        eligibilityResult: 'ELIGIBLE',
        completedAt: new Date(weekStart.getTime() - 60_000),
      });
    }
    const result = await getFunnelMetrics({ weekOf: WEEK_OF });
    for (let i = 0; i < FUNNEL_LOOKBACK_WEEKS; i++) {
      if (result.funnel.onboarded[i] >= 1) {
        expect(result.funnel.screenerQualified[i]).toBeGreaterThanOrEqual(
          result.funnel.onboarded[i],
        );
      }
    }
  });

  test('time-to-first-bid median computes correctly', async () => {
    // Five journeys with first-bid delays of 1, 2, 3, 4, 5 minutes.
    // Median over [1,2,3,4,5] is 3.
    const delaysMinutes = [1, 2, 3, 4, 5];
    for (let i = 0; i < delaysMinutes.length; i++) {
      const discoveredAt = new Date(weekStart.getTime() + i * 60_000);
      const earliestBidAt = new Date(
        discoveredAt.getTime() + delaysMinutes[i] * 60_000,
      );
      seed.journeys.push({
        id: `j-${i}`,
        customerId: 'cust-1',
        driverId: null,
        status: 'REQUESTED',
        confirmedAt: null,
        createdAt: discoveredAt,
        discoveryStartedAt: discoveredAt,
        pickupLat: -1.95,
        pickupLng: 30.08,
        recipientPhone: null,
        _bids: [
          { createdAt: earliestBidAt, status: 'PENDING' },
          { createdAt: new Date(earliestBidAt.getTime() + 30_000), status: 'PENDING' },
        ],
        _legs: [],
      });
    }
    const result = await getFunnelMetrics({ weekOf: WEEK_OF });
    expect(result.operational.timeToFirstBidMedianMinutes[FUNNEL_LOOKBACK_WEEKS - 1]).toBe(3);
  });

  test('cooperative filter restricts to driverId-of-cooperative', async () => {
    // Two cooperatives, two drivers each. Filter by coop-A; expect
    // only the coop-A drivers' journeys to contribute.
    seed.driverProfiles.push(
      { userId: 'drv-A1', verificationStatus: 'VERIFIED', cooperativeId: 'coop-A', verifiedAt: new Date(weekStart.getTime() - 60_000) },
      { userId: 'drv-A2', verificationStatus: 'VERIFIED', cooperativeId: 'coop-A', verifiedAt: new Date(weekStart.getTime() - 60_000) },
      { userId: 'drv-B1', verificationStatus: 'VERIFIED', cooperativeId: 'coop-B', verifiedAt: new Date(weekStart.getTime() - 60_000) },
      { userId: 'drv-B2', verificationStatus: 'VERIFIED', cooperativeId: 'coop-B', verifiedAt: new Date(weekStart.getTime() - 60_000) },
    );
    // 3 completed trips for each coop-A driver, 3 for each coop-B driver.
    for (const drv of ['drv-A1', 'drv-A2', 'drv-B1', 'drv-B2']) {
      for (let t = 0; t < 3; t++) {
        seed.journeys.push({
          id: `j-${drv}-${t}`,
          customerId: 'cust-1',
          driverId: drv,
          status: 'COMPLETED',
          confirmedAt: new Date(weekEnd.getTime() - 60_000),
          createdAt: insideWeek,
          discoveryStartedAt: insideWeek,
          pickupLat: -1.95,
          pickupLng: 30.08,
          recipientPhone: null,
          _bids: [],
          _legs: [],
        });
      }
    }
    const filtered = await getFunnelMetrics({
      weekOf: WEEK_OF,
      cooperativeId: 'coop-A',
    });
    // Only A1 + A2 qualify as active (>=3 trips each in window).
    expect(filtered.funnel.active[FUNNEL_LOOKBACK_WEEKS - 1]).toBe(2);

    const unfiltered = await getFunnelMetrics({ weekOf: WEEK_OF });
    expect(unfiltered.funnel.active[FUNNEL_LOOKBACK_WEEKS - 1]).toBe(4);
  });

  test('offline-sync-success rate computes from SyncRejection count when rejections exist', async () => {
    // R3-SYNC-REJECTION-MODEL §8 anchor — 3 accepted SyncEvents + 1
    // SyncRejection within the metric window → ratio = 3 / (3 + 1) = 0.75.
    // Fails loudly if the denominator forgets to include rejections.
    const driverId = 'drv-sync';
    for (let i = 0; i < 3; i++) {
      seed.syncEvents.push({
        id: `se-${i}`,
        userId: driverId,
        serverTimestamp: insideWeek,
      });
    }
    seed.syncRejections.push({
      id: 'sr-1',
      userId: driverId,
      serverTimestamp: insideWeek,
    });

    const result = await getFunnelMetrics({ weekOf: WEEK_OF });
    const currentWeekIdx = FUNNEL_LOOKBACK_WEEKS - 1;
    expect(result.operational.offlineSyncSuccessRate[currentWeekIdx]).toBeCloseTo(
      0.75,
      5,
    );
  });

  test('offline-sync-success rate is 1.0 when window has only accepted events', async () => {
    seed.syncEvents.push({
      id: 'se-a',
      userId: 'drv-a',
      serverTimestamp: insideWeek,
    });

    const result = await getFunnelMetrics({ weekOf: WEEK_OF });
    expect(
      result.operational.offlineSyncSuccessRate[FUNNEL_LOOKBACK_WEEKS - 1],
    ).toBe(1);
  });

  test('offline-sync-success rate is 0 when window has no attempts', async () => {
    const result = await getFunnelMetrics({ weekOf: WEEK_OF });
    expect(
      result.operational.offlineSyncSuccessRate[FUNNEL_LOOKBACK_WEEKS - 1],
    ).toBe(0);
  });

  test('CSV export contains the expected columns and FUNNEL_LOOKBACK_WEEKS rows', async () => {
    const csv = await getFunnelMetricsCsv({ weekOf: WEEK_OF });
    const lines = csv.trim().split('\n');
    // 1 header + FUNNEL_LOOKBACK_WEEKS data rows
    expect(lines.length).toBe(1 + FUNNEL_LOOKBACK_WEEKS);
    const header = lines[0].split(',');
    expect(header).toEqual([
      'weekOf',
      'registered',
      'screenerQualified',
      'onboarded',
      'active',
      'timeToFirstBidMedianMinutes',
      'bidsPerRideMean',
      'acceptanceRate',
      'cancellationRate',
      'parcelRecipientConfirmationRate',
      'offlineSyncSuccessRate',
      'cityBand',
    ]);
    // Last data row's weekOf must match the requested week.
    const lastRow = lines[lines.length - 1].split(',');
    expect(lastRow[0]).toBe(WEEK_OF);
    expect(lastRow[lastRow.length - 1]).toBe('all');
  });
});
