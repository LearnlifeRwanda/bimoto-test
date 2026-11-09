// HOOKS/USE-OWN-POSITION.TS
//
// COCKPIT G1 — the driver's own position, watched, for the driver's own
// screens.
//
// The sibling useGeolocation() is a ONE-SHOT read: DashboardPage calls
// requestPosition() each time it refreshes the job list, which is right
// for a list and wrong for a map someone is riding with. This watches
// instead, over the SAME `geolocation` façade every other caller in the
// app already uses (Capacitor on device, navigator.geolocation in the
// PWA) — it is not a second GPS abstraction, it is the watch-shaped
// sibling of the one-shot one.
//
// Failures are silent by design. A motari on a bike gets no permission
// toast from a map: the map simply draws the target and waits for a fix.
// Pages that need to TELL the driver something about GPS (the dashboard's
// availability toggle) keep using useGeolocation and its error channel.

import { useEffect, useState } from 'react';
import { geolocation, type GeoCoords } from './useGeolocation';

export function useOwnPosition(active = true): GeoCoords | null {
  const [coords, setCoords] = useState<GeoCoords | null>(null);

  useEffect(() => {
    if (!active) return;

    let cancelled = false;
    let watchId: string | null = null;

    geolocation
      .watchPosition(
        (next) => {
          if (!cancelled) setCoords(next);
        },
        () => {
          /* silent — see the header note */
        },
        { enableHighAccuracy: true, maximumAge: 5_000 },
      )
      .then((id) => {
        if (cancelled) {
          geolocation.clearWatch(id).catch(() => {});
        } else {
          watchId = id;
        }
      })
      .catch(() => {
        /* silent */
      });

    return () => {
      cancelled = true;
      if (watchId) {
        geolocation.clearWatch(watchId).catch(() => {});
        watchId = null;
      }
    };
  }, [active]);

  return coords;
}

export default useOwnPosition;
