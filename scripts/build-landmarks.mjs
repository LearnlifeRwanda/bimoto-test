#!/usr/bin/env node
// LANDMARKS G2 — the catalog, rebuilt from evidence.
//
// The catalog that shipped was 35 hand-typed entries, every one of them
// about 20 km west of Kigali. This script replaces it, and it is the only
// thing allowed to write packages/shared/src/constants/landmarks/. Its rule
// is the point of the whole exercise:
//
//   a landmark carries a `point` only if scripts/landmark-geocode-cache.json
//   resolved its name, and the point is copied from there verbatim.
//
// Everything the cache could not resolve still ships — a passenger who says
// "Kwa Jules" must be understood even when no database knows where that is —
// but it ships in UNVERIFIED_LANDMARKS, with no coordinates at all, so the
// app has to ask for a pin instead of guessing one.
//
// Inputs, all committed, none of them typed by hand in this file:
//   scripts/landmark-dataset.json          the team's 235 lines, split
//   scripts/landmark-existing.json         the 35 old entries' translations
//   scripts/landmark-geocode-cache.json    the only source of coordinates
//
// Run: pnpm landmarks:build

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { insideBbox, normalise } from './verify-landmarks.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'packages', 'shared', 'src', 'constants', 'landmarks');
const LOCATIONS = path.join(ROOT, 'packages', 'shared', 'src', 'constants', 'locations.ts');

const CATEGORIES = [
  ['orientation', 'Orientation points — what a motari actually steers by'],
  ['transport', 'Bus and taxi parks'],
  ['market', 'Markets'],
  ['business', 'Office towers, malls and commercial buildings'],
  ['neighborhood', 'Neighbourhoods and their sub-areas'],
  ['hospital', 'Hospitals and clinics'],
  ['hotel', 'Hotels'],
  ['recreation', 'Stadiums, parks and places people go on a Sunday'],
  ['memorial', 'Memorials, museums and galleries'],
  ['government', 'Ministries, embassies and public institutions'],
  ['education', 'Universities and schools'],
  ['worship', 'Churches and mosques'],
  ['industrial', 'Industrial zones and depots'],
  ['venue', 'Event venues'],
];

/**
 * The 30 places the old catalog and the team's list both name. Written as
 * name pairs and nothing else — the merge decides which words to keep, never
 * which coordinates. The team's spoken name wins; the old name survives as an
 * alias so a passenger who types the English one still finds the place.
 *
 * Nineteen more pairs merge on their own because the two lists spell them the
 * same way, so they are not repeated here.
 */
const SAME_PLACE = {
  'Nyabugogo Bus Station': 'Gare ya Nyabugogo',
  'Kigali Bus Park': "Gare y'Umujyi",
  'Remera Taxi Park': 'Gare ya Remera',
  'Kimironko Market': 'Isoko ya Kimironko',
  'Nyabugogo Market': 'Isoko ya Nyabugogo',
  'Kicukiro Center': 'Kicukiro',
  'RDB Offices': 'RDB',
  'MTN Center': 'MTN Centre',
  // Kigali Arena was renamed BK Arena in 2021. Same building in Remera.
  'Kigali Arena': 'BK Arena',
  'Amahoro Stadium': 'Stade Amahoro',
  // The memorial inside Camp Kigali is to the ten Belgian peacekeepers.
  'Camp Kigali Memorial': 'Belgian Peacekeepers Memorial',
};

const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

// --------------------------------------------------------------- aliases
//
// "Derived mechanically from the dataset text only" means exactly that: the
// rules below look at the line the team wrote and nothing else. No name is
// invented, and no proper noun is translated.

/** Initials of the significant words of `s` — "Kigali City Tower" -> "kct". */
function initials(s) {
  return normalise(s)
    .split(' ')
    .filter((w) => w.length > 2 || /^[a-z]$/.test(w))
    .map((w) => w[0])
    .join('');
}

/**
 * Decides what a parenthetical is. A parenthetical is an alias when it is an
 * acronym of the name ("Kigali Heights (KH)"), or when the name is an acronym
 * of it ("CHUK (Centre Hospitalier Universitaire de Kigali)"), or when it
 * plainly announces another name ("formerly ETO Kicukiro"). Otherwise it is
 * what it usually is: a hint about where in the city to look.
 */
export function classifyParen(name, paren) {
  const n = normalise(name);
  const p = normalise(paren);
  if (!p) return { kind: 'drop' };
  const bare = p.replace(/^(formerly|ex|old|aka|also)\s+/, '');
  if (/^(formerly|ex|old|aka|also)\s+/.test(p)) return { kind: 'alias', value: paren.replace(/^\s*(formerly|Ex-|ex-|Old|aka|also)\s*/i, '').trim() };
  if (bare === n) return { kind: 'drop' };
  if (initials(paren) === n.replace(/\s+/g, '')) return { kind: 'alias', value: paren };
  if (initials(name) === p.replace(/\s+/g, '')) return { kind: 'alias', value: paren };
  if (p.split(' ').length === 1 && paren === paren.toUpperCase() && paren.length <= 12) return { kind: 'alias', value: paren };
  return { kind: 'hint', value: paren };
}

/**
 * One dataset line becomes a name, a set of aliases and at most one area
 * hint. A slash inside the name is the team writing two names for one place
 * ("Isoko y'Umujyi / City Market"), so the first is the name and the rest
 * are aliases.
 */
export function splitEntry(row) {
  const parts = row.name.split(/\s+\/\s+/).map((s) => s.trim()).filter(Boolean);
  const name = parts[0];
  const aliases = parts.slice(1);
  const hints = [];
  for (const paren of row.parens ?? []) {
    for (const piece of paren.split(/\s+\/\s+/).map((s) => s.trim()).filter(Boolean)) {
      const verdict = classifyParen(name, piece);
      if (verdict.kind === 'alias') aliases.push(verdict.value);
      else if (verdict.kind === 'hint') hints.push(verdict.value);
    }
  }
  return { name, aliases, areaHint: hints.join(' / ') || null };
}

// ----------------------------------------------------------------- merge

function main() {
  const dataset = read('scripts/landmark-dataset.json');
  const existing = read('scripts/landmark-existing.json');
  const cache = read('scripts/landmark-geocode-cache.json');
  if (!cache.resolved) throw new Error('build-landmarks: the cache carries no resolved points — run `pnpm landmarks:evidence` first');

  /** name -> entry under construction, in dataset order. */
  const byName = new Map();
  const mergedDuplicates = [];

  for (const row of dataset) {
    const split = splitEntry(row);
    const found = byName.get(split.name);
    if (found) {
      // The team listed the same place under two headings.
      mergedDuplicates.push({ name: split.name, kept: found.category, alsoUnder: row.category, from: 'dataset' });
      for (const alias of split.aliases) if (!found.aliases.includes(alias)) found.aliases.push(alias);
      if (split.areaHint && !found.areaHint) found.areaHint = split.areaHint;
      continue;
    }
    byName.set(split.name, {
      name: split.name,
      aliases: split.aliases,
      areaHint: split.areaHint,
      nameRw: null,
      nameFr: null,
      category: row.category,
      cacheKeys: [split.name],
    });
  }

  for (const old of existing) {
    const target = SAME_PLACE[old.spoken] ?? SAME_PLACE[old.name] ?? null;
    const match =
      (target && byName.get(target)) ??
      byName.get(old.spoken) ??
      [...byName.values()].find((e) => normalise(e.name) === normalise(old.spoken));

    const extraAliases = [old.name, old.spoken, old.expansion].filter(Boolean);

    if (match) {
      mergedDuplicates.push({ name: match.name, kept: match.category, alsoUnder: old.category, from: 'locations.ts', was: old.name });
      match.nameRw ??= old.nameRw || null;
      match.nameFr ??= old.nameFr || null;
      for (const alias of extraAliases) {
        if (alias !== match.name && !match.aliases.includes(alias)) match.aliases.push(alias);
      }
      if (!match.cacheKeys.includes(old.spoken)) match.cacheKeys.push(old.spoken);
      continue;
    }

    byName.set(old.spoken, {
      name: old.spoken,
      aliases: extraAliases.filter((a) => a !== old.spoken),
      areaHint: null,
      nameRw: old.nameRw || null,
      nameFr: old.nameFr || null,
      category: old.category,
      cacheKeys: [old.spoken, old.name],
    });
  }

  // ------------------------------------------------------ attach evidence
  const entries = [];
  for (const entry of byName.values()) {
    let point = null;
    let evidence = null;
    for (const key of entry.cacheKeys) {
      const hit = cache.resolved[key];
      if (!hit) continue;
      if (!insideBbox({ lat: hit.lat, lng: hit.lng })) {
        throw new Error(`build-landmarks: cache point for ${key} is outside the Kigali bbox — the cache is not trustworthy`);
      }
      point = { lat: hit.lat, lng: hit.lng };
      evidence = hit;
      break;
    }
    entries.push({ ...entry, point, evidence });
  }

  // ----------------------------------------------------------- emit files
  fs.mkdirSync(OUT_DIR, { recursive: true });
  writeTypes();

  const written = [];
  for (const [category, blurb] of CATEGORIES) {
    const slice = entries.filter((e) => e.category === category);
    const verified = slice.filter((e) => e.point);
    const unverified = slice.filter((e) => !e.point);
    const file = path.join(OUT_DIR, `${category}.ts`);
    fs.writeFileSync(file, renderCategory(category, blurb, verified, unverified));
    written.push({ category, verified: verified.length, unverified: unverified.length });
  }

  const verifiedAll = entries.filter((e) => e.point);
  fs.writeFileSync(LOCATIONS, renderLocations(verifiedAll));

  // ---------------------------------------------------------- the summary
  console.log(`${entries.length} landmarks — ${verifiedAll.length} verified, ${entries.length - verifiedAll.length} unverified.`);
  console.log(`\n${'category'.padEnd(16)}${'verified'.padEnd(11)}unverified`);
  for (const w of written) console.log(`${w.category.padEnd(16)}${String(w.verified).padEnd(11)}${w.unverified}`);
  console.log(`\n${mergedDuplicates.length} merged duplicate(s):`);
  for (const d of mergedDuplicates) {
    const from = d.from === 'dataset' ? `dataset row also under "${d.alsoUnder}"` : `old catalog entry "${d.was}"`;
    console.log(`  ${d.name.padEnd(44)}${from}`);
  }
  return 0;
}

// -------------------------------------------------------------- rendering

const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

function entryLiteral(entry, withPoint) {
  const lines = [`  {`, `    name: ${q(entry.name)},`];
  if (entry.nameRw) lines.push(`    nameRw: ${q(entry.nameRw)},`);
  if (entry.nameFr) lines.push(`    nameFr: ${q(entry.nameFr)},`);
  if (entry.aliases.length > 0) lines.push(`    aliases: [${entry.aliases.map(q).join(', ')}],`);
  if (entry.areaHint) lines.push(`    areaHint: ${q(entry.areaHint)},`);
  if (withPoint) {
    lines.push(`    // ${entry.evidence.service} ${entry.evidence.osm ?? '(no osm id)'} — ${entry.evidence.name}`);
    lines.push(`    point: { lat: ${entry.point.lat}, lng: ${entry.point.lng} },`);
  }
  lines.push(`    category: ${q(entry.category)},`);
  lines.push(`  },`);
  return lines.join('\n');
}

function header(title, body) {
  return [`// ${title}`, '//', ...body.map((l) => (l ? `// ${l}` : '//')), ''].join('\n');
}

function renderCategory(category, blurb, verified, unverified) {
  const CONST = category.toUpperCase();
  const out = [
    header(`LANDMARKS G2 — ${blurb}.`, [
      'Generated by scripts/build-landmarks.mjs from scripts/landmark-dataset.json',
      'and scripts/landmark-geocode-cache.json. Do not edit by hand: every point',
      'here was resolved from the committed OSM harvest, and the comment above it',
      'names the service and the OSM object it came from.',
      '',
      `${CONST}_LANDMARKS carry a point. ${CONST}_UNVERIFIED_LANDMARKS are places`,
      'the team named and no service could place; they carry no coordinates at',
      'all, so the app asks the passenger for a pin instead of guessing.',
    ]),
    `import type { Landmark, UnverifiedLandmark } from './types.js';`,
    '',
    `export const ${CONST}_LANDMARKS: Landmark[] = [`,
    ...verified.map((e) => entryLiteral(e, true)),
    '];',
    '',
    `export const ${CONST}_UNVERIFIED_LANDMARKS: UnverifiedLandmark[] = [`,
    ...unverified.map((e) => entryLiteral(e, false)),
    '];',
    '',
  ];
  return out.join('\n');
}

function writeTypes() {
  const union = CATEGORIES.map(([c]) => `'${c}'`).join(' | ');
  const src = [
    header('LANDMARKS G2 — what a landmark is.', [
      'Split out of constants/locations.ts so the catalog can live in one file',
      'per category. Landmark and its category union are re-exported from',
      'locations.ts, which is still the path everything imports from.',
    ]),
    `import { GeoPoint } from '../../types/location.js';`,
    '',
    `export type LandmarkCategory =`,
    `  | ${CATEGORIES.map(([c]) => `'${c}'`).join('\n  | ')};`,
    '',
    '/**',
    ' * A place with a verified point. `aliases` are the other names people say',
    ' * for it, `areaHint` is the part of the city it is in — both are what the',
    ' * search box matches on, alongside the name.',
    ' */',
    'export interface Landmark {',
    '  name: string;',
    '  nameRw?: string;',
    '  nameFr?: string;',
    '  aliases?: string[];',
    '  areaHint?: string;',
    '  point: GeoPoint;',
    '  category: LandmarkCategory;',
    '}',
    '',
    '/**',
    ' * A place the team named that no service could place. It has no `point`,',
    ' * and the type says so, so nothing can read a coordinate off one of these',
    ' * by accident. Selecting one asks the passenger to drop a pin.',
    ' */',
    `export type UnverifiedLandmark = Omit<Landmark, 'point'>;`,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(OUT_DIR, 'types.ts'), src);
  void union;
}

/** The median of the verified points — a centre nobody typed. */
function medianCentre(verified) {
  const mid = (nums) => {
    const s = [...nums].sort((a, b) => a - b);
    const i = Math.floor(s.length / 2);
    return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
  };
  return { lat: mid(verified.map((e) => e.point.lat)), lng: mid(verified.map((e) => e.point.lng)) };
}

function renderLocations(verified) {
  const centre = medianCentre(verified);
  const imports = CATEGORIES.map(
    ([c]) =>
      `import { ${c.toUpperCase()}_LANDMARKS, ${c.toUpperCase()}_UNVERIFIED_LANDMARKS } from './landmarks/${c}.js';`,
  );
  return [
    header('LANDMARKS G2 — the Kigali landmark catalog.', [
      'The catalog itself lives one file per category under ./landmarks/. This',
      'file is the door everything else comes through: KIGALI_LANDMARKS and',
      'Landmark keep the names and the import path they have always had.',
      '',
      'KIGALI_LANDMARKS is every place with a point verified against OSM and',
      'checked against the Kigali bounding box. UNVERIFIED_LANDMARKS is every',
      'place the team named that no service could place — searchable, spoken,',
      'and carrying no coordinates for anything to misread.',
      '',
      'Generated by scripts/build-landmarks.mjs. Run `pnpm landmarks:build`.',
    ]),
    `import { GeoPoint } from '../types/location.js';`,
    `import type { Landmark, UnverifiedLandmark } from './landmarks/types.js';`,
    ...imports,
    '',
    `export type { Landmark, UnverifiedLandmark, LandmarkCategory } from './landmarks/types.js';`,
    '',
    'export const KIGALI_LANDMARKS: Landmark[] = [',
    ...CATEGORIES.map(([c]) => `  ...${c.toUpperCase()}_LANDMARKS,`),
    '];',
    '',
    'export const UNVERIFIED_LANDMARKS: UnverifiedLandmark[] = [',
    ...CATEGORIES.map(([c]) => `  ...${c.toUpperCase()}_UNVERIFIED_LANDMARKS,`),
    '];',
    '',
    '/**',
    ' * Default centre of Kigali for map initialisation. The old one sat 12 km',
    ' * west of the city with the old landmarks; this is the median of the',
    ` * ${verified.length} verified landmark points, so it is evidence too.`,
    ' */',
    'export const KIGALI_CENTER: GeoPoint = {',
    `  lat: ${centre.lat},`,
    `  lng: ${centre.lng},`,
    '};',
    '',
  ].join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
