// WIRE-AUDIT G5 — extractor behaviour against a fixture repo with a
// knowingly planted orphan route, a planted unreachable screen, a
// dynamically-built path (must land in UNRESOLVED), a dead file, a
// glued query-suffix call, and a broken nav target. Plus determinism
// against the real repo: two runs, byte-identical output.
//
// Run: pnpm wiring:test  (node:test via tsx)

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import {
  bestRouteMatch,
  buildWiringMap,
  DEFAULT_CONFIG,
  pathsMatch,
  tokenize,
  type AuditConfig,
} from '../extract';

const FIXTURE_CFG: AuditConfig = {
  root: path.join(__dirname, 'fixtures', 'fakerepo'),
  serverIndex: 'server/index.ts',
  clientSrc: 'client/src',
  appTsx: 'client/src/App.tsx',
  bottomNav: 'client/src/BottomNav.tsx',
  clientEntry: 'client/src/main.tsx',
};

const map = buildWiringMap(FIXTURE_CFG);
const endpoint = (method: string, p: string) =>
  map.analysis.endpointStatus.find((e) => e.method === method && e.path === p);
const route = (p: string) => map.analysis.routeStatus.find((r) => r.path === p);

test('server endpoints are enumerated through the mount, including multiline registrations', () => {
  assert.ok(endpoint('GET', '/api/things/list'));
  assert.ok(endpoint('POST', '/api/things/:id/update'), 'multiline router.post with param path');
  assert.ok(endpoint('GET', '/api/docs.json'), 'direct app.get registration');
  assert.equal(map.nonRouterMounts.length, 1, 'express.static mount is informational, not walked');
});

test('the planted orphan route is flagged; the called route is not', () => {
  assert.equal(endpoint('GET', '/api/things/orphan')?.status, 'orphan-candidate');
  assert.equal(endpoint('GET', '/api/things/list')?.status, 'called');
  assert.equal(endpoint('POST', '/api/things/:id/update')?.status, 'called', 'template call matches param route');
});

test('a dynamic router path lands in UNRESOLVED endpoints, not a guessed verdict', () => {
  assert.equal(map.unresolvedEndpoints.length, 1);
  assert.match(map.unresolvedEndpoints[0].snippet, /DYNAMIC_PATH/);
});

test('a dynamically-built client call lands in UNRESOLVED calls', () => {
  assert.equal(map.unresolvedCalls.length, 1);
  assert.match(map.unresolvedCalls[0].snippet, /buildPath\(\)/);
});

test('a glued query-suffix template still matches its endpoint', () => {
  const list = endpoint('GET', '/api/things/list')!;
  assert.equal(list.callers.length, 2, 'plain literal + `${query}`-suffixed template');
});

test('the planted unreachable screen is flagged; navigated screens are not', () => {
  assert.equal(route('/island')?.reachable, false);
  assert.equal(route('/reachable/:id')?.reachable, true, 'reached via template navigate from home');
  assert.equal(route('/')?.reachable, true, 'boot + bottomnav seed');
  assert.equal(route('*')?.reachable, true, 'catch-all is reachable by definition');
});

test('a call in a file nothing imports does not count as wiring', () => {
  assert.deepEqual(map.analysis.deadClientFiles, ['client/src/pages/DeadFile.tsx']);
  assert.equal(endpoint('GET', '/api/things/dead-only')?.status, 'called-from-dead-code-only');
});

test('a nav target matching no route is reported as a broken wire', () => {
  assert.deepEqual(
    map.analysis.unmatchedNavTargets.map((e) => e.target),
    ['/nowhere'],
  );
});

test('navigate(-1) is history navigation, not an unresolved target', () => {
  assert.equal(map.unresolvedNav.length, 0);
});

test('a literal route beats its earlier-declared param sibling (DEADWOOD G3)', () => {
  // /reachable/audit is declared AFTER /reachable/:id and its only
  // inbound edge is the literal navigate on HomePage. Taking the first
  // declared match credited that edge to the param route and called the
  // literal screen unreachable — a screen a user can in fact tap to.
  assert.equal(route('/reachable/audit')?.reachable, true);
  assert.deepEqual(route('/reachable/audit')?.reachedFrom, ['screen:/']);
  assert.equal(route('/reachable/:id')?.reachable, true, 'still reached by the template navigate');
  assert.equal(bestRouteMatch(map.routes, '/reachable/audit')?.path, '/reachable/audit');
  assert.equal(bestRouteMatch(map.routes, '/reachable/42')?.path, '/reachable/:id');
  assert.equal(bestRouteMatch(map.routes, '/nowhere'), undefined);
});

// ---------------------------------------------------------------------------
// LOOSE-ENDS G1.2/G2.3 — the silent-blanking hole (#170).
//
// A regex literal inside a template literal's ${...} expression used to
// desynchronise the tokenizer: skipTemplateExpr had no regex branch, so
// a quote INSIDE the regex started a string scan that ran past it, and
// everything after was blanked. Blanked text yields no endpoints, no
// calls and no UNRESOLVED — the map lost the rest of the file in total
// silence, which is the one failure the audit exists to prevent.
//
// The fixture assertion is the honest one: endpoints declared BELOW the
// shape must be in the map. The tokenize() cases below pin the
// mechanism itself, so a future refactor cannot re-open the hole while
// the fixture happens to stay green.
// ---------------------------------------------------------------------------

test('endpoints below a regex-inside-${...} shape survive the scan (#170)', () => {
  assert.ok(
    endpoint('GET', '/api/csv/after-regex-in-template'),
    'endpoint declared after the csvCell shape must not vanish',
  );
  assert.ok(
    endpoint('POST', '/api/csv/:id/export'),
    'param endpoint declared after the csvCell shape must not vanish',
  );
});

test('a desynchronising shape never blanks silently — the tail is still scannable', () => {
  // The exact #170 shape, followed by a marker the scan must still see.
  const code = 'const f = (s) => `"${s.replace(/"/g, \'""\')}"`;\nrouter.get(\'/tail\', h);\n';
  const tok = tokenize(code);
  assert.ok(tok.blanked.includes('router.get('), 'code after the shape is still visible');
  assert.ok(
    tok.literals.some((l) => l.value === '/tail'),
    "the literal '/tail' is collected, not swallowed by a runaway string scan",
  );
});

test('regex literals containing quotes and backticks are skipped, not entered', () => {
  const cases: Array<[string, string]> = [
    // [source, a literal value that must be collected from it]
    ['const a = /"/g; const p = \'/api/a\';', '/api/a'],
    ['const b = `${x.replace(/"/g, \'\')}`; const p = "/api/b";', '/api/b'],
    ['const c = `${x.replace(/`/g, \'\')}`; const p = "/api/c";', '/api/c'],
    ['const d = `${`${y.replace(/["\'`]/g, \'\')}`}`; const p = "/api/d";', '/api/d'],
    // A char class holding the delimiter: the skip must respect [ ].
    ['const e = `${x.replace(/[/"]/g, \'\')}`; const p = "/api/e";', '/api/e'],
  ];
  for (const [src, expected] of cases) {
    const tok = tokenize(src);
    assert.ok(
      tok.literals.some((l) => l.value === expected),
      `expected ${expected} to be collected from: ${src}`,
    );
  }
});

test('division inside a ${...} expression is still division, not a regex', () => {
  // If `/` after an identifier were treated as a regex opener, the scan
  // would swallow the rest of the line and lose the following literal.
  const tok = tokenize('const r = `${total / count}`; const p = "/api/rate";');
  assert.ok(tok.literals.some((l) => l.value === '/api/rate'));
});

test('pathsMatch semantics', () => {
  assert.ok(pathsMatch('/api/journeys/:id/bids', '/api/journeys/:param/bids'));
  assert.ok(pathsMatch('/api/admin/conflicts:param', '/api/admin/conflicts'), 'glued dynamic suffix prefix-matches');
  assert.ok(!pathsMatch('/api/a/b', '/api/a'));
  assert.ok(!pathsMatch('/api/a/b', '/api/a/c'));
});

test('fixture extraction is deterministic (same tree → same bytes)', () => {
  const again = buildWiringMap(FIXTURE_CFG);
  assert.equal(JSON.stringify(again), JSON.stringify(map));
});

test('real-repo extraction is deterministic (same tree → same bytes)', () => {
  const root = path.resolve(__dirname, '..', '..', '..');
  const first = JSON.stringify(buildWiringMap({ root, ...DEFAULT_CONFIG }));
  const second = JSON.stringify(buildWiringMap({ root, ...DEFAULT_CONFIG }));
  assert.equal(first, second);
});
