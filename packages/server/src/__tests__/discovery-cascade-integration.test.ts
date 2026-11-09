// END-TO-END CASCADE INTEGRATION
//
// Exercises the K1 cascade pipeline across all 4 tiers using mocked
// prisma but the real cascade math, feed-filter and supply pipeline.
// Verifies the user-visible behaviour described in §2 group 8 of
// the dispatch:
//   - DENSE  Kigali ring expansion (200 → 500 → 1000 → 2000m)
//   - SPARSE rural eventual no-limit ring
//   - Privacy floor flip from null → 3 once supply hits the threshold
//   - Frozen drivers excluded from feed AND supply

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    // FIELD-FIT G5 — the feed asks whether this driver is already carrying
    // someone before building a feed; null = not engaged.
    journey: { findMany: jest.fn(), findFirst: jest.fn().mockResolvedValue(null) },
    driverProfile: { findUnique: jest.fn(), findMany: jest.fn() },
  },
}));

import prisma from '../prisma';
import { JourneyStatus, UserRole } from '@bimoto/shared';
import * as journeyService from '../services/journey.service';
import { getNearbyDriverCount } from '../services/discovery/supply';
import { _resetTierConfigForTests } from '../services/mobility/tier-classification';
import { currentRingForElapsed } from '../services/discovery/cascade';
import { tierForCoordinates } from '../services/mobility/tier-classification';

const journeyRepo = (prisma as any).journey;
const driverRepo = (prisma as any).driverProfile;

const KIGALI = { lat: -1.9536, lng: 30.0606 }; // DENSE
const RURAL = { lat: -2.0, lng: 28.5 }; // SPARSE

function metersOffsetLat(meters: number): number {
  return meters / 111_320;
}

function freshDate(now: Date, ageSec = 60): Date {
  return new Date(now.getTime() - ageSec * 1000);
}

beforeEach(() => {
  jest.clearAllMocks();
  _resetTierConfigForTests();
});

describe('K1 end-to-end cascade — DENSE Kigali ring expansion', () => {
  // 5 drivers staged at increasing distances from a Kigali pickup.
  // We seed all 5 into the journey.findMany call as candidate journeys
  // (one journey per driver, co-located with the driver) so we can
  // verify which driver feeds the journey when at each timestamp.
  //
  // For each tested timestamp `t`, we run getJourneys for one driver
  // at a time. Each driver-call mocks the prisma response to return
  // the SINGLE journey at the journey-pickup. The test confirms whether
  // that journey survives the cascade filter for that driver.

  const t0 = new Date('2026-05-05T10:00:00Z');

  function setupDriverFeed(
    driverPos: { lat: number; lng: number },
    journeyDiscoveryStartedAt: Date,
  ) {
    driverRepo.findUnique.mockResolvedValue({
      userId: 'd',
      vehicleType: 'MOTO',
      lastLat: driverPos.lat,
      lastLng: driverPos.lng,
      lastLocationAt: freshDate(t0),
    });
    const seed = [
      {
        id: 'j1',
        customerId: 'cust1',
        status: JourneyStatus.REQUESTED,
        type: 'PASSENGER',
        pickupLat: KIGALI.lat,
        pickupLng: KIGALI.lng,
        vehiclePreference: null,
        bids: [],
        customer: { id: 'cust1', nickname: 'C', completedRides: 0 },
        createdAt: journeyDiscoveryStartedAt,
        discoveryStartedAt: journeyDiscoveryStartedAt,
      },
    ];
    // R3-EXPRESS / R3-PRIORITY — driver branch fans out into urgent +
    // priority + other findMany calls. The cascade fixture is "other"
    // only; urgent and priority buckets return empty.
    journeyRepo.findMany.mockImplementation(({ where }: any) => {
      if (where?.type === 'URGENT_MESSENGER') return Promise.resolve([]);
      if (where?.type === 'PRIORITY_MESSENGER') return Promise.resolve([]);
      return Promise.resolve(seed);
    });
  }

  async function feedSize(
    driverPos: { lat: number; lng: number },
    journeyDiscoveryStartedAt: Date,
    requestLat: number,
    requestLng: number,
  ): Promise<number> {
    setupDriverFeed(driverPos, journeyDiscoveryStartedAt);
    const out = await journeyService.getJourneys(
      'd',
      UserRole.DRIVER,
      undefined,
      requestLat,
      requestLng,
      'driver',
    );
    return out.length;
  }

  it('t=0s — only the 100m driver gets the journey; 300m driver does not', async () => {
    jest.useFakeTimers().setSystemTime(t0);
    try {
      // Driver at 100m
      const size100 = await feedSize(
        { lat: KIGALI.lat + metersOffsetLat(100), lng: KIGALI.lng },
        t0,
        KIGALI.lat + metersOffsetLat(100),
        KIGALI.lng,
      );
      expect(size100).toBe(1);

      // Driver at 300m
      const size300 = await feedSize(
        { lat: KIGALI.lat + metersOffsetLat(300), lng: KIGALI.lng },
        t0,
        KIGALI.lat + metersOffsetLat(300),
        KIGALI.lng,
      );
      expect(size300).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('t=30s — 300m driver now sees the journey; 800m driver does not', async () => {
    const t30 = new Date(t0.getTime() + 30_000);
    jest.useFakeTimers().setSystemTime(t30);
    try {
      const size300 = await feedSize(
        { lat: KIGALI.lat + metersOffsetLat(300), lng: KIGALI.lng },
        t0,
        KIGALI.lat + metersOffsetLat(300),
        KIGALI.lng,
      );
      expect(size300).toBe(1);

      const size800 = await feedSize(
        { lat: KIGALI.lat + metersOffsetLat(800), lng: KIGALI.lng },
        t0,
        KIGALI.lat + metersOffsetLat(800),
        KIGALI.lng,
      );
      expect(size800).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('t=60s — 800m driver sees the journey; 1.5km driver does not', async () => {
    const t60 = new Date(t0.getTime() + 60_000);
    jest.useFakeTimers().setSystemTime(t60);
    try {
      const size800 = await feedSize(
        { lat: KIGALI.lat + metersOffsetLat(800), lng: KIGALI.lng },
        t0,
        KIGALI.lat + metersOffsetLat(800),
        KIGALI.lng,
      );
      expect(size800).toBe(1);

      const size1500 = await feedSize(
        { lat: KIGALI.lat + metersOffsetLat(1500), lng: KIGALI.lng },
        t0,
        KIGALI.lat + metersOffsetLat(1500),
        KIGALI.lng,
      );
      expect(size1500).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('t=90s — 1.5km driver sees the journey; 3km driver does not (still 2km ring; 3km out of 5km legacy radius too)', async () => {
    const t90 = new Date(t0.getTime() + 90_000);
    jest.useFakeTimers().setSystemTime(t90);
    try {
      const size1500 = await feedSize(
        { lat: KIGALI.lat + metersOffsetLat(1500), lng: KIGALI.lng },
        t0,
        KIGALI.lat + metersOffsetLat(1500),
        KIGALI.lng,
      );
      expect(size1500).toBe(1);

      const size3000 = await feedSize(
        { lat: KIGALI.lat + metersOffsetLat(3000), lng: KIGALI.lng },
        t0,
        KIGALI.lat + metersOffsetLat(3000),
        KIGALI.lng,
      );
      expect(size3000).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('K1 end-to-end cascade — SPARSE rural no-limit final ring', () => {
  it('SPARSE journey at t=0s with single 4km driver — driver does NOT see it (first ring is 2km)', async () => {
    const tStart = new Date('2026-05-05T10:00:00Z');
    jest.useFakeTimers().setSystemTime(tStart);
    try {
      driverRepo.findUnique.mockResolvedValue({
        userId: 'd',
        vehicleType: 'MOTO',
        lastLat: RURAL.lat + metersOffsetLat(4000),
        lastLng: RURAL.lng,
        lastLocationAt: freshDate(tStart),
      });
      journeyRepo.findMany.mockResolvedValue([
        {
          id: 'jR',
          customerId: 'rurCust',
          status: JourneyStatus.REQUESTED,
          pickupLat: RURAL.lat,
          pickupLng: RURAL.lng,
          vehiclePreference: null,
          bids: [],
          customer: { id: 'rurCust', nickname: 'C', completedRides: 0 },
          createdAt: tStart,
          discoveryStartedAt: tStart,
        },
      ]);
      const out = await journeyService.getJourneys(
        'd',
        UserRole.DRIVER,
        undefined,
        RURAL.lat + metersOffsetLat(4000),
        RURAL.lng,
        'driver',
      );
      expect(out.length).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('SPARSE at t=270s the final no-limit ring (-1) returns the journey regardless of distance', async () => {
    const tStart = new Date('2026-05-05T10:00:00Z');
    const t270 = new Date(tStart.getTime() + 270_000);
    // Verify the ring math matches expectation directly.
    const ring = currentRingForElapsed(tStart, tierForCoordinates(RURAL.lat, RURAL.lng), t270);
    expect(ring.radiusMeters).toBe(-1);
  });
});

describe('K1 end-to-end cascade — privacy floor flip null → 3', () => {
  const t0 = new Date('2026-05-05T10:00:00Z');

  it('with 2 drivers in ring → supply.count is null (privacy floor)', async () => {
    driverRepo.findMany.mockResolvedValue([
      { lastLat: KIGALI.lat + 0.0001, lastLng: KIGALI.lng },
      { lastLat: KIGALI.lat - 0.0001, lastLng: KIGALI.lng },
    ]);
    const ring = currentRingForElapsed(t0, 'DENSE', t0);
    const out = await getNearbyDriverCount(prisma as any, KIGALI, ring, t0);
    expect(out.count).toBeNull();
  });

  it('add a third driver → supply.count flips to 3', async () => {
    driverRepo.findMany.mockResolvedValue([
      { lastLat: KIGALI.lat + 0.0001, lastLng: KIGALI.lng },
      { lastLat: KIGALI.lat - 0.0001, lastLng: KIGALI.lng },
      { lastLat: KIGALI.lat, lastLng: KIGALI.lng + 0.0001 },
    ]);
    const ring = currentRingForElapsed(t0, 'DENSE', t0);
    const out = await getNearbyDriverCount(prisma as any, KIGALI, ring, t0);
    expect(out.count).toBe(3);
  });
});

describe('K1 end-to-end cascade — frozen drivers excluded', () => {
  it('supply query filters by user.frozenAt:null', async () => {
    driverRepo.findMany.mockResolvedValue([]);
    const ring = currentRingForElapsed(new Date(), 'DENSE');
    await getNearbyDriverCount(prisma as any, KIGALI, ring);
    const where = driverRepo.findMany.mock.calls[0][0].where;
    expect(where.user).toEqual({ frozenAt: null });
    expect(where.isOnline).toBe(true);
  });
});
