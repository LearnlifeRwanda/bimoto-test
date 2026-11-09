// LIB/DRIVER-RATING.TS
//
// Dispatch RATE-DISPLAY — the ONE shared accessor for "extract rating
// info from a driver-ish object". The same driver reaches the client in
// several shapes:
//
//   1. Bid payload (GET /journeys/:id/bids, bid.service.ts):
//      bid.driver = { avgRating: number, totalRides: number, ... }
//      (avgRating already Number()-coerced server-side; 0 = never rated,
//      since MIN_RATING is 1).
//   2. Journey payload (GET /journeys/:id, journey.service.ts):
//      journey.driver = { nickname, driverProfile: <raw DriverProfile> }
//      where driverProfile.avgRating is a Prisma Decimal that JSON-
//      serializes as a STRING (e.g. "4.5") — hence the Number() below.
//   3. Auth-store user: user.driverProfile = { avgRating, totalRides }
//      (same raw-profile shape as 2's nested object).
//   4. Legacy / offline rows (LocalBid, older test fixtures):
//      { driverRating: number, driverTotalRides | driverRides: number }.
//
// avgRating === 0 (or missing / non-numeric) means "never rated" and
// maps to null so callers render a calm "New driver" label instead of
// NaN or 0.0 stars.

export interface DriverRatingInfo {
  /** Average star rating (1..5), or null when the driver has never been rated. */
  avgRating: number | null;
  /** Driver's completed-rides count, or null when the payload doesn't carry it. */
  completedRides: number | null;
}

function firstFinite(...candidates: unknown[]): number | null {
  for (const c of candidates) {
    if (c === null || c === undefined || c === '') continue;
    const n = Number(c);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function getDriverRatingInfo(source: unknown): DriverRatingInfo {
  if (source === null || typeof source !== 'object') {
    return { avgRating: null, completedRides: null };
  }

  const obj = source as Record<string, unknown>;
  // Accept a whole bid/journey-ish object: prefer its nested driver.
  const driver =
    obj.driver !== null && typeof obj.driver === 'object'
      ? (obj.driver as Record<string, unknown>)
      : obj;
  const profile =
    driver.driverProfile !== null && typeof driver.driverProfile === 'object'
      ? (driver.driverProfile as Record<string, unknown>)
      : null;

  const rawAvg = firstFinite(
    profile?.avgRating,
    driver.avgRating,
    obj.driverRating,
  );
  const rawRides = firstFinite(
    profile?.totalRides,
    driver.totalRides,
    obj.driverTotalRides,
    obj.driverRides,
  );

  return {
    // 0 means "no ratings yet" (ratings are 1..5), not a zero-star driver.
    avgRating: rawAvg !== null && rawAvg > 0 ? rawAvg : null,
    completedRides: rawRides !== null && rawRides >= 0 ? rawRides : null,
  };
}
