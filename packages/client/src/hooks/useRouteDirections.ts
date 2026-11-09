// HOOKS/USE-ROUTE-DIRECTIONS.TS
//
// MAP-CACHE G4 — the likely road route between pickup and destination,
// from the server's LocationIQ directions proxy. Strictly a preview
// upgrade: on ANY failure (offline, endpoint missing on a pre-bundle
// pilot server, key unset, no route known) the caller keeps today's
// straight line — routing never blocks the booking flow.
//
// Cache: in memory only, per rounded point-pair, successes AND failures
// — each pair asks the server at most once per app run. A 503
// GEOCODING_UNAVAILABLE additionally flips the shared session flag
// (same LOCATIONIQ_API_KEY powers search/reverse), so no geocode
// feature keeps asking a server that declared the key unset.

import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import {
  isGeocodingUnavailable,
  markGeocodingUnavailable,
} from './useGeocodeSearch';
import { useUIStore } from '../stores/ui.store';

export interface RouteDirections {
  /** Road polyline, [lat, lng] pairs in travel order. */
  coordinates: [number, number][];
  distanceM: number;
  durationS: number;
}

interface LatLng {
  lat: number;
  lng: number;
}

const CACHE_MAX_ENTRIES = 50;
// null = asked and failed (or no route) — remembered so the pair is
// never re-asked this run.
const cache = new Map<string, RouteDirections | null>();

export function _resetRouteDirectionsForTests(): void {
  cache.clear();
}

function pairKey(from: LatLng, to: LatLng): string {
  // 4-decimal rounding (~11 m) matches the server-side cache key.
  return `${from.lat.toFixed(4)},${from.lng.toFixed(4)};${to.lat.toFixed(4)},${to.lng.toFixed(4)}`;
}

function cacheSet(key: string, value: RouteDirections | null): void {
  if (!cache.has(key) && cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, value);
}

async function fetchDirections(from: LatLng, to: LatLng): Promise<RouteDirections | null> {
  const qs = new URLSearchParams({
    fromLat: String(from.lat),
    fromLng: String(from.lng),
    toLat: String(to.lat),
    toLng: String(to.lng),
  });
  const res = await apiFetch(`/api/geocode/directions?${qs.toString()}`, {
    credentials: 'include',
  });
  if (res.status === 503) {
    // Key unset — dormant by design; remember for the session.
    markGeocodingUnavailable();
    return null;
  }
  if (!res.ok) return null; // 404 (no route / pre-bundle server), 5xx, ...
  const body = (await res.json()) as Partial<RouteDirections> | null;
  if (
    !body ||
    !Array.isArray(body.coordinates) ||
    body.coordinates.length < 2 ||
    typeof body.distanceM !== 'number' ||
    typeof body.durationS !== 'number'
  ) {
    return null;
  }
  return {
    coordinates: body.coordinates,
    distanceM: body.distanceM,
    durationS: body.durationS,
  };
}

/**
 * Road route for the pair, or null while absent (not set, loading,
 * offline, or any failure — the caller's straight line covers all of
 * those identically).
 */
export function useRouteDirections(
  from: LatLng | null,
  to: LatLng | null,
): RouteDirections | null {
  const isOnline = useUIStore((s) => s.isOnline);
  const [route, setRoute] = useState<RouteDirections | null>(null);

  const key = from && to ? pairKey(from, to) : null;

  useEffect(() => {
    if (!from || !to || !key) {
      setRoute(null);
      return;
    }
    const hit = cache.get(key);
    if (hit !== undefined) {
      setRoute(hit);
      return;
    }
    if (!isOnline || isGeocodingUnavailable()) {
      // Don't cache — the pair may resolve once connectivity returns.
      setRoute(null);
      return;
    }
    let cancelled = false;
    setRoute(null);
    fetchDirections(from, to)
      .then((result) => {
        cacheSet(key, result);
        if (!cancelled) setRoute(result);
      })
      .catch(() => {
        // Offline/unreachable mid-flight — silent straight-line fallback;
        // not cached so a retry can succeed later.
        if (!cancelled) setRoute(null);
      });
    return () => {
      cancelled = true;
    };
    // from/to identity is captured by the rounded pair key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, isOnline]);

  return route;
}
