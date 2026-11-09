// Mocked services need to be hoisted before the evaluator import
// pulls them in.
jest.mock('../../bid.service', () => ({
  createBid: jest.fn(),
}));

jest.mock('../../fair-price.service', () => ({
  estimatePrice: jest.fn((distanceKm: number) => ({
    min: 300 + 200 * distanceKm,
    max: 300 + 400 * distanceKm,
  })),
}));

import {
  computeBidAmount,
  evaluateRulesForJourney,
  ruleMatches,
} from '../evaluator';
import { _resetForTests as resetRateLimiter } from '../rate-limiter';
import * as bidServiceMock from '../../bid.service';

const KIGALI = { lat: -1.9536, lng: 30.0606 };

function rule(overrides: any = {}) {
  return {
    id: 'r1',
    driverId: 'd1',
    priority: 0,
    enabled: true,
    maxPickupDistanceM: 500,
    maxRideDistanceM: 3000,
    vehicleTypeFilter: 'MOTO',
    bidAmountMode: 'FLAT',
    bidAmountValue: 1500,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function ctx(overrides: any = {}) {
  const now = overrides.now ?? new Date();
  return {
    journey: {
      id: 'j1',
      pickupLat: KIGALI.lat,
      pickupLng: KIGALI.lng,
      destinationLat: KIGALI.lat + 0.02,  // ~2.2 km north
      destinationLng: KIGALI.lng,
      vehiclePreference: 'MOTO',
      ...overrides.journey,
    },
    driver: {
      id: 'd1',
      lastLat: KIGALI.lat + 0.0005, // ~55m north
      lastLng: KIGALI.lng,
      lastLocationAt: new Date(now.getTime() - 30_000), // 30s ago
      frozenAt: null,
      ...overrides.driver,
    },
    rule: rule(overrides.rule),
    now,
  };
}

describe('auto-bid/evaluator — ruleMatches', () => {
  it('returns true when journey is within all bounds', () => {
    expect(ruleMatches(ctx())).toBe(true);
  });

  it('returns false when pickup distance exceeds maxPickupDistanceM', () => {
    expect(
      ruleMatches(
        ctx({ rule: { maxPickupDistanceM: 10 } }),
      ),
    ).toBe(false);
  });

  it('returns false when ride distance exceeds maxRideDistanceM', () => {
    expect(
      ruleMatches(
        ctx({ rule: { maxRideDistanceM: 100 } }),
      ),
    ).toBe(false);
  });

  it('returns false when vehicleTypeFilter does not match', () => {
    expect(
      ruleMatches(
        ctx({
          rule: { vehicleTypeFilter: 'BIKE' },
          journey: { vehiclePreference: 'MOTO' },
        }),
      ),
    ).toBe(false);
  });

  // ANY-VEHICLE G4 — the both-ways proof for the null-preference fix.
  //
  // A filtered rule used to skip every any-vehicle journey, because a
  // plain !== reads a null preference as "not my kind". It is the
  // opposite: a job open to every vehicle is open to this one too. The
  // cases below are the whole semantics — pass on null for every filter
  // value, still skip on a real mismatch, still fire on a real match,
  // the null-filter ("any machine") case untouched, and the other gates
  // still doing their own work.
  it('a filtered rule FIRES on a null-preference (any-vehicle) journey', () => {
    expect(
      ruleMatches(
        ctx({
          rule: { vehicleTypeFilter: 'BIKE' },
          journey: { vehiclePreference: null },
        }),
      ),
    ).toBe(true);
  });

  it('...for every filter value, not just one', () => {
    for (const filter of ['BIKE', 'MOTO', 'E_MOTO', 'E_BIKE']) {
      expect(
        ruleMatches(
          ctx({
            rule: { vehicleTypeFilter: filter },
            journey: { vehiclePreference: null },
          }),
        ),
      ).toBe(true);
    }
  });

  it('...while a MISMATCHED explicit preference still skips', () => {
    expect(
      ruleMatches(
        ctx({
          rule: { vehicleTypeFilter: 'E_MOTO' },
          journey: { vehiclePreference: 'BIKE' },
        }),
      ),
    ).toBe(false);
  });

  it('...and a MATCHING explicit preference still fires', () => {
    expect(
      ruleMatches(
        ctx({
          rule: { vehicleTypeFilter: 'MOTO' },
          journey: { vehiclePreference: 'MOTO' },
        }),
      ),
    ).toBe(true);
  });

  it('a null filter ("any machine") is unchanged in both directions', () => {
    expect(
      ruleMatches(
        ctx({ rule: { vehicleTypeFilter: null }, journey: { vehiclePreference: null } }),
      ),
    ).toBe(true);
    expect(
      ruleMatches(
        ctx({ rule: { vehicleTypeFilter: null }, journey: { vehiclePreference: 'BIKE' } }),
      ),
    ).toBe(true);
  });

  it('the vehicle filter does not rescue a rule blocked for another reason', () => {
    // A null preference passes the VEHICLE gate; it must not pass the
    // distance gate with it.
    expect(
      ruleMatches(
        ctx({
          rule: { vehicleTypeFilter: 'BIKE', maxRideDistanceM: 100 },
          journey: { vehiclePreference: null },
        }),
      ),
    ).toBe(false);
  });

  it('returns false for a frozen driver (defence-in-depth)', () => {
    expect(
      ruleMatches(
        ctx({ driver: { frozenAt: new Date() } }),
      ),
    ).toBe(false);
  });

  it('returns false when driver location is stale', () => {
    const now = new Date();
    expect(
      ruleMatches(
        ctx({
          now,
          driver: {
            lastLocationAt: new Date(now.getTime() - 10 * 60 * 1000), // 10 min
          },
        }),
      ),
    ).toBe(false);
  });

  it('returns false for a disabled rule', () => {
    expect(
      ruleMatches(ctx({ rule: { enabled: false } })),
    ).toBe(false);
  });

  it('returns false when driver has no location (lastLat null)', () => {
    expect(
      ruleMatches(ctx({ driver: { lastLat: null } })),
    ).toBe(false);
  });
});

describe('auto-bid/evaluator — computeBidAmount', () => {
  it('PERCENT 110 + fairPrice 2000 → 2200 (smallest-wrongness #1)', () => {
    expect(
      computeBidAmount(
        { bidAmountMode: 'PERCENT_OF_FAIR_PRICE', bidAmountValue: 110 },
        2000,
      ),
    ).toBe(2200);
  });

  it('PERCENT 90 + fairPrice 2000 → 1800 (smallest-wrongness #2)', () => {
    expect(
      computeBidAmount(
        { bidAmountMode: 'PERCENT_OF_FAIR_PRICE', bidAmountValue: 90 },
        2000,
      ),
    ).toBe(1800);
  });

  it('FLAT 1500 returns 1500 regardless of fairPrice', () => {
    expect(
      computeBidAmount({ bidAmountMode: 'FLAT', bidAmountValue: 1500 }, 2000),
    ).toBe(1500);
    expect(
      computeBidAmount({ bidAmountMode: 'FLAT', bidAmountValue: 1500 }, null),
    ).toBe(1500);
  });

  it('PERCENT 110 + fairPrice null → null (fair-price unavailable)', () => {
    expect(
      computeBidAmount(
        { bidAmountMode: 'PERCENT_OF_FAIR_PRICE', bidAmountValue: 110 },
        null,
      ),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------
// evaluateRulesForJourney — IO path. We mock prisma + createBid +
// fair-price.service (above) to keep the test fast and deterministic.
// ---------------------------------------------------------------

function makeMockPrisma(opts: {
  driver: any;
  journey: any;
  rules: any[];
  existingBid?: any;
}) {
  return {
    user: {
      findUnique: jest.fn().mockResolvedValue(opts.driver),
    },
    journey: {
      findUnique: jest.fn().mockResolvedValue(opts.journey),
    },
    bid: {
      findUnique: jest.fn().mockResolvedValue(opts.existingBid ?? null),
      update: jest.fn().mockResolvedValue({}),
    },
    driverAutoBidRule: {
      findMany: jest.fn().mockResolvedValue(
        [...opts.rules].sort((a, b) => a.priority - b.priority),
      ),
    },
  } as any;
}

beforeEach(() => {
  jest.clearAllMocks();
  resetRateLimiter();
});

describe('auto-bid/evaluator — evaluateRulesForJourney', () => {
  const driver = {
    id: 'd1',
    frozenAt: null,
    driverProfile: {
      lastLat: KIGALI.lat + 0.0005,
      lastLng: KIGALI.lng,
      lastLocationAt: new Date(),
    },
  };
  const journey = {
    id: 'j1',
    pickupLat: KIGALI.lat,
    pickupLng: KIGALI.lng,
    destinationLat: KIGALI.lat + 0.02,
    destinationLng: KIGALI.lng,
    vehiclePreference: 'MOTO',
    estimatedDistance: 2.2,
  };

  it('fires the priority-0 rule when both rules match', async () => {
    (bidServiceMock.createBid as jest.Mock).mockResolvedValue({
      id: 'b1',
      price: 1500,
    });
    const prisma = makeMockPrisma({
      driver,
      journey,
      rules: [
        rule({ id: 'r0', priority: 0, bidAmountValue: 1500 }),
        rule({ id: 'r1', priority: 1, bidAmountValue: 1700 }),
      ],
    });
    const result = await evaluateRulesForJourney(prisma, 'd1', 'j1', null);
    expect(result.fired).toBe(true);
    expect(result.ruleId).toBe('r0');
    expect(result.bidAmount).toBe(1500);
    expect(bidServiceMock.createBid).toHaveBeenCalledWith('j1', 'd1', 1500, expect.any(Number));
  });

  it('returns no-match when no rule matches', async () => {
    const prisma = makeMockPrisma({
      driver,
      journey,
      rules: [
        rule({ id: 'r0', priority: 0, maxPickupDistanceM: 1 }),
      ],
    });
    const result = await evaluateRulesForJourney(prisma, 'd1', 'j1', null);
    expect(result.fired).toBe(false);
    expect(result.reason).toBe('no-match');
  });

  it('returns driver-frozen for a frozen driver even if rule matches', async () => {
    const prisma = makeMockPrisma({
      driver: { ...driver, frozenAt: new Date() },
      journey,
      rules: [rule()],
    });
    const result = await evaluateRulesForJourney(prisma, 'd1', 'j1', null);
    expect(result.fired).toBe(false);
    expect(result.reason).toBe('driver-frozen');
  });

  it('returns already-bid when driver already has a Bid on this journey', async () => {
    const prisma = makeMockPrisma({
      driver,
      journey,
      rules: [rule()],
      existingBid: { id: 'existing', journeyId: 'j1', driverId: 'd1' },
    });
    const result = await evaluateRulesForJourney(prisma, 'd1', 'j1', null);
    expect(result.fired).toBe(false);
    expect(result.reason).toBe('already-bid');
  });

  it('PERCENT mode fires with the computed fairPrice × percent', async () => {
    (bidServiceMock.createBid as jest.Mock).mockResolvedValue({
      id: 'b2',
      price: 0,
    });
    const prisma = makeMockPrisma({
      driver,
      journey,  // estimatedDistance 2.2 km → fairPrice midpoint (300+200*2.2 + 300+400*2.2)/2 = 960
      rules: [
        rule({
          id: 'rPct',
          bidAmountMode: 'PERCENT_OF_FAIR_PRICE',
          bidAmountValue: 110,
        }),
      ],
    });
    const result = await evaluateRulesForJourney(prisma, 'd1', 'j1', null);
    expect(result.fired).toBe(true);
    // (300 + 200*2.2 + 300 + 400*2.2)/2 = (740 + 1180)/2 = 960; 960 * 1.10 = 1056.
    expect(result.bidAmount).toBe(1056);
  });
});
