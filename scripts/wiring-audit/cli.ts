// WIRE-AUDIT G1 — regenerate the wiring map with one command:
//   pnpm wiring:map
// Writes docs/wiring-map.json (machine-readable) and docs/wiring-map.md
// (human-readable). Output is deterministic: same tree, same bytes.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildMarkdown, buildWiringMap, DEFAULT_CONFIG } from './extract';

const root = path.resolve(__dirname, '..', '..');
const map = buildWiringMap({ root, ...DEFAULT_CONFIG });

const jsonPath = path.join(root, 'docs', 'wiring-map.json');
const mdPath = path.join(root, 'docs', 'wiring-map.md');
fs.writeFileSync(jsonPath, JSON.stringify(map, null, 2) + '\n');
fs.writeFileSync(mdPath, buildMarkdown(map));

const orphans = map.analysis.endpointStatus.filter((e) => e.status === 'orphan-candidate').length;
const unreachable = map.analysis.routeStatus.filter((r) => !r.reachable).length;
console.log(
  `wiring-map: ${map.endpoints.length} endpoints, ${map.calls.length} calls, ` +
    `${map.routes.length} routes, ${map.navEdges.length} nav edges — ` +
    `${orphans} orphan candidates, ${unreachable} unreachable candidates, ` +
    `${map.unresolvedEndpoints.length + map.unresolvedCalls.length + map.unresolvedNav.length} unresolved`,
);
console.log(`wrote ${path.relative(root, jsonPath)} and ${path.relative(root, mdPath)}`);
