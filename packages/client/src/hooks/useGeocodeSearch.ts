import { useEffect, useMemo, useRef, useState } from 'react';
import { useNetworkStatus } from './useNetworkStatus';
import { apiFetch } from '../lib/api';
import {
  searchLandmarks,
  type LandmarkSuggestion,
} from '../lib/landmark-search';

// GEOCODE — debounced address autocomplete against the server's
// LocationIQ proxy (/api/geocode/search). The server owns the API key,
// caching and rate limiting; this hook only debounces, aborts stale
// requests, and remembers when the feature is switched off.
//
// LANDMARKS G3 — before any of that, the Kigali landmark catalog is
// searched in the browser. A passenger typing "Sonatubes" is naming a
// junction the street geocoder does not know; the catalog does, and it
// answers instantly and offline. Landmark matches are always returned
// first, and they are returned even when the network is down and the
// geocoder half of this hook has nothing to say.

export interface GeocodeSuggestion {
  lat: number;
  lng: number;
  label: string;
}
const DEBOUNCE_MS = 350;
const MIN_QUERY_LENGTH = 3;

// Session memory: once the server answers 503 GEOCODING_UNAVAILABLE
// (LOCATIONIQ_API_KEY unset), stop asking for the rest of the session —
// the fields quietly behave as labels and map + GPS stay the path.
let unavailableThisSession = false;

export function _resetGeocodeAvailabilityForTests(): void {
  unavailableThisSession = false;
}

export function markGeocodingUnavailable(): void {
  unavailableThisSession = true;
}

export function isGeocodingUnavailable(): boolean {
  return unavailableThisSession;
}

export interface GeocodeSearchState {
  /** Landmark matches, always ahead of the geocoder and never network-bound. */
  landmarks: LandmarkSuggestion[];
  suggestions: GeocodeSuggestion[];
  loading: boolean;
  unavailable: boolean;
  /**
   * True when there is something to show: a landmark match, or a geocoder
   * search actually in play (long enough query, online, available).
   */
  active: boolean;
}

export function useGeocodeSearch(query: string): GeocodeSearchState {
  const { connected } = useNetworkStatus();
  const [suggestions, setSuggestions] = useState<GeocodeSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(unavailableThisSession);
  const abortRef = useRef<AbortController | null>(null);

  const q = query.trim();

  // Synchronous, in-bundle, and deliberately outside every network guard
  // below: an airplane-mode passenger who types "Chez Lando" still gets it.
  const landmarks = useMemo(() => searchLandmarks(q), [q]);

  const geocoderActive = !unavailable && connected && q.length >= MIN_QUERY_LENGTH;
  const active = geocoderActive || landmarks.length > 0;

  useEffect(() => {
    if (unavailableThisSession) {
      setUnavailable(true);
      setSuggestions([]);
      setLoading(false);
      return;
    }
    if (!connected || q.length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await apiFetch(
          `/api/geocode/search?q=${encodeURIComponent(q)}`,
          {
            credentials: 'include',
            signal: controller.signal,
          },
        );
        if (controller.signal.aborted) return;
        if (res.status === 503) {
          markGeocodingUnavailable();
          setUnavailable(true);
          setSuggestions([]);
          setLoading(false);
          return;
        }
        if (!res.ok) {
          setSuggestions([]);
          setLoading(false);
          return;
        }
        const data = await res.json().catch(() => null);
        const results = Array.isArray(data?.results) ? data.results : [];
        setSuggestions(
          results.filter(
            (r: unknown): r is GeocodeSuggestion =>
              typeof (r as GeocodeSuggestion)?.lat === 'number' &&
              typeof (r as GeocodeSuggestion)?.lng === 'number' &&
              typeof (r as GeocodeSuggestion)?.label === 'string',
          ),
        );
        setLoading(false);
      } catch {
        // Aborted (stale) requests keep the newer request's state; real
        // failures just clear the list — never block the booking flow.
        if (!controller.signal.aborted) {
          setSuggestions([]);
          setLoading(false);
        }
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [q, connected]);

  // Abort any in-flight request on unmount.
  useEffect(() => () => abortRef.current?.abort(), []);

  return { landmarks, suggestions, loading, unavailable, active };
}

/**
 * One-shot reverse geocode for pins/GPS fixes (G3): turns raw
 * coordinates into a human-readable label. Silent on every failure —
 * callers keep their coordinate-based fallback display.
 */
export async function reverseGeocodeOnce(
  lat: number,
  lng: number,
): Promise<GeocodeSuggestion | null> {
  if (unavailableThisSession) return null;
  try {
    const res = await apiFetch(
      `/api/geocode/reverse?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`,
      {
        credentials: 'include',
      },
    );
    if (res.status === 503) {
      markGeocodingUnavailable();
      return null;
    }
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    const r = data?.result;
    if (
      typeof r?.lat === 'number' &&
      typeof r?.lng === 'number' &&
      typeof r?.label === 'string'
    ) {
      return r as GeocodeSuggestion;
    }
    return null;
  } catch {
    return null;
  }
}
