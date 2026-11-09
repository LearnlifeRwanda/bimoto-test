// INCLUDE-REACH G6 — rule-2 behaviour, both directions.
//
// The ratchet is worth its CI minute only if it fails on the thing it was
// built for and passes on the thing it was told to accept. Both are asserted
// here, against a planted fixture for the failing direction and against the
// REAL repo at HEAD for the passing one — plus the two ways an attestation
// goes stale, which is the rule AUTH-READ established and this inherits: an
// allowlist entry that no longer describes a finding is an unexamined human
// claim sitting in the tree, and the next reader would trust it.

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildRouteMap, DEFAULT_CONFIG, extractRoutesFromSource } from '../extract';
import {
  buildReachMap,
  collectExportedSelectors,
  DEFAULT_REACH_CONFIG,
  extractFromSource,
  parsePrismaSchema,
  type ReachMap,
} from '../include-reach';
import { census, loadRule2Allowlist, runRule2, type Rule2AllowlistEntry } from '../rule2';

const FIXTURES = path.join(__dirname, 'fixtures');
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

const schema = parsePrismaSchema(
  fs.readFileSync(path.join(REPO_ROOT, 'packages/server/prisma/schema.prisma'), 'utf8'),
);

/** A ReachMap over the two planted fixtures and nothing else. */
function plantedMap(): ReachMap {
  const svcRel = 'packages/server/src/services/overreach.service.ts';
  const routeRel = 'packages/server/src/routes/overreach.routes.ts';
  return {
    functions: [
      ...extractFromSource(routeRel, fs.readFileSync(path.join(FIXTURES, 'overreach.routes.ts'), 'utf8'), schema),
      ...extractFromSource(svcRel, fs.readFileSync(path.join(FIXTURES, 'overreach.service.ts'), 'utf8'), schema),
    ],
    files: [routeRel, svcRel],
    roots: ['packages/server/src'],
  };
}

const planted = census(plantedMap());
const overReaching = planted.find((r) => r.fn === 'getThingById');
const scoped = planted.find((r) => r.fn === 'getScopedThingById');

// ---------------------------------------------------------------- direction 1
// A planted over-reaching read FAILS.

test('a planted over-reaching read fails the guard', () => {
  const res = runRule2(plantedMap(), []);
  assert.equal(res.ok, false);
  const finding = res.errors.find((e) => e.includes('getThingById'));
  assert.ok(finding, `expected a finding for getThingById, got: ${res.errors.join(' | ')}`);
  assert.match(finding!, /over-reaching read/);
  // The message names the models and the route, not merely the rule — an
  // error a reader cannot act on is a false economy.
  assert.match(finding!, /Escrow/);
  assert.match(finding!, /Message/);
  assert.match(finding!, /GET \/:id in packages\/server\/src\/routes\/overreach\.routes\.ts/);
});

test('the walker crosses the route→service boundary rule 1 cannot', () => {
  // The include is a file away from the handler. Rule 1 sees a delegated
  // read and can say nothing about it; rule 2 attributes the read back to
  // the GET route through the call graph. This is blind spot (c).
  assert.ok(overReaching);
  assert.equal(overReaching!.file, 'packages/server/src/services/overreach.service.ts');
  assert.deepEqual(overReaching!.routes, [
    'GET /:id in packages/server/src/routes/overreach.routes.ts',
  ]);
});

test('a hoisted selector is resolved, not shrugged at', () => {
  // Blind spot (a) — DECRYPT v3 addendum 2. The include is a module-level
  // const; excess-property checking never sees one, and neither did review.
  assert.ok(overReaching);
  assert.deepEqual(overReaching!.unknowns, []);
  assert.deepEqual(overReaching!.traversed, ['Escrow', 'Leg', 'Message']);
});

test('a relation with no `select` reaches the WHOLE row', () => {
  // `legs: { orderBy: … }` returns every column of every leg, contact name
  // and phone included. Reading that as "narrowed because it has a body"
  // is exactly how the third-party PII survived review.
  assert.ok(overReaching!.traversed.includes('Leg'));
});

// ---------------------------------------------------------------- direction 2
// The scoped read PASSES, and so does the real repo.

test('choosing the projection from the caller is not a finding', () => {
  assert.ok(scoped);
  assert.equal(scoped!.verdict, 'restricted');
  assert.ok(
    scoped!.restrictions.includes('caller-scope') ||
      scoped!.restrictions.includes('scoped-projection'),
    `expected a caller-derived restriction, got ${scoped!.restrictions.join('+')}`,
  );
});

test('the committed rule-2 allowlist keeps the guard green on the real repo', () => {
  const reach = buildReachMap({ root: REPO_ROOT, ...DEFAULT_REACH_CONFIG });
  const routes = buildRouteMap({ root: REPO_ROOT, ...DEFAULT_CONFIG });
  const allowlist = loadRule2Allowlist(path.join(__dirname, '..', 'include-allowlist.json'));
  const res = runRule2(reach, allowlist, routes.routes);
  assert.deepEqual(res.errors, []);
  assert.equal(res.ok, true);
});

test('the real repo has no unattested finding and no unattested UNKNOWN', () => {
  const reach = buildReachMap({ root: REPO_ROOT, ...DEFAULT_REACH_CONFIG });
  const routes = buildRouteMap({ root: REPO_ROOT, ...DEFAULT_CONFIG });
  const rows = census(reach, routes.routes);
  const attested = new Set(
    loadRule2Allowlist(path.join(__dirname, '..', 'include-allowlist.json')).map((e) => e.key),
  );
  const open = rows.filter(
    (r) => (r.verdict === 'finding' || r.verdict === 'unknown') && !attested.has(r.key),
  );
  assert.deepEqual(
    open.map((r) => `${r.key} [${r.verdict}]`),
    [],
    'an UNKNOWN is not a clean row — it is the walker saying it could not see',
  );
});

// ------------------------------------------------------------------ staleness

test('an entry whose read no longer exists FAILS', () => {
  const stale: Rule2AllowlistEntry[] = [
    { key: 'ghostFunction in packages/server/src/services/gone.ts → Journey.findUnique', reason: 'x' },
  ];
  const res = runRule2(plantedMap(), stale);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => /STALE rule-2 entry/.test(e) && /ghostFunction/.test(e)));
});

test('an entry for a read that now restricts by caller FAILS', () => {
  // The scoped read is not a finding, so an attestation for it describes
  // nothing. It must be removed, not left to be trusted.
  const stale: Rule2AllowlistEntry[] = [
    { key: scoped!.key, reason: 'attested back when this read was unscoped' },
    { key: overReaching!.key, reason: 'the real one' },
  ];
  const res = runRule2(plantedMap(), stale);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => /STALE rule-2 entry/.test(e) && e.includes('getScopedThingById')));
});

test('an entry that attests the wrong models FAILS', () => {
  const wrong: Rule2AllowlistEntry[] = [
    { key: overReaching!.key, models: ['Escrow'], reason: 'understated on purpose' },
  ];
  const res = runRule2(plantedMap(), wrong);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => /STALE rule-2 entry/.test(e) && /it attests Escrow/.test(e)));
});

test('a correct entry silences the finding, and only that finding', () => {
  const ok: Rule2AllowlistEntry[] = [
    {
      key: overReaching!.key,
      models: ['Escrow', 'Leg', 'Message'],
      reason: 'planted fixture, attested for the test',
    },
  ];
  const res = runRule2(plantedMap(), ok);
  assert.deepEqual(res.errors, []);
  assert.equal(res.ok, true);
});

// ------------------------------------------------------------------ the seam
// Rule 1 is untouched by any of this.

test('rule 1 still passes on the real repo, unmodified', () => {
  const routes = buildRouteMap({ root: REPO_ROOT, ...DEFAULT_CONFIG });
  assert.ok(routes.routes.length > 100);
  // The fixture files are NOT in packages/server/src/routes, so they cannot
  // leak into the real rule-1 map.
  assert.equal(
    routes.routes.some((r) => r.file.includes('overreach')),
    false,
  );
  assert.equal(extractRoutesFromSource('x.routes.ts', 'const a = 1;').routes.length, 0);
});

// ---------------------------------------------------------------- direction 3
// A SELECTOR SHARED ACROSS MODULES RESOLVES — it is not an unknown, and it
// is not attested away.
//
// MONEY-VIEW v2 (#207) gave the curated bidder projection ONE definition for
// three exits across two services to share, precisely so a second copy could
// not drift from the first. Under the old resolver — module-level consts, in
// THIS file only — each of those three reads became an UNKNOWN, and the only
// route past was an allowlist entry, which would have blinded this guard to
// the exact field set that dispatch existed to narrow. An oracle going quiet
// about the room it is pointed at is the failure this repo has paid for
// before.
//
// The pair below is the whole argument: WITHOUT the pre-pass the walker
// reports "unresolved" and does NOT see the chat the selector traverses into;
// WITH it, the walker resolves both levels and names `Message`. The extension
// does not make a finding go away — it turns a blind spot into a seen one.

const sharedViewRel = 'packages/server/src/services/shared-selector.view.ts';
const sharedSvcRel = 'packages/server/src/services/shared-selector.service.ts';
const readSharedFixture = (rel: string) =>
  fs.readFileSync(path.join(FIXTURES, path.basename(rel)), 'utf8');
const sharedFiles = [sharedViewRel, sharedSvcRel];

function sharedSelectorRow(withPrePass: boolean) {
  const exported = withPrePass
    ? collectExportedSelectors(readSharedFixture, sharedFiles)
    : undefined;
  return census({
    functions: sharedFiles.flatMap((rel) =>
      extractFromSource(rel, readSharedFixture(rel), schema, exported),
    ),
    files: sharedFiles,
    roots: ['packages/server/src'],
  }).find((r) => r.fn === 'getSharedSelectorThing');
}

test('a selector imported from another module resolves, nested levels and all', () => {
  const row = sharedSelectorRow(true);
  assert.ok(row, 'the read must be censused');
  assert.deepEqual(
    row!.unknowns,
    [],
    `a shared selector must resolve, not become an unknown: ${row!.unknowns.join(' | ')}`,
  );
  // And the resolution is REAL: the walker now sees through both levels
  // into the chat, which is what an allowlist entry would have hidden.
  assert.ok(
    row!.traversed.includes('Message'),
    `expected the walker to see through the shared selector: ${row!.traversed.join(', ')}`,
  );
});

test('without the pre-pass the same read is an UNKNOWN and the chat is unseen', () => {
  // The red half — the behaviour that produced three findings across two
  // services at #207, and the reason this is a resolver change rather than
  // an attestation.
  const row = sharedSelectorRow(false);
  assert.ok(row);
  assert.ok(
    row!.unknowns.some((u) => u.includes('SHARED_DETAIL_INCLUDE')),
    `expected the un-seeded resolver to report it unresolved: ${row!.unknowns.join(' | ')}`,
  );
  assert.equal(row!.traversed.includes('Message'), false);
});

test('a name exported TWICE with different values stays unresolved, not guessed', () => {
  // Ambiguity is an unknown. Resolving to whichever file was walked first
  // would be a guess, and a guess in an oracle is worse than a gap.
  const exported = collectExportedSelectors(
    (rel) =>
      rel === 'a.ts'
        ? 'export const DUPLICATED = { messages: true };'
        : 'export const DUPLICATED = { legs: true };',
    ['a.ts', 'b.ts'],
  );
  assert.equal(exported.has('DUPLICATED'), false);
});

test('a local const of the same name still wins over an imported one', () => {
  const exported = collectExportedSelectors(
    () => 'export const SHADOWED = { legs: true };',
    ['other.ts'],
  );
  const code = [
    "import { SHADOWED } from './other';",
    "import prisma from '../prisma';",
    'const SHADOWED = { messages: true };',
    'export async function readIt(id: string) {',
    '  return prisma.journey.findUnique({ where: { id }, include: SHADOWED });',
    '}',
  ].join('\n');
  const row = census({
    functions: extractFromSource(sharedSvcRel, code, schema, exported),
    files: [sharedSvcRel],
    roots: ['packages/server/src'],
  }).find((r) => r.fn === 'readIt');
  assert.ok(row, 'the read must be censused');
  assert.deepEqual(row!.unknowns, []);
  // The LOCAL declaration is the one that resolved: it reaches the chat,
  // the imported one would not have.
  assert.ok(row!.traversed.includes('Message'));
});
