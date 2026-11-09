// LIB/HEX-GEOMETRY.TS
//
// INTEL-DECK G5 — the shape of a mobility cell, for drawing.
//
// The server's grid.ts snaps a coordinate into a pointy-top hexagon on
// an axial lattice and stores only the cell's CENTRE (cellCenterLat /
// cellCenterLng) plus, via the tier, its size. This file is the inverse
// the map needs: centre + cellSizeMeters → the six corners of that same
// hexagon, in lat/lng, ready for a Leaflet Polygon.
//
// It must agree with grid.ts exactly, or the map lies about which cell a
// place belongs to. Two details make it agree:
//
//   1. ORIENTATION. grid.ts's axialToPoint is the standard pointy-top
//      pair — x = size·(√3·q + √3⁄2·r), y = size·(3⁄2·r) — with `size`
//      as the circumradius. Corner i of a pointy-top hexagon therefore
//      sits at 60·i − 30 degrees, at distance `size` from the centre.
//
//   2. PROJECTION. grid.ts projects with a local equirectangular map
//      where the longitude scale depends on the point's OWN latitude:
//      x = lng · 111320·cos(lat). Inverting all six corners at the
//      centre's latitude is the obvious thing and it is subtly wrong —
//      because lng ≈ 30° in Rwanda, x is ~3.3 million metres, so the
//      1.3e-6 relative difference in cos(lat) across a cell is about
//      4 metres of real error at the corners. Measured over 40 000
//      random Kigali points, that put 269 of them outside the hexagon
//      grid.ts had actually assigned them. Inverting each corner at ITS
//      OWN latitude puts 0 of 40 000 outside.
//
// The price of correctness is that the six corner distances are not all
// exactly `size` (248–252 m for a 250 m DENSE cell). That is not error:
// the cell genuinely is that shape in lat/lng space, and drawing it as
// a regular hexagon would be the lie.

const METERS_PER_DEGREE_LAT = 111_320;

function metersPerDegreeLng(lat: number): number {
  return METERS_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180);
}

/** A Leaflet-ready [lat, lng] position. */
export type LatLngTuple = [number, number];

/**
 * The six corners of the mobility cell centred on (centerLat, centerLng)
 * at the given tier cell size, in order, starting at the corner 30°
 * clockwise of due east. Leaflet closes the ring itself, so no repeated
 * first point.
 */
export function hexVertices(
  centerLat: number,
  centerLng: number,
  cellSizeMeters: number,
): LatLngTuple[] {
  // The centre's own x in the forward projection — corner offsets are
  // added here, in metres, before being projected back.
  const centerX = centerLng * metersPerDegreeLng(centerLat);
  const vertices: LatLngTuple[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = ((60 * i - 30) * Math.PI) / 180;
    const dx = cellSizeMeters * Math.cos(angle);
    const dy = cellSizeMeters * Math.sin(angle);
    const lat = centerLat + dy / METERS_PER_DEGREE_LAT;
    const lng = (centerX + dx) / metersPerDegreeLng(lat);
    vertices.push([lat, lng]);
  }
  return vertices;
}

/**
 * Where a hexagon's colour comes from: its share of the busiest cell in
 * the same view, on a square root so that one enormous cell does not
 * flatten everything else into the same pale wash. Returns 0..1.
 */
export function intensity(count: number, maxCount: number): number {
  if (maxCount <= 0 || count <= 0) return 0;
  return Math.min(1, Math.sqrt(count / maxCount));
}

/**
 * The fill for a given intensity: one hue, deepening. Bimoto's
 * #1B4F72 at full strength, opened up towards transparent at the low
 * end so the map underneath still reads. No colour scale, no legend to
 * misread — darker is busier.
 */
export function intensityFill(value: number): { color: string; fillOpacity: number } {
  const clamped = Math.max(0, Math.min(1, value));
  return {
    color: '#1B4F72',
    fillOpacity: 0.12 + clamped * 0.6,
  };
}
