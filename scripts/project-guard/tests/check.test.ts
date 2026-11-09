// Behaviour tests for the project guard, both directions: the shapes that
// must PASS, and every way the rule can be broken, which must FAIL.
//
// runCheck is pure — it takes the file list, the covered list and the
// allowlist — so these are deterministic and need no compiler. The live
// tree is what `pnpm projects:check` gates in CI.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as path from 'node:path';
import * as fs from 'node:fs';
import {
  covers,
  listRepoFiles,
  loadAllowlist,
  parseTypecheckScript,
  runCheck,
  type AllowEntry,
} from '../check';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const ALLOWLIST = path.join(ROOT, 'scripts', 'project-guard', 'allowlist.json');

const entry = (p: string, reason = 'a stated reason'): AllowEntry => ({ path: p, reason });

/* ------------------------------------------------ the rule, both ways ---- */

test('a tree with every file covered passes', () => {
  const files = ['packages/server/src/index.ts', 'packages/client/src/App.tsx'];
  const r = runCheck(files, files, []);
  assert.equal(r.ok, true, r.errors.join('\n'));
  assert.deepEqual(r.orphans, []);
  assert.equal(r.coveredCount, 2);
});

test('an uncovered file FAILS as an orphan', () => {
  const r = runCheck(
    ['packages/server/src/index.ts', 'scripts/stray/tool.ts'],
    ['packages/server/src/index.ts'],
    [],
  );
  assert.equal(r.ok, false);
  assert.deepEqual(r.orphans, ['scripts/stray/tool.ts']);
  assert.match(r.errors.join('\n'), /ORPHAN: scripts\/stray\/tool\.ts/);
});

test('this is the guard that would have caught scripts/livewire the day it landed', () => {
  const r = runCheck(
    ['packages/server/src/index.ts', 'scripts/livewire/measure.ts'],
    ['packages/server/src/index.ts'],
    [],
  );
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /ORPHAN: scripts\/livewire\/measure\.ts/);
});

test('an orphan with an allowlist entry passes, and is reported as allowed', () => {
  const r = runCheck(
    ['packages/server/src/index.ts', 'scripts/stray/tool.ts'],
    ['packages/server/src/index.ts'],
    [entry('scripts/stray')],
  );
  assert.equal(r.ok, true, r.errors.join('\n'));
  assert.deepEqual(r.allowed, ['scripts/stray/tool.ts']);
});

test('a directory entry covers every orphan beneath it, and only beneath it', () => {
  assert.equal(covers('scripts/stray', 'scripts/stray/tool.ts'), true);
  assert.equal(covers('scripts/stray/', 'scripts/stray/deep/tool.ts'), true);
  assert.equal(covers('scripts/stray', 'scripts/stray'), true);
  assert.equal(covers('scripts/stray', 'scripts/straying/tool.ts'), false);
  assert.equal(covers('scripts/stray', 'scripts/other/tool.ts'), false);
});

/* --------------------------------------------------------- staleness ---- */

test('an entry matching no orphan FAILS as stale (the #183 rule)', () => {
  const files = ['packages/server/src/index.ts'];
  const r = runCheck(files, files, [entry('scripts/gone', 'it used to be orphaned')]);
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /STALE allowlist entry 'scripts\/gone'/);
  assert.match(r.errors.join('\n'), /it used to be orphaned/);
});

test('bringing an allowlisted file under a project turns the entry stale — deleting it is the fix', () => {
  const files = ['packages/client/capacitor.config.ts'];
  const held = runCheck(files, [], [entry('packages/client/capacitor.config.ts')]);
  assert.equal(held.ok, true, held.errors.join('\n'));
  const brought = runCheck(files, files, [entry('packages/client/capacitor.config.ts')]);
  assert.equal(brought.ok, false);
  assert.match(brought.errors.join('\n'), /STALE/);
  assert.equal(runCheck(files, files, []).ok, true);
});

/* ------------------------------------------------------ entry hygiene --- */

test('an entry with no reason FAILS', () => {
  const r = runCheck(['a/b.ts'], [], [{ path: 'a/b.ts', reason: '   ' }]);
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /has no reason/);
});

test('an entry with no path FAILS', () => {
  const r = runCheck(['a/b.ts'], [], [{ path: '', reason: 'because' }, entry('a/b.ts')]);
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /allowlist entry with no path/);
});

test('a duplicate entry warns but does not fail', () => {
  const r = runCheck(['a/b.ts'], [], [entry('a'), entry('a')]);
  assert.equal(r.ok, true, r.errors.join('\n'));
  assert.match(r.warnings.join('\n'), /duplicate allowlist entry for a/);
});

/* ------------------------------------------ the project list is derived -- */

const DIRS: Record<string, string> = {
  '@bimoto/server': 'packages/server',
  '@bimoto/client': 'packages/client',
  '@bimoto/shared': 'packages/shared',
  '@bimoto/e2e': 'packages/e2e',
};
const resolve = (f: string) => DIRS[f] ?? null;

test('every segment shape in the real typecheck script parses', () => {
  const script = (
    JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    }
  ).scripts.typecheck;
  const { projects, errors } = parseTypecheckScript(script, resolve);
  assert.deepEqual(errors, [], errors.join('\n'));
  assert.equal(projects.length, script.split('&&').length);
  // the two projects this wave added, and the default-tsconfig form
  assert.ok(projects.some((p) => p.cwd === 'packages/client' && p.project === 'tsconfig.root.json'));
  assert.ok(projects.some((p) => p.cwd === 'packages/shared' && p.project === 'tsconfig.test.json'));
  assert.ok(projects.some((p) => p.cwd === 'packages/server' && p.project === null));
  assert.ok(projects.some((p) => p.cwd === '.' && p.project === 'scripts/project-guard'));
});

test('an unreadable segment FAILS rather than silently shrinking coverage', () => {
  const { errors } = parseTypecheckScript('pnpm exec tsc --build --verbose', resolve);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /cannot read this segment/);
});

test('a parse error reaches the result, so an unparsed project can never read as green', () => {
  const files = ['a/b.ts'];
  const { errors } = parseTypecheckScript('some other command', resolve);
  const r = runCheck(files, files, [], errors);
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /cannot read this segment/);
});

test('a workspace filter naming no package in the tree FAILS', () => {
  const { errors } = parseTypecheckScript('pnpm --filter @bimoto/ghost exec tsc --noEmit', resolve);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /not a package in the tree/);
});

/* ------------------------------------------------ the committed data ----- */

test('the committed allowlist is well-formed: every entry has a path and a real reason', () => {
  const allow = loadAllowlist(ALLOWLIST);
  assert.ok(allow.length > 0);
  for (const e of allow) {
    assert.equal(typeof e.path, 'string');
    assert.notEqual(e.path.trim(), '');
    assert.ok(e.reason.trim().length > 40, `entry '${e.path}' needs a real reason, not a label`);
  }
});

test('every allowlisted path still exists in the tree', () => {
  for (const e of loadAllowlist(ALLOWLIST)) {
    assert.ok(fs.existsSync(path.join(ROOT, e.path)), `allowlisted path is gone: ${e.path}`);
  }
});

/* ------------------------------------------------- the .mjs surface ----- */

// VALIDATE-MEND G5 / FT B6 — .mjs used to be invisible to this guard.
// The rule it is now under is the SAME rule, both ways: an unaccounted
// .mjs fails as an orphan, a seeded one passes, and a seeded one that
// stops describing anything fails as stale.

test('a NEW .mjs with no entry FAILS as an orphan — the point of the whole extension', () => {
  const r = runCheck(
    ['packages/server/src/index.ts', 'scripts/new-tool.mjs'],
    ['packages/server/src/index.ts'],
    [],
  );
  assert.equal(r.ok, false);
  assert.deepEqual(r.orphans, ['scripts/new-tool.mjs']);
  assert.match(r.errors.join('\n'), /ORPHAN: scripts\/new-tool\.mjs/);
});

test('a seeded .mjs passes, and is reported as allowed', () => {
  const r = runCheck(
    ['packages/server/src/index.ts', 'scripts/build-landmarks.mjs'],
    ['packages/server/src/index.ts'],
    [entry('scripts/build-landmarks.mjs', 'conversion candidate, produces shipped data')],
  );
  assert.equal(r.ok, true, r.errors.join('\n'));
  assert.deepEqual(r.allowed, ['scripts/build-landmarks.mjs']);
});

test('a .mjs entry that no longer matches anything FAILS as stale (the #183 rule)', () => {
  // The good outcome of a conversion: build-landmarks.mjs becomes
  // build-landmarks.ts, comes under a project, and its entry must go.
  const r = runCheck(
    ['packages/server/src/index.ts', 'scripts/build-landmarks.ts'],
    ['packages/server/src/index.ts', 'scripts/build-landmarks.ts'],
    [entry('scripts/build-landmarks.mjs', 'conversion candidate, produces shipped data')],
  );
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /STALE allowlist entry 'scripts\/build-landmarks\.mjs'/);
});

test('the walker actually picks .mjs up out of the real tree', () => {
  // The rule above is worth nothing if the file list never contains one.
  const files = listRepoFiles(ROOT);
  const mjs = files.filter((f) => f.endsWith('.mjs'));
  assert.ok(mjs.length > 0, 'listRepoFiles found no .mjs — the glob is not doing its job');
  assert.ok(mjs.includes('scripts/build-landmarks.mjs'));
  // And has not stopped picking up what it always did.
  assert.ok(files.some((f) => f.endsWith('.ts')));
  assert.ok(files.some((f) => f.endsWith('.tsx')));
});

test('every .mjs in the tree is accounted for by a seeded entry', () => {
  // The live-tree assertion. `pnpm projects:check` gates this in CI too;
  // stating it here means the seed is proved by the unit suite as well.
  const allow = loadAllowlist(ALLOWLIST);
  for (const f of listRepoFiles(ROOT).filter((x) => x.endsWith('.mjs'))) {
    assert.ok(
      allow.some((a) => covers(a.path, f)),
      `.mjs with no allowlist entry: ${f}`,
    );
  }
});
