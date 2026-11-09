// HYGIENE W3 G4 — the literal-drift census printer.
//
// Prints the table the wave was commissioned to produce: every production
// site where a time literal restates a rule that is declared elsewhere.
//
// Run: pnpm constants:literals
import * as path from 'node:path';
import { collectDriftInput, findDrift } from './literals';

const repoRoot = path.resolve(__dirname, '..', '..');
const findings = findDrift(collectDriftInput(repoRoot));

const byRule = new Map<string, typeof findings>();
for (const f of findings) {
  if (!byRule.has(f.rule)) byRule.set(f.rule, []);
  byRule.get(f.rule)!.push(f);
}
for (const [rule, rows] of byRule) {
  console.log(`\n## ${rule} — ${rows.length}`);
  for (const f of rows) console.log(`${f.file}:${f.line}  ${f.literal}  ->  ${f.matches}  [${f.verdict}]`);
}
console.log(`\ntotal: ${findings.length}  AGREEING: ${findings.filter((f) => f.verdict === 'AGREEING').length}  DISAGREEING: ${findings.filter((f) => f.verdict === 'DISAGREEING').length}`);
