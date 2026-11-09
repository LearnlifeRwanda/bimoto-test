// Behaviour tests for the pin guard, both directions: the repo as it
// stands must PASS, and each drift the guard exists to catch — planted
// one at a time on top of that same passing state — must FAIL with the
// message that names it.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as path from 'node:path';
import {
  dockerNodeTags,
  parseExact,
  readInputs,
  runCheck,
  satisfies,
  tagMajor,
  type PinInputs,
} from '../check';

const ROOT = path.resolve(__dirname, '..', '..', '..');

/** The real repo, deep-copied so a planted drift cannot leak between tests. */
function baseline(): PinInputs {
  return JSON.parse(JSON.stringify(readInputs(ROOT))) as PinInputs;
}

function fails(inputs: PinInputs, needle: string) {
  const r = runCheck(inputs);
  assert.equal(r.ok, false, `expected a failure mentioning ${needle}, got a pass`);
  assert.ok(
    r.errors.some((e) => e.includes(needle)),
    `expected an error containing ${JSON.stringify(needle)}, got:\n${r.errors.join('\n')}`,
  );
}

// ---------------------------------------------------------------- unit

test('parseExact takes X.Y.Z and refuses ranges', () => {
  assert.deepEqual(parseExact('22.23.2'), { major: 22, minor: 23, patch: 2 });
  assert.deepEqual(parseExact(' v22.23.2\n'), { major: 22, minor: 23, patch: 2 });
  assert.equal(parseExact('22'), null);
  assert.equal(parseExact('22.23'), null);
  assert.equal(parseExact('>=22.9.0'), null);
  assert.equal(parseExact('lts/*'), null);
});

test('satisfies evaluates the bounded comparator form, and only that form', () => {
  const v = { major: 22, minor: 23, patch: 2 };
  assert.equal(satisfies('>=22.9.0 <23', v), true);
  assert.equal(satisfies('>=22.9.0', { major: 23, minor: 0, patch: 0 }), true); // the defect
  assert.equal(satisfies('>=22.9.0 <23', { major: 23, minor: 0, patch: 0 }), false);
  assert.equal(satisfies('>=23.0.0 <24', v), false);
  // Refused, not guessed at: an unprovable range must not read as bounded.
  assert.equal(satisfies('^22.9.0', v), null);
  assert.equal(satisfies('22.x', v), null);
  assert.equal(satisfies('>=22.9.0 || >=24', v), null);
});

test('dockerNodeTags finds every stage; tagMajor reads the leading major', () => {
  const tags = dockerNodeTags('FROM node:22-bookworm-slim AS builder\nRUN x\nFROM node:22-bookworm-slim\n');
  assert.deepEqual(tags, [
    { line: 1, tag: '22-bookworm-slim' },
    { line: 3, tag: '22-bookworm-slim' },
  ]);
  assert.equal(tagMajor('22-bookworm-slim'), 22);
  assert.equal(tagMajor('22.23.2-slim'), 22);
  assert.equal(tagMajor('lts-slim'), null);
});

// ------------------------------------------------- the repo as it stands

test('the repository at HEAD passes every assertion', () => {
  const r = runCheck(baseline());
  assert.equal(r.ok, true, `pins:check failed on the real repo:\n${r.errors.join('\n')}`);
  assert.equal(r.checked.length, 5, `expected all five assertions to report: ${r.checked.join(' | ')}`);
});

// ------------------------------------------------------- planted drift

test('a .nvmrc holding a major instead of an exact version fails', () => {
  const i = baseline();
  i.nvmrc = '22\n';
  fails(i, 'must hold ONE exact Node version');
});

test('a .nvmrc holding lts/* fails — it resolves to newest available', () => {
  const i = baseline();
  i.nvmrc = 'lts/*\n';
  fails(i, 'must hold ONE exact Node version');
});

test('a Dockerfile stage on another major fails', () => {
  const i = baseline();
  i.dockerfile = i.dockerfile.replace('FROM node:22-bookworm-slim\n', 'FROM node:24-bookworm-slim\n');
  fails(i, 'NODE PIN DRIFT');
});

test('a Dockerfile with only one node stage fails', () => {
  const i = baseline();
  i.dockerfile = i.dockerfile.replace(/^FROM node:\S+ AS builder.*$/m, 'FROM scratch AS builder');
  fails(i, "'FROM node:...' stage(s)");
});

test('the original open-ended engines.node fails — a floor with no ceiling', () => {
  const i = baseline();
  i.manifests[0].enginesNode = '>=22.9.0';
  fails(i, 'UNBOUNDED ENGINES');
});

test('an engines.node that excludes the pin fails', () => {
  const i = baseline();
  i.manifests[0].enginesNode = '>=24.0.0 <25';
  fails(i, 'excludes the pinned Node');
});

test('a caret engines.node fails — this guard will not guess at a bound', () => {
  const i = baseline();
  i.manifests[0].enginesNode = '^22.9.0';
  fails(i, 'not a plain comparator range');
});

test('a workflow that hardcodes node-version fails', () => {
  const i = baseline();
  i.workflows[0].text = i.workflows[0].text.replace(
    /node-version-file: \.nvmrc/,
    'node-version: 24',
  );
  fails(i, 'INLINE NODE PIN');
});

test('node-version-file pointed at package.json fails — §K-4s trap', () => {
  const i = baseline();
  i.workflows[0].text = i.workflows[0].text.replace(
    /node-version-file: \.nvmrc/,
    'node-version-file: package.json',
  );
  fails(i, 'resolves as a range, not a pin');
});

test('a setup-node step that reads no version file at all fails', () => {
  const i = baseline();
  i.workflows[0].text = i.workflows[0].text.replace(/^\s*node-version-file: \.nvmrc\s*$/gm, '');
  fails(i, `never reads .nvmrc`);
});

test('an unset packageManager fails', () => {
  const i = baseline();
  for (const m of i.manifests) delete m.packageManager;
  fails(i, "no manifest declares 'packageManager'");
});

test('a packageManager that drifts from the workflows pnpm pin fails', () => {
  const i = baseline();
  i.manifests[0].packageManager = 'pnpm@10.0.0';
  fails(i, 'PNPM PIN DRIFT');
});

test('a ranged packageManager fails', () => {
  const i = baseline();
  i.manifests[0].packageManager = 'pnpm@^9.15.0';
  fails(i, "not an exact 'pnpm@X.Y.Z'");
});
