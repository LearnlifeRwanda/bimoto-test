import { filterJourneysByCascade } from '../feed-filter';
import { _resetTierConfigForTests } from '../../mobility/tier-classification';

const KIGALI = { lat: -1.9536, lng: 30.0606 }; // DENSE
const RURAL = { lat: -2.0, lng: 28.5 }; // SPARSE

function offsetMeters(
  point: { lat: number; lng: number },
  meters: number,
): { lat: number; lng: number } {
  const dLat = meters / 111_320;
  return { lat: point.lat + dLat, lng: point.lng };
}

function makeJourney(
  id: string,
  pickup: { lat: number; lng: number },
  startedAtMsAgo: number,
  now: Date,
) {
  return {
    id,
    pickupLat: pickup.lat,
    pickupLng: pickup.lng,
    createdAt: new Date(now.getTime() - startedAtMsAgo),
    discoveryStartedAt: new Date(now.getTime() - startedAtMsAgo),
  };
}

const FRESH_LOC_AGE_SEC = 60;

beforeEach(() => {
  _resetTierConfigForTests();
});

describe('discovery/feed-filter — DENSE Kigali ring expansion', () => {
  const t0 = new Date('2026-05-05T10:00:00Z');

  it('t=0s: only the 100m journey is visible to a driver at Kigali centre', () => {
    const driver = {
      lastLat: KIGALI.lat,
      lastLng: KIGALI.lng,
      lastLocationAt: new Date(t0.getTime() - FRESH_LOC_AGE_SEC * 1000),
    };
    const candidates = [
      makeJourney('J100', offsetMeters(KIGALI, 100), 0, t0),
      makeJourney('J400', offsetMeters(KIGALI, 400), 0, t0),
      makeJourney('J1500', offsetMeters(KIGALI, 1500), 0, t0),
    ];
    const out = filterJourneysByCascade(driver, candidates, t0).map((j) => j.id);
    expect(out).toEqual(['J100']);
  });

  it('t=30s: ring expands to 500m → J100 + J400 visible', () => {
    const t30 = new Date(t0.getTime() + 30_000);
    const driver = {
      lastLat: KIGALI.lat,
      lastLng: KIGALI.lng,
      lastLocationAt: new Date(t30.getTime() - FRESH_LOC_AGE_SEC * 1000),
    };
    const candidates = [
      makeJourney('J100', offsetMeters(KIGALI, 100), 30_000, t30),
      makeJourney('J400', offsetMeters(KIGALI, 400), 30_000, t30),
      makeJourney('J1500', offsetMeters(KIGALI, 1500), 30_000, t30),
    ];
    const out = filterJourneysByCascade(driver, candidates, t30).map((j) => j.id);
    expect(out.sort()).toEqual(['J100', 'J400']);
  });

  it('t=90s: ring at 2km → all three visible', () => {
    const t90 = new Date(t0.getTime() + 90_000);
    const driver = {
      lastLat: KIGALI.lat,
      lastLng: KIGALI.lng,
      lastLocationAt: new Date(t90.getTime() - FRESH_LOC_AGE_SEC * 1000),
    };
    const candidates = [
      makeJourney('J100', offsetMeters(KIGALI, 100), 90_000, t90),
      makeJourney('J400', offsetMeters(KIGALI, 400), 90_000, t90),
      makeJourney('J1500', offsetMeters(KIGALI, 1500), 90_000, t90),
    ];
    const out = filterJourneysByCascade(driver, candidates, t90).map((j) => j.id);
    expect(out.sort()).toEqual(['J100', 'J1500', 'J400']);
  });
});

describe('discovery/feed-filter — driver freshness gate', () => {
  const t0 = new Date('2026-05-05T10:00:00Z');

  it('driver with stale location (>5 min) sees nothing', () => {
    const staleDriver = {
      lastLat: KIGALI.lat,
      lastLng: KIGALI.lng,
      lastLocationAt: new Date(t0.getTime() - 10 * 60 * 1000),
    };
    const candidates = [makeJourney('J100', offsetMeters(KIGALI, 100), 0, t0)];
    expect(filterJourneysByCascade(staleDriver, candidates, t0)).toEqual([]);
  });

  it('driver with no location at all sees nothing', () => {
    const driver = {
      lastLat: null,
      lastLng: null,
      lastLocationAt: null,
    };
    const candidates = [makeJourney('J100', offsetMeters(KIGALI, 100), 0, t0)];
    expect(filterJourneysByCascade(driver, candidates, t0)).toEqual([]);
  });
});

describe('discovery/feed-filter — SPARSE no-limit final ring', () => {
  it('SPARSE last ring (-1) returns all journeys regardless of distance', () => {
    const t0 = new Date('2026-05-05T10:00:00Z');
    const t300 = new Date(t0.getTime() + 300_000);
    const driver = {
      // Driver 4km from a rural pickup
      lastLat: RURAL.lat + 4000 / 111_320,
      lastLng: RURAL.lng,
      lastLocationAt: new Date(t300.getTime() - FRESH_LOC_AGE_SEC * 1000),
    };
    const candidates = [makeJourney('JFAR', RURAL, 300_000, t300)];
    expect(
      filterJourneysByCascade(driver, candidates, t300).map((j) => j.id),
    ).toEqual(['JFAR']);
  });

  it('SPARSE first ring (2km): driver 4km away does NOT see the journey at t=0', () => {
    const t0 = new Date('2026-05-05T10:00:00Z');
    const driver = {
      lastLat: RURAL.lat + 4000 / 111_320,
      lastLng: RURAL.lng,
      lastLocationAt: new Date(t0.getTime() - FRESH_LOC_AGE_SEC * 1000),
    };
    const candidates = [makeJourney('JFAR', RURAL, 0, t0)];
    expect(filterJourneysByCascade(driver, candidates, t0)).toEqual([]);
  });
});

describe('discovery/feed-filter — fallback to createdAt when discoveryStartedAt is null', () => {
  it('uses createdAt when discoveryStartedAt is null (legacy rows)', () => {
    const t0 = new Date('2026-05-05T10:00:00Z');
    const driver = {
      lastLat: KIGALI.lat,
      lastLng: KIGALI.lng,
      lastLocationAt: new Date(t0.getTime() - FRESH_LOC_AGE_SEC * 1000),
    };
    const candidates = [
      {
        id: 'JLEGACY',
        pickupLat: KIGALI.lat,
        pickupLng: KIGALI.lng,
        createdAt: t0,
        discoveryStartedAt: null,
      },
    ];
    expect(
      filterJourneysByCascade(driver, candidates, t0).map((j) => j.id),
    ).toEqual(['JLEGACY']);
  });
});

describe('discovery/feed-filter — R3-PRIORITY half-speed cascade', () => {
  // DENSE Kigali rings: 200, 500, 1000, 2000m at 30s each. PRIORITY
  // halves the per-ring duration so PRIORITY at elapsed=N is at the
  // same ring as NORMAL at elapsed=2N. Concretely: NORMAL at t=15s is
  // still in ring 0 (0-29s); PRIORITY at t=15s is in ring 1 (apparent
  // elapsed = 30s, i.e. the 500m ring).
  const t0 = new Date('2026-05-05T10:00:00Z');

  it('PRIORITY journey at t=15s reaches the 500m ring while NORMAL is still at 200m', () => {
    const t15 = new Date(t0.getTime() + 15_000);
    const driver = {
      // 350m north of pickup — outside ring 0 (200m), inside ring 1 (500m).
      lastLat: KIGALI.lat + 350 / 111_320,
      lastLng: KIGALI.lng,
      lastLocationAt: new Date(t15.getTime() - FRESH_LOC_AGE_SEC * 1000),
    };
    const candidates = [
      {
        id: 'JNORMAL',
        pickupLat: KIGALI.lat,
        pickupLng: KIGALI.lng,
        createdAt: t0,
        discoveryStartedAt: t0,
        type: 'GOODS',
      },
      {
        id: 'JPRIORITY',
        pickupLat: KIGALI.lat,
        pickupLng: KIGALI.lng,
        createdAt: t0,
        discoveryStartedAt: t0,
        type: 'PRIORITY_MESSENGER',
      },
    ];
    // The PRIORITY trip must be visible to the 350m driver; the NORMAL
    // trip at the same elapsed must not be. If the wire was not
    // installed (or installed with a copy-paste typo that still calls
    // currentRingForElapsed for PRIORITY), both rings are identical
    // and this assertion fails immediately.
    const visible = filterJourneysByCascade(driver, candidates, t15).map(
      (j) => j.id,
    );
    expect(visible).toEqual(['JPRIORITY']);
  });

  it('URGENT branch is preserved (PRIORITY does NOT short-circuit to final ring)', () => {
    // 1500m driver — outside ring 0 (200m) and ring 1 (500m), inside
    // ring 2 (1000m boundary check passes only at 1000m, and 1500m is
    // inside ring 3 = 2000m). At t=0, NORMAL sees nothing past 200m,
    // PRIORITY sees nothing past 200m either (apparent elapsed = 0).
    // URGENT shorts to the final 2000m ring, so URGENT is visible.
    const driver = {
      lastLat: KIGALI.lat + 1500 / 111_320,
      lastLng: KIGALI.lng,
      lastLocationAt: new Date(t0.getTime() - FRESH_LOC_AGE_SEC * 1000),
    };
    const candidates = [
      {
        id: 'JURGENT',
        pickupLat: KIGALI.lat,
        pickupLng: KIGALI.lng,
        createdAt: t0,
        discoveryStartedAt: t0,
        type: 'URGENT_MESSENGER',
      },
      {
        id: 'JPRIORITY',
        pickupLat: KIGALI.lat,
        pickupLng: KIGALI.lng,
        createdAt: t0,
        discoveryStartedAt: t0,
        type: 'PRIORITY_MESSENGER',
      },
      {
        id: 'JNORMAL',
        pickupLat: KIGALI.lat,
        pickupLng: KIGALI.lng,
        createdAt: t0,
        discoveryStartedAt: t0,
        type: 'GOODS',
      },
    ];
    const visible = filterJourneysByCascade(driver, candidates, t0).map(
      (j) => j.id,
    );
    expect(visible).toEqual(['JURGENT']);
  });

  it('PRIORITY at t=0 matches NORMAL at t=0 (both at ring 0 = 200m)', () => {
    // Discoverability sanity: at the moment a journey is created, the
    // half-speed cascade has had no time to run, so the ring must
    // match NORMAL. A PRIORITY trip should not be visible to a 1500m
    // driver at t=0 (otherwise PRIORITY would behave like URGENT).
    const driver = {
      lastLat: KIGALI.lat + 1500 / 111_320,
      lastLng: KIGALI.lng,
      lastLocationAt: new Date(t0.getTime() - FRESH_LOC_AGE_SEC * 1000),
    };
    const candidates = [
      {
        id: 'JPRIORITY',
        pickupLat: KIGALI.lat,
        pickupLng: KIGALI.lng,
        createdAt: t0,
        discoveryStartedAt: t0,
        type: 'PRIORITY_MESSENGER',
      },
    ];
    expect(filterJourneysByCascade(driver, candidates, t0)).toEqual([]);
  });
});
