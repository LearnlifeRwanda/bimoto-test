// ANY-VEHICLE G2 — the trip-duration estimate is a RANGE, and an honest one.
//
// This helper exists because nothing in the codebase routes
// pickup→destination: the ETA service answers the different question of
// how long a motari needs to REACH the pickup. So the any-vehicle
// comparison screen has to derive its duration column, and the one
// thing it must never do is derive a number precise enough to be read
// as a promise.
//
// What is pinned here is that shape, not the constants: that the answer
// is always a band, that faster machines get shorter bands, that the
// band brackets the cruising speed the customer is shown elsewhere for
// the same machine, and that degenerate input degrades instead of
// producing NaN.

import { VehicleType } from '../types/user.js';
import { getVehicleCompliance } from '../constants/vehicle-compliance.js';
import {
  COMPARABLE_VEHICLE_TYPES,
  estimateTripMinutesRange,
} from '../constants/trip-estimate.js';

/** The straight-line length of a fairly typical Kigali cross-town trip. */
const FIVE_KM = 5000;

describe('estimateTripMinutesRange — it is always a band', () => {
  it('returns min < max for every comparable vehicle on a real trip', () => {
    for (const vt of COMPARABLE_VEHICLE_TYPES) {
      const { minMinutes, maxMinutes } = estimateTripMinutesRange(FIVE_KM, vt);
      expect(minMinutes).toBeGreaterThan(0);
      expect(maxMinutes).toBeGreaterThan(minMinutes);
    }
  });

  it('never returns a fractional minute', () => {
    for (const vt of COMPARABLE_VEHICLE_TYPES) {
      const { minMinutes, maxMinutes } = estimateTripMinutesRange(FIVE_KM, vt);
      expect(Number.isInteger(minMinutes)).toBe(true);
      expect(Number.isInteger(maxMinutes)).toBe(true);
    }
  });

  it('is pure — the same inputs give the same answer', () => {
    const a = estimateTripMinutesRange(FIVE_KM, VehicleType.MOTO);
    const b = estimateTripMinutesRange(FIVE_KM, VehicleType.MOTO);
    expect(a).toEqual(b);
  });
});

describe('the band is ordered the way the machines are', () => {
  it('a bicycle is never quicker than a moto over the same distance', () => {
    const bike = estimateTripMinutesRange(FIVE_KM, VehicleType.BIKE);
    const moto = estimateTripMinutesRange(FIVE_KM, VehicleType.MOTO);
    expect(bike.minMinutes).toBeGreaterThan(moto.minMinutes);
    expect(bike.maxMinutes).toBeGreaterThan(moto.maxMinutes);
  });

  it('a longer trip is never a shorter estimate', () => {
    const near = estimateTripMinutesRange(2000, VehicleType.MOTO);
    const far = estimateTripMinutesRange(8000, VehicleType.MOTO);
    expect(far.minMinutes).toBeGreaterThan(near.minMinutes);
    expect(far.maxMinutes).toBeGreaterThan(near.maxMinutes);
  });
});

describe('the band brackets the cruising speed shown elsewhere', () => {
  // VehicleTypeInfoCard shows the customer a typical cruising speed per
  // vehicle kind on the SAME screen. If the band implied by this helper
  // did not contain that figure, the two surfaces would contradict each
  // other in front of the customer. These are the info card's numbers.
  const INFO_CARD_TYPICAL_KMH: Record<string, number> = {
    [VehicleType.BIKE]: 12,
    [VehicleType.E_BIKE]: 18,
    [VehicleType.MOTO]: 25,
    [VehicleType.E_MOTO]: 28,
  };

  it.each(COMPARABLE_VEHICLE_TYPES)(
    '%s — the implied speed band contains the info card figure',
    (vt) => {
      const { minMinutes, maxMinutes } = estimateTripMinutesRange(FIVE_KM, vt);
      // Implied speeds, over the SAME road distance the helper used, so
      // the winding factor cancels out of the comparison.
      const roadKm = (FIVE_KM / 1000) * 1.3;
      const fastestKmh = roadKm / (minMinutes / 60);
      const slowestKmh = roadKm / (maxMinutes / 60);
      const typical = INFO_CARD_TYPICAL_KMH[vt];

      expect(slowestKmh).toBeLessThan(typical);
      expect(fastestKmh).toBeGreaterThan(typical);
    },
  );

  it('stays under the plausibility ceiling it is derived from', () => {
    for (const vt of COMPARABLE_VEHICLE_TYPES) {
      const { minMinutes } = estimateTripMinutesRange(FIVE_KM, vt);
      const roadKm = (FIVE_KM / 1000) * 1.3;
      const fastestKmh = roadKm / (minMinutes / 60);
      expect(fastestKmh).toBeLessThan(getVehicleCompliance(vt).maxPlausibleSpeedKmh);
    }
  });
});

describe('degenerate input degrades, it does not explode', () => {
  it.each([0, -1, NaN, Infinity])('distance %p yields a finite floor band', (d) => {
    const { minMinutes, maxMinutes } = estimateTripMinutesRange(d, VehicleType.MOTO);
    expect(Number.isFinite(minMinutes)).toBe(true);
    expect(Number.isFinite(maxMinutes)).toBe(true);
    expect(minMinutes).toBeGreaterThan(0);
    expect(maxMinutes).toBeGreaterThanOrEqual(minMinutes);
  });

  it('an unknown vehicle type falls back rather than throwing', () => {
    // getVehicleCompliance's documented MOTO fallback.
    expect(estimateTripMinutesRange(FIVE_KM, 'HOVERCRAFT')).toEqual(
      estimateTripMinutesRange(FIVE_KM, VehicleType.MOTO),
    );
  });
});
