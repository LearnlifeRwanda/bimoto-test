import { LEGAL_THRESHOLDS } from '../legal-thresholds';

// R3-CHILD — shape + invariant checks.
//
// We deliberately do NOT assert specific numerical values for the
// thresholds: that would lock the placeholders against ops
// recalibration once RESEARCH-1 returns. Instead, we assert
// structural shape (all keys present, all values positive integers)
// and the one invariant that must hold under any future calibration
// (motos must be at least as strict as bicycles).
describe('child-safety/legal-thresholds', () => {
  const REQUIRED_KEYS = [
    'MIN_AGE_MOTO_PASSENGER',
    'MIN_AGE_E_MOTO_PASSENGER',
    'MIN_AGE_BIKE_PASSENGER',
    'MIN_AGE_E_BIKE_PASSENGER',
    'MIN_AGE_UNACCOMPANIED_MINOR',
    'MAX_CHILD_HELMET_AGE_BAND',
    'MAX_CHILD_PASSENGERS_PER_VEHICLE',
  ] as const;

  it('exports all 7 required keys', () => {
    for (const key of REQUIRED_KEYS) {
      expect(LEGAL_THRESHOLDS).toHaveProperty(key);
    }
    expect(Object.keys(LEGAL_THRESHOLDS).sort()).toEqual([...REQUIRED_KEYS].sort());
  });

  it('all values are non-negative integers', () => {
    for (const key of REQUIRED_KEYS) {
      const value = LEGAL_THRESHOLDS[key];
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });

  it('motos are at least as strict as bicycles (invariant under any calibration)', () => {
    expect(LEGAL_THRESHOLDS.MIN_AGE_MOTO_PASSENGER).toBeGreaterThanOrEqual(
      LEGAL_THRESHOLDS.MIN_AGE_BIKE_PASSENGER,
    );
    expect(LEGAL_THRESHOLDS.MIN_AGE_E_MOTO_PASSENGER).toBeGreaterThanOrEqual(
      LEGAL_THRESHOLDS.MIN_AGE_E_BIKE_PASSENGER,
    );
  });

  it('MAX_CHILD_PASSENGERS_PER_VEHICLE is at least 1', () => {
    expect(LEGAL_THRESHOLDS.MAX_CHILD_PASSENGERS_PER_VEHICLE).toBeGreaterThanOrEqual(1);
  });
});
