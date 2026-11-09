// R3-N-3 — unit tests for deriveApproachStatus.
//
// Covers the four ApproachStatus branches with representative
// geometries around a Kigali pickup at (-1.95, 30.06):
//   - silent      (no GPS / stale GPS)
//   - arrived     (recent, within 50 m)
//   - approaching (recent, vector closing OR mid-range fallback)
//   - lost        (recent, > 800 m, not closing)

import {
  deriveApproachStatus,
  type GpsPointInput,
} from '../services/approach-status';

const PICKUP_LAT = -1.95;
const PICKUP_LNG = 30.06;

// 1° lat ≈ 111_320 m; helper that places a point `metresNorth` metres
// due north of the pickup (negative => south). Lng held at pickup
// so distance ≈ |metresNorth|.
function pointNorth(metresNorth: number, ageMs: number, now: Date): GpsPointInput {
  return {
    lat: PICKUP_LAT - metresNorth / 111_320,
    lng: PICKUP_LNG,
    timestamp: new Date(now.getTime() - ageMs),
  };
}

describe('deriveApproachStatus', () => {
  describe('silent branch', () => {
    test('returns silent with null distance when no GPS points are supplied', () => {
      const now = new Date();
      const result = deriveApproachStatus([], PICKUP_LAT, PICKUP_LNG, now);
      expect(result.status).toBe('silent');
      expect(result.distanceMeters).toBeNull();
      expect(result.lastGpsAt).toBeNull();
    });

    test('returns silent when the latest GPS broadcast is older than 5 minutes', () => {
      const now = new Date();
      // 5 min + 1 s old → just past the recency window.
      const points = [pointNorth(200, 5 * 60 * 1000 + 1000, now)];
      const result = deriveApproachStatus(points, PICKUP_LAT, PICKUP_LNG, now);
      expect(result.status).toBe('silent');
      expect(result.distanceMeters).not.toBeNull();
      expect(result.lastGpsAt).toEqual(points[0].timestamp);
    });

    test('returns silent for clearly stale GPS (10 min old)', () => {
      const now = new Date();
      const points = [pointNorth(150, 10 * 60 * 1000, now)];
      const result = deriveApproachStatus(points, PICKUP_LAT, PICKUP_LNG, now);
      expect(result.status).toBe('silent');
    });
  });

  describe('arrived branch', () => {
    test('returns arrived when the latest point is exactly at pickup', () => {
      const now = new Date();
      const points = [pointNorth(0, 1000, now)];
      const result = deriveApproachStatus(points, PICKUP_LAT, PICKUP_LNG, now);
      expect(result.status).toBe('arrived');
      expect(result.distanceMeters).toBeCloseTo(0, 5);
    });

    test('returns arrived when within 50m radius (10m away)', () => {
      const now = new Date();
      const points = [pointNorth(10, 1000, now)];
      const result = deriveApproachStatus(points, PICKUP_LAT, PICKUP_LNG, now);
      expect(result.status).toBe('arrived');
      expect(result.distanceMeters).toBeLessThan(50);
    });

    test('returns arrived just inside the 50m radius (40m away)', () => {
      const now = new Date();
      const points = [pointNorth(40, 1000, now)];
      const result = deriveApproachStatus(points, PICKUP_LAT, PICKUP_LNG, now);
      expect(result.status).toBe('arrived');
    });
  });

  describe('approaching branch', () => {
    test('classifies a clearly converging driver as approaching', () => {
      const now = new Date();
      // 1000m → 500m → 100m, 30s between samples.
      const points = [
        pointNorth(1000, 60_000, now),
        pointNorth(500, 30_000, now),
        pointNorth(100, 0, now),
      ];
      const result = deriveApproachStatus(points, PICKUP_LAT, PICKUP_LNG, now);
      expect(result.status).toBe('approaching');
      expect(result.distanceMeters).toBeGreaterThan(50);
      expect(result.distanceMeters).toBeLessThan(800);
    });

    test('classifies a recently-broadcasting driver near pickup as approaching, not silent', () => {
      // Smallest-wrongness gate (§8): a slow-moving but freshly-pinging
      // driver must NOT be classified silent — that would let the cancel
      // modal offer DRIVER_NO_SHOW for a driver who is in fact closing
      // the gap.
      const now = new Date();
      const points = [
        pointNorth(200, 90_000, now),
        pointNorth(150, 0, now),
      ];
      const result = deriveApproachStatus(points, PICKUP_LAT, PICKUP_LNG, now);
      expect(result.status).toBe('approaching');
    });

    test('falls back to approaching for a single recent mid-range point with no vector', () => {
      const now = new Date();
      const points = [pointNorth(400, 30_000, now)];
      const result = deriveApproachStatus(points, PICKUP_LAT, PICKUP_LNG, now);
      expect(result.status).toBe('approaching');
    });
  });

  describe('lost branch', () => {
    test('classifies a far-and-diverging driver as lost', () => {
      const now = new Date();
      const points = [
        pointNorth(900, 90_000, now),
        pointNorth(950, 30_000, now),
        pointNorth(1000, 0, now),
      ];
      const result = deriveApproachStatus(points, PICKUP_LAT, PICKUP_LNG, now);
      expect(result.status).toBe('lost');
      expect(result.distanceMeters!).toBeGreaterThan(800);
    });

    test('classifies a far-and-stationary driver (>800m, no movement) as lost', () => {
      const now = new Date();
      const points = [
        pointNorth(900, 90_000, now),
        pointNorth(900, 30_000, now),
        pointNorth(900, 0, now),
      ];
      const result = deriveApproachStatus(points, PICKUP_LAT, PICKUP_LNG, now);
      expect(result.status).toBe('lost');
    });

    test('classifies a single far recent point with no vector as lost', () => {
      const now = new Date();
      const points = [pointNorth(1000, 30_000, now)];
      const result = deriveApproachStatus(points, PICKUP_LAT, PICKUP_LNG, now);
      expect(result.status).toBe('lost');
      expect(result.distanceMeters!).toBeGreaterThan(800);
    });
  });
});
