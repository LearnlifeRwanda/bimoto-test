// SERVICES/MOBILITY/ATTRIBUTE-SUPPRESSION.TS
//
// INTEL-DECK G3 — the grain gate, beside the cell gate.
//
// k-anonymity.ts asks one question and asks it well: does this CELL
// carry enough movements to exist? It does not look inside the cell. So
// a Kigali hex that cleared k=20 could ship
// `vehicleTypes: { MOTO: 19, E_BIKE: 1 }` — twenty movements hiding one
// person who can be picked out of them by the vehicle they rode. The
// cell is anonymous; the category of one is not.
//
// This module is the answer, and it is an ADDITION: k-anonymity.ts is
// not touched, its thresholds are not touched, and its tests pass
// unmodified. Nothing here can admit a row the cell gate refused; it
// only ever removes detail from rows the cell gate already allowed.
//
// The rule, applied to every marginal map:
//
//   1. Any category with count < MOBILITY_ATTR_MIN (default 5) is
//      folded into a single `other` entry.
//   2. If exactly one category was folded, fold the next-smallest too.
//      A lone fold is self-revealing: `{ MOTO: 19, other: 1 }` names
//      the hidden count exactly, and an analyst who knows the platform
//      offers four vehicle types has learned almost everything. Two
//      folds make `other` genuinely ambiguous.
//   3. If `other` still totals below MOBILITY_ATTR_MIN, drop it
//      entirely. A small `other` is itself a small category.
//
// Two places run it, and they must agree: the WRITE side (both
// aggregators, so nothing unsafe is ever stored) and the READ side
// (every serving path, so the rows written before this dispatch existed
// can never serve a singleton either). That is why sanitizeAttributes
// is one exported function and not a rule re-implemented per route.

import type { AttributeSet } from './types';

/**
 * The smallest category that may be named. Env-tunable like every other
 * privacy parameter in this layer; read at call time rather than module
 * load so a test (or a founder) can move it without a restart.
 */
export function attributeMinimum(): number {
  const raw = parseInt(process.env.MOBILITY_ATTR_MIN ?? '5', 10);
  return Number.isNaN(raw) || raw < 1 ? 5 : raw;
}

/** The key every folded category ends up under. */
export const OTHER_KEY = 'other';

/**
 * The three marginal maps the aggregators produce. Any other key in an
 * attributes object (the OD row's endpoints, for instance) is carried
 * through untouched — this function suppresses categories, it does not
 * curate schemas.
 */
export const MARGINAL_KEYS = ['vehicleTypes', 'hourBuckets', 'fareDecileCounts'] as const;

function isCountMap(value: unknown): value is Record<string, number> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every(
    (v) => typeof v === 'number' && Number.isFinite(v),
  );
}

/**
 * Coalesce one marginal map. Pure, total, and safe to run twice — a map
 * that has already been coalesced is returned unchanged, which is what
 * makes running it on both the write and the read side harmless.
 */
export function coalesceCategories(
  map: Record<string, number>,
  min: number = attributeMinimum(),
): Record<string, number> {
  const entries = Object.entries(map).filter(([, v]) => v > 0);
  if (entries.length === 0) return {};

  // Smallest first: the fold order and the complementary fold both read
  // off this ordering. Ties break on the key so the output is stable.
  entries.sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  const carriedOther = entries.find(([k]) => k === OTHER_KEY)?.[1] ?? 0;
  const named = entries.filter(([k]) => k !== OTHER_KEY);

  const folded: Array<[string, number]> = [];
  const kept: Array<[string, number]> = [];
  for (const entry of named) {
    if (entry[1] < min) folded.push(entry);
    else kept.push(entry);
  }

  // Complementary disclosure guard: one fold announces itself, so take
  // the next-smallest survivor down with it. If there is no survivor to
  // take, the single fold stands and rule 3 decides its fate.
  if (folded.length === 1 && kept.length > 0) {
    folded.push(kept.shift() as [string, number]);
  }

  const otherTotal = carriedOther + folded.reduce((sum, [, v]) => sum + v, 0);
  const out: Record<string, number> = {};
  for (const [k, v] of kept.sort((a, b) => (a[0] < b[0] ? -1 : 1))) out[k] = v;
  // Rule 3 — a small `other` is a small category like any other.
  if (otherTotal >= min) out[OTHER_KEY] = otherTotal;
  return out;
}

/**
 * Apply the rule to every marginal map in an attributes object and leave
 * everything else alone. Returns a NEW object; the input is not mutated.
 * `undefined`/`null` in, `undefined` out — a SPARSE row has no
 * attributes and must keep having none.
 */
export function sanitizeAttributes(
  attrs: AttributeSet | null | undefined,
): AttributeSet | undefined {
  if (attrs === null || attrs === undefined) return undefined;
  if (typeof attrs !== 'object' || Array.isArray(attrs)) return undefined;
  const min = attributeMinimum();
  const out: AttributeSet = {};
  for (const [key, value] of Object.entries(attrs)) {
    if ((MARGINAL_KEYS as readonly string[]).includes(key) && isCountMap(value)) {
      out[key] = coalesceCategories(value as Record<string, number>, min);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Write-side alias. Identical behaviour — the separate name exists so a
 * reader of an aggregator can see at a glance that the gate ran before
 * the row was stored, and so a grep for either name finds both sides.
 */
export const sanitizeMarginals = sanitizeAttributes;

/**
 * Sanitize a whole serving payload's worth of rows. Every read path
 * calls THIS rather than reaching for coalesceCategories itself, so
 * "which paths are covered" is answerable by grep.
 */
export function sanitizeRows<T extends { attributesJson?: unknown }>(rows: T[]): T[] {
  return rows.map((row) => ({
    ...row,
    attributesJson: sanitizeAttributes(row.attributesJson as AttributeSet | null | undefined) ?? null,
  }));
}
