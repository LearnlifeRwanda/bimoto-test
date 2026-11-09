// GROUNDSKEEPER G4 — the constants guard has to work in both directions,
// so this proves both against a fixture repo rather than the real one:
// a freshly planted dead constant FAILS, and an allowlisted one PASSES.
// A guard nobody has watched fail is a guard nobody knows works — which
// is the whole reason this dispatch also went looking at CI.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { buildConstantsMap, extractConstants, type ExtractConfig } from '../extract';
import { runCheck, type AllowlistEntry } from '../check';

const repoRoot = path.resolve(__dirname, 'fixtures', 'fakerepo');
const cfg: ExtractConfig = {
  repoRoot,
  constantsDir: path.join('packages', 'shared', 'src', 'constants'),
  sourceDirs: [
    path.join('packages', 'server', 'src'),
    path.join('packages', 'shared', 'src'),
  ],
};

const ALLOWLIST: AllowlistEntry[] = [
  { key: 'PENDING_RULE', reason: 'specified by founder; implementation wave pending' },
];

test('every exported constant in the directory is found', () => {
  const names = extractConstants(cfg).map((c) => c.name);
  assert.deepEqual(names, [
    'DEAD_CONSTANT',
    'MENTIONED_IN_COMMENT',
    'PENDING_RULE',
    'TEST_ONLY_CONSTANT',
    'WIRED_LIMIT',
  ]);
});

test('a constant with a production consumer is not reported', () => {
  const result = runCheck(buildConstantsMap(cfg), ALLOWLIST);
  assert.ok(!result.errors.some((e) => e.includes('WIRED_LIMIT')));
});

// The direction that matters: plant a dead constant, the guard goes red.
test('a dead constant with no allowlist entry FAILS the guard', () => {
  const result = runCheck(buildConstantsMap(cfg), ALLOWLIST);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('DEAD_CONSTANT')));
});

// The other direction: the founder's pending rules stay green.
test('a dead constant WITH an allowlist entry passes silently', () => {
  const result = runCheck(buildConstantsMap(cfg), ALLOWLIST);
  assert.ok(!result.errors.some((e) => e.includes('PENDING_RULE')));
});

test('the guard is green once every dead constant is allowlisted', () => {
  const full: AllowlistEntry[] = [
    ...ALLOWLIST,
    { key: 'DEAD_CONSTANT', reason: 'fixture fossil' },
    { key: 'TEST_ONLY_CONSTANT', reason: 'fixture test-only' },
    { key: 'MENTIONED_IN_COMMENT', reason: 'fixture comment-only' },
  ];
  const result = runCheck(buildConstantsMap(cfg), full);
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
});

// A constant only its own tests read is exactly the state a fossil reaches
// the moment someone writes it a test. It is not wired.
test('a test-only consumer does not count as wiring', () => {
  const result = runCheck(buildConstantsMap(cfg), ALLOWLIST);
  assert.ok(result.errors.some((e) => e.includes('TEST_ONLY_CONSTANT')));
});

// A doc-comment naming a threshold is documentation, not enforcement.
test('a mention in a comment does not count as wiring', () => {
  const result = runCheck(buildConstantsMap(cfg), ALLOWLIST);
  assert.ok(result.errors.some((e) => e.includes('MENTIONED_IN_COMMENT')));
});

// A barrel re-export is how a fossil stays reachable without being read.
test('a barrel re-export does not count as wiring', () => {
  const map = buildConstantsMap(cfg);
  assert.deepEqual(map.consumers.get('DEAD_CONSTANT'), []);
});

// An allowlist that does not say why is just a mute button.
test('an allowlist entry with no reason fails the guard', () => {
  const result = runCheck(buildConstantsMap(cfg), [
    { key: 'PENDING_RULE', reason: '   ' } as AllowlistEntry,
  ]);
  assert.ok(result.errors.some((e) => e.includes('has no reason')));
});

// A guard whose allowlist may rot stops meaning anything.
test('an allowlist entry for a wired constant is reported as stale', () => {
  const result = runCheck(buildConstantsMap(cfg), [
    ...ALLOWLIST,
    { key: 'WIRED_LIMIT', reason: 'was pending, now implemented' },
  ]);
  assert.ok(result.warnings.some((w) => w.includes('WIRED_LIMIT') && w.includes('stale')));
});

test('an allowlist entry for a constant that no longer exists is reported as stale', () => {
  const result = runCheck(buildConstantsMap(cfg), [
    ...ALLOWLIST,
    { key: 'DELETED_LONG_AGO', reason: 'was pending' },
  ]);
  assert.ok(result.warnings.some((w) => w.includes('DELETED_LONG_AGO')));
});

// The committed allowlist is the real one, and it must be well-formed.
test('the real allowlist is valid JSON with a reason on every entry', () => {
  const real = require(path.resolve(__dirname, '..', 'allowlist.json')) as AllowlistEntry[];
  assert.ok(real.length > 0);
  for (const e of real) {
    assert.equal(typeof e.key, 'string');
    assert.ok(e.key.trim().length > 0);
    assert.ok(e.reason.trim().length > 0, `${e.key} has no reason`);
  }
});
