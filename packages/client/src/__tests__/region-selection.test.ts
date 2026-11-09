// __TESTS__/REGION-SELECTION.TEST.TS
//
// MAP-RWANDA G4 — which cached archive draws the map.
//
// protomaps-leaflet cannot stack two full-flavor basemap layers (each one
// fills every tile with an opaque background before painting, so the
// upper layer erases the lower wherever it has no data — see
// components/map/region-selection.ts for the source lines). So one
// archive is active at a time, chosen by where the map is looking, and
// this is the choice.
//
// The rules that matter to a rider:
//   - in Kigali with both Kigali and Rwanda downloaded, the CITY draws —
//     it is the archive built for that box and has the detail;
//   - riding into a province they have, that province draws;
//   - drifted somewhere they have no archive for, the widest one draws
//     rather than nothing — a partly-covering map beats the raster layer
//     they have no signal for.

import { describe, test, expect } from 'vitest';
import {
  pickRegion,
  boundsContain,
  boundsArea,
  type RegionCandidate,
} from '../components/map/region-selection';

// Rough real coverage, of the shape each archive's PMTiles header carries.
const RWANDA = { minLon: 28.85, minLat: -2.85, maxLon: 30.9, maxLat: -1.05 };
const KIGALI = { minLon: 29.95, minLat: -2.1, maxLon: 30.25, maxLat: -1.83 };
const NORTH = { minLon: 29.3, minLat: -1.9, maxLon: 30.1, maxLat: -1.05 };
const WEST = { minLon: 28.85, minLat: -2.85, maxLon: 29.6, maxLat: -1.35 };

const at = (lat: number, lng: number) => ({ lat, lng });

// Real places, so a failure says something about Rwanda and not about
// an abstract rectangle.
const NYABUGOGO = at(-1.939, 30.043); // Kigali
const MUSANZE = at(-1.499, 29.635); // Northern Province
const RUBAVU = at(-1.679, 29.264); // Western Province
const OUTSIDE = at(-3.5, 32.0); // well beyond any archive

function candidates(
  ...entries: Array<[string, typeof RWANDA | null]>
): RegionCandidate<string>[] {
  return entries.map(([region, bounds]) => ({ region, bounds, value: region }));
}

describe('boundsContain / boundsArea', () => {
  test('a point inside and a point outside', () => {
    expect(boundsContain(KIGALI, NYABUGOGO)).toBe(true);
    expect(boundsContain(KIGALI, MUSANZE)).toBe(false);
    expect(boundsContain(RWANDA, MUSANZE)).toBe(true);
    expect(boundsContain(RWANDA, OUTSIDE)).toBe(false);
  });

  test('the country is larger than any province', () => {
    expect(boundsArea(RWANDA)).toBeGreaterThan(boundsArea(NORTH));
    expect(boundsArea(NORTH)).toBeGreaterThan(boundsArea(KIGALI));
  });
});

describe('pickRegion', () => {
  test('nothing cached → null, and the map stays on online tiles', () => {
    expect(pickRegion([], NYABUGOGO)).toBeNull();
  });

  test('one archive is always the answer, wherever the map is', () => {
    const only = candidates(['kigali', KIGALI]);
    expect(pickRegion(only, NYABUGOGO)?.region).toBe('kigali');
    // Even looking somewhere it does not cover: one map beats no map.
    expect(pickRegion(only, MUSANZE)?.region).toBe('kigali');
  });

  test('in Kigali, the city archive wins over the whole country', () => {
    const both = candidates(['rwanda', RWANDA], ['kigali', KIGALI]);
    // The tighter box is the one built with detail to spare at z14.
    expect(pickRegion(both, NYABUGOGO)?.region).toBe('kigali');
  });

  test('in Musanze, the province the rider downloaded draws', () => {
    const held = candidates(['rwanda', RWANDA], ['kigali', KIGALI], ['north', NORTH]);
    expect(pickRegion(held, MUSANZE)?.region).toBe('north');
    // …and riding back to the capital swaps to the city.
    expect(pickRegion(held, NYABUGOGO)?.region).toBe('kigali');
  });

  test('two provinces held: each covers its own', () => {
    const held = candidates(['north', NORTH], ['west', WEST]);
    expect(pickRegion(held, MUSANZE)?.region).toBe('north');
    expect(pickRegion(held, RUBAVU)?.region).toBe('west');
  });

  test('a province the rider does not hold falls back to the country', () => {
    const held = candidates(['rwanda', RWANDA], ['kigali', KIGALI]);
    // No Northern archive, but Rwanda covers Musanze.
    expect(pickRegion(held, MUSANZE)?.region).toBe('rwanda');
  });

  test('outside every archive, the widest one draws rather than nothing', () => {
    const held = candidates(['kigali', KIGALI], ['rwanda', RWANDA]);
    expect(pickRegion(held, OUTSIDE)?.region).toBe('rwanda');
  });

  test('before the map reports a centre, the widest archive draws', () => {
    const held = candidates(['kigali', KIGALI], ['rwanda', RWANDA]);
    expect(pickRegion(held, null)?.region).toBe('rwanda');
  });

  test('an archive with an unreadable header is a last resort, not a default', () => {
    // Unknown coverage must never beat a known covering archive…
    const mixed = candidates(['broken', null], ['kigali', KIGALI]);
    expect(pickRegion(mixed, NYABUGOGO)?.region).toBe('kigali');
    // …nor a known non-covering one.
    expect(pickRegion(mixed, MUSANZE)?.region).toBe('kigali');
    // But if it is all there is, it is used.
    expect(pickRegion(candidates(['broken', null]), NYABUGOGO)?.region).toBe('broken');
    // And if every header is unreadable, something still draws.
    expect(
      pickRegion(candidates(['broken', null], ['alsobroken', null]), NYABUGOGO),
    ).not.toBeNull();
  });

  test('the choice is stable — the same inputs give the same archive', () => {
    const held = candidates(['rwanda', RWANDA], ['kigali', KIGALI], ['north', NORTH]);
    const first = pickRegion(held, NYABUGOGO)?.region;
    for (let i = 0; i < 5; i++) {
      expect(pickRegion(held, NYABUGOGO)?.region).toBe(first);
    }
  });
});
