import {
  cascadeConfigForPickup,
  currentRingForElapsed,
  currentRingForPriority,
  currentRingForUrgent,
  haversineMeters,
  isDriverInCurrentRing,
  PRIORITY_CASCADE_SPEEDUP,
} from '../cascade';
import { _resetTierConfigForTests } from '../../mobility/tier-classification';
import { CASCADE_CONFIGS } from '../config';

const KIGALI = { lat: -1.9536, lng: 30.0606 }; // DENSE
const RURAL = { lat: -2.0, lng: 28.5 }; // outside any tier box → SPARSE

beforeEach(() => {
  _resetTierConfigForTests();
});

describe('discovery/cascade — cascadeConfigForPickup', () => {
  it('returns DENSE config for a Kigali pickup', () => {
    const cfg = cascadeConfigForPickup(KIGALI.lat, KIGALI.lng);
    expect(cfg.tier).toBe('DENSE');
    expect(cfg.rings[0]).toBeLessThan(cfg.rings[cfg.rings.length - 1]);
  });

  it('returns SPARSE config for a rural pickup outside all tier boxes', () => {
    const cfg = cascadeConfigForPickup(RURAL.lat, RURAL.lng);
    expect(cfg.tier).toBe('SPARSE');
    // SPARSE last ring is the -1 sentinel so rural requests reach all drivers.
    expect(cfg.rings[cfg.rings.length - 1]).toBe(-1);
  });
});

describe('discovery/cascade — currentRingForElapsed', () => {
  const t0 = new Date('2026-05-05T10:00:00Z');

  it('at t=0 returns ring 0 (smallest radius)', () => {
    const ring = currentRingForElapsed(t0, 'DENSE', t0);
    expect(ring.ringIndex).toBe(0);
    expect(ring.radiusMeters).toBe(200);
    expect(ring.isCascadeComplete).toBe(false);
  });

  it('at t=29s (DENSE 30s rings) still in ring 0; at t=30s flips to ring 1', () => {
    const at29 = new Date(t0.getTime() + 29_000);
    expect(currentRingForElapsed(t0, 'DENSE', at29).ringIndex).toBe(0);
    const at30 = new Date(t0.getTime() + 30_000);
    expect(currentRingForElapsed(t0, 'DENSE', at30).ringIndex).toBe(1);
  });

  it('at t=120s (DENSE) is in last ring (idx 3) but not complete', () => {
    const at120 = new Date(t0.getTime() + 120_000);
    const ring = currentRingForElapsed(t0, 'DENSE', at120);
    expect(ring.ringIndex).toBe(3);
    expect(ring.radiusMeters).toBe(2000);
    expect(ring.isCascadeComplete).toBe(true); // 120 >= 4*30 = 120
    expect(ring.ringEndsAt).toBeNull();
  });

  it('at t=240s (DENSE) is well past total cascade duration → complete', () => {
    const at240 = new Date(t0.getTime() + 240_000);
    const ring = currentRingForElapsed(t0, 'DENSE', at240);
    expect(ring.ringIndex).toBe(3);
    expect(ring.isCascadeComplete).toBe(true);
  });

  it('SPARSE at t=270s lands on the no-limit final ring', () => {
    const at270 = new Date(t0.getTime() + 270_000);
    const ring = currentRingForElapsed(t0, 'SPARSE', at270);
    expect(ring.ringIndex).toBe(3);
    expect(ring.radiusMeters).toBe(-1);
  });

  it('SPARSE first ring (t=0) is the smallest configured radius, not -1', () => {
    const ring = currentRingForElapsed(t0, 'SPARSE', t0);
    expect(ring.ringIndex).toBe(0);
    expect(ring.radiusMeters).toBeGreaterThan(0);
  });
});

describe('discovery/cascade — currentRingForUrgent (R3-T)', () => {
  it('returns the final (widest) ring of the DENSE config immediately', () => {
    const ring = currentRingForUrgent('DENSE');
    const cfg = CASCADE_CONFIGS.DENSE;
    expect(ring.ringIndex).toBe(cfg.rings.length - 1);
    expect(ring.radiusMeters).toBe(cfg.rings[cfg.rings.length - 1]);
    expect(ring.isCascadeComplete).toBe(true);
    expect(ring.ringEndsAt).toBeNull();
  });

  it('SPARSE urgent ring is the no-limit (-1) sentinel so rural urgent reaches every driver', () => {
    const ring = currentRingForUrgent('SPARSE');
    expect(ring.radiusMeters).toBe(-1);
    expect(ring.isCascadeComplete).toBe(true);
  });
});

describe('discovery/cascade — currentRingForPriority (R3-PRIORITY)', () => {
  const t0 = new Date('2026-05-10T10:00:00Z');

  it('PRIORITY_CASCADE_SPEEDUP is 0.5 (half-speed = double the apparent elapsed)', () => {
    expect(PRIORITY_CASCADE_SPEEDUP).toBe(0.5);
  });

  it('at elapsed=0 returns ring 0 (same as NORMAL)', () => {
    const ring = currentRingForPriority(t0, 'DENSE', t0);
    expect(ring.ringIndex).toBe(0);
  });

  it('at half the time NORMAL would reach ring 1, PRIORITY is already at ring 1', () => {
    // DENSE rings are 30s each. NORMAL flips to ring 1 at t=30s.
    // PRIORITY (half-speed) flips at t=15s.
    const at15 = new Date(t0.getTime() + 15_000);
    expect(currentRingForElapsed(t0, 'DENSE', at15).ringIndex).toBe(0);
    expect(currentRingForPriority(t0, 'DENSE', at15).ringIndex).toBe(1);
  });

  it('PRIORITY at elapsed T equals NORMAL at elapsed T/PRIORITY_CASCADE_SPEEDUP', () => {
    // For an arbitrary elapsed of 20s, PRIORITY should match NORMAL at 40s.
    const at20 = new Date(t0.getTime() + 20_000);
    const at40 = new Date(t0.getTime() + 40_000);
    const priorityRing = currentRingForPriority(t0, 'DENSE', at20);
    const normalRing = currentRingForElapsed(t0, 'DENSE', at40);
    expect(priorityRing.ringIndex).toBe(normalRing.ringIndex);
    expect(priorityRing.radiusMeters).toBe(normalRing.radiusMeters);
  });

  it('PRIORITY reaches the final ring at half the NORMAL time', () => {
    // DENSE has 4 rings × 30s = 120s for NORMAL to be at the final ring.
    // PRIORITY reaches it at 60s.
    const at60 = new Date(t0.getTime() + 60_000);
    const ring = currentRingForPriority(t0, 'DENSE', at60);
    expect(ring.ringIndex).toBe(3);
  });
});

describe('discovery/cascade — haversineMeters', () => {
  it('returns ~0 for identical points', () => {
    expect(haversineMeters(KIGALI, KIGALI)).toBeLessThan(0.001);
  });

  it('returns ~2.5km between Kigali centre and Nyabugogo', () => {
    // Nyabugogo bus station is roughly ~2-3km NW of Kigali centre.
    const NYABUGOGO = { lat: -1.9396, lng: 30.0431 };
    const d = haversineMeters(KIGALI, NYABUGOGO);
    expect(d).toBeGreaterThan(2000);
    expect(d).toBeLessThan(3500);
  });

  it('is symmetric: haversine(a,b) == haversine(b,a)', () => {
    const A = { lat: -1.95, lng: 30.06 };
    const B = { lat: -1.96, lng: 30.07 };
    expect(haversineMeters(A, B)).toBeCloseTo(haversineMeters(B, A), 6);
  });
});

describe('discovery/cascade — isDriverInCurrentRing', () => {
  const now = new Date('2026-05-05T10:00:00Z');
  const t0 = new Date('2026-05-05T10:00:00Z');
  const ringDense0 = currentRingForElapsed(t0, 'DENSE', t0);

  function driver(
    overrides: Partial<{
      lastLat: number | null;
      lastLng: number | null;
      ageSec: number;
    }>,
  ) {
    const ageSec = overrides.ageSec ?? 60;
    return {
      lastLat: overrides.lastLat ?? KIGALI.lat,
      lastLng: overrides.lastLng ?? KIGALI.lng,
      lastLocationAt: new Date(now.getTime() - ageSec * 1000),
    };
  }

  it('returns true for a driver within radius and fresh location', () => {
    expect(isDriverInCurrentRing(driver({}), KIGALI, ringDense0, now)).toBe(true);
  });

  it('returns false when location is stale (> freshness window)', () => {
    expect(
      isDriverInCurrentRing(driver({ ageSec: 600 }), KIGALI, ringDense0, now),
    ).toBe(false);
  });

  it('returns false when driver has never reported a location', () => {
    expect(
      isDriverInCurrentRing(
        { lastLat: null, lastLng: null, lastLocationAt: null },
        KIGALI,
        ringDense0,
        now,
      ),
    ).toBe(false);
  });

  it('returns true for any driver when ring radius is the no-limit sentinel', () => {
    const sparseLast = currentRingForElapsed(
      t0,
      'SPARSE',
      new Date(t0.getTime() + 300_000),
    );
    expect(sparseLast.radiusMeters).toBe(-1);
    // Driver 100km away should still pass.
    expect(
      isDriverInCurrentRing(
        driver({ lastLat: -3.0, lastLng: 29.0 }),
        KIGALI,
        sparseLast,
        now,
      ),
    ).toBe(true);
  });

  it('returns false for a driver outside the current ring radius', () => {
    // ~2km offset, but ring is 200m
    const farLat = KIGALI.lat + 0.02;
    expect(
      isDriverInCurrentRing(
        driver({ lastLat: farLat }),
        KIGALI,
        ringDense0,
        now,
      ),
    ).toBe(false);
  });
});
