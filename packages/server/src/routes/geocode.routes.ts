import { Router, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import { rateLimit } from '../middleware/rate-limit';
import {
  searchAddresses,
  reverseGeocode,
  getDirections,
  GeocodingError,
} from '../services/geocoding/locationiq';

const router = Router();

// 20 requests/minute per IP — a debounced autocomplete fires well under
// this while typing, and it keeps one user from draining the shared
// LocationIQ free-tier budget (~5k/day). Scoped so geocode traffic never
// counts against the 3/min OTP buckets.
const geocodeRateLimit = rateLimit(20, 60_000, 'geocode');

function sendGeocodingError(res: Response, err: unknown): void {
  if (err instanceof GeocodingError) {
    if (err.code === 'GEOCODING_UNAVAILABLE') {
      // Key not configured — the feature is dormant by design. The client
      // remembers this for the session and falls back to map + GPS.
      res.status(503).json({
        error: { code: 'GEOCODING_UNAVAILABLE', message: 'errors.geocodingUnavailable' },
      });
      return;
    }
    if (err.code === 'GEOCODING_TIMEOUT') {
      res.status(504).json({
        error: { code: 'GEOCODING_TIMEOUT', message: 'errors.geocodingFailed' },
      });
      return;
    }
  }
  res.status(502).json({
    error: { code: 'GEOCODING_FAILED', message: 'errors.geocodingFailed' },
  });
}

/**
 * @openapi
 * /api/geocode/search:
 *   get:
 *     summary: Address autocomplete (LocationIQ proxy, biased to Rwanda).
 *     tags: [Geocode]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema: { type: string, minLength: 3 }
 *         description: Free-text address query (at least 3 characters).
 *     responses:
 *       200:
 *         description: Up to 20 matching places, Kigali-proximate results first.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 results:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       lat:   { type: number }
 *                       lng:   { type: number }
 *                       label: { type: string }
 *       400:
 *         description: Query missing or shorter than 3 characters.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       429:
 *         description: Rate limited.
 *       502:
 *         description: Geocoding provider failed.
 *       503:
 *         description: Geocoding not configured (LOCATIONIQ_API_KEY unset).
 *       504:
 *         description: Geocoding provider timed out.
 */
router.get('/search', authMiddleware, geocodeRateLimit, async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (q.length < 3) {
    res.status(400).json({
      error: { code: 'GEOCODE_QUERY_TOO_SHORT', message: 'errors.geocodeQueryTooShort' },
    });
    return;
  }
  try {
    const results = await searchAddresses(q);
    res.json({ results });
  } catch (err) {
    sendGeocodingError(res, err);
  }
});

/**
 * @openapi
 * /api/geocode/reverse:
 *   get:
 *     summary: Reverse geocode coordinates to a human-readable label (LocationIQ proxy).
 *     tags: [Geocode]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: lat
 *         required: true
 *         schema: { type: number, minimum: -90, maximum: 90 }
 *       - in: query
 *         name: lng
 *         required: true
 *         schema: { type: number, minimum: -180, maximum: 180 }
 *     responses:
 *       200:
 *         description: Best-match place, or null when nothing is known there.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 result:
 *                   type: object
 *                   nullable: true
 *                   properties:
 *                     lat:   { type: number }
 *                     lng:   { type: number }
 *                     label: { type: string }
 *       400:
 *         description: lat/lng missing, non-numeric, or out of range.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       429:
 *         description: Rate limited.
 *       502:
 *         description: Geocoding provider failed.
 *       503:
 *         description: Geocoding not configured (LOCATIONIQ_API_KEY unset).
 *       504:
 *         description: Geocoding provider timed out.
 */
router.get('/reverse', authMiddleware, geocodeRateLimit, async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    res.status(400).json({
      error: { code: 'GEOCODE_INVALID_COORDINATES', message: 'errors.geocodeInvalidCoordinates' },
    });
    return;
  }
  try {
    const result = await reverseGeocode(lat, lng);
    res.json({ result });
  } catch (err) {
    sendGeocodingError(res, err);
  }
});

function parseCoord(v: unknown, min: number, max: number): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

// TRUE-ROUTES G2 — the opt-in `alternatives` query parameter:
//   absent | 'false'      → undefined (single-route, pre-G2 shape)
//   'true'                → true (provider decides how many to search)
//   '2'..'5'              → that many routes searched for
// Anything else is invalid (null) → 400. The 2..5 window keeps a
// client from asking the provider for absurd counts; the provider may
// still answer with fewer, including exactly one.
function parseAlternatives(v: unknown): true | number | undefined | null {
  if (v === undefined || v === 'false') return undefined;
  if (v === 'true') return true;
  if (typeof v === 'string' && /^[0-9]+$/.test(v)) {
    const n = Number(v);
    if (n >= 2 && n <= 5) return n;
  }
  return null;
}

/**
 * @openapi
 * /api/geocode/directions:
 *   get:
 *     summary: Likely road route between two points (LocationIQ directions proxy).
 *     tags: [Geocode]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: fromLat
 *         required: true
 *         schema: { type: number, minimum: -90, maximum: 90 }
 *       - in: query
 *         name: fromLng
 *         required: true
 *         schema: { type: number, minimum: -180, maximum: 180 }
 *       - in: query
 *         name: toLat
 *         required: true
 *         schema: { type: number, minimum: -90, maximum: 90 }
 *       - in: query
 *         name: toLng
 *         required: true
 *         schema: { type: number, minimum: -180, maximum: 180 }
 *       - in: query
 *         name: alternatives
 *         required: false
 *         schema: { type: string, enum: ['false', 'true', '2', '3', '4', '5'] }
 *         description: >
 *           Opt-in route alternatives. Absent or 'false' keeps the
 *           single-route response shape. 'true' or a count (2-5)
 *           switches the response to a ranked routes array — which may
 *           still contain a single route when the road network offers
 *           no alternative.
 *     responses:
 *       200:
 *         description: >
 *           Without `alternatives`: road polyline in travel order plus
 *           totals ({ coordinates, distanceM, durationS }). With
 *           `alternatives`: { routes: [...] } where each entry carries
 *           the same three fields, ordered by descending recommendation
 *           rank (length may be 1).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 coordinates:
 *                   type: array
 *                   description: "[lat, lng] pairs (single-route shape)"
 *                   items:
 *                     type: array
 *                     items: { type: number }
 *                 distanceM: { type: number }
 *                 durationS: { type: number }
 *                 routes:
 *                   type: array
 *                   description: Ranked alternatives (alternatives shape only)
 *                   items:
 *                     type: object
 *                     properties:
 *                       coordinates:
 *                         type: array
 *                         items:
 *                           type: array
 *                           items: { type: number }
 *                       distanceM: { type: number }
 *                       durationS: { type: number }
 *       400:
 *         description: Coordinates or alternatives invalid.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       404:
 *         description: Provider knows no road route between the points.
 *       429:
 *         description: Rate limited.
 *       502:
 *         description: Directions provider failed.
 *       503:
 *         description: Geocoding not configured (LOCATIONIQ_API_KEY unset).
 *       504:
 *         description: Directions provider timed out.
 */
router.get('/directions', authMiddleware, geocodeRateLimit, async (req, res) => {
  const fromLat = parseCoord(req.query.fromLat, -90, 90);
  const fromLng = parseCoord(req.query.fromLng, -180, 180);
  const toLat = parseCoord(req.query.toLat, -90, 90);
  const toLng = parseCoord(req.query.toLng, -180, 180);
  if (fromLat === null || fromLng === null || toLat === null || toLng === null) {
    res.status(400).json({
      error: { code: 'GEOCODE_INVALID_COORDINATES', message: 'errors.geocodeInvalidCoordinates' },
    });
    return;
  }
  const alternatives = parseAlternatives(req.query.alternatives);
  if (alternatives === null) {
    res.status(400).json({
      error: { code: 'GEOCODE_INVALID_ALTERNATIVES', message: 'errors.geocodeInvalidAlternatives' },
    });
    return;
  }
  try {
    if (alternatives === undefined) {
      // Pre-G2 contract, byte-compatible: single route, flat shape.
      const route = await getDirections(fromLat, fromLng, toLat, toLng);
      if (!route) {
        // The client treats this exactly like any other directions failure:
        // silent straight-line fallback — never a blocked flow.
        res.status(404).json({
          error: { code: 'ROUTE_NOT_FOUND', message: 'errors.routeNotFound' },
        });
        return;
      }
      res.json(route);
      return;
    }
    // TRUE-ROUTES G2 — ranked routes array; may hold one route when the
    // road network offers no alternative.
    const routes = await getDirections(fromLat, fromLng, toLat, toLng, alternatives);
    if (!routes) {
      res.status(404).json({
        error: { code: 'ROUTE_NOT_FOUND', message: 'errors.routeNotFound' },
      });
      return;
    }
    res.json({ routes });
  } catch (err) {
    sendGeocodingError(res, err);
  }
});

export default router;
