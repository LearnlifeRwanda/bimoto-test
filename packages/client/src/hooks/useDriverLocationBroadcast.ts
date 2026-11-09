import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { JourneyStatus, SOCKET_EVENTS } from '@bimoto/shared';
import { useAuthStore } from '../stores/auth.store';
import { db } from '../db/dexie';
import { recordError } from '../services/error-ledger';
import { geolocation, type GeoCoords, type GeoError } from './useGeolocation';
import { getFreshAccessToken } from '../lib/api';
import { refreshSession } from '../lib/auth-refresh';
import { SOCKET_AUTH_ERRORS } from './useSocket';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const BROADCAST_INTERVAL_MS = 8_000;

export interface DriverLocationBroadcastResult {
  isBroadcasting: boolean;
  lastError: GeoError | null;
}

/**
 * GHOST-TRACE G2 — the point that has nowhere to go tonight.
 *
 * Online, the server persists this stream itself: the UPDATE_LOCATION
 * handler stamps a SERVER-side timestamp and writes a gpsPoint
 * (socket/index.ts). Offline there was no writer at all — the point was
 * dropped where the socket check failed, and the ride left no trace.
 *
 * Buffered points are written ONLY while disconnected, deliberately.
 * saveGpsBatch dedupes on journeyId + timestamp (sync.service.ts), and a
 * socket-written point carries the server's clock while a batch-written
 * one carries the phone's — the two never collide, so buffering a point
 * that was also emitted would record it twice rather than be collapsed.
 *
 * The write is fire-and-forget: a geolocation callback is no place to
 * throw. Both ways of losing a point — no signed-in user to stamp it
 * with, or a Dexie failure — leave an error-ledger breadcrumb instead.
 */
function bufferPointOffline(journeyId: string, coords: GeoCoords): void {
  // Read fresh at write time, exactly as the drain does
  // (SyncManager.currentSessionUserId). A closure could hold the name of
  // whoever was signed in when the effect ran, and on a phone that
  // changes hands that is the wrong name. Never inferred, never guessed:
  // with nobody signed in the point is dropped and said so.
  const userId = useAuthStore.getState().user?.id;
  if (!userId) {
    recordError({
      kind: 'gps-buffer',
      message: 'offline gps point dropped: no signed-in user to stamp it with',
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
 * Mounted on the driver's ActiveRidePage. Watches geolocation while the
 * journey is in MATCHED state and emits update-location to the server's
 * journey:<id> room at most once every BROADCAST_INTERVAL_MS. Stops
 * immediately on any other state (privacy: customer must not see the
 * driver after pickup).
 */
export function useDriverLocationBroadcast(
  journeyId: string | undefined,
  journeyState: JourneyStatus | undefined,
): DriverLocationBroadcastResult {
  const token = useAuthStore((s) => s.token);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [lastError, setLastError] = useState<GeoError | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const watchIdRef = useRef<string | null>(null);
  const lastEmitRef = useRef(0);

  useEffect(() => {
    const shouldBroadcast =
      isAuthenticated &&
      !!token &&
      !!journeyId &&
      journeyState === JourneyStatus.MATCHED;

    if (!shouldBroadcast) {
      // Tear down any prior watch / socket — privacy-critical.
      if (watchIdRef.current) {
        geolocation.clearWatch(watchIdRef.current).catch(() => {});
        watchIdRef.current = null;
      }
      if (socketRef.current) {
        try {
          if (journeyId) socketRef.current.emit(SOCKET_EVENTS.LEAVE_JOURNEY, { journeyId });
        } catch { /* ignore */ }
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      setIsBroadcasting(false);
      return;
    }

    let cancelled = false;
    let authRetried = false;
    setLastError(null);

    // AUTH-REFRESH G3 — auth as a callback so every handshake (connect
    // + reconnect attempts) presents the CURRENT token, refreshed first
    // when near expiry; on a middleware auth rejection (which stops
    // socket.io's automatic reconnection) refresh once and retry.
    const socket = io(API_URL, {
      auth: (cb) => {
        void getFreshAccessToken().then((fresh) => cb({ token: fresh ?? token }));
      },
      transports: ['websocket', 'polling'],
      reconnection: true,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      authRetried = false;
      if (cancelled) return;
      socket.emit(SOCKET_EVENTS.JOIN_JOURNEY, { journeyId });
    });

    socket.on('connect_error', (err) => {
      if (SOCKET_AUTH_ERRORS.has(err.message) && !authRetried) {
        authRetried = true;
        void refreshSession().then((fresh) => {
          if (fresh && !cancelled) socket.connect();
        });
      }
    });

    const onPos = (coords: GeoCoords) => {
      // GROUNDSKEEPER G3 — the recorder's guard (useRideTraceRecorder),
      // ported here because in THIS hook a late position is not merely
      // wasted work.
      //
      // clearWatch is async and the plugin honours it when it gets round
      // to it, so a position already in flight when the leg ended still
      // lands in this callback. Without the gate it reaches the offline
      // branch below, gets written to the Dexie buffer, drains through
      // SyncManager, and persists as a GpsPoint stamped with a journey
      // whose MATCHED phase was already over — past the exact privacy
      // boundary this effect's teardown exists to enforce (the customer
      // must not see the driver after pickup, per the hook's docstring).
      //
      // The flag covers both teardown paths, because React runs the
      // previous effect's cleanup before the next effect body: at the
      // MATCHED->IN_PROGRESS transition the cleanup below sets `cancelled`
      // on this closure first, and only then does the re-run hit the
      // !shouldBroadcast branch. The trace stops where the disclosure
      // says it stops.
      if (cancelled) return;
      const now = Date.now();
      if (now - lastEmitRef.current < BROADCAST_INTERVAL_MS) return;
      lastEmitRef.current = now;
      if (!socket.connected) {
        // GHOST-TRACE G2 — offline, the point is held on the phone
        // instead of discarded. SyncManager drains it to
        // POST /api/sync/gps when the network returns.
        bufferPointOffline(journeyId, coords);
        setIsBroadcasting(true);
        return;
      }
      socket.emit(SOCKET_EVENTS.UPDATE_LOCATION, {
        lat: coords.lat,
        lng: coords.lng,
        accuracy: coords.accuracy,
      });
      setIsBroadcasting(true);
    };

    const onErr = (err: GeoError) => {
      setLastError(err);
      setIsBroadcasting(false);
    };

    geolocation
      .watchPosition(onPos, onErr, { enableHighAccuracy: true, maximumAge: 5_000 })
      .then((id) => {
        if (cancelled) {
          geolocation.clearWatch(id).catch(() => {});
        } else {
          watchIdRef.current = id;
        }
      })
      .catch(() => {
        setLastError({ code: 'unknown', message: 'Failed to start watch' });
      });

    return () => {
      cancelled = true;
      if (watchIdRef.current) {
        geolocation.clearWatch(watchIdRef.current).catch(() => {});
        watchIdRef.current = null;
      }
      try {
        if (journeyId) socket.emit(SOCKET_EVENTS.LEAVE_JOURNEY, { journeyId });
      } catch { /* ignore */ }
      socket.disconnect();
      socketRef.current = null;
      setIsBroadcasting(false);
      lastEmitRef.current = 0;
    };
  }, [isAuthenticated, token, journeyId, journeyState]);

  return { isBroadcasting, lastError };
}
