// I18N-TRUTH G6 — guard behaviour: green on a clean tree, red on planted
// drift (a string added without regenerating), red on a missing file, and
// specific about a hand edit. The last test is the load-bearing one: it
// proves the committed docs in THIS repo match what the generator emits,
// which is the claim the guard makes on every PR.

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { buildModel, renderWorkbook, type Stamp } from '../generate';
import { checkFile, firstDifference, runCheck } from '../check';
import { loadInputs, REPO_ROOT } from '../load';
import { loadSources } from '../sources';

const FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'fakerepo');
const FIXTURE_MANIFESTS = path.join(__dirname, 'fixtures', 'manifests');
const STAMP: Stamp = { commit: 'abc1234', date: '2026-01-02' };

const fixture = loadInputs(FIXTURE_ROOT, FIXTURE_MANIFESTS);
const committed = renderWorkbook(fixture.model, STAMP, fixture.notes);

test('guard passes when the committed file is what the generator emits', () => {
  const result = checkFile('docs/fixture.md', committed, committed);
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
});

test('guard fails when a key was added without regenerating', () => {
  // Exactly the PR shape the guard exists to catch: a new UI string lands
  // in the locale files, the workbook is left as it was.
  const sources = loadSources(FIXTURE_ROOT);
  sources.locales.en['journey.newlyAdded'] = 'Newly added string';
  sources.locales.fr['journey.newlyAdded'] = 'Nouvelle chaîne ajoutée';
  sources.locales.rw['journey.newlyAdded'] = 'Ijambo ryongewemo';
  const drifted = buildModel(sources, fixture.notes, fixture.classification, fixture.baseline);

  const expected = renderWorkbook(drifted, STAMP, fixture.notes);
  const result = checkFile('docs/fixture.md', expected, committed);

  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /out of date/);
  assert.match(result.errors[0], /pnpm i18n:review/);
});

test('guard fails when the generated file is missing entirely', () => {
  const result = checkFile('docs/fixture.md', committed, null);
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /is missing/);
});

test('guard names a hand edit when only the stamp differs', () => {
  const handEdited = committed.replace('2026-01-02 at commit `abc1234`', '2026-05-05 at commit `deadbee`');
  const result = checkFile('docs/fixture.md', committed, handEdited);
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /hand-edited/);
});

test('the failure message points at the first differing line', () => {
  const detail = firstDifference('alpha\nbravo\ncharlie\n', 'alpha\nBRAVO\ncharlie\n');
  assert.match(detail, /line 2/);
  assert.match(detail, /"bravo"/);
  assert.match(detail, /"BRAVO"/);
});

test('the committed docs in this repo are green', () => {
  const live = loadInputs();
  const result = runCheck(REPO_ROOT, live.model, live.notes, { commit: 'pending', date: '0000-00-00' });
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
});
