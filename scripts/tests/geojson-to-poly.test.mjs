// SCRIPTS/TESTS/GEOJSON-TO-POLY.TEST.MJS
//
// MAP-RWANDA G3 — the conversion behind province clipping.
//
// Province builds clip to the real provincial boundary rather than a
// bounding box, because a box around Amajyaruguru overlaps three
// neighbours. The boundary reaches Planetiler as a .poly file, and this
// is the code that writes it — so it is the part that gets a test, while
// the osmium invocation that produces the GeoJSON stays a documented
// operator step in derive-province-polys.command.
//
// A real province boundary is not a simple ring. It can be several
// polygons (an exclave) and it can have holes (a lake, an enclave), and
// getting a hole wrong means clipping the hole INTO the province — a
// motari in the middle of it would find a map with a bite taken out.
// Both cases are covered below.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPoly, ringsOf, geometryFrom } from '../geojson-to-poly.mjs';

const SQUARE = [
  [29.0, -2.0],
  [30.0, -2.0],
  [30.0, -1.0],
  [29.0, -1.0],
  [29.0, -2.0],
];

const HOLE = [
  [29.4, -1.6],
  [29.6, -1.6],
  [29.6, -1.4],
  [29.4, -1.4],
  [29.4, -1.6],
];

test('a simple polygon becomes one ring', () => {
  const poly = toPoly('north', { type: 'Polygon', coordinates: [SQUARE] });
  assert.equal(
    poly,
    [
      'north',
      '1',
      '   29.0000000   -2.0000000',
      '   30.0000000   -2.0000000',
      '   30.0000000   -1.0000000',
      '   29.0000000   -1.0000000',
      '   29.0000000   -2.0000000',
      'END',
      'END',
      '',
    ].join('\n'),
  );
});

test('a hole is marked with ! so it is cut OUT, not clipped in', () => {
  const poly = toPoly('west', { type: 'Polygon', coordinates: [SQUARE, HOLE] });
  const lines = poly.split('\n');
  assert.equal(lines[0], 'west');
  assert.equal(lines[1], '1');
  // The second ring is the hole. Without the !, a lake or an enclave
  // would become the only part of the province that got built.
  assert.ok(lines.includes('!2'), 'hole ring must carry the ! prefix');
  assert.equal(lines.filter((l) => l === 'END').length, 3); // 2 rings + file
});

test('a multipolygon keeps every part', () => {
  const second = SQUARE.map(([lon, lat]) => [lon + 2, lat]);
  const poly = toPoly('east', {
    type: 'MultiPolygon',
    coordinates: [[SQUARE], [second]],
  });
  const rings = poly.split('\n').filter((l) => /^!?\d+$/.test(l));
  assert.deepEqual(rings, ['1', '2']);
  // An exclave is a separate outer ring, never a hole.
  assert.ok(!poly.includes('!'));
  assert.ok(poly.includes('   31.0000000'));
});

test('coordinates are written at centimetre precision', () => {
  const poly = toPoly('south', {
    type: 'Polygon',
    coordinates: [[[29.123456789, -2.987654321], ...SQUARE.slice(1)]],
  });
  assert.ok(poly.includes('   29.1234568   -2.9876543'));
});

test('the file ends with the file-level END', () => {
  const poly = toPoly('north', { type: 'Polygon', coordinates: [SQUARE] });
  assert.ok(poly.endsWith('END\nEND\n'));
});

test('several features merge into one province', () => {
  const second = SQUARE.map(([lon, lat]) => [lon + 2, lat]);
  const geometry = geometryFrom({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: { type: 'Polygon', coordinates: [SQUARE] } },
      { type: 'Feature', geometry: { type: 'Polygon', coordinates: [second] } },
    ],
  });
  assert.equal(geometry.type, 'MultiPolygon');
  const rings = toPoly('north', geometry)
    .split('\n')
    .filter((l) => /^!?\d+$/.test(l));
  assert.deepEqual(rings, ['1', '2']);
});

test('a bare Feature and a bare geometry both work', () => {
  const g = { type: 'Polygon', coordinates: [SQUARE] };
  assert.deepEqual(geometryFrom({ type: 'Feature', geometry: g }), g);
  assert.deepEqual(geometryFrom(g), g);
});

test('unusable input fails loudly rather than writing a broken clip', () => {
  // A silently empty or malformed .poly would make Planetiler build
  // something — and whatever it built would be shipped as a province.
  assert.throws(() => toPoly('north', { type: 'Point', coordinates: [29, -2] }), /unsupported/);
  assert.throws(() => toPoly('north', { type: 'Polygon', coordinates: [] }), /no rings/);
  assert.throws(
    () => toPoly('north', { type: 'Polygon', coordinates: [[[29, -2], [30, -2]]] }),
    /fewer than 3/,
  );
  assert.throws(
    () => toPoly('north', { type: 'Polygon', coordinates: [[[29, -2], [30, -2], ['x', -1]]] }),
    /non-numeric/,
  );
  assert.throws(() => ringsOf(null), /no geometry/);
  assert.throws(
    () => geometryFrom({ type: 'FeatureCollection', features: [] }),
    /no geometry/,
  );
});
