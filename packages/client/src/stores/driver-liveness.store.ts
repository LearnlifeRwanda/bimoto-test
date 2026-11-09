import { create } from 'zustand';

// LOCATION-LIFE A G2 — what THIS phone knows about the motari being
// online, held where it outlives every screen.
//
// THE DEFECT THIS EXISTS TO CLOSE (FIELD-TRIAGE C1 #1/#2): "driver goes
// online but gets no requests; takes ~15 minutes or an app restart."
//
// Discovery's whole notion of a live driver is
// `driverProfile.lastLocationAt`, and SEVEN consumers gate on it — the
// supply count, the cascade ring test, the urgent and supply
// broadcasts, the auto-bid evaluator, and the request FEED itself
// (journey.service passes the same stamp into filterJourneysByCascade,
// so a stale driver gets an empty list as well as no pushes). The
// server drops anyone whose stamp is older than 300 s.
//
// The only thing refreshing that stamp outside a ride was a 15 s
// setInterval created inside DashboardPage's go-online handler and
// destroyed by its unmount effect. So the motari's existence was owned
// by one page's lifecycle: opening a bid, a chat or the account screen
// killed the ping, and five minutes later he had stopped existing for
// all seven consumers — while his screen still said "I'm online".
// Returning to /driver remounted the page and restarted it, which is
// exactly the field's "leave the app and get back in".
//
// This store is module-level for the same reason
// emergency-follow.store.ts is, and against the same failure: the only
// thing that knew the fact was component state, and component state
// does not survive a navigation, a backgrounded app or a restart.
//
// PRIVACY INVARIANT: `active` is set ONLY where the driver has
// deliberately toggled themselves online (or where the server says they
// already are — the mount-time restore of that same deliberate act).
// Nothing here starts a transmission the dashboard's own interval did
// not already start, at the same cadence, carrying the same lat/lng to
// the same endpoint. No new data is collected and no disclosure changes.

export interface DriverLivenessState {
  /** True exactly while this driver has deliberately gone online. */
  active: boolean;
  /**
   * The last liveness ping failed (GPS refused, or the server rejected
   * the write). Drives the dashboard's existing 'tracking' banner —
   * "your position is not being sent" — so a silent liveness death is
   * still visible on the one screen that can explain it.
   */
  lastPingFailed: boolean;
  /**
   * The position of the last SUCCESSFUL ping. The dashboard mirrors it
   * into its own currentPosition so the request feed keeps following
   * the motari as he moves, which the page's own tick used to do.
   */
  lastCoords: { lat: number; lng: number } | null;
  setActive: (active: boolean) => void;
  recordPingResult: (coords: { lat: number; lng: number } | null) => void;
}

export const useDriverLivenessStore = create<DriverLivenessState>((set) => ({
  active: false,
  lastPingFailed: false,
  lastCoords: null,
  setActive: (active) =>
    // Going offline also clears the failure: a banner about a ping that
    // is no longer being attempted is noise.
    set(active ? { active } : { active, lastPingFailed: false }),
  recordPingResult: (coords) =>
    set(
      coords
        ? { lastPingFailed: false, lastCoords: coords }
        : { lastPingFailed: true },
    ),
}));
