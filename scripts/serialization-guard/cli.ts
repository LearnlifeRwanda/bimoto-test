// CUTGUARD v2 G1 — the serialization map, printed.
//
// Sibling of scripts/route-guard/cli.ts. `pnpm serialize:map` prints
// every function that binds a Prisma row and what it does with it, which
// is how you answer "where does this model reach a client?" without
// grepping for `res.json` and hoping.
//
// The CHECK is check.ts (`pnpm serialize:check`). This is the read-only
// view of the same walk.

import * as path from 'node:path';
import { buildSerializationMap, DEFAULT_CONFIG } from './extract';
import { loadAllowlist } from './check';

function main(): void {
  const root = path.resolve(__dirname, '..', '..');
  const allowlist = loadAllowlist(path.join(__dirname, 'allowlist.json'));
  const map = buildSerializationMap({
    root,
    dirs: DEFAULT_CONFIG.dirs,
    serializers: allowlist.serializers,
  });

  const asJson = process.argv.includes('--json');
  const withRows = map.functions.filter((f) => f.bindings.length > 0);

  if (asJson) {
    console.log(JSON.stringify({ files: map.files, functions: withRows }, null, 2));
    return;
  }

  console.log(
    `[serialize] ${map.files.length} files, ${map.functions.length} functions, ` +
      `${withRows.length} of them bind a Prisma row\n`,
  );
  for (const fn of withRows) {
    console.log(`${fn.file}:${fn.line}  ${fn.name}${fn.exported ? ' (exported)' : ''}`);
    for (const b of fn.bindings) {
      console.log(
        `    binds ${b.name} = prisma.${b.model}.${b.method}()${b.hasSelect ? ' [select]' : ''} @${b.line}`,
      );
    }
    for (const e of fn.emissions) {
      if (e.carries.length === 0) continue;
      const known = e.carries.filter((c) => fn.bindings.some((b) => b.name === c));
      if (known.length === 0) continue;
      console.log(`    ${e.kind} @${e.line} carries ${known.join(', ')}`);
    }
  }
}

main();
