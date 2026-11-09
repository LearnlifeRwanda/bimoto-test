// Behaviour tests for the literal-drift half of the constants guard, both
// directions: the shapes that must PASS, and every way the rule can be
// broken, which must FAIL. All pure — no filesystem, no compiler.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  findConstantDeclarations,
  findDrift,
  findTimeLiterals,
  importedNames,
  isTimeConstant,
  packageOf,
  runLiteralCheck,
  toMs,
  type DriftFinding,
  type TimeConstant,
} from '../literals';

/* ---------------------------------------------------- literal parsing --- */

test('a factored product with a time factor is a time literal', () => {
  const found = findTimeLiterals('const x = 10 * 60 * 1000;');
  assert.equal(found.length, 1);
  assert.equal(found[0].value, 600000);
  assert.equal(found[0].text, '10 * 60 * 1000');
});

test('arithmetic with no time factor is not a time literal', () => {
  assert.deepEqual(findTimeLiterals('const grid = 3 * 4;'), []);
});

test('a bare millisecond literal counts; a pixel size, a port and a status code do not', () => {
  assert.equal(findTimeLiterals('setTimeout(f, 3600000);').length, 1);
  assert.deepEqual(findTimeLiterals('const w = 1024; const port = 3000;').length, 1); // 3000 only
  assert.deepEqual(findTimeLiterals('res.status(404); const z = 1200;'), []);
});

test('comments are not code — a duration named in prose is not a literal', () => {
  assert.deepEqual(findTimeLiterals('// the window is 10 * 60 * 1000 ms\nconst a = 1;'), []);
  assert.deepEqual(findTimeLiterals('/* 3600000 */\nconst a = 1;'), []);
});

test('a bare factor of a product is not double-counted', () => {
  const found = findTimeLiterals('const x = 60 * 1000;');
  assert.equal(found.length, 1);
});

/* --------------------------------------------------------- unit ladder -- */

test('a name unit suffix normalises the value to milliseconds', () => {
  assert.equal(toMs('DRIVER_LATE_THRESHOLD_MINUTES', 10), 600000);
  assert.equal(toMs('DISPUTE_WINDOW_HOURS', 24), 86400000);
  assert.equal(toMs('SOME_WINDOW_MS', 5000), 5000);
  assert.equal(toMs('CANCELLATION_MIN_RIDES', 5), null);
});

test('an earth radius, a page size and an IV length are not time constants', () => {
  const c = (name: string, text: string, value: number): TimeConstant => ({
    name, file: 'a.ts', line: 1, text, value, ms: toMs(name, value),
  });
  assert.equal(isTimeConstant(c('R', '6371', 6371)), false);
  assert.equal(isTimeConstant(c('PAGE_SIZE', '50', 50)), false);
  assert.equal(isTimeConstant(c('IV_LENGTH', '12', 12)), false);
  assert.equal(isTimeConstant(c('TICK_MS', '60 * 1000', 60000)), true);
  assert.equal(isTimeConstant(c('WINDOW', '24 * 60 * 60 * 1000', 86400000)), true);
});

test('declarations are read whether exported or module-private', () => {
  const decls = findConstantDeclarations(
    'const A_MS = 8 * 60 * 1000;\nexport const B_MS = 720_000;\n',
    'x.ts',
  );
  assert.deepEqual(decls.map((d) => [d.name, d.value]), [['A_MS', 480000], ['B_MS', 720000]]);
});

test('imports are read, so a file that already imports the constant is not flagged', () => {
  const names = importedNames("import { A_MS, B as C } from '@bimoto/shared';");
  assert.deepEqual([...names].sort(), ['A_MS', 'B']);
});

test('packageOf names the boundary review cannot keep two copies across', () => {
  assert.equal(packageOf('packages/client/src/a.ts'), 'client');
  assert.equal(packageOf('packages/server/src/a.ts'), 'server');
  assert.equal(packageOf('scripts/a.ts'), '(root)');
});

/* ------------------------------------------------------ rule A: value --- */

const shared = (name: string, text: string, value: number): TimeConstant => ({
  name,
  file: 'packages/shared/src/constants/config.ts',
  line: 1,
  text,
  value,
  ms: toMs(name, value),
});

test('rule A: a bare literal implementing a *_MINUTES constant is found, units normalised', () => {
  const f = findDrift({
    shared: [shared('DRIVER_LATE_THRESHOLD_MINUTES', '10', 10)],
    files: new Map([['packages/client/src/p.tsx', 'const late = now - t > 10 * 60 * 1000;']]),
  });
  const a = f.filter((x) => x.rule === 'value-match');
  assert.equal(a.length, 1);
  assert.equal(a[0].literal, '10 * 60 * 1000');
  assert.match(a[0].matches, /DRIVER_LATE_THRESHOLD_MINUTES/);
});

test('rule A: a file that imports the constant is not flagged', () => {
  const f = findDrift({
    shared: [shared('DRIVER_LATE_THRESHOLD_MINUTES', '10', 10)],
    files: new Map([
      [
        'packages/client/src/p.tsx',
        "import { DRIVER_LATE_THRESHOLD_MINUTES } from '@bimoto/shared';\nconst x = 10 * 60 * 1000;",
      ],
    ]),
  });
  assert.deepEqual(f.filter((x) => x.rule === 'value-match'), []);
});

/* ------------------------------------------------------- rule B: name --- */

const twoPackages = (aText: string, bText: string) =>
  new Map([
    ['packages/server/src/a.ts', `export const MIN_LEAD_TIME_MS = ${aText};`],
    ['packages/client/src/b.ts', `export const MIN_LEAD_TIME_MS = ${bText};`],
  ]);

test('rule B: one name declared in two packages FAILS, and equal values read AGREEING', () => {
  const f = findDrift({ shared: [], files: twoPackages('60 * 60 * 1000', '60 * 60 * 1000') });
  const b = f.filter((x) => x.rule === 'name-match');
  assert.equal(b.length, 1);
  assert.equal(b[0].verdict, 'AGREEING');
  assert.equal(runLiteralCheck(f, []).ok, false);
});

test('rule B: unequal values read DISAGREEING and say so — never a silent reconciliation', () => {
  const f = findDrift({ shared: [], files: twoPackages('60 * 60 * 1000', '90 * 60 * 1000') });
  const b = f.filter((x) => x.rule === 'name-match');
  assert.equal(b.length, 1);
  assert.equal(b[0].verdict, 'DISAGREEING');
  assert.match(runLiteralCheck(f, []).errors.join('\n'), /founder decision, never a silent/);
});

test('rule B: the same name twice INSIDE one package is not a pair (two jobs, two tick rates)', () => {
  const f = findDrift({
    shared: [],
    files: new Map([
      ['packages/server/src/jobs/a.job.ts', 'const TICK_MS = 60 * 1000;'],
      ['packages/server/src/jobs/b.job.ts', 'const TICK_MS = 30 * 1000;'],
    ]),
  });
  assert.deepEqual(f.filter((x) => x.rule === 'name-match'), []);
});

test('rule B: a non-time constant sharing a name across packages is not a pair', () => {
  const f = findDrift({
    shared: [],
    files: new Map([
      ['packages/server/src/a.ts', 'const PAGE_SIZE = 500;'],
      ['packages/client/src/b.ts', 'const PAGE_SIZE = 50;'],
    ]),
  });
  assert.deepEqual(f.filter((x) => x.rule === 'name-match'), []);
});

test('rule B: collapsing the duplication to a shared import makes it pass', () => {
  const f = findDrift({
    shared: [shared('MIN_LEAD_TIME_MS', '60 * 60 * 1000', 3600000)],
    files: new Map([
      ['packages/server/src/a.ts', "import { MIN_LEAD_TIME_MS } from '@bimoto/shared';"],
      ['packages/client/src/b.ts', "import { MIN_LEAD_TIME_MS } from '@bimoto/shared';"],
    ]),
  });
  assert.equal(runLiteralCheck(f, []).ok, true);
});

/* ------------------------------------------------------------- gate ----- */

const finding = (key: string): DriftFinding => ({
  rule: 'name-match',
  file: 'packages/client/src/b.ts',
  line: 1,
  literal: 'X_MS = 1000',
  matches: 'X_MS (packages/server/src/a.ts:1) = 1000',
  verdict: 'AGREEING',
  key,
});

test('only rule B gates: rules A and C are census output, not build failures', () => {
  const censusOnly: DriftFinding[] = [
    { ...finding('k'), rule: 'value-match' },
    { ...finding('k2'), rule: 'unnamed-duplication' },
  ];
  const r = runLiteralCheck(censusOnly, []);
  assert.equal(r.ok, true, r.errors.join('\n'));
  assert.deepEqual(r.gated, []);
});

test('an allowlisted finding passes', () => {
  const r = runLiteralCheck([finding('k')], [{ key: 'k', reason: 'a stated reason' }]);
  assert.equal(r.ok, true, r.errors.join('\n'));
});

test('an allowlist entry with no reason FAILS', () => {
  const r = runLiteralCheck([finding('k')], [{ key: 'k', reason: '  ' }]);
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /has no reason/);
});

test('an entry matching no finding FAILS as stale (the #183 rule)', () => {
  const r = runLiteralCheck([], [{ key: 'gone', reason: 'it used to be duplicated' }]);
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /STALE literal allowlist entry 'gone'/);
});

test('collapsing a duplication turns its entry stale — deleting it is the fix', () => {
  const entry = [{ key: 'k', reason: 'a stated reason' }];
  assert.equal(runLiteralCheck([finding('k')], entry).ok, true);
  assert.equal(runLiteralCheck([], entry).ok, false);
  assert.equal(runLiteralCheck([], []).ok, true);
});

test('a duplicate entry warns but does not fail', () => {
  const r = runLiteralCheck(
    [finding('k')],
    [{ key: 'k', reason: 'r' }, { key: 'k', reason: 'r' }],
  );
  assert.equal(r.ok, true, r.errors.join('\n'));
  assert.match(r.warnings.join('\n'), /duplicate literal allowlist entry/);
});
