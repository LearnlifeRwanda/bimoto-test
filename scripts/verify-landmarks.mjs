#!/usr/bin/env node
// LANDMARKS G1 — the audit that should have run before the catalog shipped.
//
// packages/shared/src/constants/locations.ts has carried 35 Kigali landmarks
// since the beginning. Not one of them is in Kigali. Every point sits about
// 0.16-0.20 degrees west of the city — roughly 18-22 km out, in the hills
// past Nyabugogo. Nothing caught it because nothing consumed it: the catalog
// is logged by the seeder and read by the i18n workbook, and never drawn on
// a map or matched against a search box.
//
// This script is the missing check, in two halves.
//
//   node scripts/verify-landmarks.mjs
//     Reads the catalog and prints every entry against the Kigali bounding
//     box that scripts/build-region-pmtiles.command ships as the kigali
//     offline
//     map. Exits non-zero if any shipped point is outside it. This is the
//     "before" table, and later the invariant.
//
//   node scripts/verify-landmarks.mjs --geocode
//     Asks public OSM services where the landmark names in
//     scripts/landmark-dataset.json actually are, one request per second,
//     and writes the answers to scripts/landmark-geocode-cache.json. That
//     cache is committed: it is the only permitted source of coordinates
//     for the rebuilt catalog. Nobody types a latitude.
//
//   node scripts/verify-landmarks.mjs --from-evidence <file>
//     LANDMARKS G2. This environment's egress gateway still answers 403 to
//     every OSM host, so the harvest above was run from an egress-capable
//     machine and its raw record committed as
//     scripts/landmark-geocode-evidence-raw.json. This mode replays that
//     record through the same matching rule --geocode uses and writes the
//     same cache, so the catalog is built from evidence either way. The
//     evidence file is read-only input: it is never written, pruned or
//     regenerated here, and the reviewer's own `accepted` verdicts in it are
//     advisory — nothing reaches the cache without passing the rule below.
//
// Reading strategy mirrors scripts/i18n-review/sources.ts and
// scripts/wiring-audit/extract.ts: the catalog is read as TEXT, never
// imported, so this runs from a bare checkout with no build step.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * West, south, east, north — the same box as the `kigali` entry in the
 * region table of scripts/build-region-pmtiles.command. A landmark
 * outside it cannot be
 * drawn on the offline map, so it cannot be a landmark this app ships.
 */
export const KIGALI_BBOX = { west: 29.95, south: -2.1, east: 30.25, north: -1.83 };

export function insideBbox(point) {
  return (
    typeof point?.lat === 'number' &&
    typeof point?.lng === 'number' &&
    point.lng >= KIGALI_BBOX.west &&
    point.lng <= KIGALI_BBOX.east &&
    point.lat >= KIGALI_BBOX.south &&
    point.lat <= KIGALI_BBOX.north
  );
}

// ------------------------------------------------------------ catalog read
//
// The catalog files are plain literal arrays. A quote- and comment-aware
// scan is enough, and a parser that silently returned nothing would be worse
// than one that throws, so every step asserts what it expects to find.

function stringLiteral(src, from) {
  const quote = src[from];
  if (quote !== "'" && quote !== '"' && quote !== '`') return null;
  let out = '';
  for (let i = from + 1; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\\') {
      out += src[i + 1];
      i++;
      continue;
    }
    if (ch === quote) return out;
    out += ch;
  }
  return null;
}

function scanBrackets(src, from, onBracket) {
  let quote = null;
  for (let i = from; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') {
      i = src.indexOf('\n', i);
      if (i === -1) break;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end === -1) break;
      i = end + 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{' || ch === '}' || ch === '[' || ch === ']') {
      const stop = onBracket(ch, i);
      if (typeof stop === 'number') return stop;
    }
  }
  return -1;
}

function objectChunks(body) {
  const chunks = [];
  let depth = 0;
  let start = -1;
  scanBrackets(body, 0, (ch, i) => {
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        chunks.push(body.slice(start, i + 1));
        start = -1;
      }
    }
  });
  return chunks;
}

function arrayBody(src, name) {
  const anchor = new RegExp(`export const ${name}\\b[^=]*=\\s*\\[`).exec(src);
  if (!anchor) throw new Error(`verify-landmarks: could not find "export const ${name} = [" in the catalog`);
  const open = anchor.index + anchor[0].length;
  let depth = 1;
  const close = scanBrackets(src, open, (ch, i) => {
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) return i;
    }
  });
  if (close === -1) throw new Error(`verify-landmarks: unterminated ${name} array literal`);
  return src.slice(open, close);
}

function field(chunk, name) {
  const m = new RegExp(`(?:^|[^\\w.])${name}\\s*:\\s*`).exec(chunk);
  if (!m) return null;
  return stringLiteral(chunk, m.index + m[0].length);
}

function numberField(chunk, name) {
  const m = new RegExp(`(?:^|[^\\w.])${name}\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`).exec(chunk);
  return m ? Number(m[1]) : null;
}

/**
 * Every file that may hold a slice of the catalog. locations.ts is the entry
 * point; per-category files live beside it once the catalog is split, and
 * are picked up here automatically so this audit can never fall behind the
 * catalog it audits.
 */
export function catalogFiles(root = ROOT) {
  const dir = path.join(root, 'packages', 'shared', 'src', 'constants');
  const files = [path.join(dir, 'locations.ts')];
  const split = path.join(dir, 'landmarks');
  if (fs.existsSync(split)) {
    for (const f of fs.readdirSync(split).sort()) {
      if (f.endsWith('.ts')) files.push(path.join(split, f));
    }
  }
  return files.filter((f) => fs.existsSync(f));
}

/** Every landmark with a `point`, from every catalog file, in file order. */
export function loadCatalog(root = ROOT) {
  const found = [];
  for (const file of catalogFiles(root)) {
    const src = fs.readFileSync(file, 'utf8');
    for (const match of src.matchAll(/export const ([A-Z0-9_]*LANDMARKS)\b[^=]*=\s*\[/g)) {
      const name = match[1];
      if (name.includes('UNVERIFIED')) continue; // by design carries no point
      for (const chunk of objectChunks(arrayBody(src, name))) {
        const entryName = field(chunk, 'name');
        if (!entryName) continue;
        const lat = numberField(chunk, 'lat');
        const lng = numberField(chunk, 'lng');
        found.push({
          name: entryName,
          category: field(chunk, 'category') ?? '',
          point: lat === null || lng === null ? null : { lat, lng },
          source: `${path.relative(root, file)}#${name}`,
        });
      }
    }
  }
  return found;
}

// ------------------------------------------------------------- bbox report

function pad(s, n) {
  const str = String(s);
  return str.length >= n ? str.slice(0, n) : str + ' '.repeat(n - str.length);
}

export function auditCatalog(entries) {
  const rows = entries.map((e) => ({ ...e, inside: e.point !== null && insideBbox(e.point) }));
  const outside = rows.filter((r) => !r.inside);
  return { rows, outside };
}

function printAudit(entries) {
  const { rows, outside } = auditCatalog(entries);
  console.log(
    `Kigali bbox  W ${KIGALI_BBOX.west}  S ${KIGALI_BBOX.south}  E ${KIGALI_BBOX.east}  N ${KIGALI_BBOX.north}`,
  );
  console.log(`(same box as the kigali region in scripts/build-region-pmtiles.command)\n`);
  console.log(`${pad('name', 52)}${pad('lat', 12)}${pad('lng', 12)}verdict`);
  console.log('-'.repeat(88));
  for (const r of rows) {
    const lat = r.point ? r.point.lat.toFixed(4) : '—';
    const lng = r.point ? r.point.lng.toFixed(4) : '—';
    console.log(`${pad(r.name, 52)}${pad(lat, 12)}${pad(lng, 12)}${r.inside ? 'inside' : 'OUTSIDE'}`);
  }
  console.log('-'.repeat(88));
  console.log(`${rows.length} entries with a point — ${rows.length - outside.length} inside, ${outside.length} outside.`);
  return outside.length;
}

// ------------------------------------------------------------- OSM geocode
//
// Two public services, tried in order. Plain fetch, no SDK: one HTTP GET per
// name is not worth a dependency, and a dependency would have to be trusted
// with the only coordinates this app will ever ship.

const SERVICES = [
  {
    id: 'nominatim',
    probe: 'https://nominatim.openstreetmap.org/status?format=json',
    // viewbox is x1,y1,x2,y2 = west,north,east,south; bounded=1 refuses to
    // look outside it, which is exactly the guarantee this audit needs.
    url: (q) =>
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q + ', Kigali, Rwanda')}` +
      `&format=jsonv2&limit=5&addressdetails=0&bounded=1` +
      `&viewbox=${KIGALI_BBOX.west},${KIGALI_BBOX.north},${KIGALI_BBOX.east},${KIGALI_BBOX.south}`,
    parse: (json) =>
      (Array.isArray(json) ? json : []).map((r) => ({
        name: r.display_name ?? r.name ?? '',
        lat: Number(r.lat),
        lng: Number(r.lon),
        osm: r.osm_type && r.osm_id ? `${r.osm_type}/${r.osm_id}` : null,
      })),
  },
  {
    id: 'photon',
    probe: 'https://photon.komoot.io/api/?q=Kigali&limit=1',
    url: (q) =>
      `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=5&lang=en&lat=-1.95&lon=30.06` +
      `&bbox=${KIGALI_BBOX.west},${KIGALI_BBOX.south},${KIGALI_BBOX.east},${KIGALI_BBOX.north}`,
    parse: (json) =>
      (json?.features ?? []).map((f) => ({
        name: [f.properties?.name, f.properties?.city, f.properties?.country].filter(Boolean).join(', '),
        lat: f.geometry?.coordinates?.[1],
        lng: f.geometry?.coordinates?.[0],
        osm: f.properties?.osm_type && f.properties?.osm_id ? `${f.properties.osm_type}/${f.properties.osm_id}` : null,
      })),
  },
];

const USER_AGENT = 'bimoto-landmark-verifier/1.0 (+https://github.com/Joschll/bimoto)';
const THROTTLE_MS = 1100; // OSM's usage policy is one request per second.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// -------- the matching rule
//
// A candidate is accepted only when BOTH hold:
//   1. its point is inside the Kigali bbox, and
//   2. every significant token of the queried name appears in the name the
//      service returned.
// Significant = not a structural or generic word. "Isoko ya Kimironko"
// reduces to {kimironko}; "Gare ya Nyabugogo" to {nyabugogo}; "Okapi Hotel"
// to {okapi}. Matching on those alone would accept anything in the right
// neighbourhood, so the rule keeps every token that is not in the stop list
// and requires all of them — a query with no significant tokens left falls
// back to requiring the whole normalised name as a substring.

const STOPWORDS = new Set([
  'ya', 'y', 'i', 'wa', 'rwa', 'cya', 'bya', 'na',
  'de', 'du', 'des', 'la', 'le', 'les', 'of', 'the', 'and', 'a', 'in',
  'isoko', 'gare', 'kwa', 'chez', 'stop', 'turnoff', 'roundabout',
  'centre', 'center', 'hotel', 'hopital', 'hospital', 'house', 'building',
  'plaza', 'market', 'station', 'park', 'zone', 'campus', 'kigali', 'rwanda',
]);

export function normalise(s) {
  return String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function significantTokens(name) {
  const all = normalise(name).split(' ').filter(Boolean);
  const kept = all.filter((t) => t.length > 1 && !STOPWORDS.has(t));
  return kept.length > 0 ? kept : all;
}

export function nameMatches(query, candidateName) {
  const hay = normalise(candidateName);
  const tokens = significantTokens(query);
  if (tokens.length === 0) return normalise(query).length > 0 && hay.includes(normalise(query));
  return tokens.every((t) => hay.includes(t));
}

export function acceptCandidate(query, candidate) {
  return insideBbox(candidate) && nameMatches(query, candidate.name);
}

const CACHE_PATH = path.join(ROOT, 'scripts', 'landmark-geocode-cache.json');

function readCache() {
  if (!fs.existsSync(CACHE_PATH)) return { note: '', probes: {}, queries: {} };
  return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
}

function writeCache(cache, mode = 'live') {
  cache.note =
    mode === 'evidence'
      ? 'LANDMARKS G2 evidence. Written by scripts/verify-landmarks.mjs --from-evidence, which replays ' +
        'the committed raw harvest through the same matching rule --geocode applies. `probes` is this ' +
        "environment's own record: both OSM hosts answer 403 here, which is why the harvest was run " +
        'elsewhere. Every point in the catalog comes from `resolved` and from nowhere else; each entry ' +
        'names the service, the query and the OSM object, so it can be found again in the raw file.'
      : 'LANDMARKS G1 evidence. Written by scripts/verify-landmarks.mjs --geocode. ' +
        'The rebuilt catalog may take coordinates from here and from nowhere else.';
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2) + '\n');
}

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.json();
}

/**
 * One probe per service before any name is queried. A service that answers
 * its own status endpoint with a network or policy error will answer 235
 * name queries the same way, and retrying a policy denial is not something
 * this script is allowed to do — so it stops and says so.
 */
async function probeServices(cache) {
  const live = [];
  for (const service of SERVICES) {
    try {
      await getJson(service.probe);
      cache.probes[service.id] = { ok: true, probedAt: new Date().toISOString() };
      live.push(service);
      console.log(`  ${service.id}: reachable`);
    } catch (err) {
      const detail = err?.cause?.message ? `${err.message} (${err.cause.message})` : String(err.message ?? err);
      cache.probes[service.id] = { ok: false, probedAt: new Date().toISOString(), error: detail };
      console.log(`  ${service.id}: UNREACHABLE — ${detail}`);
    }
    await sleep(THROTTLE_MS);
  }
  return live;
}

function datasetNames() {
  const file = path.join(ROOT, 'scripts', 'landmark-dataset.json');
  const dataset = JSON.parse(fs.readFileSync(file, 'utf8'));
  const names = dataset.map((d) => d.name);
  for (const entry of loadCatalog()) names.push(entry.name);
  return [...new Set(names)];
}

async function geocode() {
  const cache = readCache();
  cache.probes = {};
  console.log('Probing OSM services before querying any name:');
  const live = await probeServices(cache);
  if (live.length === 0) {
    writeCache(cache);
    console.error(
      '\nNo OSM service is reachable from here. No coordinate was invented to fill the gap;\n' +
        `the failures are recorded in ${path.relative(ROOT, CACHE_PATH)}. Re-run this once egress allows\n` +
        'nominatim.openstreetmap.org or photon.komoot.io.',
    );
    return 2;
  }

  const names = datasetNames();
  console.log(`\nQuerying ${names.length} names at one request per second — expect about ${Math.ceil((names.length * THROTTLE_MS) / 60000)} minutes.\n`);
  let accepted = 0;
  let queried = 0;
  for (const name of names) {
    for (const service of live) {
      const key = `${service.id}:${name}`;
      if (cache.queries[key]) break; // already evidence; never re-ask
      let record;
      try {
        const candidates = service.parse(await getJson(service.url(name)));
        const hit = candidates.find((c) => acceptCandidate(name, c));
        record = {
          service: service.id,
          query: name,
          queriedAt: new Date().toISOString(),
          candidates,
          accepted: hit ? { lat: hit.lat, lng: hit.lng, name: hit.name, osm: hit.osm } : null,
        };
      } catch (err) {
        record = { service: service.id, query: name, queriedAt: new Date().toISOString(), error: String(err.message ?? err) };
      }
      cache.queries[key] = record;
      queried++;
      await sleep(THROTTLE_MS);
      if (record.accepted) break; // first service that can prove it, wins
    }
    const hit = live.map((s) => cache.queries[`${s.id}:${name}`]).find((r) => r?.accepted);
    if (hit) accepted++;
    console.log(`${hit ? 'OK  ' : '--  '}${pad(name, 56)}${hit ? `${hit.accepted.lat}, ${hit.accepted.lng}` : 'no candidate inside the bbox matched'}`);
    if (queried % 20 === 0) writeCache(cache);
  }
  writeCache(cache);
  console.log(`\n${accepted} of ${names.length} names verified inside the bbox. Evidence: ${path.relative(ROOT, CACHE_PATH)}`);
  return 0;
}

// ---------------------------------------------------------- evidence replay
//
// The evidence file records, per landmark name, every raw result the two
// services returned for every query variant the harvest tried. Replaying it
// means doing exactly what the live loop does — walk the services in order,
// take the first candidate that passes acceptCandidate, stop — except that
// the answers come off disk instead of the wire.

const SERVICE_ORDER = ['nominatim', 'photon'];

/**
 * The name a raw result is matched against. Nominatim's live parse used
 * display_name and Photon's joined name, city and country, so the harvest's
 * display_name is the same string the rule would have seen on the wire.
 */
export function evidenceCandidates(record) {
  return (record.results ?? []).map((r) => ({
    name: r.display_name || r.name || '',
    lat: Number(r.lat),
    lng: Number(r.lon),
    osm: r.osm_type && r.osm_id ? `${r.osm_type}/${r.osm_id}` : null,
    kind: [r.category, r.type].filter(Boolean).join('/') || null,
  }));
}

/**
 * Applies the rule to one landmark's raw records. `name` is the landmark's
 * real name, never the harvest's broadened query variant: "Chez Rasta" was
 * also asked as "rasta Kigali", and accepting on the variant's tokens would
 * accept whatever the broadening dragged in.
 */
export function resolveFromEvidence(name, records) {
  const ordered = [...records].sort((a, b) => {
    const d = SERVICE_ORDER.indexOf(a.service) - SERVICE_ORDER.indexOf(b.service);
    return d !== 0 ? d : 0;
  });
  let considered = 0;
  for (const record of ordered) {
    for (const candidate of evidenceCandidates(record)) {
      considered++;
      if (acceptCandidate(name, candidate)) {
        return { accepted: { ...candidate, service: record.service, query: record.query }, considered };
      }
    }
  }
  return { accepted: null, considered };
}

/**
 * The harvest split the team's lines into a name and a parenthetical of its
 * own, and three of them came out differently from the split committed in
 * scripts/landmark-dataset.json. Two of those three matter: the team's
 * "University of Rwanda (UR) - Gikondo Campus (Ex-SFB)" reached the harvest
 * as the bare name "University of Rwanda", and a bare university name in
 * Kigali matches AUCA. The dataset is the canonical split, so every dataset
 * row is rejoined to its evidence here by the full original line, and the
 * rule is then applied to the name the team actually wrote.
 */
export function canonicalNames(dataset) {
  const byKey = new Map();
  for (const row of dataset) {
    for (const key of [normalise(row.entry), normalise(row.name)]) {
      if (!byKey.has(key)) byKey.set(key, row.name);
    }
  }
  return (entry) => {
    const candidates = [
      normalise(`${entry?.name ?? ''} ${entry?.hint ?? ''}`),
      normalise(entry?.name ?? ''),
    ];
    for (const key of candidates) {
      const hit = byKey.get(key);
      if (hit) return hit;
    }
    return null;
  };
}

export function groupEvidence(evidence) {
  const raw = new Map();
  const finals = [];
  for (const record of evidence.queries ?? []) {
    if (record.final) finals.push(record);
    else raw.set(record.for, [...(raw.get(record.for) ?? []), record]);
  }
  return { raw, finals };
}

function fromEvidence(file) {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) {
    console.error(`verify-landmarks: no evidence file at ${abs}`);
    return 2;
  }
  const bytes = fs.readFileSync(abs);
  const evidence = JSON.parse(bytes.toString('utf8'));
  const { raw, finals } = groupEvidence(evidence);
  if (finals.length === 0) {
    console.error('verify-landmarks: the evidence file finalises no names — it is not the harvest record.');
    return 2;
  }

  const cache = readCache();
  cache.source = {
    kind: 'evidence-replay',
    file: path.relative(ROOT, abs),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    meta: evidence.meta ?? null,
    rule: 'acceptCandidate() in scripts/verify-landmarks.mjs — inside KIGALI_BBOX and every significant token of the landmark name present in the returned name',
    replayedNames: finals.length,
  };
  cache.queries = {};
  cache.resolved = {};

  const dataset = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'landmark-dataset.json'), 'utf8'));
  const canonical = canonicalNames(dataset);

  const rows = [];
  const renamed = [];
  for (const record of finals) {
    const harvested = record.entry?.name ?? record.for.split('::').slice(1).join('::');
    const name = (record.entry?.source === 'team-dataset' ? canonical(record.entry) : null) ?? harvested;
    if (name !== harvested) renamed.push({ harvested, name });
    const records = raw.get(record.for) ?? [];
    const { accepted, considered } = resolveFromEvidence(name, records);
    rows.push({ name, for: record.for, entry: record.entry, accepted, considered, reviewer: record.accepted ?? null });
    for (const r of records) {
      // The harvest broadened some names into a shared query ("rasta Kigali"),
      // so the landmark has to be part of the key or one record overwrites another.
      const key = `${record.for}|${r.service}:${r.query}`;
      const mine = accepted && accepted.service === r.service && accepted.query === r.query ? accepted : null;
      cache.queries[key] = {
        service: r.service,
        query: r.query,
        for: record.for,
        candidates: r.results?.length ?? 0,
        error: r.error ?? null,
        accepted: mine ? { lat: mine.lat, lng: mine.lng, name: mine.name, osm: mine.osm, kind: mine.kind } : null,
      };
    }
    if (accepted) {
      cache.resolved[name] = {
        lat: accepted.lat,
        lng: accepted.lng,
        name: accepted.name,
        osm: accepted.osm,
        kind: accepted.kind,
        service: accepted.service,
        query: accepted.query,
        evidenceFor: record.for,
      };
    }
  }

  // Every name the harvest finalised, resolved or not, so the catalog build
  // needs the dataset and this cache and nothing else.
  cache.names = rows.map((r) => ({
    name: r.name,
    hint: r.entry?.hint ?? null,
    source: r.entry?.source ?? null,
    resolved: Boolean(r.accepted),
  }));

  console.log(`${pad('name', 52)}${pad('lat', 12)}${pad('lng', 12)}verdict`);
  console.log('-'.repeat(96));
  for (const row of rows) {
    const lat = row.accepted ? row.accepted.lat.toFixed(5) : '—';
    const lng = row.accepted ? row.accepted.lng.toFixed(5) : '—';
    const verdict = row.accepted ? `verified (${row.accepted.service})` : `no candidate matched (${row.considered} seen)`;
    console.log(`${pad(row.name, 52)}${pad(lat, 12)}${pad(lng, 12)}${verdict}`);
  }
  console.log('-'.repeat(96));

  const mineOk = rows.filter((r) => r.accepted);
  const bySource = {};
  for (const row of rows) {
    const key = row.entry?.source ?? row.for.split('::')[0];
    bySource[key] ??= { total: 0, accepted: 0 };
    bySource[key].total++;
    if (row.accepted) bySource[key].accepted++;
  }
  console.log(`${mineOk.length} of ${rows.length} names verified by this rule.`);
  for (const [source, counts] of Object.entries(bySource)) {
    console.log(`  ${pad(source, 20)}${counts.accepted} of ${counts.total}`);
  }

  if (renamed.length > 0) {
    console.log(`\n${renamed.length} name(s) rejoined to the dataset's own split before the rule ran:`);
    for (const r of renamed) console.log(`  ${pad(r.harvested, 44)}-> ${r.name}`);
  }

  const disagreements = rows.filter((r) => Boolean(r.accepted) !== Boolean(r.reviewer));
  console.log(`\n${disagreements.length} disagreement(s) with the reviewer's advisory verdict:`);
  for (const row of disagreements) {
    if (row.reviewer && !row.accepted) {
      const hit = row.reviewer.hit ?? {};
      const candidate = { name: hit.display_name || hit.name || '', lat: Number(hit.lat), lng: Number(hit.lon) };
      const why = !insideBbox(candidate)
        ? 'reviewer hit is outside the Kigali bbox'
        : `reviewer hit "${candidate.name}" is missing token(s) ${significantTokens(row.name)
            .filter((t) => !normalise(candidate.name).includes(t))
            .join(', ')}`;
      console.log(`  reviewer yes / rule no   ${pad(row.name, 44)}${why}`);
    } else {
      console.log(
        `  rule yes / reviewer no   ${pad(row.name, 44)}accepted "${row.accepted.name}" from ${row.accepted.service} (query "${row.accepted.query}")`,
      );
    }
  }

  const floor = Math.ceil(rows.length / 2);
  if (mineOk.length < floor) {
    writeCache(cache, 'evidence');
    console.error(`\nSTOP: the rule accepts ${mineOk.length} of ${rows.length}, below the floor of ${floor}.`);
    return 1;
  }

  writeCache(cache, 'evidence');
  console.log(`\nWrote ${path.relative(ROOT, CACHE_PATH)} — ${Object.keys(cache.resolved).length} names carry a point.`);
  return 0;
}

// -------------------------------------------------------------------- main

async function main() {
  const geocodeMode = process.argv.includes('--geocode');
  const evidenceFlag = process.argv.indexOf('--from-evidence');
  if (evidenceFlag !== -1) {
    const file = process.argv[evidenceFlag + 1] ?? path.join(ROOT, 'scripts', 'landmark-geocode-evidence-raw.json');
    process.exit(fromEvidence(file));
  }
  if (geocodeMode) process.exit(await geocode());

  const entries = loadCatalog();
  const outside = printAudit(entries);
  if (outside > 0) {
    console.error(`\n${outside} shipped landmark(s) are outside Kigali. The catalog is wrong.`);
    process.exit(1);
  }
  process.exit(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
