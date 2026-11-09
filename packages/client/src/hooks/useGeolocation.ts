import { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Geolocation, type Position } from '@capacitor/geolocation';

export interface GeoCoords {
  lat: number;
  lng: number;
  accuracy: number;
  speed: number | null;
  heading: number | null;
  timestamp: number;
}

export type GeoErrorCode =
  | 'permission-denied'
  | 'position-unavailable'
  | 'timeout'
  | 'unsupported'
  | 'unknown';

export interface GeoError {
  code: GeoErrorCode;
  message: string;
}

export interface GeoOptions {
  enableHighAccuracy?: boolean;
  timeout?: number;
  maximumAge?: number;
}

const DEFAULT_OPTIONS: Required<GeoOptions> = {
  enableHighAccuracy: true,
  timeout: 10_000,
  maximumAge: 0,
};

function fromCapacitor(pos: Position): GeoCoords {
  return {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    accuracy: pos.coords.accuracy,
    speed: pos.coords.speed ?? null,
    heading: pos.coords.heading ?? null,
    timestamp: pos.timestamp,
  };
}

function fromBrowser(pos: GeolocationPosition): GeoCoords {
  return {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    accuracy: pos.coords.accuracy,
    speed: pos.coords.speed ?? null,
    heading: pos.coords.heading ?? null,
    timestamp: pos.timestamp,
  };
}

function browserErrorCode(code: number): GeoErrorCode {
  if (code === 1) return 'permission-denied';
  if (code === 2) return 'position-unavailable';
  if (code === 3) return 'timeout';
  return 'unknown';
}

async function ensureNativePermission(): Promise<GeoError | null> {
  const perm = await Geolocation.checkPermissions();
  if (perm.location === 'granted') return null;
  const requested = await Geolocation.requestPermissions();
  if (requested.location === 'granted') return null;
  return { code: 'permission-denied', message: 'Location permission denied' };
}

/**
 * Platform-agnostic geolocation utility. Use directly when you need
 * one-off coordinates outside of React state (e.g. emergency triggers,
 * background buffers). For UI state, prefer the `useGeolocation` hook.
 */
export const geolocation = {
  async getCurrentPosition(options: GeoOptions = {}): Promise<GeoCoords> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    if (Capacitor.isNativePlatform()) {
      const denied = await ensureNativePermission();
      if (denied) throw denied;
      const pos = await Geolocation.getCurrentPosition({
        enableHighAccuracy: opts.enableHighAccuracy,
        timeout: opts.timeout,
        maximumAge: opts.maximumAge,
      });
      return fromCapacitor(pos);
    }
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      throw { code: 'unsupported', message: 'Geolocation is not supported' } satisfies GeoError;
    }
    return new Promise<GeoCoords>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (p) => resolve(fromBrowser(p)),
        (err) => reject({ code: browserErrorCode(err.code), message: err.message } satisfies GeoError),
        opts,
      );
    });
  },

  async watchPosition(
    onPosition: (coords: GeoCoords) => void,
    onError: (err: GeoError) => void,
    options: GeoOptions = {},
  ): Promise<string> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    if (Capacitor.isNativePlatform()) {
      const denied = await ensureNativePermission();
      if (denied) {
        onError(denied);
        return '';
      }
      const id = await Geolocation.watchPosition(
        {
          enableHighAccuracy: opts.enableHighAccuracy,
          timeout: opts.timeout,
          maximumAge: opts.maximumAge,
        },
        (pos, err) => {
          if (err) {
            onError({ code: 'unknown', message: err.message });
            return;
          }
          if (pos) onPosition(fromCapacitor(pos));
        },
      );
      return id;
    }
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      onError({ code: 'unsupported', message: 'Geolocation is not supported' });
      return '';
    }
    const id = navigator.geolocation.watchPosition(
      (p) => onPosition(fromBrowser(p)),
      (err) => onError({ code: browserErrorCode(err.code), message: err.message }),
      opts,
    );
    return String(id);
  },

  async clearWatch(id: string): Promise<void> {
    if (!id) return;
    if (Capacitor.isNativePlatform()) {
      await Geolocation.clearWatch({ id });
      return;
    }
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.clearWatch(Number(id));
    }
  },
};

export interface UseGeolocationResult {
  coords: GeoCoords | null;
  error: GeoError | null;
  loading: boolean;
  requestPosition: (options?: GeoOptions) => Promise<GeoCoords | null>;
}

export function useGeolocation(): UseGeolocationResult {
  const [coords, setCoords] = useState<GeoCoords | null>(null);
  const [error, setError] = useState<GeoError | null>(null);
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const requestPosition = useCallback(async (options?: GeoOptions) => {
    setLoading(true);
    setError(null);
    try {
      const next = await geolocation.getCurrentPosition(options);
      if (mountedRef.current) {
        setCoords(next);
        setLoading(false);
      }
      return next;
    } catch (err) {
      if (mountedRef.current) {
        const geoErr = err as GeoError;
        setError(geoErr);
        setLoading(false);
      }
      return null;
    }
  }, []);

  return { coords, error, loading, requestPosition };
}
