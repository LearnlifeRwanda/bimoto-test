// LIB/SESSION-RESET.TS
//
// LIVE-WIRE G5 — a new number is a new person on this phone.
//
// The Kigali team's item 7: "logging in with a new number kept the
// previous profile." #159 verified logout-and-switch works at the AUTH
// level, so this is state hygiene above it — and it was total.
// `auth.store.logout()` cleared `user`, `isAuthenticated` and `token`,
// and nothing else in the client was cleared or keyed by user:
//
//   - every other zustand store (journey, bid, chat, emergency alerts,
//     the frozen-account flag, diagnostics) is in-memory and survived a
//     logout→login inside one app session. A page RELOAD hid the bug,
//     which is exactly why it reached the field as "sometimes";
//   - the Dexie read caches (journeys, bids, messages, syncMeta) are
//     durable and survived an app RESTART too, keyed by nothing.
//
// WHAT IS CLEARED, and why that set:
//
//   zustand journey / bid / chat / emergency-alert stores — a previous
//     user's ride, offers, conversation and alerts. Nothing else holds
//     them; dropping them costs a refetch.
//   ui.accountFrozen — a blocking notice raised for someone else.
//   driver-liveness `active` — LOCATION-LIFE A moved the online
//     driver's heartbeat out of DashboardPage and into an app-lived
//     module, so it no longer has a page unmount to die with. This is
//     now the seam where it dies instead.
//   diagnostics — last position sent, last feed hop: another person's
//     movements, and misleading as this person's diagnostics.
//   Dexie journeys / bids / messages / syncMeta — the same set, and the
//     same argument, that ErrorBoundary's cache-clear ladder already
//     drops (components/ErrorBoundary.tsx). They are caches: the server
//     is authoritative and every one of them rebuilds on next read.
//
// WHAT DELIBERATELY SURVIVES:
//
//   Dexie mapCache / mapDownloads — the offline Kigali map is a
//     DEVICE-level asset, 30–50 MB, and contains nothing about anyone.
//     Re-downloading it on a borrowed phone would be a data-cost
//     injury with no privacy gain.
//   services/error-ledger (localStorage) — diagnostic breadcrumbs sent
//     only by the user's own deliberate hand (#158). Device-level.
//   prefs `bimoto-lang`, `hasSeenWelcome` — device preferences.
//   prefs `registrationPending` — already keyed by user id
//     (auth.store.ts), so a different account cannot inherit it.
//
//   Dexie syncEvents and gpsBuffer — NOT TOUCHED, and this is now a
//     decision rather than the reported seam it used to be. QUEUE-UNITY
//     stamped both tables with a userId (db/dexie.ts v5), so the
//     dilemma that made this a seam is gone: a row says whose it is, no
//     scoped read matches anyone else's, and the drain re-checks
//     identity between batches. Rows belonging to the person signing
//     out stay on the device, inert to whoever signs in next, and are
//     still theirs when they come back — which is the mapCache
//     argument above, and it only applies cleanly now that the rows
//     can be told apart. Clearing them would destroy a previous user's
//     unsynced work to solve a leak that no longer exists.
//
//     Rows written before v5 carry `userId: null` and belong to nobody
//     the client can name. They are quarantined: never drained, never
//     rendered, and deliberately not deleted here either — deciding
//     when unclaimable data leaves a phone is a retention question
//     (Trello item 10), not a logout's business. See
//     docs/adr/ADR-001-two-queue-architecture.md.
//
// WHEN IT RUNS: on a change of authenticated user identity — see
// auth.store's setUser/logout. Not on a token refresh, not on a
// re-login as the SAME user (which would throw away a live ride's
// state for nothing).

import { useJourneyStore } from '../stores/journey.store';
import { useBidStore } from '../stores/bid.store';
import { useChatStore } from '../stores/chat.store';
import { useUIStore } from '../stores/ui.store';
import { useEmergencyAlertStore } from '../stores/emergency-alert.store';
import { useEmergencyFollowStore } from '../stores/emergency-follow.store';
import { useDriverLivenessStore } from '../stores/driver-liveness.store';
import { useDiagnosticsStore } from '../stores/diagnostics.store';

/** In-memory per-user state. Synchronous — no I/O, cannot fail. */
export function resetPerUserStores(): void {
  useJourneyStore.setState({
    journeys: [],
    activeJourney: null,
    nearbyRequests: [],
    availableSignal: null,
    isLoading: false,
  });
  useBidStore.setState({ bids: [], myBids: [], isLoading: false });
  useChatStore.setState({ messages: [], isLoading: false });
  useEmergencyAlertStore.setState({ alerts: [], positions: {} });
  // SOS-FOLLOW G4 — a phone that changes hands must not keep streaming
  // the previous user's emergency. The server would refuse the frames
  // (the new user is not a party to that journey), but the watch would
  // stay open and the device would keep trying, which is the wrong
  // behaviour to leave running on somebody else's phone.
  useEmergencyFollowStore.setState({ active: {} });
  // LOCATION-LIFE A G2 — and the same argument for the driver
  // heartbeat, which is now app-lived rather than screen-lived and so
  // has no unmount to stop it. A phone that changes hands must not keep
  // reporting the previous motari's position to discovery. Clearing
  // `active` is the whole teardown: services/driver-liveness.ts watches
  // this flag and stops its timer on the transition.
  useDriverLivenessStore.setState({
    active: false,
    lastPingFailed: false,
    lastCoords: null,
  });
  useUIStore.setState({ accountFrozen: false });
  useDiagnosticsStore.setState({
    lastFeedViewAs: null,
    lastFeedStatus: null,
    lastFeedAt: null,
    lastLocationLat: null,
    lastLocationLng: null,
    lastLocationAt: null,
  });
}

/**
 * Durable per-user caches. Dynamically imported so this module — and
 * therefore auth.store — does not pull Dexie into every module graph
 * that touches auth, including test environments with no IndexedDB.
 *
 * Best-effort by design, exactly like the logout it accompanies: a
 * failed clear must never strand a user on the login screen.
 */
export async function resetPerUserCaches(): Promise<void> {
  try {
    const { db } = await import('../db/dexie');
    await Promise.all([
      db.journeys.clear(),
      db.bids.clear(),
      db.messages.clear(),
      db.syncMeta.clear(),
      // db.syncEvents, db.gpsBuffer and db.outbox are deliberately
      // absent — user-stamped and inert to anyone else, see the header.
      // db.mapCache and db.mapDownloads are device-level.
    ]);
  } catch (err) {
    console.debug('[session-reset] cache clear failed:', err);
  }
}

/**
 * The whole reset. Stores clear synchronously so the very next render
 * is already clean; the durable caches follow.
 */
export function resetSessionState(): void {
  resetPerUserStores();
  void resetPerUserCaches();
}
