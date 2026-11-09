// CUTGUARD v2 G4 — the rule-3 census.
//
// `pnpm routes:census3` lists every place a handler hands a
// record-sourced owner id to a call. Run it before touching the
// allowlist: the point of a census is that the list comes from the
// walker, not from somebody's memory of where the problem is.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { findRule3, ROUTE_DIRS } from './rule3-config';

function main(): void {
  const root = path.resolve(__dirname, '..', '..');
  const findings = [];
  for (const dir of ROUTE_DIRS) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) continue;
    for (const name of fs.readdirSync(abs).sort()) {
      if (!name.endsWith('.routes.ts')) continue;
      const rel = `${dir}/${name}`;
      findings.push(...findRule3(rel, fs.readFileSync(path.join(root, rel), 'utf8')));
    }
  }
  for (const f of findings) {
    console.log(`${f.file}:${f.line}  ${f.callee}(${f.expression})`);
  }
  console.log(`\nroutes:census3 — ${findings.length} record-sourced owner argument(s)`);
}

main();
