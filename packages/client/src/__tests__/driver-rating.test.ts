// Tests for the shared driver-rating accessor (Dispatch RATE-DISPLAY).
//
// The accessor is the ONE place that knows the driver-ish shapes the
// client receives: the bids payload's flat driver, the journey
// payload's raw nested driverProfile (Decimal avgRating serialized as
// a string), the auth-store user, and the legacy top-level fields.
import { describe, test, expect } from 'vitest';

import { getDriverRatingInfo } from '../lib/driver-rating';

describe('getDriverRatingInfo — RATE-DISPLAY', () => {
  test('reads the bids-payload shape (flat driver with avgRating/totalRides)', () => {
    const bid = {
      id: 'b1',
      price: 2000,
      driver: { nickname: 'Joe', avgRating: 4.6, totalRides: 23 },
    };
    expect(getDriverRatingInfo(bid)).toEqual({
      avgRating: 4.6,
      completedRides: 23,
    });
  });

  test('reads the journey-payload shape (nested driverProfile, Decimal-as-string avgRating)', () => {
    const driver = {
      nickname: 'Joe',
      driverProfile: { avgRating: '4.50', totalRides: 12 },
    };
    expect(getDriverRatingInfo(driver)).toEqual({
      avgRating: 4.5,
      completedRides: 12,
    });
  });

  test('reads the legacy top-level fields (driverRating/driverTotalRides)', () => {
    const bid = { driverRating: 4.8, driverTotalRides: 30 };
    expect(getDriverRatingInfo(bid)).toEqual({
      avgRating: 4.8,
      completedRides: 30,
    });
  });

  test('reads the offline LocalBid shape (driverRating/driverRides)', () => {
    const row = { driverRating: 3.9, driverRides: 7 };
    expect(getDriverRatingInfo(row)).toEqual({
      avgRating: 3.9,
      completedRides: 7,
    });
  });

  test('avgRating 0 means never rated → null (ratings are 1..5)', () => {
    const bid = { driver: { avgRating: 0, totalRides: 3 } };
    expect(getDriverRatingInfo(bid)).toEqual({
      avgRating: null,
      completedRides: 3,
    });
  });

  test('missing rides count → completedRides null, rating still read', () => {
    const driver = { avgRating: 4.2 };
    expect(getDriverRatingInfo(driver)).toEqual({
      avgRating: 4.2,
      completedRides: null,
    });
  });

  test('handles null / undefined / non-object / empty sources without throwing', () => {
    const empty = { avgRating: null, completedRides: null };
    expect(getDriverRatingInfo(null)).toEqual(empty);
    expect(getDriverRatingInfo(undefined)).toEqual(empty);
    expect(getDriverRatingInfo('not-an-object')).toEqual(empty);
    expect(getDriverRatingInfo({})).toEqual(empty);
  });

  test('non-numeric garbage in rating fields → null, never NaN', () => {
    const bid = { driver: { avgRating: 'not-a-number', totalRides: 'nope' } };
    expect(getDriverRatingInfo(bid)).toEqual({
      avgRating: null,
      completedRides: null,
    });
  });
});
