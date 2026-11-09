import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import { SOCKET_EVENTS, type EmergencyEndedEvent } from '@bimoto/shared';
import { useAuthStore } from '../stores/auth.store';
import { useEmergencyFollowStore } from '../stores/emergency-follow.store';
import { geolocation, type GeoCoords } from './useGeolocation';
import { recordError } from '../services/error-ledger';
import { getFreshAccessToken } from '../lib/api';
import { refreshSession } from '../lib/auth-refresh';
import { SOCKET_AUTH_ERRORS } from './useSocket';
import { EMERGENCY_FOLLOW_MS, EMERGENCY_FOLLOW_CAP_MS } from '../config/sos';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

/**
 * SOS-FOLLOW G4 — this phone's half of the live follow.
 *
 * Structurally the driver broadcast hook (useDriverLocationBroadcast):
 * one socket, one geolocation watch, one throttle, torn down completely
 * on every exit path. Three things about it are different, and each is a
 * deliberate consequence of what an emergency is.
 *
 * IT RUNS FOR BOTH PARTICIPANTS. The broadcast hook is the motari's
 * alone. This one is mounted wherever EmergencySOS is, on both roles'
 * screens, and both phones stream once either of them knows the alert is
 * live — the raiser from the press response, the other party from the
 * journey-room event or the active-GET. Which of the two still has a
 * working phone is not knowable in advance, and an emergency is not the
 * moment to find out you picked the wrong one.
 *
 * IT ENDS FOUR WAYS, and all four are wired here rather than hoped for:
 *   - the ended-event on the journey room (ops resolved, or the valve
 *     expired it) — the normal path;
 *   - the store's entry going away for any other reason;
 *   - unmount;
 *   - and a local cap mirroring the server's 60-minute valve, because
 *     the phone most likely to still be streaming an hour in is exactly
 *     the phone that lost the socket carrying the message that would
 *     have stopped it.
 *
 * IT SENDS NOWHERE BUT UP. The frame goes to the server, which relays to
 * the 'admins' room and nothing else. This hook has no counterpart
 * listener: there is no client anywhere that receives another person's
 * emergency position, because no such client exists outside the admin
 * panel.
 *
 * OFFLINE, IT DOES NOTHING — stated rather than hidden. No socket means
 * no live frames, full stop; there is no offline buffer here on purpose,
 * because a position that arrives after the emergency is a trace and not
 * a follow. The trace is already covered: the ride recorder keeps
 * buffering at its own interval and its points arrive on sync, and the
 * ops view prints the age of the last position it has rather than
 * implying it is current.
 */
export function useEmergencyFollowStream(journeyId: string | undefined): void {
  const token = useAuthStore((s) => s.token);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const alertId = useEmergencyFollowStore((s) =>
    journeyId ? s.active[journeyId] : undefined,
  );
  const clear = useEmergencyFollowStore((s) => s.clear);

  const watchIdRef = useRef<string | null>(null);
  const lastEmitRef = useRef(0);

  useEffect(() => {
    const shouldFollow = isAuthenticated && !!token && !!journeyId && !!alertId;
    if (!shouldFollow) return;

    let cancelled = false;
    let authRetried = false;

    const socket: Socket = io(API_URL, {
      auth: (cb) => {
        void getFreshAccessToken().then((fresh) => cb({ token: fresh ?? token }));
      },
      transports: ['websocket', 'polling'],
      reconnection: true,
    });

    socket.on('connect', () => {
      authRetried = false;
    });

    socket.on('connect_error', (err: Error) => {
      if (SOCKET_AUTH_ERRORS.has(err.message) && !authRetried) {
        authRetried = true;
        void refreshSession().then((fresh) => {
          if (fresh && !cancelled) socket.connect();
        });
      }
    });

    // The normal ending. The server sends this to the journey room the
    // instant ops resolves or the valve expires, and it carries no
    // position data in either direction — only the fact that this is
    // over. Clearing the store unmounts the stream through this same
    // effect's cleanup.
    socket.on(SOCKET_EVENTS.EMERGENCY_ENDED, (event: EmergencyEndedEvent | undefined) => {
      if (event?.journeyId === journeyId) clear(journeyId!);
    });

    // The journey room is where the ended-event arrives, so the follow
    // has to be in it. Nothing is ever sent TO the room from here.
    socket.emit(SOCKET_EVENTS.JOIN_JOURNEY, { journeyId });

    // The phone's own clock, independent of any message. See
    // EMERGENCY_FOLLOW_CAP_MS.
    const cap = setTimeout(() => {
      if (!cancelled) clear(journeyId!);
    }, EMERGENCY_FOLLOW_CAP_MS);

    const onPos = (coords: GeoCoords) => {
      // GROUNDSKEEPER G3 — the recorder's guard (useRideTraceRecorder),
      // ported to the third hook that shares this shape. clearWatch is
      // async, so a position already in flight when the alert ended still
      // arrives here; emitting it would put a frame on the admin room for
      // an emergency ops has already resolved, which is exactly the "a
      // position that arrives after the emergency is a trace and not a
      // follow" line in this hook's own docstring. The follow ends when it
      // says it ends, not when the plugin catches up.
      if (cancelled) return;
      const now = Date.now();
      if (now - lastEmitRef.current < EMERGENCY_FOLLOW_MS) return;
      // Offline is not buffered here: see the hook's own comment. The
      // frame is simply not sent, and the throttle is not advanced, so
      // the first position after reconnection goes out immediately.
      if (!socket.connected) return;
      lastEmitRef.current = now;
      socket.emit(SOCKET_EVENTS.EMERGENCY_LOCATION, {
        journeyId,
        lat: coords.lat,
        lng: coords.lng,
        accuracy: coords.accuracy,
      });
    };

    // A geolocation error is not surfaced. The SOS sheet already says
    // what it can promise, and a phone in an emergency does not need a
    // second thing on screen telling it what it cannot do.
    geolocation
      .watchPosition(onPos, () => {}, { enableHighAccuracy: true, maximumAge: 5_000 })
      .then((id) => {
        if (cancelled) {
          geolocation.clearWatch(id).catch(() => {});
        } else {
          watchIdRef.current = id;
        }
      })
      .catch((err: unknown) => {
        // GROUNDSKEEPER G3 — this used to be a bare `.catch(() => {})`.
        // Every sibling hook comments its swallows; this one swallowed the
        // one failure that matters most. A rejected watchPosition means the
        // follow never starts at all — on the SOS path, the phone that
        // pressed the button streams nothing, and both the rider and ops
        // see a live-looking screen backed by no positions.
        //
        // Still silent on screen, and deliberately: the SOS sheet says what
        // it can promise, and an emergency is not the moment to add a
        // second thing telling someone what their phone cannot do. But it
        // leaves a breadcrumb now, so the failure is answerable afterwards
        // instead of invisible forever.
        recordError({
          kind: 'gps-buffer',
          message: `emergency follow watch failed to start: ${(err as Error)?.message ?? String(err)}`,
        });
      });

    return () => {
      cancelled = true;
      clearTimeout(cap);
      if (watchIdRef.current) {
        geolocation.clearWatch(watchIdRef.current).catch(() => {});
        watchIdRef.current = null;
      }
      try {
        socket.emit(SOCKET_EVENTS.LEAVE_JOURNEY, { journeyId });
      } catch { /* ignore */ }
      socket.disconnect();
      lastEmitRef.current = 0;
    };
  }, [isAuthenticated, token, journeyId, alertId, clear]);
}
