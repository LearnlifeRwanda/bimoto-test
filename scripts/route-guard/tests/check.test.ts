// AUTH-READ G4 — guard behaviour, both directions.
//
// The ratchet is only worth its CI minute if it fails on the thing it was
// built for and passes on the thing it was told to accept. Both are
// asserted here, plus the two ways an allowlist entry goes stale.

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildRouteMap, extractRoutesFromSource, DEFAULT_CONFIG } from '../extract';
import { runCheck, loadAllowlist, routeKey, type AllowlistEntry } from '../check';

const FIXTURES = path.join(__dirname, 'fixtures');
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

function fixture(name: string) {
  const rel = `packages/server/src/routes/${name}`;
  return extractRoutesFromSource(rel, fs.readFileSync(path.join(FIXTURES, name), 'utf8')).routes;
}

const chat = fixture('chat.routes.ts');
const inline = fixture('inline.routes.ts');
const open = fixture('public.routes.ts');

// ---------------------------------------------------------------- direction 1
// A planted unguarded read-sibling FAILS.

test('a planted unguarded read-sibling fails the guard', () => {
  const res = runCheck(chat, []);
  assert.equal(res.ok, false);
  assert.equal(res.errors.length, 1);
  assert.match(res.errors[0], /unguarded read sibling/);
  assert.match(res.errors[0], /GET \/:id\/messages/);
  // The message must name the sibling that proves the check was available,
  // not merely assert a rule.
  assert.match(res.errors[0], /write sibling POST \/:id\/messages/);
});

test('the unguarded read is condemned on evidence the walker can actually see', () => {
  const read = chat.find((r) => r.method === 'GET')!;
  const write = chat.find((r) => r.method === 'POST')!;
  // Not "the service is unsafe" — the walker cannot know that. The claim
  // is narrower and decidable: this handler never says who is asking.
  assert.equal(read.usesCaller, false);
  assert.equal(read.posture, 'none');
  assert.equal(write.usesCaller, true);
  assert.equal(write.posture, 'delegated');
});

// ---------------------------------------------------------------- direction 2
// The seeded allowlist passes — against the REAL repo at HEAD, not a fixture.

test('the committed allowlist keeps the guard green on the real repo', () => {
  const map = buildRouteMap({ root: REPO_ROOT, ...DEFAULT_CONFIG });
  const allowlist = loadAllowlist(path.join(__dirname, '..', 'allowlist.json'));
  const res = runCheck(map.routes, allowlist);
  assert.deepEqual(res.errors, []);
  assert.equal(res.ok, true);
});

test('every committed entry names the function that carries the delegated check', () => {
  const allowlist = loadAllowlist(path.join(__dirname, '..', 'allowlist.json'));
  assert.ok(allowlist.length > 0);
  for (const entry of allowlist) {
    assert.ok(entry.reason.trim().length > 0, `${entry.key} has no reason`);
    assert.ok(
      entry.delegatesTo && entry.delegatesTo.trim().length > 0,
      `${entry.key} does not name the service function carrying its check`,
    );
  }
});

test('the real repo has no unguarded read sibling left', () => {
  const map = buildRouteMap({ root: REPO_ROOT, ...DEFAULT_CONFIG });
  const unguarded = runCheck(map.routes, []).errors.filter((e) =>
    e.includes('unguarded read sibling'),
  );
  assert.deepEqual(unguarded, [], `still unguarded:\n${unguarded.join('\n')}`);
});

// ------------------------------------------------------------------- staleness

test('a stale entry for a route that no longer exists fails', () => {
  const entry: AllowlistEntry = {
    key: 'GET /:id/ghost in packages/server/src/routes/chat.routes.ts',
    delegatesTo: 'ghostService.read',
    reason: 'route was renamed away under this entry',
  };
  const res = runCheck(chat, [entry]);
  assert.equal(res.ok, false);
  const stale = res.errors.filter((e) => e.includes('STALE'));
  assert.equal(stale.length, 1);
  assert.match(stale[0], /no such route/);
});

test('an entry survives only while the route still delegates where it says', () => {
  // The read now enforces ownership inline, so nothing is being attested
  // any more — the entry is an unexamined claim and must come out.
  const entry: AllowlistEntry = {
    key: routeKey(inline.find((r) => r.method === 'GET')!),
    delegatesTo: 'etaService.get',
    reason: 'stale: this read checks ownership in the handler now',
  };
  const res = runCheck(inline, [entry]);
  assert.equal(res.ok, false);
  assert.match(res.errors.join('\n'), /STALE/);
  assert.match(res.errors.join('\n'), /enforces ownership inline/);
});

test('an entry that names the wrong callee fails even while the route needs one', () => {
  const read = chat.find((r) => r.method === 'GET')!;
  // Make the read delegate, as the real fix did, then attest the wrong function.
  const delegating = { ...read, posture: 'delegated' as const, usesCaller: true, delegatesTo: ['messageService.getMessages'] };
  const res = runCheck([delegating, chat.find((r) => r.method === 'POST')!], [
    { key: routeKey(read), delegatesTo: 'someOtherService.read', reason: 'points at the wrong function' },
  ]);
  assert.equal(res.ok, false);
  assert.match(res.errors.join('\n'), /STALE allowlist entry/);
  assert.match(res.errors.join('\n'), /messageService\.getMessages/);
});

test('an entry with no reason fails', () => {
  const res = runCheck(chat, [
    { key: routeKey(chat.find((r) => r.method === 'GET')!), reason: '  ' },
  ]);
  assert.equal(res.ok, false);
  assert.match(res.errors.join('\n'), /has no reason/);
});

// ------------------------------------------------------------- no false alarms

test('a read that enforces ownership inline needs no entry', () => {
  const res = runCheck(inline, []);
  assert.deepEqual(res.errors, []);
  assert.deepEqual(res.findings, []);
  assert.equal(inline.find((r) => r.method === 'GET')!.posture, 'inline');
});

test('rule 1 stays silent when the write sibling guards nothing either', () => {
  const res = runCheck(open, []);
  assert.deepEqual(res.errors, []);
  assert.deepEqual(res.findings, []);
});

test('rule 1 does not treat different paths in one file as siblings', () => {
  // The guarded write from the chat fixture beside an unrelated open read.
  const mixed = [chat.find((r) => r.method === 'POST')!, ...open.filter((r) => r.method === 'GET')];
  const res = runCheck(mixed, []);
  assert.deepEqual(res.errors, []);
});
