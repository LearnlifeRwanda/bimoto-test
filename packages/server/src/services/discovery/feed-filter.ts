// SERVICES/DISCOVERY/FEED-FILTER.TS
//
// Bridge between journey.service.getJourneys and the cascade ring
// math. When a driver requests their discovery feed, REQUESTED
// journeys are filtered to only those whose CURRENT cascade ring
// contains the driver. Closest drivers see new requests first; the
// ring expands automatically over time per cascade.ts.
//
// The filter is computed on every read — no persisted ring state, no
// cron — so it survives server restarts cleanly.

import {
  currentRingForElapsed,
  currentRingForPriority,
  currentRingForUrgent,
  isDriverInCurrentRing,
} from './cascade';
import { tierForCoordinates } from '../mobility/tier-classification';

export interface CascadeJourneyShape {
  pickupLat: number;
  pickupLng: number;
  createdAt: Date;
  discoveryStartedAt: Date | null;
  // R3-T — when 'URGENT_MESSENGER', the journey skips time-based ring
  // expansion and is visible at the maximum radius from t=0.
  // R3-PRIORITY — when 'PRIORITY_MESSENGER', the journey uses the
  // half-speed cascade so the broadcast radius widens twice as fast as
  // a NORMAL trip without bypassing the cascade entirely.
  type?: string | null;
}

export interface CascadeDriverShape {
  lastLat: number | null;
  lastLng: number | null;
  lastLocationAt: Date | null;
}

export function filterJourneysByCascade<J extends CascadeJourneyShape>(
  driver: CascadeDriverShape,
  candidates: J[],
  now: Date = new Date(),
): J[] {
  return candidates.filter((j) => {
    const tier = tierForCoordinates(j.pickupLat, j.pickupLng);
    // R3-T — urgent journeys hit the widest ring immediately. The
    // time-based ring rollout would defeat the purpose of an urgent
    // dispatch, so we short-circuit to the final ring here.
    // R3-PRIORITY — priority journeys use the half-speed cascade so
    // the radius expands twice as fast as a NORMAL trip but without
    // jumping straight to the final ring.
    const start = j.discoveryStartedAt ?? j.createdAt;
    const ring =
      j.type === 'URGENT_MESSENGER'
        ? currentRingForUrgent(tier, now)
        : j.type === 'PRIORITY_MESSENGER'
          ? currentRingForPriority(start, tier, now)
          : currentRingForElapsed(start, tier, now);
    return isDriverInCurrentRing(
      driver,
      { lat: j.pickupLat, lng: j.pickupLng },
      ring,
      now,
    );
  });
}
