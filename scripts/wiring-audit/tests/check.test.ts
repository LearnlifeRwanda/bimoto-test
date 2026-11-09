// WIRE-AUDIT G5 — guard behaviour: passes on a baseline-covered map,
// fails on a new unallowlisted violation, fails on a reason-less
// allowlist entry, warns (without failing) on a stale entry. Also
// proves the committed allowlist keeps the guard green against the
// real repo at HEAD.

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { buildWiringMap, DEFAULT_CONFIG, type AuditConfig } from '../extract';
import { runCheck, loadAllowlist, type AllowlistEntry } from '../check';

const FIXTURE_CFG: AuditConfig = {
  root: path.join(__dirname, 'fixtures', 'fakerepo'),
  serverIndex: 'server/index.ts',
  clientSrc: 'client/src',
  appTsx: 'client/src/App.tsx',
  bottomNav: 'client/src/BottomNav.tsx',
  clientEntry: 'client/src/main.tsx',
};

const map = buildWiringMap(FIXTURE_CFG);

// The fixture's complete baseline.
const BASELINE: AllowlistEntry[] = [
  { key: 'endpoint GET /api/things/orphan', reason: 'planted fixture orphan' },
  { key: 'endpoint GET /api/things/dead-only', reason: 'called only from planted dead file' },
  { key: 'endpoint GET /api/docs.json', reason: 'fixture docs endpoint' },
  { key: 'route /island', reason: 'planted fixture island' },
  // LOOSE-ENDS G2 — the two endpoints declared below the #170
  // regex-inside-${...} reproduction. No fixture client calls them;
  // their whole job is to be VISIBLE to the extractor at all.
  {
    key: 'endpoint GET /api/csv/after-regex-in-template',
    reason: 'tokenizer-desynchronisation reproduction — visibility is the assertion, not wiring',
  },
  {
    key: 'endpoint POST /api/csv/:id/export',
    reason: 'tokenizer-desynchronisation reproduction — visibility is the assertion, not wiring',
  },
];

test('guard passes when every finding is allowlisted with a reason', () => {
  const result = runCheck(map, BASELINE);
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
});

test('guard fails on a new violation missing from the allowlist', () => {
  const withoutOrphan = BASELINE.filter((e) => !e.key.includes('/orphan'));
  const result = runCheck(map, withoutOrphan);
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /NEW server orphan: endpoint GET \/api\/things\/orphan/);
});

test('guard fails on a new unreachable screen missing from the allowlist', () => {
  const withoutIsland = BASELINE.filter((e) => e.key !== 'route /island');
  const result = runCheck(map, withoutIsland);
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /NEW unreachable screen: route \/island/);
});

test('an allowlist entry without a reason fails the guard', () => {
  const noReason = [...BASELINE, { key: 'endpoint GET /api/whatever', reason: '  ' }];
  const result = runCheck(map, noReason);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('has no reason')));
});

test('a stale allowlist entry warns but does not fail', () => {
  const stale = [...BASELINE, { key: 'endpoint GET /api/things/list', reason: 'no longer true' }];
  const result = runCheck(map, stale);
  assert.equal(result.ok, true);
  assert.ok(result.warnings.some((w) => w.includes('stale allowlist entry')));
});

test('dead-code-only callers are reported as orphans with their own wording', () => {
  const without = BASELINE.filter((e) => !e.key.includes('dead-only'));
  const result = runCheck(map, without);
  assert.ok(result.errors.some((e) => e.includes('only callers are in files nothing imports')));
});

test('the committed allowlist keeps the guard green against the real repo', () => {
  const root = path.resolve(__dirname, '..', '..', '..');
  const realMap = buildWiringMap({ root, ...DEFAULT_CONFIG });
  const allowlist = loadAllowlist(path.join(__dirname, '..', 'allowlist.json'));
  const result = runCheck(realMap, allowlist);
  assert.deepEqual(result.errors, []);
  assert.equal(result.warnings.length, 0, 'no stale entries at baseline');
});
