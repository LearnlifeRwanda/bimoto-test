// SCRIPTS/TESTS/SELECT-ADMIN4.TEST.MJS
//
// SHIPSHAPE G2 — the selector must read what osmium actually writes.
//
// The bug this pins: derive-province-polys.command exports boundaries
// with `osmium export … -o .admin4.geojson`, and osmium picks its
// writer from the extension — `.geojson` means ONE FeatureCollection
// document. The selector that read it parsed line-by-line, so it
// matched nothing and the script died claiming "no admin_level=4
// boundary named Amajyaruguru / Northern Province" with the boundary
// sitting right there in the file. That happened to an operator
// mid-release (Update 5, 17 Aug 2026).
//
// So the fixtures below are the two shapes an export can arrive in —
// the FeatureCollection osmium writes today, and the line-delimited
// sequence the old code assumed — and both must select the same
// province. The GeoJSONL case is also a regression pin: its output must
// stay byte-identical to what the inline selector produced, because
// data/poly/*.poly is downstream of it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { featuresOf, selectAdmin4 } from '../select-admin4.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'select-admin4.mjs');

const RING = [
  [29.0, -2.0],
  [30.0, -2.0],
  [30.0, -1.0],
  [29.0, -1.0],
  [29.0, -2.0],
];

/** A boundary feature as osmium export writes one. */
function feature(props) {
  return {
    type: 'Feature',
    properties: props,
    geometry: { type: 'Polygon', coordinates: [RING] },
  };
}

const NORTH = feature({
  admin_level: '4',
  name: 'Amajyaruguru',
  'name:en': 'Northern Province',
  'name:rw': 'Amajyaruguru',
});
const SOUTH = feature({
  admin_level: '4',
  name: 'Amajyepfo',
  'name:en': 'Southern Province',
});
// A district inside the province — right name family, wrong level.
const DISTRICT = feature({ admin_level: '5', name: 'Amajyaruguru' });

const ALL = [NORTH, SOUTH, DISTRICT];

const COLLECTION = JSON.stringify({ type: 'FeatureCollection', features: ALL });
const SEQUENCE = ALL.map((f) => JSON.stringify(f)).join('\n') + '\n';

// --- the shape osmium actually writes --------------------------------

test('a FeatureCollection export selects the province', () => {
  const got = selectAdmin4(featuresOf(COLLECTION), 'Amajyaruguru', 'Northern Province');
  assert.equal(got.length, 1);
  assert.equal(got[0].properties['name:en'], 'Northern Province');
});

test('a pretty-printed FeatureCollection selects the province too', () => {
  const pretty = JSON.stringify({ type: 'FeatureCollection', features: ALL }, null, 2);
  const got = selectAdmin4(featuresOf(pretty), 'Amajyepfo', 'Southern Province');
  assert.equal(got.length, 1);
  assert.equal(got[0].properties.name, 'Amajyepfo');
});

// --- the shape the old inline selector assumed -----------------------

test('a line-delimited export still selects the province', () => {
  const got = selectAdmin4(featuresOf(SEQUENCE), 'Amajyaruguru', 'Northern Province');
  assert.equal(got.length, 1);
  assert.equal(got[0].properties.name, 'Amajyaruguru');
});

test('a single-feature line-delimited export selects it', () => {
  const got = selectAdmin4(featuresOf(JSON.stringify(NORTH) + '\n'), 'Amajyaruguru', 'Northern Province');
  assert.equal(got.length, 1);
});

test('a GeoJSON text sequence with RS separators selects the province', () => {
  const seq = ALL.map((f) => '\x1e' + JSON.stringify(f)).join('\n') + '\n';
  const got = selectAdmin4(featuresOf(seq), 'Amajyaruguru', 'Northern Province');
  assert.equal(got.length, 1);
});

// --- the predicate ---------------------------------------------------

test('admin_level 5 with the same name is not the province', () => {
  const got = selectAdmin4([DISTRICT], 'Amajyaruguru', 'Northern Province');
  assert.equal(got.length, 0);
});

test('a numeric admin_level 4 matches as well as the string', () => {
  const numeric = feature({ admin_level: 4, name: 'Iburasirazuba', 'name:en': 'Eastern Province' });
  const got = selectAdmin4([numeric], 'Iburasirazuba', 'Eastern Province');
  assert.equal(got.length, 1);
});

test('the English name alone is enough', () => {
  const got = selectAdmin4(featuresOf(COLLECTION), 'Amajyepfo', 'Southern Province');
  assert.equal(got.length, 1);
});

// --- the CLI contract ------------------------------------------------

test('both shapes produce byte-identical stdout', () => {
  const run = (input) =>
    execFileSync('node', [CLI, 'Amajyaruguru', 'Northern Province'], {
      input,
      encoding: 'utf8',
    });
  const fromCollection = run(COLLECTION);
  const fromSequence = run(SEQUENCE);
  assert.equal(fromCollection, fromSequence);
  // One JSON object per line, newline-terminated — the contract
  // geojson-to-poly.mjs reads on the other side of the pipe.
  assert.equal(fromSequence, JSON.stringify(NORTH) + '\n');
});

test('no match exits 3 with the message the caller reports', () => {
  let code = 0;
  let stderr = '';
  try {
    execFileSync('node', [CLI, 'Nowhere', 'No Province'], {
      input: COLLECTION,
      encoding: 'utf8',
    });
  } catch (err) {
    code = err.status;
    stderr = err.stderr;
  }
  assert.equal(code, 3);
  assert.match(stderr, /no admin_level=4 boundary named Nowhere \/ No Province/);
});
