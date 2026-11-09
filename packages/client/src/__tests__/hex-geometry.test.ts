// INTEL-DECK G5 — the hexagons the map draws are the cells the server
// counted, or the map is lying about where people are.
//
// The strongest available check without importing server code: this
// test re-implements grid.ts's snapToCell projection (quoted from
// packages/server/src/services/mobility/grid.ts:29-71), samples
// thousands of points across Kigali, and asserts every point falls
// inside the polygon hexVertices draws for the cell grid.ts assigned it.
// If the orientation, the radius or the projection inverse drifts, this
// goes red immediately.
import { describe, test, expect } from 'vitest';
import { hexVertices, intensity, intensityFill } from '../lib/hex-geometry';

const M_LAT = 111_320;
const mLng = (lat: number) => M_LAT * Math.cos((lat * Math.PI) / 180);

// --- verbatim port of grid.ts's pointy-top axial snap -----------------
function snapToCell(lat: number, lng: number, size: number) {
  const x = lng * mLng(lat);
  const y = lat * M_LAT;
  const qF = ((Math.sqrt(3) / 3) * x - (1 / 3) * y) / size;
  const rF = ((2 / 3) * y) / size;
  const sF = -qF - rF;
  let q = Math.round(qF);
  let r = Math.round(rF);
  const s = Math.round(sF);
  const dq = Math.abs(q - qF);
  const dr = Math.abs(r - rF);
  const ds = Math.abs(s - sF);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  const cx = size * (Math.sqrt(3) * q + (Math.sqrt(3) / 2) * r);
  const cy = size * ((3 / 2) * r);
  const centerLat = cy / M_LAT;
  return { centerLat, centerLng: cx / mLng(centerLat), q, r };
}

function pointInPolygon([lat, lng]: [number, number], poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i];
    const [yj, xj] = poly[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// A deterministic PRNG — a sampling test that changes its own inputs
// every run is a flake waiting to happen.
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('hex-geometry — shape', () => {
  test('a cell has exactly six corners', () => {
    expect(hexVertices(-1.95, 30.06, 250)).toHaveLength(6);
  });

  test('the corners are pointy-top: one is (near enough) due north', () => {
    const centerLat = -1.95;
    const centerLng = 30.06;
    const vs = hexVertices(centerLat, centerLng, 250);
    // A pointy-top hexagon has a single topmost corner, and it sits
    // straight above the centre. Straight, here, means within a few
    // metres — the residue of the projection warp the module header
    // describes, and two orders of magnitude below the cell size.
    const topmost = vs.reduce((a, b) => (b[0] > a[0] ? b : a));
    const northOffsetMeters = (topmost[0] - centerLat) * M_LAT;
    const eastWestOffsetMeters = Math.abs(topmost[1] - centerLng) * mLng(centerLat);
    expect(northOffsetMeters).toBeGreaterThan(240);
    expect(eastWestOffsetMeters).toBeLessThan(10);
    // A flat-top hexagon would instead have two corners tied at the top.
    const tied = vs.filter((v) => Math.abs(v[0] - topmost[0]) * M_LAT < 1);
    expect(tied).toHaveLength(1);
  });

  test('the corners sit at roughly the tier cell size from the centre', () => {
    const centerLat = -1.95;
    const centerLng = 30.06;
    for (const size of [250, 500, 1000, 5000]) {
      for (const [lat, lng] of hexVertices(centerLat, centerLng, size)) {
        const d = Math.hypot((lat - centerLat) * M_LAT, (lng - centerLng) * mLng(centerLat));
        // Within 1% — the lat/lng warp described in the module header.
        expect(Math.abs(d - size) / size).toBeLessThan(0.01);
      }
    }
  });

  test('bigger tiers draw bigger hexagons', () => {
    const small = hexVertices(-1.95, 30.06, 250);
    const big = hexVertices(-1.95, 30.06, 1000);
    const spread = (vs: [number, number][]) =>
      Math.max(...vs.map((v) => v[0])) - Math.min(...vs.map((v) => v[0]));
    expect(spread(big)).toBeGreaterThan(spread(small) * 3.5);
  });
});

describe('hex-geometry — the drawn cell IS the counted cell', () => {
  test.each([
    ['DENSE', 250],
    ['MEDIUM', 500],
    ['LOW', 1000],
    ['SPARSE', 5000],
  ])('%s (%i m): 5000 sampled points all fall inside their own hexagon', (_tier, size) => {
    const rand = lcg(20260816);
    let outside = 0;
    for (let i = 0; i < 5000; i++) {
      const lat = -2.02 + rand() * 0.14;
      const lng = 29.98 + rand() * 0.16;
      const cell = snapToCell(lat, lng, size as number);
      if (!pointInPolygon([lat, lng], hexVertices(cell.centerLat, cell.centerLng, size as number))) {
        outside += 1;
      }
    }
    expect(outside).toBe(0);
  });

  test('adjacent cells do not overlap at their shared edge', () => {
    // A point just inside cell A must not also be inside cell B.
    const rand = lcg(7);
    for (let i = 0; i < 500; i++) {
      const lat = -1.99 + rand() * 0.08;
      const lng = 30.02 + rand() * 0.1;
      const a = snapToCell(lat, lng, 250);
      const neighbours = [
        snapToCell(lat + 0.0025, lng, 250),
        snapToCell(lat - 0.0025, lng, 250),
        snapToCell(lat, lng + 0.0025, 250),
      ].filter((n) => n.q !== a.q || n.r !== a.r);
      for (const n of neighbours) {
        expect(pointInPolygon([lat, lng], hexVertices(n.centerLat, n.centerLng, 250))).toBe(false);
      }
    }
  });
});

describe('hex-geometry — intensity', () => {
  test('is 0 for an empty or impossible cell', () => {
    expect(intensity(0, 100)).toBe(0);
    expect(intensity(20, 0)).toBe(0);
  });

  test('is 1 for the busiest cell in the view', () => {
    expect(intensity(100, 100)).toBe(1);
  });

  test('a square-root ramp keeps quiet cells visible', () => {
    // A cell with 1% of the peak still reads at 10% of the ramp, which
    // is the point: a linear scale washes the whole city out behind
    // Nyabugogo.
    expect(intensity(1, 100)).toBeCloseTo(0.1, 6);
    expect(intensity(25, 100)).toBeCloseTo(0.5, 6);
  });

  test('fill deepens with intensity and never goes fully opaque or invisible', () => {
    const low = intensityFill(0);
    const high = intensityFill(1);
    expect(high.fillOpacity).toBeGreaterThan(low.fillOpacity);
    expect(low.fillOpacity).toBeGreaterThan(0);
    expect(high.fillOpacity).toBeLessThan(1);
    expect(low.color).toBe(high.color);
  });

  test('fill clamps values outside 0..1 rather than producing nonsense', () => {
    expect(intensityFill(-5).fillOpacity).toBe(intensityFill(0).fillOpacity);
    expect(intensityFill(5).fillOpacity).toBe(intensityFill(1).fillOpacity);
  });
});
