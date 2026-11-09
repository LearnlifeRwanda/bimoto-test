// LANDMARKS G1 — tests for the audit itself.
//
// The audit is the only thing standing between a typed-in coordinate and a
// motari sent 18 km into the hills, so its own parts are exercised here:
// the bounding box, the text parser that reads the catalog without importing
// it, and the rule that decides whether an OSM answer is the place we asked
// about.
//
// Run: node --test scripts/tests/verify-landmarks.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';

import {
  KIGALI_BBOX,
  insideBbox,
  loadCatalog,
  auditCatalog,
  normalise,
  significantTokens,
  nameMatches,
  acceptCandidate,
  evidenceCandidates,
  resolveFromEvidence,
  canonicalNames,
  groupEvidence,
} from '../verify-landmarks.mjs';
import { classifyParen, splitEntry } from '../build-landmarks.mjs';

test('the bbox is the one the offline map ships', () => {
  assert.deepEqual(KIGALI_BBOX, { west: 29.95, south: -2.1, east: 30.25, north: -1.83 });
});

test('insideBbox accepts the city and refuses the hills west of it', () => {
  // A point on the eastern edge and one on the western edge of the box.
  assert.equal(insideBbox({ lat: KIGALI_BBOX.south, lng: KIGALI_BBOX.west }), true);
  assert.equal(insideBbox({ lat: KIGALI_BBOX.north, lng: KIGALI_BBOX.east }), true);
  // A tenth of a degree west of the box is where the shipped catalog lives.
  assert.equal(insideBbox({ lat: -1.94, lng: KIGALI_BBOX.west - 0.1 }), false);
  assert.equal(insideBbox({ lat: KIGALI_BBOX.south - 0.01, lng: 30.1 }), false);
  assert.equal(insideBbox(null), false);
  assert.equal(insideBbox({ lat: '-1.94', lng: '30.1' }), false);
});

test('the catalog is read off disk without importing it', () => {
  const entries = loadCatalog();
  assert.ok(entries.length > 0, 'parsed no landmarks — the parser needs updating');
  for (const entry of entries) {
    assert.ok(entry.name.length > 0);
    assert.ok(entry.source.includes('#'), 'every entry says which file and array it came from');
  }
  // Named entries the parser must not lose, whatever the catalog is split into.
  const names = entries.map((e) => e.name);
  assert.ok(names.some((n) => n.includes('Nyabugogo')));
});

test('auditCatalog separates inside from outside', () => {
  const { rows, outside } = auditCatalog([
    { name: 'in', point: { lat: -1.95, lng: 30.06 } },
    { name: 'out', point: { lat: -1.95, lng: 29.85 } },
    { name: 'no point', point: null },
  ]);
  assert.equal(rows.length, 3);
  assert.deepEqual(
    outside.map((r) => r.name),
    ['out', 'no point'],
  );
});

test('normalise folds case, accents and punctuation', () => {
  assert.equal(normalise('Hôtel des Mille Collines'), 'hotel des mille collines');
  assert.equal(normalise("Isoko y'Umujyi / City Market"), 'isoko y umujyi city market');
  assert.equal(normalise('Saint-André'), 'saint andre');
});

test('significant tokens drop the structural words motaris speak past', () => {
  assert.deepEqual(significantTokens('Isoko ya Kimironko'), ['kimironko']);
  assert.deepEqual(significantTokens('Gare ya Nyabugogo'), ['nyabugogo']);
  assert.deepEqual(significantTokens('Kwa Mutwe'), ['mutwe']);
  assert.deepEqual(significantTokens('Chez Lando'), ['lando']);
  // A name made only of stop words keeps them rather than matching everything.
  assert.deepEqual(significantTokens('Kigali'), ['kigali']);
});

test('nameMatches requires every significant token of the query', () => {
  assert.equal(nameMatches('Isoko ya Kimironko', 'Kimironko Market, Kigali, Rwanda'), true);
  assert.equal(nameMatches('Gare ya Nyabugogo', 'Nyabugogo Bus Terminal, Nyarugenge'), true);
  assert.equal(nameMatches('Isoko ya Kimironko', 'Kicukiro Market, Kigali'), false);
  assert.equal(nameMatches('Kigali Genocide Memorial', 'Genocide Memorial, Gisozi, Kigali'), true);
  // Two different markets must not satisfy each other.
  assert.equal(nameMatches('Isoko ya Gisozi', 'Isoko ya Gikondo'), false);
});

// ------------------------------------------------------- the shipped catalog
//
// The invariant this whole dispatch exists for. It was red by design in G1
// with 35 of 35 entries outside the box; it is a merge condition now.

test('every shipped landmark is inside Kigali', () => {
  const { rows, outside } = auditCatalog(loadCatalog());
  assert.ok(rows.length > 100, `only ${rows.length} landmarks carry a point — the catalog looks truncated`);
  assert.deepEqual(
    outside.map((r) => `${r.name} (${r.source})`),
    [],
  );
});

test('the unverified half of the catalog carries no coordinates at all', () => {
  const dir = new URL('../../packages/shared/src/constants/landmarks/', import.meta.url);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ts'));
  assert.ok(files.length > 10, 'expected one catalog file per category');
  for (const file of files) {
    const src = fs.readFileSync(new URL(file, dir), 'utf8');
    const anchor = /export const \w*UNVERIFIED_LANDMARKS\b[^=]*=\s*\[/.exec(src);
    if (!anchor) continue;
    assert.equal(
      /\blat:\s*-?\d/.test(src.slice(anchor.index)),
      false,
      `${file} has a coordinate inside its unverified array`,
    );
  }
});

// -------------------------------------------------------- the evidence replay

test('a raw OSM result becomes a candidate the rule can judge', () => {
  const [candidate] = evidenceCandidates({
    results: [
      {
        display_name: 'Sonatubes, Kicukiro District, City of Kigali, Rwanda',
        name: 'Sonatubes',
        lat: '-1.9686025',
        lon: '30.1023935',
        osm_type: 'way',
        osm_id: 143208385,
        category: 'highway',
        type: 'bus_stop',
      },
    ],
  });
  assert.equal(candidate.name, 'Sonatubes, Kicukiro District, City of Kigali, Rwanda');
  assert.equal(candidate.lat, -1.9686025);
  assert.equal(candidate.lng, 30.1023935);
  assert.equal(candidate.osm, 'way/143208385');
  assert.equal(candidate.kind, 'highway/bus_stop');
});

test('the replay takes the first candidate that passes, nominatim before photon', () => {
  const hit = (name, lat, lon) => ({ display_name: name, lat: String(lat), lon: String(lon), osm_type: 'node', osm_id: 1 });
  const records = [
    { service: 'photon', query: 'Kimironko', results: [hit('Kimironko Market, Gasabo, Kigali', -1.9498, 30.1263)] },
    { service: 'nominatim', query: 'Isoko ya Kimironko', results: [hit('Kimironko Market, Kigali, Rwanda', -1.9497, 30.1262)] },
  ];
  const { accepted } = resolveFromEvidence('Isoko ya Kimironko', records);
  assert.equal(accepted.service, 'nominatim');
  assert.equal(accepted.lng, 30.1262);
});

test('the replay refuses a name the harvest broadened its way into', () => {
  // The harvest also asked "rasta Kigali" for "Chez Rasta". A hit that only
  // answers the broadened query must not become a coordinate.
  const records = [
    {
      service: 'nominatim',
      query: 'rasta Kigali',
      results: [{ display_name: 'Kigali Heights, Kimihurura, Kigali', lat: '-1.9527', lon: '30.0927', osm_type: 'way', osm_id: 2 }],
    },
  ];
  assert.equal(resolveFromEvidence('Chez Rasta', records).accepted, null);
});

test('the dataset split wins over the harvest split', () => {
  const canonical = canonicalNames([
    { entry: 'University of Rwanda (UR) - Gikondo Campus (Ex-SFB)', name: 'University of Rwanda - Gikondo Campus' },
    { entry: 'Lycée de Kigali (LDK)', name: 'Lycée de Kigali' },
    { entry: 'Chez Lando (Remera junction)', name: 'Chez Lando' },
  ]);
  // The harvest reduced the Gikondo campus to a bare university name, which
  // in Kigali matches a different university altogether.
  assert.equal(
    canonical({ name: 'University of Rwanda', hint: 'UR) - Gikondo Campus (Ex-SFB' }),
    'University of Rwanda - Gikondo Campus',
  );
  assert.equal(canonical({ name: 'Lycee de Kigali', hint: 'LDK' }), 'Lycée de Kigali');
  assert.equal(canonical({ name: 'Chez Lando', hint: 'Remera junction' }), 'Chez Lando');
  assert.equal(canonical({ name: 'Somewhere Else', hint: null }), null);
});

test('the committed evidence finalises every name it was asked about', () => {
  const file = new URL('../landmark-geocode-evidence-raw.json', import.meta.url);
  const { raw, finals } = groupEvidence(JSON.parse(fs.readFileSync(file, 'utf8')));
  assert.equal(finals.length, 268, 'the harvest record is not the one this dispatch describes');
  for (const record of finals) {
    assert.ok(raw.has(record.for), `${record.for} was finalised with no raw result behind it`);
  }
});

// ---------------------------------------------------------- alias derivation

test('a parenthetical is an alias when it is a name, and a hint when it is a place', () => {
  assert.deepEqual(classifyParen('Kigali Heights', 'KH'), { kind: 'alias', value: 'KH' });
  assert.deepEqual(classifyParen('CHUK', 'Centre Hospitalier Universitaire de Kigali'), {
    kind: 'alias',
    value: 'Centre Hospitalier Universitaire de Kigali',
  });
  assert.deepEqual(classifyParen('IPRC Kigali', 'formerly ETO Kicukiro'), { kind: 'alias', value: 'ETO Kicukiro' });
  assert.deepEqual(classifyParen('Chez Lando', 'Remera junction'), { kind: 'hint', value: 'Remera junction' });
  assert.deepEqual(classifyParen('Nyamirambo', 'Nyamirambo'), { kind: 'drop' });
});

test('a slash in the team\'s name is two names for one place', () => {
  const split = splitEntry({
    name: "Isoko y'Umujyi / City Market",
    parens: ['Kigali City Market'],
  });
  assert.equal(split.name, "Isoko y'Umujyi");
  assert.ok(split.aliases.includes('City Market'));
  assert.equal(split.areaHint, 'Kigali City Market');
});

test('a candidate is accepted only when it is both the right name and in Kigali', () => {
  const rightNameWrongPlace = { name: 'Kimironko Market', lat: -1.95, lng: 29.85 };
  const wrongNameRightPlace = { name: 'Kicukiro Market', lat: -1.95, lng: 30.06 };
  const both = { name: 'Kimironko Market, Kigali', lat: -1.95, lng: 30.11 };
  assert.equal(acceptCandidate('Isoko ya Kimironko', rightNameWrongPlace), false);
  assert.equal(acceptCandidate('Isoko ya Kimironko', wrongNameRightPlace), false);
  assert.equal(acceptCandidate('Isoko ya Kimironko', both), true);
});
