// CUTGUARD v2 G1 — the serialization guard's self-test, both directions.
//
// The guard family's own convention (route-guard/tests, txn-guard/tests,
// constants-guard/tests): a guard without a self-test is not a guard. It
// has to fail on the thing it was built for and pass on the thing it was
// told to accept, or it is a script that happens to exit 0.
//
// Run: pnpm serialize:test

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { extractFile, type FunctionRecord } from '../extract';
import { runCheck, runRule3, loadAllowlist, S2_MODELS, type Allowlist } from '../check';
import { findRule3 } from '../rule3';
import { findRule4, runRule4, rule4Key, CUSTOMER_PROJECTORS, DRIVER_PROJECTORS } from '../rule4';
import { findGatedFunctions, findRule5, runRule5, rule5Key } from '../rule5';

const FIXTURES = path.join(__dirname, 'fixtures');
const SERIALIZERS = new Set(['toClientUser']);

function fixture(name: string, rel: string): FunctionRecord[] {
  return extractFile(path.join(FIXTURES, name), rel, SERIALIZERS);
}

const rawRoutes = fixture('raw.routes.ts', 'packages/server/src/routes/raw.routes.ts');
const okRoutes = fixture('serialized.routes.ts', 'packages/server/src/routes/serialized.routes.ts');
const rawService = fixture('raw.service.ts', 'packages/server/src/services/raw.service.ts');

/**
 * An allowlist literal with every rule's list present. The fields are
 * REQUIRED on `Allowlist` rather than optional on purpose: a caller who
 * forgot `gateSites` would silently switch S4 off, and a guard that can
 * be disabled by omission is not a guard.
 */
function allowlist(partial: Partial<Allowlist> = {}): Allowlist {
  return { serializers: [], sites: [], gateSites: [], gateCallSites: [], ...partial };
}

const EMPTY: Allowlist = allowlist({ serializers: ['toClientUser'] });

function check(fns: FunctionRecord[], allowlist: Allowlist = EMPTY) {
  return runCheck({ functions: fns, files: [] }, allowlist);
}

/* ------------------------------------------------- direction 1: it FAILS --- */

test('S1 — a raw row as the response body fails', () => {
  const res = check(rawRoutes);
  assert.equal(res.ok, false);
  const direct = res.violations.find((v) => v.key.includes('GET /direct'));
  assert.ok(direct, 'the direct-body site must be condemned');
  assert.equal(direct!.rule, 'S1');
  assert.match(direct!.message, /raw prisma\.user\.findUnique\(\) row/);
});

test('S1 — a raw row carried as a PROPERTY fails (verify-otp’s shape)', () => {
  const res = check(rawRoutes);
  const prop = res.violations.find((v) => v.key.includes('POST /property'));
  assert.ok(prop, 'a row on a named key is still a row on the wire');
  assert.match(prop!.message, /\(property\)/);
});

test('S1 — a raw row carried as a SPREAD fails (the {...user} that shipped moneyPinHash)', () => {
  const res = check(rawRoutes);
  const spread = res.violations.find((v) => v.key.includes('GET /spread'));
  assert.ok(spread, 'a spread flattens every column into the body — the original defect');
  assert.match(spread!.message, /\(spread\)/);
});

test('S2 — an exported service returning a raw user row fails', () => {
  const res = check(rawService);
  const leak = res.violations.find((v) => v.key.includes('leaksUser'));
  assert.ok(leak, 'this is B-1 exactly: the route one file away cannot see this');
  assert.equal(leak!.rule, 'S2');
  assert.match(leak!.message, /carries credentials/);
});

/* ------------------------------------------------- direction 2: it PASSES -- */

test('a row laundered by an allowlisted serializer passes', () => {
  const res = check(okRoutes);
  assert.ok(
    !res.violations.some((v) => v.key.includes('GET /serialized')),
    'toClientUser is the door; going through it is the whole point',
  );
});

test('a row narrowed by an explicit select: passes', () => {
  const res = check(okRoutes);
  assert.ok(
    !res.violations.some((v) => v.key.includes('GET /selected')),
    'a select IS the positive projection the rule asks for',
  );
  assert.equal(res.ok, true);
});

test('an exported service returning a SELECTED user row passes', () => {
  const res = check(rawService);
  assert.ok(!res.violations.some((v) => v.key.includes('safeUser')));
});

test('S2 is scoped to the credential-bearing models, and says so', () => {
  const res = check(rawService);
  assert.ok(
    !res.violations.some((v) => v.key.includes('escrowIsNotS2')),
    'widening S2 to every model is how a guard becomes noise and then becomes deleted',
  );
  assert.ok(S2_MODELS.has('user'));
  assert.ok(!S2_MODELS.has('escrow'));
});

/* -------------------------------------------------- the allowlist itself --- */

test('an allowlisted site passes, and the entry must carry a reason', () => {
  const key = 'S1 packages/server/src/routes/raw.routes.ts GET /direct user:user';
  const withReason = check(rawRoutes, allowlist({ serializers: ['toClientUser'], sites: [{ key, reason: 'fixture: proving an entry with a reason clears its site' }] }));
  assert.ok(!withReason.violations.some((v) => v.key === key));

  const withoutReason = check(rawRoutes, allowlist({ serializers: ['toClientUser'], sites: [{ key, reason: '' }] }));
  assert.equal(withoutReason.ok, false);
  assert.ok(withoutReason.errors.some((e) => /has no reason/.test(e)));
});

test('a stale allowlist entry warns rather than rotting silently', () => {
  const res = check(okRoutes, allowlist({ serializers: ['toClientUser'], sites: [{ key: 'S1 nowhere.ts GET /gone x:user', reason: 'points at nothing' }] }));
  assert.ok(res.warnings.some((w) => /stale allowlist site/.test(w)));
});

/* ------------------------------------------------------- the real repo ----- */

test('the shipped allowlist parses and names toClientUser as a serializer', () => {
  const allowlist = loadAllowlist(path.join(__dirname, '..', 'allowlist.json'));
  assert.ok(allowlist.serializers.includes('toClientUser'));
  for (const site of allowlist.sites) {
    assert.ok(site.key.trim().length > 0, 'every site needs a key');
    assert.ok(
      site.reason.trim().length > 20,
      `site '${site.key}' needs a real reason, not a placeholder`,
    );
  }
});


/* ============================================== rule S3: the projection === */
//
// U-4's mechanism was not "somebody shipped driverPayout". It was that a
// new money exit BUILT ITS OWN breakdown, the way every endpoint builds
// an object, and nothing distinguished the customer's exit from the
// driver's. S3 is about who decided the shape.

const COMMISSION_FIXTURE = 'packages/server/src/services/commission.service.ts';
const commissionFindings = findRule3(
  COMMISSION_FIXTURE,
  fs.readFileSync(path.join(FIXTURES, 'commission.service.ts'), 'utf8'),
);

test('S3 — a hand-rolled inline breakdown fails, and the message names the driver money', () => {
  const res = runRule3(commissionFindings, EMPTY);
  const inline = res.violations.find((v) => /driverPayout/.test(v.message));
  assert.ok(inline, 'the accept path\'s original shape must be condemned');
  assert.equal(inline!.rule, 'S3');
  assert.match(inline!.message, /produced by a projector/);
});

test('S3 — a literal given a name first is still hand-rolled', () => {
  // `const commissionBreakdown = {…}` then `{ commissionBreakdown }`. One
  // extra line was enough to slip past a rule that only looked at
  // property assignments.
  assert.equal(
    commissionFindings.filter((f) => f.driverKeys.length === 0).length,
    1,
    'the named-local form must be found exactly once',
  );
});

test('S3 — a projected breakdown passes, for EITHER audience', () => {
  const res = runRule3(commissionFindings, EMPTY);
  // Two refusals and no more: the two projector calls are not findings at
  // all, because a call is not a literal.
  assert.equal(res.violations.length, 2);
  assert.equal(commissionFindings.length, 2);
});

test('S3 — an allowlisted site clears, and a stale one is reported', () => {
  const key = commissionFindings[0].siteKey;
  const res = runRule3(commissionFindings, allowlist({ serializers: [], sites: [{ key, reason: 'fixture: a driver-scoped literal with a stated audience' }] }));
  assert.equal(res.violations.length, 1);
  assert.ok(res.usedSites.has(key));
});

test('the shipped repo has NO S3 allowlist entries — every commission is projected', () => {
  const allowlist = loadAllowlist(path.join(__dirname, '..', 'allowlist.json'));
  const s3 = allowlist.sites.filter((s) => s.key.startsWith('S3 '));
  assert.deepEqual(
    s3,
    [],
    'an S3 exemption means a money shape is being written by hand again — say why, loudly',
  );
});

/* ------------------------------------------------------------- rule S4 ---- */
//
// CUTGUARD v2 amendment 2. S3 asks how a money shape was BUILT; S4 asks
// who is allowed to SEE it. S3 is what makes S4 possible — because every
// breakdown goes through a projector, the projector's NAME says which
// audience the value is for, and S4 never has to guess at a shape.

const GATE_FIXTURE = 'packages/server/src/services/version-gate.service.ts';
const gateFindings = findRule4(
  GATE_FIXTURE,
  fs.readFileSync(path.join(FIXTURES, 'version-gate.service.ts'), 'utf8'),
);

test('S4 — an ungated customer attach fails, and the message names the crash', () => {
  const res = runRule4(gateFindings, []);
  const v = res.violations.find((x) => x.key.includes('newCustomerSurface'));
  assert.ok(v, 'a new customer surface with no gate is exactly B-2');
  assert.match(v!.message, /totalCommissionAmount \/ driverPayout/);
  assert.match(v!.message, /customerSavingsPreview/);
});

test('S4 — the rides-list SHAPE without the rides-list GATE still fails', () => {
  // `const commissionBreakdown = toCustomerListCommission(escrow)` then
  // `{ commissionBreakdown }`. The projector condemns it, not the syntax —
  // which is the point of classifying by projector rather than by keys.
  const res = runRule4(gateFindings, []);
  assert.ok(res.violations.some((v) => v.key.includes('ungatedShorthand')));
});

test('S4 — an attach inside a callback is keyed to its NAMED ancestor', () => {
  // Two of the three real surfaces attach inside a `.map()`. Keying those
  // by line number would produce an allowlist entry that goes stale on
  // the next unrelated edit — route-guard's rule 3 was re-cut for exactly
  // this reason, and S4 starts where that one ended up.
  const f = gateFindings.find((x) => x.fn.startsWith('ungatedInsideMap'));
  assert.ok(f, 'a callback attach must still be found');
  assert.equal(f!.fn, 'ungatedInsideMap/λ');
  assert.equal(f!.key, rule4Key(GATE_FIXTURE, 'ungatedInsideMap/λ', 'toCustomerSafeCommission'));
  assert.ok(!/@\d+/.test(f!.key), 'the key must not carry a line number');
});

test('S4 — the DRIVER ladder is not a finding at all', () => {
  // Never gated: his build has always rendered it, and the gate narrows
  // by CLIENT, not by viewer. It must not even be raised as a question.
  assert.equal(
    gateFindings.filter((f) => DRIVER_PROJECTORS.has(f.projector)).length,
    0,
  );
  assert.ok(!gateFindings.some((f) => f.fn === 'driverLadderNeverGated'));
});

test('S4 — all three real gating SHAPES pass', () => {
  // The journey read gates inside the spread, the rides list gates at a
  // variable two lines above the attach, and the bid list gates inside a
  // callback. All three are in the tree; all three must clear without an
  // exemption, or the rule would have to be argued with at every site.
  for (const fn of ['gatedInSpread', 'gatedAtTheVariable', 'gatedInsideMap/λ']) {
    const f = gateFindings.find((x) => x.fn === fn);
    assert.ok(f, `${fn} must be found`);
    assert.equal(f!.gated, true, `${fn} must clear`);
  }
  const res = runRule4(gateFindings, []);
  // Anchored on the function segment: `ungatedInsideMap` CONTAINS
  // `gatedInsideMap`, and a substring match here would have quietly
  // asserted the opposite of what it says.
  const gatedFns = new Set(['gatedInSpread', 'gatedAtTheVariable', 'gatedInsideMap/λ']);
  assert.ok(!res.violations.some((v) => gatedFns.has(v.key.split(' ')[2])));
});

test('S4 — every customer projector is classified, none is missed', () => {
  // A new projector added to commission-view and NOT added to
  // CUSTOMER_PROJECTORS would be invisible to S4 — findRule4 would return
  // nothing for it and the guard would go quiet, which is the one failure
  // mode a guard must not have. This pins the set the fixture exercises.
  assert.deepEqual(
    [...CUSTOMER_PROJECTORS].sort(),
    ['projectCustomerSafeCommission', 'toCustomerListCommission', 'toCustomerSafeCommission'],
  );
  for (const p of CUSTOMER_PROJECTORS) {
    assert.ok(
      gateFindings.some((f) => f.projector === p),
      `the fixture must exercise ${p}, or the rule is untested for it`,
    );
  }
});

test('S4 — an allowlisted attach clears with its reason, a stale one warns', () => {
  const key = rule4Key(GATE_FIXTURE, 'newCustomerSurface', 'toCustomerSafeCommission');
  const res = runRule4(gateFindings, [
    { key, reason: 'fixture: attested rather than gated' },
    { key: 'S4 nonexistent.ts nobody toCustomerSafeCommission', reason: 'fixture: stale' },
  ]);
  assert.ok(!res.violations.some((v) => v.key === key), 'the attested site must clear');
  assert.ok(res.cleared.some((c) => c.includes('attested: fixture: attested rather than gated')));
  assert.ok(res.warnings.some((w) => w.includes('stale S4 allowlist entry')));
});

test('S4 — an allowlist entry with no reason is an error, not a pass', () => {
  const key = rule4Key(GATE_FIXTURE, 'newCustomerSurface', 'toCustomerSafeCommission');
  const res = runRule4(gateFindings, [{ key, reason: '   ' }]);
  assert.ok(res.errors.some((e) => /needs a key AND a reason/.test(e)));
  assert.ok(res.violations.some((v) => v.key === key), 'and it must not clear the site');
});

test('S4 — THE RESIDUAL, stated rather than discovered', () => {
  // A SECOND attach inside a function that already mentions the option
  // passes without its own gate. The check is lexical and function-
  // scoped, deliberately: what it catches is the realistic case and the
  // one that actually happened — a new surface, in a new function, with
  // nobody thinking about v13.
  //
  // This test exists so the limit is a written-down property rather than
  // something found later and called a bug. If a fourth surface is ever
  // added INSIDE an already-gated function, this is the test that says
  // the guard will not save you.
  const second = gateFindings.filter((f) => f.fn === 'secondAttachInAGatedFunction');
  assert.equal(second.length, 2, 'both attaches are seen');
  assert.ok(second.every((f) => f.gated), 'and both clear — that is the residual');
});

test('the shipped repo has NO S4 exemptions — all five customer attaches are gated', () => {
  // The five: the bid list (G6), the journey read and the rides list
  // (amendment 2), and BOTH accept-path exits (amendment 2, found by this
  // very rule while its author was drafting an exemption for them).
  const allowlist = loadAllowlist(path.join(__dirname, '..', 'allowlist.json'));
  assert.deepEqual(
    allowlist.gateSites,
    [],
    'an S4 exemption is a claim about every APK ever installed — see _gateSitesComment',
  );
});

test('S4 over the real tree: five customer attaches, all gated, none exempted', () => {
  // The enumeration itself, asserted. A SIXTH customer surface added in a
  // new function without the gate raises this count and fails on the
  // violation; a surface that quietly loses its gate fails on `gated`.
  const root = path.resolve(__dirname, '..', '..', '..');
  const files = [
    'packages/server/src/services/bid.service.ts',
    'packages/server/src/services/journey.service.ts',
  ];
  const findings = files.flatMap((rel) =>
    findRule4(rel, fs.readFileSync(path.join(root, rel), 'utf8')),
  );
  assert.deepEqual(
    findings.map((f) => `${f.fn}:${f.gated ? 'gated' : 'UNGATED'}`).sort(),
    [
      'acceptBid:gated',
      'acceptBidForCard:gated',
      'getBidsForJourney/λ:gated',
      'getJourneyById:gated',
      'getJourneys/λ:gated',
    ],
  );
  assert.equal(runRule4(findings, []).violations.length, 0);
});

/* ------------------------------------------------------------- rule S5 ---- */
//
// The gate from the ROUTE's side. S4 cannot see a caller who forgot: from
// inside a correctly-gated service, "forgot" and "meant false" are the
// same call.

const GATE_SERVICE = 'packages/server/src/services/version-gate.service.ts';
const GATE_ROUTES = 'packages/server/src/routes/version-gate.routes.ts';
const derivedGated = findGatedFunctions(
  GATE_SERVICE,
  fs.readFileSync(path.join(FIXTURES, 'version-gate.service.ts'), 'utf8'),
);
const routeFindings = findRule5(
  GATE_ROUTES,
  fs.readFileSync(path.join(FIXTURES, 'version-gate.routes.ts'), 'utf8'),
  new Set(derivedGated),
);

test('S5 — the gated set is DERIVED from the services, not hand-listed', () => {
  // A sixth gated function is covered the day it is written, with no
  // second place to keep in step. This is the same reason G5 derives its
  // obligation set from the schema.
  assert.ok(derivedGated.includes('gatedInSpread'));
  assert.ok(derivedGated.includes('gatedAtTheVariable'));
  // …and a function that takes no such option is NOT in it, so S5 asks
  // nothing of routes that call it.
  assert.ok(!derivedGated.includes('newCustomerSurface'));
});

test('S5 — a route that calls a gated function and says nothing fails', () => {
  const res = runRule5(routeFindings, []);
  const v = res.violations.find((x) => x.key.includes('GET /:id/forgot'));
  assert.ok(v, 'the forgotten caller must be condemned');
  // And the message must say which way it failed, because the benign
  // direction is the one people argue about.
  assert.match(v!.message, /does not crash anybody/);
  assert.match(v!.message, /silently WITHHOLDS/);
});

test('S5 — a finding is keyed by METHOD and PATH, never by line', () => {
  const f = routeFindings.find((x) => x.handler === 'GET /:id/forgot');
  assert.ok(f);
  assert.equal(f!.key, rule5Key(GATE_ROUTES, 'GET /:id/forgot', 'gatedInSpread'));
  assert.ok(!/:\d+$/.test(f!.key), 'a line number in the key rots on the next edit above it');
});

test('S5 — declaring the option passes, alone or among siblings', () => {
  const res = runRule5(routeFindings, []);
  assert.equal(res.violations.length, 1, 'exactly one refusal — the two declared calls clear');
  assert.ok(res.cleared.some((c) => c.includes('GET /:id/declared')));
  assert.ok(res.cleared.some((c) => c.includes('POST /:id/declared-with-siblings')));
});

test('S5 — a route calling an UNGATED function is not a finding at all', () => {
  // S4 condemns `newCustomerSurface` from the service side. S5 has
  // nothing to ask here, and must not invent a question.
  assert.ok(!routeFindings.some((f) => f.callee === 'newCustomerSurface'));
});

test('S5 — an exemption needs a reason, and a stale one warns', () => {
  const key = rule5Key(GATE_ROUTES, 'GET /:id/forgot', 'gatedInSpread');
  const bad = runRule5(routeFindings, [{ key, reason: '' }]);
  assert.ok(bad.errors.some((e) => /needs a key AND a reason/.test(e)));
  assert.ok(bad.violations.some((v) => v.key === key), 'and a reasonless entry clears nothing');

  const good = runRule5(routeFindings, [
    { key, reason: 'fixture: the result never reaches a client' },
    { key: 'S5 nowhere.routes.ts GET /gone gatedInSpread', reason: 'fixture: stale' },
  ]);
  assert.equal(good.violations.length, 0);
  assert.ok(good.warnings.some((w) => w.includes('stale S5 allowlist entry')));
});

test('S5 over the real tree: every route caller is declared or attested', () => {
  // The enumeration, asserted. A new route calling a gated function
  // without the option raises a violation; a route that loses its
  // `isCurrentApp(req)` fails the same way.
  const root = path.resolve(__dirname, '..', '..', '..');
  const services = [
    'packages/server/src/services/bid.service.ts',
    'packages/server/src/services/journey.service.ts',
  ];
  const gated = new Set(
    services.flatMap((rel) => findGatedFunctions(rel, fs.readFileSync(path.join(root, rel), 'utf8'))),
  );
  assert.deepEqual(
    [...gated].sort(),
    ['acceptBid', 'acceptBidForCard', 'getBidsForJourney', 'getJourneyById', 'getJourneys'],
  );

  const routes = [
    'packages/server/src/routes/bid.routes.ts',
    'packages/server/src/routes/journey.routes.ts',
    'packages/server/src/routes/rating.routes.ts',
    'packages/server/src/routes/scheduled-ride.routes.ts',
  ];
  const findings = routes.flatMap((rel) =>
    findRule5(rel, fs.readFileSync(path.join(root, rel), 'utf8'), gated),
  );
  const allowlist = loadAllowlist(path.join(__dirname, '..', 'allowlist.json'));
  const res = runRule5(findings, allowlist.gateCallSites);
  assert.deepEqual(res.violations, []);

  // The six that DECLARE: every customer-facing exit of a gated read.
  assert.deepEqual(
    findings.filter((f) => f.declared).map((f) => f.handler).sort(),
    [
      'GET /',
      'GET /:id',
      'GET /:id/bids',
      'POST /:id/accept-bid',
      'POST /:id/accept-bid-card',
      'POST /:id/conflict-acknowledge',
    ],
  );
  // …and the three that do NOT are exactly the attested participation
  // checks. If a fourth ever joins them it fails until somebody writes
  // down why the journey never reaches the wire.
  assert.deepEqual(
    findings.filter((f) => !f.declared).map((f) => f.handler).sort(),
    ['GET /:id/emergency/active', 'POST /:id/emergency', 'POST /:id/rate'],
  );
});
