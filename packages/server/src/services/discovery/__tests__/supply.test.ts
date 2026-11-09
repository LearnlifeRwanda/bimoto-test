import { applyPrivacyFloor, getNearbyDriverCount } from '../supply';
import type { CurrentRing } from '../types';

const KIGALI = { lat: -1.9536, lng: 30.0606 };

const ring200m: CurrentRing = {
  ringIndex: 0,
  radiusMeters: 200,
  ringStartedAt: new Date('2026-05-05T10:00:00Z'),
  ringEndsAt: new Date('2026-05-05T10:00:30Z'),
  isCascadeComplete: false,
};

describe('discovery/supply — applyPrivacyFloor', () => {
  it('SMALLEST WRONGNESS: rawCount=1 returns count=null (anonymity floor)', () => {
    const out = applyPrivacyFloor(1);
    expect(out.count).toBeNull();
    expect(out.displayHint).toBe('few');
  });

  it('rawCount=2 still below floor → count=null', () => {
    expect(applyPrivacyFloor(2).count).toBeNull();
  });

  it('rawCount=3 boundary inclusive → exact count returned', () => {
    const out = applyPrivacyFloor(3);
    expect(out.count).toBe(3);
    expect(out.displayHint).toBe('few');
  });

  it('rawCount=7 returns "some"', () => {
    const out = applyPrivacyFloor(7);
    expect(out.count).toBe(7);
    expect(out.displayHint).toBe('some');
  });

  it('rawCount=15 (just above 10) is rounded down to 15 with hint "many"', () => {
    const out = applyPrivacyFloor(15);
    expect(out.count).toBe(15);
    expect(out.displayHint).toBe('many');
  });

  it('rawCount=23 is rounded down to nearest 5 → 20', () => {
    const out = applyPrivacyFloor(23);
    expect(out.count).toBe(20);
    expect(out.displayHint).toBe('many');
  });

  it('rawCount=0 returns null with no first-bid ETA', () => {
    const out = applyPrivacyFloor(0);
    expect(out.count).toBeNull();
    expect(out.estimatedFirstBidSeconds).toBeNull();
  });
});

describe('discovery/supply — getNearbyDriverCount (DB integration via mocked prisma)', () => {
  function makePrisma(rows: Array<{ lastLat: number; lastLng: number }>) {
    return {
      driverProfile: {
        findMany: jest.fn().mockResolvedValue(rows),
      },
    } as any;
  }

  it('counts 5 drivers within 200m, excluding stale ones (stale never reach query)', async () => {
    // The query itself filters by isOnline + lastLocationAt + frozenAt;
    // we assert here that all 5 returned rows are counted and the
    // findMany WHERE clause includes those filters.
    const prisma = makePrisma([
      { lastLat: KIGALI.lat + 0.0001, lastLng: KIGALI.lng + 0.0001 },
      { lastLat: KIGALI.lat - 0.0001, lastLng: KIGALI.lng - 0.0001 },
      { lastLat: KIGALI.lat + 0.0002, lastLng: KIGALI.lng },
      { lastLat: KIGALI.lat, lastLng: KIGALI.lng + 0.0002 },
      { lastLat: KIGALI.lat + 0.001, lastLng: KIGALI.lng + 0.001 },
    ]);
    const result = await getNearbyDriverCount(prisma, KIGALI, ring200m);
    expect(result.count).toBe(5);
    const callArgs = prisma.driverProfile.findMany.mock.calls[0][0];
    expect(callArgs.where.isOnline).toBe(true);
    expect(callArgs.where.lastLocationAt).toBeDefined();
    expect(callArgs.where.user).toEqual({ frozenAt: null });
  });

  it('SMALLEST WRONGNESS: 1 driver in radius → returns count=null (privacy floor)', async () => {
    const prisma = makePrisma([
      { lastLat: KIGALI.lat + 0.0001, lastLng: KIGALI.lng + 0.0001 },
    ]);
    const result = await getNearbyDriverCount(prisma, KIGALI, ring200m);
    expect(result.count).toBeNull();
    expect(result.displayHint).toBe('few');
  });

  it('drops candidates outside ring (Haversine refine)', async () => {
    // Bounding-box prefilter would catch these since they sit inside
    // the lat/lng box, but Haversine should reject the corners that
    // are actually >200m away.
    const dLatDeg = 200 / 111_320;
    const prisma = makePrisma([
      // Far corner of the bounding box (~283m away → outside 200m circle)
      { lastLat: KIGALI.lat + dLatDeg, lastLng: KIGALI.lng + dLatDeg },
      { lastLat: KIGALI.lat - dLatDeg, lastLng: KIGALI.lng - dLatDeg },
      { lastLat: KIGALI.lat + dLatDeg, lastLng: KIGALI.lng - dLatDeg },
    ]);
    const result = await getNearbyDriverCount(prisma, KIGALI, ring200m);
    // All 3 corners >200m → count=0 → null
    expect(result.count).toBeNull();
  });

  it('with no-limit ring (-1), every returned row counts (no Haversine refine)', async () => {
    const noLimitRing: CurrentRing = {
      ...ring200m,
      ringIndex: 3,
      radiusMeters: -1,
      ringEndsAt: null,
      isCascadeComplete: true,
    };
    const prisma = makePrisma([
      { lastLat: -3.0, lastLng: 29.0 },
      { lastLat: -1.5, lastLng: 30.5 },
      { lastLat: -2.5, lastLng: 28.0 },
      { lastLat: 0.5, lastLng: 30.0 },
    ]);
    const result = await getNearbyDriverCount(prisma, KIGALI, noLimitRing);
    expect(result.count).toBe(4);
  });
});
