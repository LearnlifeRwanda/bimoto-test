// MONEY-ATOMIC G5 — guard behaviour, both directions.
//
// The ratchet is only worth its CI minute if it fails on the thing it was
// built for and passes on the thing it was told to accept. Both are
// asserted here, plus the two ways an allowlist entry goes stale, plus
// the one thing this allowlist must never accept: a class-(a) entry.

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildTxnMap, extractFromSource, functionKey, DEFAULT_CONFIG } from '../extract';
import { runCheck, loadAllowlist, type AllowlistEntry } from '../check';

const FIXTURES = path.join(__dirname, 'fixtures');
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

function fixture(name: string) {
  const rel = `packages/server/src/services/${name}`;
  return extractFromSource(rel, fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
}

const planted = fixture('planted.service.ts');
const batched = fixture('batched.service.ts');

// ---------------------------------------------------------------- direction 1
// A planted class-(a) function FAILS.

test('a planted class-(a) function fails the guard', () => {
  const res = runCheck(planted, []);
  assert.equal(res.ok, false);
  assert.equal(res.errors.length, 1);
  assert.match(res.errors[0], /UNBATCHED CROSS-MODEL WRITES/);
  assert.match(res.errors[0], /settleSomething/);
  // The message must name what it saw, not merely assert a rule.
  assert.match(res.errors[0], /journey \+ user/);
  assert.match(res.errors[0], /journey\.update@/);
  assert.match(res.errors[0], /user\.update@/);
});

// ---------------------------------------------------------------- direction 2
// The seeded allowlist PASSES — and the shapes that are not the defect
// are not flagged in the first place.

test('the repo passes with its seeded allowlist', () => {
  const map = buildTxnMap({ root: REPO_ROOT, ...DEFAULT_CONFIG });
  const allowlist = loadAllowlist(path.join(__dirname, '..', 'allowlist.json'));
  const res = runCheck(map.functions, allowlist);
  assert.deepEqual(res.errors, []);
  assert.equal(res.ok, true);
  assert.ok(res.findings.length > 0, 'the guard should be attesting something, not seeing nothing');
});

test('every MONEY-ATOMIC defect is gone from the findings', () => {
  const map = buildTxnMap({ root: REPO_ROOT, ...DEFAULT_CONFIG });
  const keys = new Set(map.functions.filter((f) => f.models.length >= 2).map(functionKey));
  for (const fixed of [
    'confirmJourney in packages/server/src/services/journey.service.ts',
    'disputeJourney in packages/server/src/services/journey.service.ts',
    'endJourney in packages/server/src/services/journey.service.ts',
    'createRating in packages/server/src/services/rating.service.ts',
    'applyPreferenceChange in packages/server/src/services/payout/preferences/change-flow.ts',
    // MONEY-ATOMIC-2 — the seventh, the one this walker found itself.
    'processAutoConfirm in packages/server/src/jobs/auto-confirm.job.ts',
  ]) {
    assert.ok(!keys.has(fixed), `${fixed} is still an unbatched cross-model write site`);
  }
});

// THE PARKED LIST IS NOW EMPTY, and that is the assertion.
//
// It held exactly one entry for several waves: customerCompleteJourney,
// parked because founder decision D10 was going to decide the shape of the
// write itself and fixing the transaction boundary first would have been
// fixing a thing about to change. D10 decided: the endpoint and the service
// function are DELETED (EXPORT-AND-LEDGER G3), so there is no unbatched
// write left to fix and no owner left to name.
//
// This assertion moves in the SAME COMMIT as the allowlist it reads —
// #195's lesson. The check and its self-test are different oracles: an
// allowlist emptied without this line changed still passes deepEqual
// against a one-element array in nobody's imagination but this file's, and
// the failure would name a wave that no longer exists.
//
// An empty parked list is the healthy state, not a temporary one. A new
// entry here means a money-path defect was found, deliberately not fixed,
// and handed to another wave — which is a thing a reviewer should have to
// read about, so adding one must fail this test until they write down why.
test('no class-(a) defect is parked — the money-path warning list is empty', () => {
  const allowlist = loadAllowlist(path.join(__dirname, '..', 'allowlist.json'));
  const parked = allowlist.filter((e) => e.class === 'a-parked');
  assert.deepEqual(
    parked.map((e) => e.key).sort(),
    [],
    'a class-(a) defect was parked. Parking one is a decision another wave ' +
      'has to own: name it here, with its owner, or fix it.',
  );
  for (const e of parked) assert.ok(e.parkedBy && e.parkedBy.trim() !== '', `${e.key} has no owner`);
});

test('batched writes, a tx parameter and a single model are not findings', () => {
  const res = runCheck(batched, []);
  assert.deepEqual(res.errors, []);
  assert.deepEqual(res.findings, []);
});

// ------------------------------------------------------------------- classes

test('a class-(a) allowlist entry is refused — the defect must be fixed, not attested', () => {
  const entry: AllowlistEntry = {
    key: 'settleSomething in packages/server/src/services/planted.service.ts',
    class: 'a',
    reason: 'we will get to it',
  };
  const res = runCheck(planted, [entry]);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => /is class \(a\)/.test(e) && /must be FIXED/.test(e)));
});

test('a parked class-(a) entry needs an owner, and warns loudly once it has one', () => {
  const key = 'settleSomething in packages/server/src/services/planted.service.ts';

  const ownerless = runCheck(planted, [{ key, class: 'a-parked', reason: 'later' }]);
  assert.equal(ownerless.ok, false);
  assert.ok(ownerless.errors.some((e) => /names no owner/.test(e)));

  const owned = runCheck(planted, [
    { key, class: 'a-parked', parkedBy: 'SOME-WAVE', reason: 'owned there' },
  ]);
  assert.equal(owned.ok, true);
  assert.ok(owned.warnings.some((w) => /PARKED class-\(a\) defect/.test(w) && /SOME-WAVE/.test(w)));
});

test('an entry with no reason is refused', () => {
  const res = runCheck(planted, [
    {
      key: 'settleSomething in packages/server/src/services/planted.service.ts',
      class: 'b',
      reason: '   ',
    },
  ]);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => /has no reason/.test(e)));
});

// --------------------------------------------------------------------- stale
// Both ways an entry stops describing reality. Stale FAILS, on the
// route-guard precedent: an unexamined claim in the tree is worse than no
// claim, because the next reader trusts it.

test('an entry for a function that no longer exists fails as stale', () => {
  const res = runCheck(planted, [
    {
      key: 'settleSomethingElse in packages/server/src/services/planted.service.ts',
      class: 'b',
      reason: 'gone',
    },
    {
      key: 'settleSomething in packages/server/src/services/planted.service.ts',
      class: 'b',
      reason: 'still here',
    },
  ]);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => /STALE/.test(e) && /no such function/.test(e)));
});

test('an entry for a function that is now batched fails as stale', () => {
  // Same key, but the function it names composes its writes into one
  // transaction now. The attestation has nothing left to describe.
  const res = runCheck(batched, [
    {
      key: 'settleSomething in packages/server/src/services/batched.service.ts',
      class: 'b',
      reason: 'was best-effort before someone wrapped it',
    },
  ]);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => /STALE/.test(e) && /it was batched/.test(e)));
});
