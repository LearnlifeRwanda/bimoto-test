// COMPONENTS/MAP/ROUTE-STYLE.TS
//
// TRUE-ROUTES G1 — one visual language for journey lines across every
// map (LocationPickerMap, RoutePreviewMap, MiniMap, DriverApproachMap):
//
//   - a SOLID line is reserved for real road geometry (the directions
//     proxy's polyline, or an actually-travelled GPS trace);
//   - when the road route can't be fetched (offline, pre-bundle pilot
//     server, key unset, no route known) the connector is visibly
//     NOT-a-route: dashed, muted, and labelled by RouteFallbackNotice.
//
// A straight line must never be presented as a route.

import type { PathOptions } from 'leaflet';

/** Real road geometry — the only pickup→destination line drawn solid. */
export const ROAD_ROUTE_STYLE: PathOptions = { color: '#2E75B6', weight: 4 };

/** TRUE-ROUTES G3 — a real road alternative that isn't currently
 * chosen: same solidity (it IS a route), dimmed so the chosen one
 * reads as the selection. */
export const ROAD_ROUTE_DIMMED_STYLE: PathOptions = {
  color: '#7F8C8D',
  weight: 4,
  opacity: 0.55,
};

/** Straight connector when no road route is available — dashed and
 * muted so it cannot be mistaken for a route. The dashArray matches
 * the original picker fallback ('6 8'). */
export const FALLBACK_LINE_STYLE: PathOptions = {
  color: '#7F8C8D',
  weight: 3,
  dashArray: '6 8',
  opacity: 0.8,
};

/** "3.2" km / "12" min strings for route chips. Minutes floor at 1 —
 * "0 min" reads broken. */
export function routeSummaryParts(
  distanceM: number,
  durationS: number,
): { km: string; min: string } {
  return {
    km: (distanceM / 1000).toFixed(1),
    min: String(Math.max(1, Math.round(durationS / 60))),
  };
}
