// CUTGUARD v2 G4 — rule 3's self-test, both directions.
//
// The guard family's rule: a guard without a self-test is not a guard. It
// has to fail on the thing it was built for — and the fixture IS the
// thing it was built for, the conflict-acknowledge handler as it stood
// when a stranger motari matched a passenger with her money held.

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { findRule3, runRule3, loadRule3Allowlist } from '../rule3';

const FIXTURE = 'packages/server/src/routes/tautology.routes.ts';
const findings = findRule3(
  FIXTURE,
  fs.readFileSync(path.join(__dirname, 'fixtures', 'tautology.routes.ts'), 'utf8'),
);

/* ------------------------------------------------- direction 1: it FAILS -- */

test('the LIVE defect fails: journey.customerId handed to acceptBid', () => {
  // Asserted on the SHAPE, not on a line number: a test that breaks when
  // a comment is added above the fixture is a test people delete.
  const hit = findings.find(
    (f) => f.expression === 'journey.customerId' && f.callee === 'bidService.acceptBid',
  );
  assert.ok(hit, 'this is U-1 verbatim; if it passes, the guard is measuring nothing');
  assert.equal(hit!.callee, 'bidService.acceptBid');

  const res = runRule3(findings, []);
  assert.ok(res.errors.some((e) => /journey\.customerId/.test(e)));
  assert.ok(
    res.errors.some((e) => /must come from the SESSION/.test(e)),
    'the message must say what the fix IS, not merely that something is wrong',
  );
});

test('one more line does not launder it: const owner = journey.customerId', () => {
  // Two findings, not one: the direct form and the assigned-to-a-local
  // form. If the walker only saw the direct one, `const owner = …` would
  // be a one-line bypass of the whole rule.
  assert.equal(
    findings.filter((f) => f.expression === 'journey.customerId').length,
    2,
    'a record-sourced id assigned to a local is still record-sourced',
  );
});

/* ------------------------------------------------ direction 2: it PASSES -- */

test('a session-sourced actor passes', () => {
  assert.ok(
    !findings.some((f) => /sessionUserId/.test(f.expression)),
    'sessionUserId(req) is the whole point; it must not be flagged',
  );
});

test('a row id handed to a Prisma lookup is not an authorisation', () => {
  assert.ok(
    !findings.some((f) => f.callee.startsWith('prisma.')),
    'where: { journeyId: journey.id } is how you fetch the next row',
  );
});

test('exactly two findings in the fixture — no more, no fewer', () => {
  assert.equal(findings.length, 2);
});

/* -------------------------------------------------- the allowlist itself -- */

test('an allowlisted site clears, and an entry without a reason is an error', () => {
  const key = findings[0].key;
  const ok = runRule3(findings, [{ key, reason: 'fixture: an attested site' }]);
  assert.equal(ok.errors.length, 0);

  const bad = runRule3(findings, [{ key, reason: '   ' }]);
  assert.ok(bad.errors.some((e) => /needs a key AND a reason/.test(e)));
});

test('the key is line-independent — and that is a stated trade-off', () => {
  // Both fixture sites are `bidService.acceptBid(journey.customerId)` in
  // one file, so they share ONE key and one attestation clears both.
  //
  // That is deliberate and it is the same trade-off rule 1 already makes
  // (its key is `METHOD path in file`, not a line): a line-numbered key
  // goes stale every time somebody adds a comment above it, and a guard
  // that cries stale on every edit is a guard somebody turns off.
  //
  // The COST, stated rather than discovered later: a second call with the
  // identical callee and identical expression in an already-attested file
  // is covered silently. It is written down here, in rule3.ts's header,
  // and in docs/rollout-window.md.
  assert.equal(new Set(findings.map((f) => f.key)).size, 1);
  assert.equal(findings.length, 2);
});

test('a stale entry is warned about rather than rotting silently', () => {
  const res = runRule3(findings, [{ key: 'rule3 gone.ts f(x.yId)', reason: 'points at nothing' }]);
  assert.ok(res.warnings.some((w) => /stale rule3 allowlist entry/.test(w)));
});

test('the shipped allowlist has a real reason on every attested site', () => {
  const entries = loadRule3Allowlist(path.join(__dirname, '..', 'rule3-allowlist.json'));
  assert.ok(entries.length > 0);
  for (const e of entries) {
    assert.ok(
      e.reason.trim().length > 40,
      `entry '${e.key}' must NAME what authorises the call, not merely allow it`,
    );
  }
});
