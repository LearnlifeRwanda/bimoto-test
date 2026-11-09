// INCLUDE-REACH G3 — the census, printed. Report-only: it never exits
// non-zero. `pnpm routes:check` is the gate; this is the table §8 asks for.
//
//   pnpm exec tsx scripts/route-guard/census.ts [--all]
//
// Without --all it prints the rows that need a human: findings and UNKNOWNs.
// With --all it prints every row the walker recorded, including the
// restricted and unreachable ones, which is what makes it auditable.

import * as path from 'node:path';
import { buildRouteMap, DEFAULT_CONFIG } from './extract';
import { buildReachMap, DEFAULT_REACH_CONFIG } from './include-reach';
import { census, loadRule2Allowlist, type CensusRow } from './rule2';

const root = path.resolve(__dirname, '..', '..');
const map = buildReachMap({ root, ...DEFAULT_REACH_CONFIG });
const routeMap = buildRouteMap({ root, ...DEFAULT_CONFIG });
const attested = new Set(
  loadRule2Allowlist(path.join(__dirname, 'include-allowlist.json')).map((e) => e.key),
);
// A row a human has signed for is not an open finding. It stays in the
// table — that is the point of an allowlist over a suppression — but it is
// labelled for what it is, so "0 findings, 0 UNKNOWN" means what it says.
const rows = census(map, routeMap.routes).map((r) =>
  (r.verdict === 'finding' || r.verdict === 'unknown') && attested.has(r.key)
    ? { ...r, verdict: 'attested-safe' as const }
    : r,
);
const all = process.argv.includes('--all');

const shown = all
  ? rows
  : rows.filter(
      (r) => r.verdict === 'finding' || r.verdict === 'unknown' || r.verdict === 'attested-safe',
    );

const line = (r: CensusRow) =>
  [
    `${r.file}:${r.line}`,
    r.fn,
    r.routes.length ? r.routes.join(' | ') : '(no GET route)',
    r.traversed.join('+') || '-',
    r.direct.join('+') || '-',
    r.restrictions.join('+') || 'none',
    r.verdict.toUpperCase(),
    r.unknowns.join('; '),
  ].join(' · ');

for (const r of shown) console.log(line(r));

const tally = (v: string) => rows.filter((r) => r.verdict === v).length;
console.log(
  `\nroots: ${map.roots.join(', ')}\n` +
    `files: ${map.files.length}, functions: ${map.functions.length}, census rows: ${rows.length}\n` +
    `findings: ${tally('finding')}, unknown: ${tally('unknown')}, ` +
    `attested-safe: ${tally('attested-safe')}, restricted: ${tally('restricted')}, ` +
    `unreachable-from-GET: ${tally('unreachable')}`,
);
