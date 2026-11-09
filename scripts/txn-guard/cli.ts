// MONEY-ATOMIC G5 — human-readable dump of the transaction map, for
// seeding the allowlist and for auditing an entry by hand.
//
// Run: pnpm txn:map [--all]

import * as path from 'node:path';
import { buildTxnMap, DEFAULT_CONFIG, functionKey } from './extract';

const root = path.resolve(__dirname, '..', '..');
const map = buildTxnMap({ root, ...DEFAULT_CONFIG });
const showAll = process.argv.includes('--all');

const flagged = map.functions.filter((f) => f.models.length >= 2);
console.log(
  `txn-guard: ${map.functions.length} functions writing through prisma in ${map.files.length} files; ` +
    `${flagged.length} write two or more distinct models\n`,
);

for (const fn of showAll ? map.functions : flagged) {
  console.log(`${functionKey(fn)}:${fn.line}  [${fn.models.join(', ')}]`);
  for (const w of fn.writes) console.log(`    ${w.line}  ${w.model}.${w.method}`);
  console.log('');
}
