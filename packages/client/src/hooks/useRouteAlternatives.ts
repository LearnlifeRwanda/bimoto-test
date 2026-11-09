// HOOKS/USE-ROUTE-ALTERNATIVES.TS
//
// TRUE-ROUTES G2 — road route ALTERNATIVES between pickup and
// destination, from the server's directions proxy with the opt-in
// `alternatives` parameter. A sibling of useRouteDirections (whose
// single-route shape stays untouched for its existing consumers):
// same per-pair memory cache, same online/geocoding-unavailable
// awareness, same contract that null means "keep the caller's honest
// fallback".
//
// The provider searches alternatives "if available" — the resolved
// array is ranked by descending recommendation and MAY hold a single
// route when the road network offers no real choice. Callers handle
// length 1 gracefully.

import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import type { RouteDirections } from './useRouteDirections';
import {
  isGeocodingUnavailable,
  markGeocodingUnavailable,
} from './useGeocodeSearch';
import { useUIStore } from '../stores/ui.store';

interface LatLng {
  lat: number;
  lng: number;
}

// Ask for up to 3 routes — more than three choices stops being a
// choice on a phone screen, and the provider may answer with fewer.
const ALTERNATIVES_COUNT = 3;

const CACHE_MAX_ENTRIES = 50;
// null = asked and failed (or no route) — remembered so the pair is
// never re-asked this run.
const cache = new Map<string, RouteDirections[] | null>();

export function _resetRouteAlternativesForTests(): void {
  cache.clear();
}

function pairKey(from: LatLng, to: LatLng): string {
  // 4-decimal rounding (~11 m) matches the server-side cache key.
  return `${from.lat.toFixed(4)},${from.lng.toFixed(4)};${to.lat.toFixed(4)},${to.lng.toFixed(4)}`;
}

function cacheSet(key: string, value: RouteDirections[] | null): void {
  if (!cache.has(key) && cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, value);
}

function mapRoute(raw: unknown): RouteDirections | null {
  const r = raw as Partial<RouteDirections> | null;
  if (
    !r ||
    !Array.isArray(r.coordinates) ||
    r.coordinates.length < 2 ||
    typeof r.distanceM !== 'number' ||
    typeof r.durationS !== 'number'
  ) {
    return null;
  }
  return {
    coordinates: r.coordinates,
    distanceM: r.distanceM,
    durationS: r.durationS,
  };
}

async function fetchAlternatives(
  from: LatLng,
  to: LatLng,
): Promise<RouteDirections[] | null> {
  const qs = new URLSearchParams({
    fromLat: String(from.lat),
    fromLng: String(from.lng),
    toLat: String(to.lat),
    toLng: String(to.lng),
    alternatives: String(ALTERNATIVES_COUNT),
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
  const body = (await res.json()) as { routes?: unknown[] } | null;
  if (!body || !Array.isArray(body.routes)) return null;
  const routes = body.routes
    .map(mapRoute)
    .filter((r): r is RouteDirections => r !== null);
  return routes.length > 0 ? routes : null;
}

/**
 * Ranked road routes for the pair (best first, length ≥ 1), or null
 * while absent (not set, loading, offline, pre-alternatives server, or
 * any failure — the caller's honest fallback covers all of those
 * identically).
 */
export function useRouteAlternatives(
  from: LatLng | null,
  to: LatLng | null,
): RouteDirections[] | null {
  const isOnline = useUIStore((s) => s.isOnline);
  const [routes, setRoutes] = useState<RouteDirections[] | null>(null);

  const key = from && to ? pairKey(from, to) : null;

  useEffect(() => {
    if (!from || !to || !key) {
      setRoutes(null);
      return;
    }
    const hit = cache.get(key);
    if (hit !== undefined) {
      setRoutes(hit);
      return;
    }
    if (!isOnline || isGeocodingUnavailable()) {
      // Don't cache — the pair may resolve once connectivity returns.
      setRoutes(null);
      return;
    }
    let cancelled = false;
    setRoutes(null);
    fetchAlternatives(from, to)
      .then((result) => {
        cacheSet(key, result);
        if (!cancelled) setRoutes(result);
      })
      .catch(() => {
        // Offline/unreachable mid-flight — silent fallback; not cached
        // so a retry can succeed later.
        if (!cancelled) setRoutes(null);
      });
    return () => {
      cancelled = true;
    };
    // from/to identity is captured by the rounded pair key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, isOnline]);

  return routes;
}
