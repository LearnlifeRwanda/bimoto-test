import { estimateMinutes, haversineMetres } from '../services/eta';

describe('eta estimator', () => {
  test('returns high confidence and ~2-3 minutes for a ~1km trip on a moto', () => {
    // Two Kigali points that are roughly 1.0 km apart.
    // Approx: at -1.95 lat, 1 deg lng ≈ 111.32 km * cos(1.95°) ≈ 111.26 km;
    // so 0.009 deg lng ≈ 1001 m.
    const eta = estimateMinutes(-1.95, 30.06, -1.95, 30.069, 'MOTO');
    expect(eta.minutes).toBeGreaterThanOrEqual(2);
    expect(eta.minutes).toBeLessThanOrEqual(3);
    // 1.001 km is *just* over the 1km high-confidence cutoff, so med is correct.
    expect(eta.confidence).toBe('med');
  });

  test('high confidence when distance is well under 1km', () => {
    const eta = estimateMinutes(-1.95, 30.06, -1.951, 30.061, 'MOTO');
    expect(eta.confidence).toBe('high');
    expect(eta.minutes).toBeGreaterThanOrEqual(1);
  });

  test('low confidence when distance is well above 5km', () => {
    const eta = estimateMinutes(-1.95, 30.06, -1.85, 30.16, 'MOTO');
    expect(eta.confidence).toBe('low');
  });

  test('CAR mode is slower than MOTO mode', () => {
    const moto = estimateMinutes(-1.95, 30.06, -1.95, 30.10, 'MOTO');
    const car = estimateMinutes(-1.95, 30.06, -1.95, 30.10, 'CAR');
    expect(car.minutes).toBeGreaterThanOrEqual(moto.minutes);
  });

  test('haversineMetres returns 0 for identical points', () => {
    expect(haversineMetres(-1.95, 30.06, -1.95, 30.06)).toBe(0);
  });
});
