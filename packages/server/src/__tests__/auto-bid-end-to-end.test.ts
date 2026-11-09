// END-TO-END AUTO-BID INTEGRATION
//
// Exercises the full Dispatch K2 flow with a mocked prisma but real
// evaluator + real rules-store + real rate-limiter. Walks through the
// scenarios described in §2 group 8 of the dispatch:
//   - Jean creates 2 rules (priority 0 FLAT, priority 1 PERCENT)
//   - First matching journey → priority 0 wins
//   - Second matching journey (outside priority 0 distance) →
//     priority 1 wins, computed against fair price
//   - Frozen driver: rule matches but evaluator refuses to fire
//   - Rate-limited driver: 30 prior bids in the rolling window cause
//     the 31st evaluation to be throttled

jest.mock('../services/bid.service', () => ({
  createBid: jest.fn(),
}));

jest.mock('../services/fair-price.service', () => ({
  estimatePrice: jest.fn((distanceKm: number) => ({
    min: 300 + 200 * distanceKm,
    max: 300 + 400 * distanceKm,
  })),
}));

import * as bidServiceMock from '../services/bid.service';
import * as rulesStore from '../services/auto-bid/rules-store';
import { evaluateRulesForJourney } from '../services/auto-bid/evaluator';
import {
  _resetForTests as resetRateLimiter,
  recordAutoBid,
} from '../services/auto-bid/rate-limiter';
import { MAX_AUTO_BIDS_PER_DRIVER_PER_HOUR } from '../services/auto-bid/config';

// In-memory prisma — only the methods the auto-bid path touches.
function makeMockPrisma() {
  const rules: any[] = [];
  const bids: any[] = [];
  const driverProfiles = new Map<string, any>();
  const users = new Map<string, any>();
  const journeys = new Map<string, any>();
  let nextRuleId = 1;
  let nextBidId = 1;

  return {
    user: {
      findUnique: jest.fn(async ({ where, include }: any) => {
        const u = users.get(where.id);
        if (!u) return null;
        if (include?.driverProfile) {
          return { ...u, driverProfile: driverProfiles.get(where.id) ?? null };
        }
        return u;
      }),
    },
    journey: {
      findUnique: jest.fn(async ({ where }: any) => {
        return journeys.get(where.id) ?? null;
      }),
    },
    bid: {
      findUnique: jest.fn(async ({ where }: any) => {
        if (where.journeyId_driverId) {
          const { journeyId, driverId } = where.journeyId_driverId;
          return bids.find((b) => b.journeyId === journeyId && b.driverId === driverId) ?? null;
        }
        return null;
      }),
      findMany: jest.fn(async ({ where, include, orderBy }: any) => {
        let rows = bids.filter((b) => {
          if (where?.driverId !== undefined && b.driverId !== where.driverId) return false;
          if (where?.autoBidRuleId?.not === null && b.autoBidRuleId === null) return false;
          return true;
        });
        if (orderBy?.createdAt === 'desc') {
          rows = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        }
        if (include?.autoBidRule) {
          rows = rows.map((b) => ({
            ...b,
            autoBidRule: rules.find((r) => r.id === b.autoBidRuleId) ?? null,
          }));
        }
        return rows;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const b = bids.find((x) => x.id === where.id);
        if (!b) throw new Error('bid not found');
        Object.assign(b, data);
        return b;
      }),
    },
    driverAutoBidRule: {
      findMany: jest.fn(async ({ where, orderBy }: any) => {
        let rows = rules.filter((r) => {
          if (where?.driverId !== undefined && r.driverId !== where.driverId) return false;
          if (where?.enabled !== undefined && r.enabled !== where.enabled) return false;
          return true;
        });
        if (orderBy?.priority === 'asc') {
          rows = [...rows].sort((a, b) => a.priority - b.priority);
        }
        return rows;
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        if (where.id) return rules.find((r) => r.id === where.id) ?? null;
        if (where.driverId_priority) {
          const { driverId, priority } = where.driverId_priority;
          return rules.find((r) => r.driverId === driverId && r.priority === priority) ?? null;
        }
        return null;
      }),
      count: jest.fn(async ({ where }: any) => {
        return rules.filter((r) => {
          if (where?.driverId !== undefined && r.driverId !== where.driverId) return false;
          if (where?.enabled !== undefined && r.enabled !== where.enabled) return false;
          return true;
        }).length;
      }),
      create: jest.fn(async ({ data }: any) => {
        const row = {
          id: `rule${nextRuleId++}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        rules.push(row);
        return row;
      }),
    },
    // Test-only seeding helpers
    _seedDriver: (id: string, profile: any, frozen = false) => {
      users.set(id, { id, frozenAt: frozen ? new Date() : null });
      driverProfiles.set(id, profile);
    },
    _setFrozen: (id: string, frozen: boolean) => {
      const u = users.get(id);
      if (u) u.frozenAt = frozen ? new Date() : null;
    },
    _seedJourney: (j: any) => {
      journeys.set(j.id, j);
    },
    _addAutoBidFromCreateBid: (journeyId: string, driverId: string, price: number) => {
      const bid = {
        id: `bid${nextBidId++}`,
        journeyId,
        driverId,
        price,
        etaMinutes: 5,
        status: 'PENDING',
        autoBidRuleId: null,
        createdAt: new Date(),
      };
      bids.push(bid);
      return bid;
    },
    _bids: bids,
    _rules: rules,
  } as any;
}

const KACYIRU = { lat: -1.9408, lng: 30.0888 }; // DENSE Kigali

function metersOffsetLat(m: number): number {
  return m / 111_320;
}

beforeEach(() => {
  jest.clearAllMocks();
  resetRateLimiter();
});

describe('Auto-bid end-to-end — Jean drives in Kacyiru', () => {
  it('priority 0 FLAT rule wins for the first matching journey', async () => {
    const prisma = makeMockPrisma();

    // Jean parks in Kacyiru.
    prisma._seedDriver('jean', {
      lastLat: KACYIRU.lat,
      lastLng: KACYIRU.lng,
      lastLocationAt: new Date(),
    });

    // Two rules: priority 0 FLAT 1500 (200m / 3km / MOTO);
    //            priority 1 PERCENT 110 (1km / 5km / MOTO).
    await rulesStore.createRule(prisma, 'jean', {
      priority: 0,
      enabled: true,
      maxPickupDistanceM: 200,
      maxRideDistanceM: 3000,
      vehicleTypeFilter: 'MOTO',
      bidAmountMode: 'FLAT',
      bidAmountValue: 1500,
    });
    await rulesStore.createRule(prisma, 'jean', {
      priority: 1,
      enabled: true,
      maxPickupDistanceM: 1000,
      maxRideDistanceM: 5000,
      vehicleTypeFilter: 'MOTO',
      bidAmountMode: 'PERCENT_OF_FAIR_PRICE',
      bidAmountValue: 110,
    });

    // Customer requests a ride 150m from Jean, 2km long, MOTO.
    const pickupLat = KACYIRU.lat + metersOffsetLat(150);
    prisma._seedJourney({
      id: 'j1',
      pickupLat,
      pickupLng: KACYIRU.lng,
      destinationLat: pickupLat + metersOffsetLat(2000),
      destinationLng: KACYIRU.lng,
      vehiclePreference: 'MOTO',
      estimatedDistance: 2.0,
    });

    // createBid is mocked to return a fake row, then evaluator stamps
    // the autoBidRuleId via prisma.bid.update.
    (bidServiceMock.createBid as jest.Mock).mockImplementation(
      async (journeyId: string, driverId: string, price: number) => {
        return prisma._addAutoBidFromCreateBid(journeyId, driverId, price);
      },
    );

    const result = await evaluateRulesForJourney(prisma, 'jean', 'j1', null);
    expect(result.fired).toBe(true);
    expect(result.bidAmount).toBe(1500);
    expect(prisma._bids[0].price).toBe(1500);
    expect(prisma._bids[0].autoBidRuleId).toBe(prisma._rules[0].id); // priority 0
  });

  it('priority 1 PERCENT rule wins when priority 0 does not match', async () => {
    const prisma = makeMockPrisma();
    prisma._seedDriver('jean', {
      lastLat: KACYIRU.lat,
      lastLng: KACYIRU.lng,
      lastLocationAt: new Date(),
    });
    await rulesStore.createRule(prisma, 'jean', {
      priority: 0,
      enabled: true,
      maxPickupDistanceM: 200,
      maxRideDistanceM: 3000,
      vehicleTypeFilter: 'MOTO',
      bidAmountMode: 'FLAT',
      bidAmountValue: 1500,
    });
    await rulesStore.createRule(prisma, 'jean', {
      priority: 1,
      enabled: true,
      maxPickupDistanceM: 1000,
      maxRideDistanceM: 5000,
      vehicleTypeFilter: 'MOTO',
      bidAmountMode: 'PERCENT_OF_FAIR_PRICE',
      bidAmountValue: 110,
    });

    // 700m from Jean → outside priority 0 (200m), inside priority 1 (1km).
    const pickupLat = KACYIRU.lat + metersOffsetLat(700);
    prisma._seedJourney({
      id: 'j2',
      pickupLat,
      pickupLng: KACYIRU.lng,
      destinationLat: pickupLat + metersOffsetLat(4000),
      destinationLng: KACYIRU.lng,
      vehiclePreference: 'MOTO',
      estimatedDistance: 4.0,
    });

    (bidServiceMock.createBid as jest.Mock).mockImplementation(
      async (journeyId: string, driverId: string, price: number) => {
        return prisma._addAutoBidFromCreateBid(journeyId, driverId, price);
      },
    );

    const result = await evaluateRulesForJourney(prisma, 'jean', 'j2', null);
    expect(result.fired).toBe(true);
    // fair-price midpoint at 4 km: (300+200*4 + 300+400*4)/2 = (1100+1900)/2 = 1500.
    // 110% of 1500 = 1650.
    expect(result.bidAmount).toBe(1650);
    expect(prisma._bids[0].autoBidRuleId).toBe(prisma._rules[1].id); // priority 1
  });

  it('frozen driver — evaluator refuses to fire even when rule matches', async () => {
    const prisma = makeMockPrisma();
    prisma._seedDriver(
      'jean',
      {
        lastLat: KACYIRU.lat,
        lastLng: KACYIRU.lng,
        lastLocationAt: new Date(),
      },
      /* frozen */ true,
    );
    await rulesStore.createRule(prisma, 'jean', {
      priority: 0,
      enabled: true,
      maxPickupDistanceM: 1000,
      maxRideDistanceM: 5000,
      vehicleTypeFilter: 'MOTO',
      bidAmountMode: 'FLAT',
      bidAmountValue: 1500,
    });
    const pickupLat = KACYIRU.lat + metersOffsetLat(150);
    prisma._seedJourney({
      id: 'j3',
      pickupLat,
      pickupLng: KACYIRU.lng,
      destinationLat: pickupLat + metersOffsetLat(2000),
      destinationLng: KACYIRU.lng,
      vehiclePreference: 'MOTO',
      estimatedDistance: 2.0,
    });

    const result = await evaluateRulesForJourney(prisma, 'jean', 'j3', null);
    expect(result.fired).toBe(false);
    expect(result.reason).toBe('driver-frozen');
    expect(prisma._bids).toHaveLength(0);
  });

  it('rate-limited — 31st evaluation is throttled', async () => {
    const prisma = makeMockPrisma();
    prisma._seedDriver('jean', {
      lastLat: KACYIRU.lat,
      lastLng: KACYIRU.lng,
      lastLocationAt: new Date(),
    });
    await rulesStore.createRule(prisma, 'jean', {
      priority: 0,
      enabled: true,
      maxPickupDistanceM: 1000,
      maxRideDistanceM: 5000,
      vehicleTypeFilter: 'MOTO',
      bidAmountMode: 'FLAT',
      bidAmountValue: 1500,
    });
    const t0 = new Date();
    // Pre-load 30 fires inside the rolling window.
    for (let i = 0; i < MAX_AUTO_BIDS_PER_DRIVER_PER_HOUR; i++) {
      recordAutoBid('jean', new Date(t0.getTime() + i * 30_000));
    }
    const pickupLat = KACYIRU.lat + metersOffsetLat(150);
    prisma._seedJourney({
      id: 'j4',
      pickupLat,
      pickupLng: KACYIRU.lng,
      destinationLat: pickupLat + metersOffsetLat(2000),
      destinationLng: KACYIRU.lng,
      vehiclePreference: 'MOTO',
      estimatedDistance: 2.0,
    });
    const result = await evaluateRulesForJourney(
      prisma,
      'jean',
      'j4',
      null,
      new Date(t0.getTime() + 16 * 60 * 1000),
    );
    expect(result.fired).toBe(false);
    expect(result.reason).toBe('rate-limited');
    expect(prisma._bids).toHaveLength(0);
  });
});
