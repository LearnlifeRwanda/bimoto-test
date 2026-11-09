// Behaviour tests for the supply-chain guard, both directions: the
// production tree as it stands must PASS against the committed
// baseline, and each way the rule can be broken must FAIL.
//
// These run against a fixed advisory set rather than a live `pnpm
// audit`, so they test the RULE and stay deterministic offline. The
// live tree is what `pnpm deps:check` gates in CI.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as path from 'node:path';
import {
  loadBaseline,
  parseAudit,
  runCheck,
  type Advisory,
  type BaselineEntry,
} from '../check';

const BASELINE = path.resolve(__dirname, '..', 'baseline.json');

/**
 * The four advisories the tree carries after SUPPLY-CHAIN G4/G5.
 *
 * EXPORT-AND-LEDGER G6(b) — @opentelemetry/core moved from 1120821 to
 * 1145811. The advisory was RE-ISSUED under a new id (same package, same
 * defect, same fix); the registry retired the old one, so deps:check
 * failed the tree as STALE. The fixture moves in the SAME COMMIT as
 * baseline.json, because this is the self-test-pin class again — a
 * fixture pinning an id the baseline no longer carries makes this file
 * assert against a world that does not exist, and the failure would blame
 * the guard rather than the drift.
 */
function residue(): Advisory[] {
  return [
    { id: 1119441, module_name: 'uuid', severity: 'moderate', title: 'uuid bounds check', paths: ['packages/server > firebase-admin > uuid@9.0.1'] },
    { id: 1145811, module_name: '@opentelemetry/core', severity: 'moderate', title: 'Baggage allocation', paths: ['packages/server > @sentry/node > @opentelemetry/core@1.30.1'] },
    { id: 1124268, module_name: 'react-router', severity: 'moderate', title: 'Open redirect', paths: ['packages/client > react-router-dom > react-router@6.30.6'] },
    { id: 1124272, module_name: 'react-router', severity: 'moderate', title: 'Constructor injection', paths: ['packages/client > react-router-dom > react-router@6.30.6'] },
  ];
}

function base(): BaselineEntry[] {
  return JSON.parse(JSON.stringify(loadBaseline(BASELINE))) as BaselineEntry[];
}

function fails(advs: Advisory[], b: BaselineEntry[], needle: string) {
  const r = runCheck(advs, b);
  assert.equal(r.ok, false, `expected a failure mentioning ${needle}, got a pass`);
  assert.ok(
    r.errors.some((e) => e.includes(needle)),
    `expected an error containing ${JSON.stringify(needle)}, got:\n${r.errors.join('\n')}`,
  );
}

// --------------------------------------------------------------- passes

test('the residue after G4/G5 passes against the committed baseline', () => {
  const r = runCheck(residue(), base());
  assert.equal(r.ok, true, `deps:check failed on the seeded residue:\n${r.errors.join('\n')}`);
});

test('a clean tree with an empty baseline passes', () => {
  assert.equal(runCheck([], []).ok, true);
});

test('an unrecorded MODERATE does not fail — the gate is high and above', () => {
  const advs = residue();
  advs.push({ id: 999001, module_name: 'somepkg', severity: 'moderate', title: 'x', paths: ['a > b'] });
  assert.equal(runCheck(advs, base()).ok, true);
});

// -------------------------------------------------------- the two rules

test('a NEW high advisory with no baseline entry fails', () => {
  const advs = residue();
  advs.push({ id: 999002, module_name: 'axios', severity: 'high', title: 'MITM via prototype pollution', paths: ['packages/server > africastalking > axios'] });
  fails(advs, base(), 'NEW HIGH ADVISORY 999002');
});

test('a NEW critical advisory with no baseline entry fails', () => {
  const advs = residue();
  advs.push({ id: 999003, module_name: 'websocket-driver', severity: 'critical', title: 'x', paths: ['packages/server > firebase-admin > websocket-driver'] });
  fails(advs, base(), 'NEW CRITICAL ADVISORY 999003');
});

test('a baseline entry whose advisory is gone fails as stale (the #183 rule)', () => {
  // react-router 1124268 is the one a v7 migration would clear.
  const advs = residue().filter((a) => a.id !== 1124268);
  fails(advs, base(), 'STALE baseline entry 1124268');
});

// ------------------------------------------- an entry must actually say

test('a baseline entry with no reason fails', () => {
  const b = base();
  b[0].reason = '';
  fails(residue(), b, 'has no reason');
});

test('a baseline entry with no owner fails', () => {
  const b = base();
  b[0].owner = '   ';
  fails(residue(), b, 'has no owner');
});

test('a baseline entry with no path fails', () => {
  const b = base();
  delete (b[0] as Partial<BaselineEntry>).path;
  fails(residue(), b, 'has no path');
});

test('a baseline entry whose severity has moved fails', () => {
  const advs = residue();
  advs[0] = { ...advs[0], severity: 'high' };
  fails(advs, base(), 'is now \'high\'');
});

test('a baseline entry pointing at the wrong package fails', () => {
  const b = base();
  b[0].package = 'not-uuid';
  fails(residue(), b, 'but its baseline entry names');
});

// ------------------------------------------------------ the audit reader

test('parseAudit reads pnpm audit JSON, collapsing findings to paths', () => {
  const advs = parseAudit(
    JSON.stringify({
      advisories: {
        '1': {
          id: 1,
          module_name: 'axios',
          severity: 'high',
          title: 't',
          findings: [{ paths: ['a > axios'] }, { paths: ['b > axios', 'a > axios'] }],
        },
      },
    }),
  );
  assert.equal(advs.length, 1);
  assert.deepEqual(advs[0].paths, ['a > axios', 'b > axios']);
});

test('parseAudit treats a tree with no advisories as clean', () => {
  assert.deepEqual(parseAudit(JSON.stringify({ metadata: {} })), []);
});

test('parseAudit refuses non-JSON rather than reporting a clean tree', () => {
  assert.throws(() => parseAudit('ERR_PNPM_AUDIT_ENDPOINT_ERROR'), /did not return JSON/);
});

test('every committed baseline entry is complete', () => {
  for (const e of base()) {
    for (const f of ['package', 'path', 'severity', 'reason', 'owner'] as const) {
      assert.ok(typeof e[f] === 'string' && e[f].trim() !== '', `entry ${e.id} lacks ${f}`);
    }
    assert.ok(e.reason.length > 60, `entry ${e.id}'s reason is too short to be a real one`);
    assert.ok(e.owner.length > 10, `entry ${e.id}'s owner is too vague to be a real one`);
  }
});
