// __TESTS__/BASE-TILE-SOURCE.TEST.TS
//
// MAP-TRUTH G2/G6 — the regression that fails if the base-tile source
// silently reverts.
//
// Two things this guards, both of which actually happened on main:
//
//  1. FIVE map surfaces each carried their own hardcoded OSM URL. Three
//     of them (RoutePreviewMap, DriverApproachMap) therefore had
//     no offline fallback at all, and a fix confined to MapCanvas left
//     the in-ride approach map blank in exactly the conditions the fix
//     was for. The source is now named once; a second one reappearing
//     anywhere in client source fails here.
//
//  2. The CSP img-src allowance and the tile URL must agree. A CSP
//     wildcard `*.tile.openstreetmap.org` does NOT match the bare host
//     `tile.openstreetmap.org`, so changing one without the other ships
//     a blank map that no unit test of the component would catch.

// The other half of guard 2 — that buildCsp's img-src actually contains
// this host — lives in ../../webview-csp.test.ts, which runs in the node
// environment because importing vite.config pulls in esbuild.

import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { OSM_TILE_URL } from '../components/map/tile-source';

const SRC = resolve(__dirname, '..');
const TILE_SOURCE_FILE = join(SRC, 'components', 'map', 'tile-source.ts');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

describe('base tile source (MAP-TRUTH G2)', () => {
  test('exactly one file names a tile URL, and it is tile-source.ts', () => {
    const offenders = walk(SRC)
      .filter((f) => f !== TILE_SOURCE_FILE)
      .filter((f) => !f.includes('__tests__'))
      .filter((f) => /https:\/\/[^'"`\s]*tile\.openstreetmap\.org\/\{z\}/.test(readFileSync(f, 'utf8')));

    expect(offenders.map((f) => f.slice(SRC.length + 1))).toEqual([]);
  });

  test('every map surface renders BaseTileLayer, never a raw TileLayer', () => {
    const surfaces = [
      'components/map/MapCanvas.tsx',
      'components/journey/RoutePreviewMap.tsx',
      'components/journey/DriverApproachMap.tsx',
    ];
    for (const rel of surfaces) {
      const src = readFileSync(join(SRC, rel), 'utf8');
      expect(src, `${rel} must use the shared base layer`).toContain('<BaseTileLayer');
      expect(src, `${rel} must not render its own TileLayer`).not.toMatch(/<TileLayer\b/);
    }
  });

  test('the deprecated {s} subdomain scheme is gone', () => {
    expect(OSM_TILE_URL).not.toContain('{s}');
  });
});
