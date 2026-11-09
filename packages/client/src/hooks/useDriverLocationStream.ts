import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { JourneyStatus, SOCKET_EVENTS, type ApproachStatus } from '@bimoto/shared';
import { useAuthStore } from '../stores/auth.store';
import { apiFetch, getFreshAccessToken } from '../lib/api';
import { refreshSession } from '../lib/auth-refresh';
import { SOCKET_AUTH_ERRORS } from './useSocket';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const STALE_THRESHOLD_MS = 30_000;
const ETA_REFRESH_MS = 30_000;

export type EtaConfidence = 'low' | 'med' | 'high' | 'unknown';

export interface DriverLocationFix {
  lat: number;
  lng: number;
  asOf: Date;
}

export interface DriverLocationStreamResult {
  driverLocation: DriverLocationFix | null;
  etaMinutes: number | null;
  etaConfidence: EtaConfidence;
  etaAsOf: Date | null;
  isLive: boolean;
  // R3-N-3 — server-derived approach status; gates the cancel modal
  // so DRIVER_NO_SHOW only appears when the driver is silent/lost.
  approachStatus: ApproachStatus | null;
  distanceMeters: number | null;
}

interface DriverLocationEvent {
  journeyId: string;
  lat: number;
  lng: number;
  accuracy?: number | null;
  timestamp: string;
}

/**
 * Mounted on the customer's MatchedPage. Joins the journey:<id> room
 * while the journey is MATCHED, listens for driver-location events,
 * and polls /api/journeys/:id/eta for an ETA estimate. Auto-leaves
 * the room on unmount or state transition.
 */
export function useDriverLocationStream(
  journeyId: string | undefined,
  journeyState: JourneyStatus | undefined,
): DriverLocationStreamResult {
  const token = useAuthStore((s) => s.token);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const [driverLocation, setDriverLocation] = useState<DriverLocationFix | null>(null);
  const [etaMinutes, setEtaMinutes] = useState<number | null>(null);
  const [etaConfidence, setEtaConfidence] = useState<EtaConfidence>('unknown');
  const [etaAsOf, setEtaAsOf] = useState<Date | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [approachStatus, setApproachStatus] = useState<ApproachStatus | null>(null);
  const [distanceMeters, setDistanceMeters] = useState<number | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const stalenessTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const shouldStream =
      isAuthenticated &&
      !!token &&
      !!journeyId &&
      journeyState === JourneyStatus.MATCHED;

    if (!shouldStream) {
      if (socketRef.current) {
        try {
          if (journeyId) socketRef.current.emit(SOCKET_EVENTS.LEAVE_JOURNEY, { journeyId });
        } catch { /* ignore */ }
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      if (stalenessTimerRef.current) {
        clearInterval(stalenessTimerRef.current);
        stalenessTimerRef.current = null;
      }
      setIsLive(false);
      return;
    }

    let cancelled = false;

    const fetchEta = async () => {
      try {
        const res = await apiFetch(`/api/journeys/${journeyId}/eta`, {
          credentials: 'include',
        });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setEtaMinutes(data.minutes ?? null);
        setEtaConfidence((data.confidence ?? 'unknown') as EtaConfidence);
        setEtaAsOf(data.asOf ? new Date(data.asOf) : null);
        setApproachStatus((data.approachStatus ?? null) as ApproachStatus | null);
        setDistanceMeters(
          typeof data.distanceMeters === 'number' ? data.distanceMeters : null,
        );
      } catch { /* network errors are non-fatal */ }
    };

    // AUTH-REFRESH G3 — auth as a callback so every handshake (connect
    // + reconnect attempts) presents the CURRENT token, refreshed first
    // when near expiry; on a middleware auth rejection (which stops
    // socket.io's automatic reconnection) refresh once and retry.
    let authRetried = false;
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
      fetchEta();
    });

    socket.on('connect_error', (err) => {
      if (SOCKET_AUTH_ERRORS.has(err.message) && !authRetried) {
        authRetried = true;
        void refreshSession().then((fresh) => {
          if (fresh && !cancelled) socket.connect();
        });
      }
    });

    socket.on(SOCKET_EVENTS.DRIVER_LOCATION, (evt: DriverLocationEvent) => {
      if (cancelled || evt.journeyId !== journeyId) return;
      const asOf = evt.timestamp ? new Date(evt.timestamp) : new Date();
      setDriverLocation({ lat: evt.lat, lng: evt.lng, asOf });
      setIsLive(true);
      // Refresh ETA when the driver moves — gives the pill a fresh
      // estimate without waiting for the next poll tick.
      fetchEta();
    });

    const etaInterval = setInterval(fetchEta, ETA_REFRESH_MS);

    // Liveness watchdog: flip isLive to false if no event in the last
    // STALE_THRESHOLD_MS, regardless of socket connectivity.
    stalenessTimerRef.current = setInterval(() => {
      setDriverLocation((curr) => {
        if (!curr) return curr;
        const age = Date.now() - curr.asOf.getTime();
        setIsLive(age < STALE_THRESHOLD_MS);
        return curr;
      });
    }, 5_000);

    return () => {
      cancelled = true;
      clearInterval(etaInterval);
      if (stalenessTimerRef.current) {
        clearInterval(stalenessTimerRef.current);
        stalenessTimerRef.current = null;
      }
      try {
        if (journeyId) socket.emit(SOCKET_EVENTS.LEAVE_JOURNEY, { journeyId });
      } catch { /* ignore */ }
      socket.disconnect();
      socketRef.current = null;
      setIsLive(false);
    };
  }, [isAuthenticated, token, journeyId, journeyState]);

  return {
    driverLocation,
    etaMinutes,
    etaConfidence,
    etaAsOf,
    isLive,
    approachStatus,
    distanceMeters,
  };
}
