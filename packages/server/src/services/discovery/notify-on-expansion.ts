// SERVICES/DISCOVERY/NOTIFY-ON-EXPANSION.TS
//
// Bridge from the K1 cascade broadcast layer to the existing
// notification.service. Whenever the discovery cascade rings expand
// and previously-out-of-range drivers come into scope, this fans the
// "newly available journey" notification through the same plumbing
// other notifications use.
//
// De-duplication: supply-broadcast.ts owns the (journeyId, driverId)
// "already notified" registry. This module is called only with the
// list of NEWLY notified driver IDs returned by broadcastToRingDrivers
// — so each driver receives at most one notification per journey
// across the entire cascade.

import { notifyDriverOfNewlyAvailableJourney } from '../notification.service';

export function notifyDriversOfRingExpansion(
  journeyId: string,
  newlyNotifiedDriverIds: string[],
): void {
  for (const driverId of newlyNotifiedDriverIds) {
    notifyDriverOfNewlyAvailableJourney(driverId, journeyId);
  }
}
