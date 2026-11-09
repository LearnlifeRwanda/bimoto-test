// INTEL-DECK G5 — the import-graph proof.
//
// The claim the analyst role rests on is not "we were careful". It is:
// there is no path from the intel export to a table that names a person.
// A comment cannot hold that; a walk of the actual import closure can.
//
// This test starts at routes/intel.routes.ts, follows every relative
// import transitively, and asserts two things about the whole closure:
//
//   1. the only Prisma model it ever names is mobilityAggregate — the
//      table services/mobility/store.ts describes as having no foreign
//      key back to operational data;
//   2. no file in it belongs to an operational service (journey, bid,
//      payment, payout, user, document, sms, cooperative, admin…).
//
// Both assertions are deliberately about the closure rather than about
// intel.routes.ts alone, because the dangerous version of this bug is a
// helper three imports deep that reaches for a join.

import * as fs from 'fs';
import * as path from 'path';

const SRC = path.join(__dirname, '..');
const ENTRY = path.join(SRC, 'routes/intel.routes.ts');

function resolveImport(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null; // package import — not our graph
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
    `${base}.json`,
  ]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function importSpecifiers(code: string): string[] {
  const out: string[] = [];
  const re = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) out.push(m[1]);
  const requireRe = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = requireRe.exec(code)) !== null) out.push(m[1]);
  return out;
}

function closure(entry: string): Map<string, string> {
  const seen = new Map<string, string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (seen.has(file)) continue;
    const code = fs.readFileSync(file, 'utf8');
    seen.set(file, code);
    if (file.endsWith('.json')) continue;
    for (const spec of importSpecifiers(code)) {
      const resolved = resolveImport(file, spec);
      if (resolved && !seen.has(resolved)) queue.push(resolved);
    }
  }
  return seen;
}

const graph = closure(ENTRY);
const rel = (f: string) => path.relative(SRC, f);

// Every Prisma model the schema declares, lower-camel as the client
// exposes it. Anything in this list that is NOT mobilityAggregate is a
// table the export must never be able to name.
const FORBIDDEN_MODELS = [
  'journey',
  'bid',
  'user',
  'payment',
  'payout',
  'document',
  'rating',
  'message',
  'gpsPoint',
  'smsInbound',
  'simulatedMessage',
  'cooperative',
  'adminAction',
  'amlFlag',
  'bnrReport',
  'errorReport',
  'deviceToken',
  'scheduledRide',
  'conflict',
  'driverDocument',
  'feeWaiver',
];

const OPERATIONAL_PATH_FRAGMENTS = [
  'services/journey',
  'services/bid',
  'services/payment',
  'services/payout',
  'services/user',
  'services/document',
  'services/sms',
  'services/cooperative',
  'services/aml',
  'services/bnr',
  'routes/journey',
  'routes/bid',
  'routes/user',
  'routes/admin',
  'routes/payment',
  'routes/document',
];

// The one file in the closure that touches an identified table, and the
// reason it is allowed to. middleware/auth.ts resolves the CALLER'S OWN
// row (the frozen-account check); that is authentication, and it is the
// opposite of reaching another person's data. It is exempted by name,
// never by pattern, so a second exemption has to be argued for here.
const AUTHENTICATION_EXEMPT = ['middleware/auth.ts'];

describe('INTEL-DECK — the export cannot reach an identified table', () => {
  test('the walker actually walked something', () => {
    // Guard against a broken regex silently proving nothing.
    expect(graph.size).toBeGreaterThan(3);
    expect([...graph.keys()].map(rel)).toContain('routes/intel.routes.ts');
    expect([...graph.keys()].map(rel)).toContain(
      'services/mobility/attribute-suppression.ts',
    );
  });

  test('the only Prisma model named anywhere in the closure is mobilityAggregate', () => {
    const offences: string[] = [];
    for (const [file, code] of graph) {
      if (AUTHENTICATION_EXEMPT.includes(rel(file))) continue;
      // Strip comments so prose about Journey or User is not a finding.
      const stripped = code
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .join('\n');
      for (const model of FORBIDDEN_MODELS) {
        const re = new RegExp(`\\.\\s*${model}\\s*\\.\\s*(findMany|findUnique|findFirst|create|createMany|update|updateMany|delete|deleteMany|groupBy|count|aggregate|upsert)\\b`);
        if (re.test(stripped)) offences.push(`${rel(file)} reaches prisma.${model}`);
      }
    }
    expect(offences).toEqual([]);
  });

  test('the exemption list is exactly one file, and it is the auth middleware', () => {
    // Stated rather than assumed: if the list grows, this fails and the
    // new entry has to be justified in a diff somebody reviews.
    expect(AUTHENTICATION_EXEMPT).toEqual(['middleware/auth.ts']);
    const authCode = graph.get(path.join(SRC, 'middleware/auth.ts')) ?? '';
    // And what it does with prisma.user is read the caller's own row.
    expect(authCode).toMatch(/user\.findUnique/);
    expect(authCode).not.toMatch(/user\.findMany/);
  });

  test('mobilityAggregate IS reachable — the test is not passing by finding nothing', () => {
    const reachesVault = [...graph.values()].some((code) =>
      /mobilityAggregate\s*\.\s*findMany/.test(code),
    );
    expect(reachesVault).toBe(true);
  });

  test('no operational service or route is in the closure', () => {
    const offences = [...graph.keys()]
      .map(rel)
      .filter((f) => OPERATIONAL_PATH_FRAGMENTS.some((frag) => f.startsWith(frag)))
      // The entry point itself lives in routes/ and is named intel.
      .filter((f) => f !== 'routes/intel.routes.ts');
    expect(offences).toEqual([]);
  });

  test('the closure is small enough to read — an audit anyone can repeat by hand', () => {
    // Not a style rule: a sprawling closure is one nobody re-reads, and
    // this guarantee only survives if it stays checkable.
    expect(graph.size).toBeLessThan(20);
  });

  test('both serving paths import the SAME suppression module', () => {
    // The shared-function identity the invariant names: one gate, two
    // callers, imported rather than re-implemented.
    const exportCode = fs.readFileSync(ENTRY, 'utf8');
    const getCode = fs.readFileSync(path.join(SRC, 'routes/admin-mobility.routes.ts'), 'utf8');
    expect(exportCode).toMatch(
      /from '\.\.\/services\/mobility\/attribute-suppression'/,
    );
    expect(getCode).toMatch(/from '\.\.\/services\/mobility\/attribute-suppression'/);
    expect(exportCode).toMatch(/sanitizeAttributes\(/);
    expect(getCode).toMatch(/sanitizeRows\(/);
  });
});
