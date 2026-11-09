import { config } from '../../config';

// GEOCODE — LocationIQ proxy service. All geocoding goes through the
// server: the API key stays secret, results are cached across users,
// and the route layer rate-limits per IP. The client never talks to
// LocationIQ directly.

export interface GeocodeResult {
  lat: number;
  lng: number;
  label: string;
}

export interface DirectionsResult {
  /** Road polyline, [lat, lng] pairs in travel order. */
  coordinates: [number, number][];
  distanceM: number;
  durationS: number;
}

export type GeocodingErrorCode =
  | 'GEOCODING_UNAVAILABLE' // LOCATIONIQ_API_KEY unset — feature dormant by design
  | 'GEOCODING_TIMEOUT'
  | 'GEOCODING_FAILED';

export class GeocodingError extends Error {
  public readonly code: GeocodingErrorCode;
  public readonly httpStatus?: number;

  constructor(code: GeocodingErrorCode, opts: { httpStatus?: number; reason?: string } = {}) {
    super(`Geocoding: ${code}${opts.reason ? ` — ${opts.reason}` : ''}`);
    this.name = 'GeocodingError';
    this.code = code;
    this.httpStatus = opts.httpStatus;
  }
}

const BASE_URL = 'https://api.locationiq.com/v1';
const REQUEST_TIMEOUT_MS = 5_000;

// FIELD-UX G1 — the Autocomplete endpoint accepts limit values up to 20
// (default 10, per docs.locationiq.com/docs/autocomplete); ask for the
// ceiling so thin-OSM-coverage places still make the list.
const SEARCH_LIMIT = 20;
// FIELD-UX G1 — soft proximity bias: a viewbox over greater Kigali,
// deliberately WITHOUT bounded=1. Per the provider docs, viewbox alone
// marks "the preferred area to find search results" — places inside it
// rank first — while bounded=1 would turn it into a hard filter and
// hide the rest of Rwanda. Format is lon1,lat1,lon2,lat2.
const KIGALI_VIEWBOX = '29.95,-1.85,30.22,-2.10';

// The free tier is ~5k requests/day and Kigali queries repeat heavily
// ("Kimironko", "Nyabugogo", ...), so a small in-memory TTL cache
// absorbs most of the traffic. Reverse lookups are keyed on 4-decimal
// rounded coordinates (~11 m) — GPS jitter collapses onto one entry.
const CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const CACHE_MAX_ENTRIES = 500;

type CacheValue =
  | GeocodeResult[]
  | GeocodeResult
  | DirectionsResult
  | DirectionsResult[]
  | null;
const cache = new Map<string, { value: CacheValue; expiresAt: number }>();

function cacheGet(key: string): CacheValue | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

function cacheSet(key: string, value: CacheValue): void {
  if (!cache.has(key) && cache.size >= CACHE_MAX_ENTRIES) {
    // Map preserves insertion order — evict the oldest entry.
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

// Node >= 20 — global fetch, no HTTP client dependency. Swappable so
// tests can inject a fake without network access.
type FetchLike = typeof fetch;
let fetchImpl: FetchLike = (...args) => fetch(...args);

export function _setFetchForTests(impl: FetchLike | null): void {
  fetchImpl = impl ?? ((...args) => fetch(...args));
}

export function _resetGeocodeCacheForTests(): void {
  cache.clear();
}

function requireApiKey(): string {
  const key = config.LOCATIONIQ_API_KEY;
  if (!key) {
    // Fail fast and quietly, mirroring the card-key pattern: without the
    // key the routes answer 503 and the client falls back to map + GPS.
    throw new GeocodingError('GEOCODING_UNAVAILABLE');
  }
  return key;
}

async function requestJson(url: URL): Promise<{ status: number; body: unknown }> {
  let res: Response;
  try {
    res = await fetchImpl(url.toString(), {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { Accept: 'application/json' },
    });
  } catch (err: unknown) {
    const name = (err as { name?: string })?.name;
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new GeocodingError('GEOCODING_TIMEOUT');
    }
    throw new GeocodingError('GEOCODING_FAILED', {
      reason: (err as { message?: string })?.message,
    });
  }
  const body: unknown = await res.json().catch(() => null);
  return { status: res.status, body };
}

// LocationIQ (Nominatim-based) returns lat/lon as strings and the
// human-readable label as display_name. Map defensively — drop any
// item that doesn't carry usable coordinates and a label.
function mapProviderItem(item: unknown): GeocodeResult | null {
  const it = item as
    | { lat?: unknown; lon?: unknown; display_name?: unknown; display_place?: unknown }
    | null;
  const lat = Number(it?.lat);
  const lng = Number(it?.lon);
  const label =
    typeof it?.display_name === 'string' && it.display_name.length > 0
      ? it.display_name
      : typeof it?.display_place === 'string' && it.display_place.length > 0
        ? it.display_place
        : null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !label) return null;
  return { lat, lng, label };
}

export async function searchAddresses(q: string): Promise<GeocodeResult[]> {
  const key = requireApiKey();
  const query = q.trim().replace(/\s+/g, ' ');
  // The key carries every non-secret request parameter, so a future
  // change to the bias or limit can never serve stale entries cached
  // under a different parameterization.
  const cacheKey = `s:${query.toLowerCase()}|cc=rw|vb=${KIGALI_VIEWBOX}|limit=${SEARCH_LIMIT}`;
  const hit = cacheGet(cacheKey);
  if (hit !== undefined) return hit as GeocodeResult[];

  const url = new URL(`${BASE_URL}/autocomplete`);
  url.searchParams.set('key', key);
  url.searchParams.set('q', query);
  // Bias to Rwanda — Bimoto operates in Kigali; without this, short
  // queries resolve to same-named places on other continents.
  url.searchParams.set('countrycodes', 'rw');
  url.searchParams.set('viewbox', KIGALI_VIEWBOX);
  url.searchParams.set('limit', String(SEARCH_LIMIT));

  const { status, body } = await requestJson(url);
  // LocationIQ answers 404 {"error": "Unable to geocode"} for
  // no-result queries — that's an empty result, not a failure.
  if (status === 404) {
    cacheSet(cacheKey, []);
    return [];
  }
  if (status !== 200 || !Array.isArray(body)) {
    throw new GeocodingError('GEOCODING_FAILED', { httpStatus: status });
  }
  const results = body
    .map(mapProviderItem)
    .filter((r): r is GeocodeResult => r !== null);
  cacheSet(cacheKey, results);
  return results;
}

// One provider route object → DirectionsResult, defensively. GeoJSON
// is [lng, lat] — flipped to the [lat, lng] the client draws.
function mapProviderRoute(raw: unknown): DirectionsResult | null {
  const route = raw as
    | {
        geometry?: { coordinates?: unknown };
        distance?: unknown;
        duration?: unknown;
      }
    | undefined;
  const rawCoords = route?.geometry?.coordinates;
  const distanceM = Number(route?.distance);
  const durationS = Number(route?.duration);
  if (!Array.isArray(rawCoords) || !Number.isFinite(distanceM) || !Number.isFinite(durationS)) {
    return null;
  }
  const coordinates: [number, number][] = [];
  for (const pair of rawCoords) {
    if (!Array.isArray(pair)) continue;
    const lng = Number(pair[0]);
    const lat = Number(pair[1]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) coordinates.push([lat, lng]);
  }
  if (coordinates.length < 2) return null;
  return { coordinates, distanceM, durationS };
}

// MAP-CACHE G1 — likely road route between two points (LocationIQ
// directions, OSRM-compatible response). Same key, cache and error
// taxonomy as search/reverse; the client draws the polyline as a
// preview and silently falls back to a straight line on ANY failure.
// Null means the provider answered but knows no road route — the route
// layer turns that into 404 ROUTE_NOT_FOUND.
//
// TRUE-ROUTES G2 — opt-in `alternatives` (true, or a number of routes
// to search for, per docs.locationiq.com/docs/directions-api). With it
// the promise resolves to a routes ARRAY ordered by descending
// recommendation rank. Alternatives are searched "if available" — the
// provider may answer with a single route even when asked for more, so
// callers must be graceful about length 1. Without the parameter the
// behaviour and cache entries are exactly the pre-G2 single-route ones.
export async function getDirections(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): Promise<DirectionsResult | null>;
export async function getDirections(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
  alternatives: true | number,
): Promise<DirectionsResult[] | null>;
export async function getDirections(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
  alternatives?: true | number,
): Promise<DirectionsResult | DirectionsResult[] | null> {
  const key = requireApiKey();
  // 4-decimal rounding (~11 m) — GPS jitter and repeat pair lookups
  // collapse onto one cache entry, mirroring reverseGeocode.
  const pts = [fromLat, fromLng, toLat, toLng].map((v) => v.toFixed(4));
  // The alternatives parameter is part of the key — a single-route
  // entry must never serve an alternatives request, or vice versa.
  const altParam =
    alternatives === undefined
      ? null
      : alternatives === true
        ? 'true'
        : String(alternatives);
  const pairKey = `d:${pts[0]},${pts[1]};${pts[2]},${pts[3]}`;
  const cacheKey = altParam === null ? pairKey : `${pairKey}|alt=${altParam}`;
  const hit = cacheGet(cacheKey);
  if (hit !== undefined) return hit as DirectionsResult | DirectionsResult[] | null;

  // OSRM-style path: /directions/driving/{lng},{lat};{lng},{lat}
  const url = new URL(
    `${BASE_URL}/directions/driving/${pts[1]},${pts[0]};${pts[3]},${pts[2]}`,
  );
  url.searchParams.set('key', key);
  url.searchParams.set('overview', 'full');
  url.searchParams.set('geometries', 'geojson');
  url.searchParams.set('steps', 'false');
  url.searchParams.set('alternatives', altParam ?? 'false');

  const { status, body } = await requestJson(url);
  // "NoRoute"/"NoSegment" answers arrive as 4xx with a code field —
  // that's a real "no road route known", not a provider failure.
  if (status === 404 || status === 400) {
    cacheSet(cacheKey, null);
    return null;
  }
  if (status !== 200) {
    throw new GeocodingError('GEOCODING_FAILED', { httpStatus: status });
  }
  const rawRoutes = (body as { routes?: unknown[] } | null)?.routes;
  const routes = Array.isArray(rawRoutes)
    ? rawRoutes
        .map(mapProviderRoute)
        .filter((r): r is DirectionsResult => r !== null)
    : [];
  if (routes.length === 0) {
    cacheSet(cacheKey, null);
    return null;
  }
  const result = altParam === null ? routes[0] : routes;
  cacheSet(cacheKey, result);
  return result;
}

export async function reverseGeocode(lat: number, lng: number): Promise<GeocodeResult | null> {
  const key = requireApiKey();
  const latR = lat.toFixed(4);
  const lngR = lng.toFixed(4);
  const cacheKey = `r:${latR},${lngR}`;
  const hit = cacheGet(cacheKey);
  if (hit !== undefined) return hit as GeocodeResult | null;

  const url = new URL(`${BASE_URL}/reverse`);
  url.searchParams.set('key', key);
  url.searchParams.set('lat', latR);
  url.searchParams.set('lon', lngR);
  url.searchParams.set('format', 'json');

  const { status, body } = await requestJson(url);
  if (status === 404) {
    cacheSet(cacheKey, null);
    return null;
  }
  if (status !== 200) {
    throw new GeocodingError('GEOCODING_FAILED', { httpStatus: status });
  }
  const result = mapProviderItem(body);
  cacheSet(cacheKey, result);
  return result;
}
