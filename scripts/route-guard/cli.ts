// AUTH-READ G4 — human-readable dump of the route map, for seeding and
// for auditing an allowlist entry by hand.
//
// Run: pnpm routes:map [--all]

import * as path from 'node:path';
import { buildRouteMap, DEFAULT_CONFIG, READ_METHODS, WRITE_METHODS } from './extract';
import { groupFamilies } from './check';

const root = path.resolve(__dirname, '..', '..');
const map = buildRouteMap({ root, ...DEFAULT_CONFIG });
const showAll = process.argv.includes('--all');

console.log(`route-guard: ${map.routes.length} routes in ${map.files.length} files\n`);

for (const family of groupFamilies(map.routes)) {
  const reads = family.routes.filter((r) => READ_METHODS.has(r.method));
  const writes = family.routes.filter((r) => WRITE_METHODS.has(r.method));
  if (!showAll && (reads.length === 0 || writes.length === 0)) continue;
  console.log(`${family.key}`);
  for (const r of family.routes) {
    const kind = READ_METHODS.has(r.method) ? 'read ' : WRITE_METHODS.has(r.method) ? 'write' : 'other';
    const via = r.delegatesTo.length ? ` -> ${r.delegatesTo.join(', ')}` : '';
    const mw = r.middleware.length ? ` [${r.middleware.join(' ')}]` : '';
    console.log(`  ${kind} ${r.method.padEnd(6)} ${r.posture.padEnd(9)} ${r.file}:${r.line}${mw}${via}`);
  }
  console.log('');
}

if (map.skipped.length) {
  console.log('Not read by the walker (stated boundary):');
  for (const s of map.skipped) console.log(`  ${s.file}:${s.line} — ${s.reason}`);
}
