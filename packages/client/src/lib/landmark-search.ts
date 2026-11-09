// LANDMARKS G3 — the search a passenger actually uses.
//
// Kigali is not addressed by street. A passenger says "Sonatubes", "Chez
// Lando", "Isoko ya Kimironko" — names a street geocoder either misplaces or
// has never heard. So the catalog is searched first, in the browser, against
// every name the place answers to, and the geocoder only gets what is left.
//
// Two things matter for this to work in the field:
//
//   The structural words must not defeat the match. "Isoko ya Kimironko"
//   starts with two words nobody types. Matching is therefore on word
//   starts anywhere in the key, so "kimironko" finds the market, and
//   "isoko ya kim" finds it too.
//
//   It must work with the network down. This index is a plain array in the
//   bundle, so an airplane-mode passenger still gets landmark suggestions —
//   which is the difference between a booking and a blank screen.

import { KIGALI_LANDMARKS, UNVERIFIED_LANDMARKS } from '@bimoto/shared';
import type { Landmark, UnverifiedLandmark } from '@bimoto/shared';

export interface LandmarkSuggestion {
  kind: 'landmark';
  /** The spoken name — what goes in the field when this is chosen. */
  name: string;
  /** Name plus area hint, for the row and for the address on the request. */
  label: string;
  areaHint?: string;
  category: string;
  /** Which of the place's names the passenger's typing actually hit. */
  matchedOn: 'name' | 'alias' | 'areaHint';
  /** The alias that matched, when it was an alias. */
  matchedText?: string;
  /** Absent when no service could place this landmark — ask for a pin. */
  point?: { lat: number; lng: number };
}

/** Case-, accent- and punctuation-insensitive. "Hôtel" and "hotel" are one word. */
export function fold(text: string): string {
  return String(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * True when `query` starts a word in `key`. This is the whole trick: it is a
 * prefix match, so three letters are enough, and it ignores everything to the
 * left of the word, so "Kwa", "Chez", "Isoko ya" and "Gare ya" cannot get in
 * the way of the word the passenger is actually typing.
 */
export function matchesAt(key: string, query: string): number {
  if (!query) return -1;
  if (key.startsWith(query)) return 0;
  const at = key.indexOf(` ${query}`);
  return at === -1 ? -1 : at + 1;
}

interface Key {
  text: string;
  on: LandmarkSuggestion['matchedOn'];
  original: string;
}

function keysFor(entry: Landmark | UnverifiedLandmark): Key[] {
  const keys: Key[] = [{ text: fold(entry.name), on: 'name', original: entry.name }];
  for (const alias of entry.aliases ?? []) keys.push({ text: fold(alias), on: 'alias', original: alias });
  if (entry.areaHint) keys.push({ text: fold(entry.areaHint), on: 'areaHint', original: entry.areaHint });
  return keys;
}

function toSuggestion(entry: Landmark | UnverifiedLandmark, key: Key): LandmarkSuggestion {
  return {
    kind: 'landmark',
    name: entry.name,
    label: entry.areaHint ? `${entry.name} — ${entry.areaHint}` : entry.name,
    areaHint: entry.areaHint,
    category: entry.category,
    matchedOn: key.on,
    matchedText: key.on === 'name' ? undefined : key.original,
    point: 'point' in entry ? entry.point : undefined,
  };
}

/**
 * Built once, at module load, from both halves of the catalog. Verified
 * entries come first so that when two places answer to the same words, the
 * one that can drop a pin is offered first.
 */
const INDEX: { entry: Landmark | UnverifiedLandmark; keys: Key[]; verified: boolean }[] = [
  ...KIGALI_LANDMARKS.map((entry) => ({ entry, keys: keysFor(entry), verified: true })),
  ...UNVERIFIED_LANDMARKS.map((entry) => ({ entry, keys: keysFor(entry), verified: false })),
];

/**
 * Lower sorts first. A hit on the name beats a hit on an alias beats a hit
 * on the area hint; within that, a hit at the front of the name beats one in
 * the middle; and a place with a point beats one without, because a pin is
 * worth more to the passenger than a name.
 */
function rank(on: LandmarkSuggestion['matchedOn'], at: number, verified: boolean): number {
  const field = on === 'name' ? 0 : on === 'alias' ? 1 : 2;
  return field * 1000 + (at === 0 ? 0 : 100) + (verified ? 0 : 10) + Math.min(at, 9);
}

export const LANDMARK_MIN_QUERY = 2;

export function searchLandmarks(query: string, limit = 6): LandmarkSuggestion[] {
  const q = fold(query);
  if (q.length < LANDMARK_MIN_QUERY) return [];

  const hits: { suggestion: LandmarkSuggestion; score: number }[] = [];
  for (const { entry, keys, verified } of INDEX) {
    let best: { key: Key; score: number } | null = null;
    for (const key of keys) {
      const at = matchesAt(key.text, q);
      if (at === -1) continue;
      const score = rank(key.on, at, verified);
      if (!best || score < best.score) best = { key, score };
    }
    if (best) hits.push({ suggestion: toSuggestion(entry, best.key), score: best.score });
  }

  hits.sort((a, b) => a.score - b.score || a.suggestion.name.localeCompare(b.suggestion.name));
  return hits.slice(0, limit).map((h) => h.suggestion);
}

/** Only the verified half can be treated as a geocoder result. */
export function isPlaceable(
  s: LandmarkSuggestion,
): s is LandmarkSuggestion & { point: { lat: number; lng: number } } {
  return s.point !== undefined;
}
