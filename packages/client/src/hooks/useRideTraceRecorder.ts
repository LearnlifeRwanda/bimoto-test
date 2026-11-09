// HOOKS/USE-RIDE-TRACE-RECORDER.TS
//
// RIDE-TRACE G2 — the ride leaves a trace.
//
// WHAT THIS IS NOT. It is not an edit to useDriverLocationBroadcast,
// and it is deliberately a separate file. That hook is the customer's
// view of an approaching motari: it opens a socket, emits
// UPDATE_LOCATION into journey:<id>, and TEARS DOWN at IN_PROGRESS so
// the customer can no longer watch the driver after pickup. That
// privacy property is the reason the ride was untraced at all, and
// nothing here touches it — this file adds a recorder that starts
// exactly where that broadcast stops.
//
// STORE-AND-FORWARD ONLY. There is no socket in this hook. Not a
// disconnected branch, not a fallback: no socket leg exists, so there
// is nothing to emit and nobody to watch the ride live. Every passing
// tick goes to the Dexie buffer and nowhere else, and the existing
// SyncManager drains it to POST /api/sync/gps (participant-guarded)
// when the network allows. Connected or disconnected, the hook does
// the same single thing — which is why the sibling test asserts the
// two are byte-for-byte identical rather than merely both non-empty.
// (The broadcast hook's offline buffer had to branch, because a point
// it also emitted would be recorded twice: saveGpsBatch dedupes on
// journeyId + timestamp and the server stamps its own clock. With no
// emit here there is no such collision.)
//
// WHAT IT COSTS. A second geolocation watch runs alongside the one
// useOwnPosition already keeps for the map. Capacitor's Geolocation
// plugin returns a distinct watch id per watchPosition call and
// clearWatch takes that id, so concurrent watches are supported by
// design on device; navigator.geolocation is the same contract in the
// PWA. Sharing useOwnPosition's stream instead was rejected: that hook
// is React state feeding a map, its callback is silent by design, and
// a recorder that only sees positions when a map screen re-renders is
// a recorder with holes in it. The watch here is owned by the
// recording, torn down with it, and answerable to nothing else.

import { useEffect, useRef } from 'react';
import { useAuthStore } from '../stores/auth.store';
import { db } from '../db/dexie';
import { recordError } from '../services/error-ledger';
import { geolocation, type GeoCoords } from './useGeolocation';

/** Default cadence, in ms, when VITE_RIDE_TRACE_MS is unset or unusable. */
export const RIDE_TRACE_INTERVAL_MS_DEFAULT = 8_000;

function intervalMs(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.round(parsed);
}

/**
 * One point every eight seconds. Chosen as a time gate alone: no
 * distance gate (a stationary bike in traffic is part of the story a
 * dispute needs) and no coordinate truncation (capture raw, filter at
 * use). Tunable from the field without a rebuild of the decision.
 */
export const RIDE_TRACE_INTERVAL_MS = intervalMs(
  import.meta.env.VITE_RIDE_TRACE_MS,
  RIDE_TRACE_INTERVAL_MS_DEFAULT,
);

/** Exported for the tests that prove the parser's refusals. */
export const _intervalMsForTests = intervalMs;

/**
 * Write one point, fire-and-forget.
 *
 * GHOST-TRACE's discipline, verbatim: the owner is read FRESH at write
 * time from the auth store, never captured in the closure when the
 * effect ran. A phone changes hands; a closure would stamp the point
 * with whoever was signed in when the ride screen mounted. Nobody
 * signed in means the point is dropped and said so in the error
 * ledger — never inferred, never guessed, so no null-owner row can
 * exist.
 */
function bufferPoint(journeyId: string, coords: GeoCoords): void {
  const userId = useAuthStore.getState().user?.id;
  if (!userId) {
    recordError({
      kind: 'gps-buffer',
      message: 'ride trace point dropped: no signed-in user to stamp it with',
    });
    return;
  }

  db.gpsBuffer
    .add({
      userId,
      journeyId,
      lat: coords.lat,
      lng: coords.lng,
      accuracy: coords.accuracy,
      timestamp: new Date().toISOString(),
      synced: false,
    })
    .catch((err: unknown) => {
      recordError({
        kind: 'gps-buffer',
        message: (err as Error)?.message ?? String(err),
      });
    });
}

/**
 * Record the driver's position to the local buffer while a journey leg
 * is under way. Headless — it renders nothing and returns nothing.
 *
 * `active` is the MOUNTING SCREEN'S truth about its own leg, not a
 * guess made here: ActiveRidePage passes `phase === 'in_progress'`,
 * GoodsPickupPage passes `step === 'delivery_photo'` (the parcel is on
 * the bike and moving). The watch starts when that becomes true and is
 * cleared on unmount, on `active` going false, and on the journey id
 * changing — the leg ending stops the recording, in every direction.
 */
export function useRideTraceRecorder(
  journeyId: string | undefined,
  active: boolean,
): void {
  const lastWriteRef = useRef(0);

  useEffect(() => {
    if (!active || !journeyId) return;

    let cancelled = false;
    let watchId: string | null = null;
    lastWriteRef.current = 0;

    const onPos = (coords: GeoCoords) => {
      // The gate closes the instant the leg ends, not when the plugin
      // gets round to honouring clearWatch. A position already in
      // flight when the motari tapped end belongs to a leg that is
      // over, and the trace must stop where the disclosure says it
      // stops.
      if (cancelled) return;
      const now = Date.now();
      if (now - lastWriteRef.current < RIDE_TRACE_INTERVAL_MS) return;
      lastWriteRef.current = now;
      bufferPoint(journeyId, coords);
    };

    geolocation
      .watchPosition(onPos, () => {
        // Silent, like useOwnPosition's: a motari mid-ride gets no
        // permission toast from a recorder he is not looking at. A
        // trace with a gap in it is still the trace, and the
        // disclosure promises recording, not a guarantee of coverage.
      }, { enableHighAccuracy: true, maximumAge: 5_000 })
      .then((id) => {
        if (cancelled) {
          geolocation.clearWatch(id).catch(() => {});
        } else {
          watchId = id;
        }
      })
      .catch(() => {
        /* silent — see above */
      });

    return () => {
      cancelled = true;
      if (watchId) {
        geolocation.clearWatch(watchId).catch(() => {});
        watchId = null;
      }
      lastWriteRef.current = 0;
    };
  }, [journeyId, active]);
}

export default useRideTraceRecorder;
