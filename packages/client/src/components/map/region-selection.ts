// COMPONENTS/MAP/REGION-SELECTION.TS
//
// MAP-RWANDA G4 — which cached archive draws the map right now.
//
// THE DECISION, AND THE EVIDENCE FOR IT
//
// With one archive there was nothing to decide. With six there are two
// options: stack every cached archive as its own layer, or pick the one
// that covers where the map is looking. We read protomaps-leaflet 5.1.0
// to find out which it actually supports, and it is the second.
//
// Stacking does not work. leafletLayer({flavor: 'light'}) takes its
// background from the flavor (src/frontends/leaflet.ts:86) and
// renderTile fills the WHOLE 256×256 tile with it before painting any
// feature (:206-210) — unconditionally, whether or not that archive has
// data for the tile. So a second stacked layer paints an opaque
// background over the first everywhere it has nothing, and a rider who
// downloaded two provinces would see the emptier one erase the other.
//
// A single layer CAN hold several sources — sourcesToViews() builds a
// map of them (src/view.ts:238-267). But paint resolves every rule
// against preparedTilemap.get(rule.dataSource || "") (src/painter.ts:37)
// and labels do the same (src/labeler.ts:350), while the rules from
// namedFlavor('light') carry no dataSource at all. Wiring N sources
// would mean forking the whole upstream flavor ruleset and maintaining a
// copy of it per region — for no user-visible gain, since the provinces
// tile the country without overlapping.
//
// So: ONE ACTIVE REGION, chosen by where the map is looking. This module
// is that choice, kept pure so it can be tested without a map.
//
// The bounds are not hardcoded anywhere. They come out of each archive's
// own PMTiles v3 header, which the builder writes from the clip it
// actually used — so a new region provisioned tomorrow selects correctly
// with no code change, which is the same promise the rest of this
// dispatch makes.

export interface RegionBounds {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

export interface RegionCandidate<T = unknown> {
  region: string;
  bounds: RegionBounds | null;
  value: T;
}

export interface LatLng {
  lat: number;
  lng: number;
}

export function boundsContain(bounds: RegionBounds, at: LatLng): boolean {
  return (
    at.lng >= bounds.minLon &&
    at.lng <= bounds.maxLon &&
    at.lat >= bounds.minLat &&
    at.lat <= bounds.maxLat
  );
}

/** Rough area in square degrees. Only ever used to compare candidates,
 *  so the lack of a cos(lat) term does not matter: Rwanda spans under
 *  two degrees of latitude and every comparison is between regions of
 *  the same country. */
export function boundsArea(bounds: RegionBounds): number {
  return (
    Math.max(0, bounds.maxLon - bounds.minLon) *
    Math.max(0, bounds.maxLat - bounds.minLat)
  );
}

/**
 * The archive that should draw the map centred at `at`.
 *
 * Rules, in order:
 *
 *  1. Among archives whose bounds contain the point, take the SMALLEST.
 *     Kigali and Rwanda both cover Nyabugogo; the city archive is the
 *     one built for a bounding box that tight, so it is the one with
 *     detail to spare at z14. Preferring the larger would mean a rider
 *     who downloaded their city as well as the country got the country's
 *     rendering of their own street.
 *
 *  2. If nothing contains the point, fall back to the LARGEST archive
 *     available. A rider whose map has drifted just past a provincial
 *     boundary is better served by the whole country than by nothing —
 *     and a partly-covering map beats the raster layer they have no
 *     signal for.
 *
 *  3. An archive whose header could not be read has no bounds and is
 *     only ever used if it is the sole candidate: unknown coverage is a
 *     last resort, not a default.
 *
 * Returns null when there is nothing cached at all, which is the signal
 * to stay on online tiles.
 */
export function pickRegion<T>(
  candidates: readonly RegionCandidate<T>[],
  at: LatLng | null,
): RegionCandidate<T> | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0] ?? null;

  const known = candidates.filter(
    (c): c is RegionCandidate<T> & { bounds: RegionBounds } => c.bounds !== null,
  );
  if (known.length === 0) return candidates[0] ?? null;

  if (at) {
    const covering = known.filter((c) => boundsContain(c.bounds, at));
    if (covering.length > 0) {
      return covering.reduce((best, c) =>
        boundsArea(c.bounds) < boundsArea(best.bounds) ? c : best,
      );
    }
  }

  // Nothing covers the centre (or we do not know where it is yet): the
  // widest map is the best guess.
  return known.reduce((best, c) =>
    boundsArea(c.bounds) > boundsArea(best.bounds) ? c : best,
  );
}
