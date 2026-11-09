// GROUNDSKEEPER G4 — inventory printer for the constants guard.
// Lists every exported shared constant with its consumer count, so the
// wire-or-delete conversation has numbers in front of it.
//
// Run: pnpm constants:map

import * as path from 'node:path';
import { buildConstantsMap, DEFAULT_CONFIG } from './extract';
import { loadAllowlist } from './check';

const repoRoot = path.resolve(__dirname, '..', '..');
const map = buildConstantsMap(DEFAULT_CONFIG(repoRoot));
const allowed = new Set(loadAllowlist(path.join(__dirname, 'allowlist.json')).map((e) => e.key));

for (const c of map.constants) {
  const used = map.consumers.get(c.name) ?? [];
  const mark = used.length > 0 ? `${used.length} consumer(s)` : allowed.has(c.name) ? 'PENDING (allowlisted)' : 'DEAD';
  console.log(`${c.name.padEnd(44)} ${mark.padEnd(24)} ${c.file}:${c.line}`);
}
