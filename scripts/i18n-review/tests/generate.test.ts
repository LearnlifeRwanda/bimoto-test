// I18N-TRUTH G6 — generator behaviour against a fixture repo: grouping,
// ordering, determinism, NEW-marking, identical-row categorisation, stub
// detection, stamp stability, and the fact that human prose from
// notes.json reaches the output. The fixture is deliberately tiny so a
// failure points at a rule rather than at 1088 rows of noise.

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { loadSources, parseLandmarks, parseQuickMessages, flatten } from '../sources';
import * as fs from 'node:fs';
import {
  buildModel,
  cell,
  readStamp,
  renderQueue,
  renderStable,
  renderWorkbook,
  stripStamp,
  type Stamp,
} from '../generate';
import { loadInputs } from '../load';

const FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'fakerepo');
const FIXTURE_MANIFESTS = path.join(__dirname, 'fixtures', 'manifests');
const STAMP: Stamp = { commit: 'abc1234', date: '2026-01-02' };

const fixture = loadInputs(FIXTURE_ROOT, FIXTURE_MANIFESTS);
const model = fixture.model;
const rowFor = (key: string) => model.rows.find((r) => r.key === key)!;

// ------------------------------------------------------------- grouping

test('rows are grouped by top-level namespace', () => {
  assert.deepEqual(
    model.groups.map((g) => g.namespace),
    ['app', 'errors', 'journey', 'welcome'],
  );
  assert.deepEqual(
    model.groups.find((g) => g.namespace === 'app')!.rows.map((r) => r.key),
    ['app.name', 'app.tagline'],
  );
});

test('namespaces and keys sort by code point, not by source order', () => {
  // The fixture en file lists `welcome` first and `app` second; the model
  // must not inherit that, or the workbook would churn whenever someone
  // reorders the JSON.
  const enOrder = Object.keys(flatten(JSON.parse(fs.readFileSync(path.join(FIXTURE_ROOT, 'packages/client/public/locales/en/translation.json'), 'utf8'))));
  assert.equal(enOrder[0], 'welcome.languageRw');
  assert.equal(model.rows[0].key, 'app.name');
  assert.deepEqual([...model.rows.map((r) => r.key)], [...model.rows.map((r) => r.key)].sort());
});

test('a namespace inherits its own note and any subtree notes', () => {
  const journey = model.groups.find((g) => g.namespace === 'journey')!;
  assert.match(journey.note, /Fixture namespace note/);
  const errors = model.groups.find((g) => g.namespace === 'errors')!;
  assert.match(errors.note, /`errors\.invalid\.\*` — Fixture subtree note\./);
});

// ---------------------------------------------------------- determinism

test('building the model twice yields identical rendered bytes', () => {
  const a = renderWorkbook(buildModel(loadSources(FIXTURE_ROOT), fixture.notes, fixture.classification, fixture.baseline), STAMP, fixture.notes);
  const b = renderWorkbook(buildModel(loadSources(FIXTURE_ROOT), fixture.notes, fixture.classification, fixture.baseline), STAMP, fixture.notes);
  assert.equal(a, b);
  assert.equal(renderQueue(model, STAMP, fixture.notes), renderQueue(model, STAMP, fixture.notes));
});

test('the sources digest is stable across loads and moves when a source changes', () => {
  const again = buildModel(loadSources(FIXTURE_ROOT), fixture.notes, fixture.classification, fixture.baseline);
  assert.equal(again.digest, model.digest);

  const sources = loadSources(FIXTURE_ROOT);
  sources.rawBytes['packages/client/public/locales/en/translation.json'] += ' ';
  const changed = buildModel(sources, fixture.notes, fixture.classification, fixture.baseline);
  assert.notEqual(changed.digest, model.digest);
});

// ---------------------------------------------------------- NEW marking

test('a key absent from the baseline is NEW; a key present in it is not', () => {
  assert.equal(rowFor('errors.fresh').isNew, true);
  assert.equal(rowFor('app.name').isNew, false);
  assert.deepEqual(model.newRows.map((r) => r.key), ['errors.fresh']);
});

test('NEW rows reach both the workbook and the queue', () => {
  assert.match(renderWorkbook(model, STAMP, fixture.notes), /\| `errors\.fresh` \| \*\*NEW\*\* \|/);
  assert.match(renderQueue(model, STAMP, fixture.notes), /New since the review baseline `fixture` \(1\)/);
});

// ------------------------------------------- identical-row categorisation

test('identical rw values are categorised, and only where a rule is unambiguous', () => {
  assert.equal(rowFor('app.name').sameAsEn, 'brand');
  assert.equal(rowFor('welcome.languageRw').sameAsEn, 'proper-noun');
  assert.equal(rowFor('journey.distance').sameAsEn, 'placeholder');
  assert.equal(rowFor('journey.moto').sameAsEn, 'needs-decision');
});

test('a translated row carries no same-as-EN flag', () => {
  assert.equal(rowFor('app.tagline').sameAsEn, null);
  assert.equal(rowFor('errors.fresh').sameAsEn, null);
});

test('needs-decision rows are surfaced in the queue as an open question', () => {
  const queue = renderQueue(model, STAMP, fixture.notes);
  assert.match(queue, /reason undecided \(1\)/);
  assert.match(queue, /\| `journey\.moto` \| Moto \|/);
});

test('a marker value is flagged STUB', () => {
  assert.equal(rowFor('errors.invalid').isStub, true);
  assert.equal(rowFor('errors.fresh').isStub, false);
  assert.deepEqual(model.stubRows.map((r) => r.key), ['errors.invalid']);
});

// -------------------------------------------------------- human content

test('notes.json prose reaches the generated workbook', () => {
  const md = renderWorkbook(model, STAMP, fixture.notes);
  assert.match(md, /Fixture key note for the vehicle word\./);
  assert.match(md, /Fixture namespace note for `journey`\./);
  assert.match(md, /Preserved human prose that must survive regeneration\./);
  assert.match(md, /\*\*Brevity matters\*\*/);
});

test('queue flags are re-emitted with LIVE locale values, and dead flags are reported', () => {
  const queue = renderQueue(model, STAMP, fixture.notes);
  assert.match(queue, /\| `app\.tagline` \| Your ride, your price \| Urugendo rwawe, igiciro cyawe \| fixture PR #1 \|/);
  assert.match(queue, /`gone\.key`.*Remove them from/s);
  assert.doesNotMatch(queue, /\| `gone\.key` \| /);
});

// ------------------------------------------------------- cell escaping

test('pipes and newlines cannot break a table cell', () => {
  assert.equal(cell('left | right'), 'left \\| right');
  assert.equal(cell('first\nsecond'), 'first<br>second');
  const md = renderWorkbook(model, STAMP, fixture.notes);
  assert.match(md, /left \\\| right/);
  assert.match(md, /first line<br>second line/);
  // The full namespace tables have 7 columns, so 8 delimiters. A value
  // carrying a raw pipe would silently shift every column after it.
  for (const key of ['journey.legend', 'journey.multiline']) {
    const row = md.split('\n').find((l) => l.startsWith(`| \`${key}\` |`))!;
    assert.ok(row, `no table row for ${key}`);
    assert.equal(row.replace(/\\\|/g, '').split('|').length - 1, 8, `row has stray pipes: ${row}`);
  }
});

// ---------------------------------------------------- header truthfulness

test('the header states the counts it actually audited', () => {
  const md = renderWorkbook(model, STAMP, fixture.notes);
  assert.match(md, /\| English keys \| 9 \|/);
  assert.match(md, /\| French keys \| 9 \|/);
  assert.match(md, /\| Kinyarwanda keys \| 9 \|/);
  assert.match(md, /\| Namespaces \| 4 \|/);
  assert.match(md, /\| Canned chat phrases \(`QUICK_MESSAGES`\) \| 3 \|/);
  assert.match(md, /\| Generator last run \| 2026-01-02 at commit `abc1234` \|/);
  assert.match(md, new RegExp(`\\| Sources digest \\| \`${model.digest}\` \\|`));
});

// -------------------------------------------------------- stamp stability

test('an unchanged body keeps the previous stamp, so bytes do not move', () => {
  const render = (s: Stamp) => renderWorkbook(model, s, fixture.notes);
  const committed = render(STAMP);
  const regenerated = renderStable(render, { commit: 'zzz9999', date: '2026-12-31' }, committed);
  assert.equal(regenerated, committed);
  assert.deepEqual(readStamp(regenerated), STAMP);
});

test('a changed body takes the fresh stamp', () => {
  const render = (s: Stamp) => renderWorkbook(model, s, fixture.notes);
  const stale = render(STAMP).replace('Brand new string', 'Older wording');
  const fresh: Stamp = { commit: 'zzz9999', date: '2026-12-31' };
  assert.deepEqual(readStamp(renderStable(render, fresh, stale)), fresh);
});

test('stripStamp ignores only the stamp line', () => {
  const a = renderWorkbook(model, { commit: 'aaa1111', date: '2026-01-01' }, fixture.notes);
  const b = renderWorkbook(model, { commit: 'bbb2222', date: '2026-02-02' }, fixture.notes);
  assert.notEqual(a, b);
  assert.equal(stripStamp(a), stripStamp(b));
});

// ------------------------------------------------------------- parsing

test('constants parsing survives apostrophes and braces inside comments', () => {
  const qm = parseQuickMessages(
    fs.readFileSync(path.join(FIXTURE_ROOT, 'packages/shared/src/constants/quick-messages.ts'), 'utf8'),
  );
  assert.deepEqual(qm.map((m) => m.id), ['qm_on_my_way', 'qm_arrived', 'qm_thank_you']);
  assert.equal(qm[0].fr, "J'arrive");
  assert.equal(qm[1].rw, 'Nagezeho');

  const lm = parseLandmarks(
    fs.readFileSync(path.join(FIXTURE_ROOT, 'packages/shared/src/constants/locations.ts'), 'utf8'),
  );
  assert.deepEqual(lm.map((l) => l.name), ['Nyabugogo Bus Station', 'Kimironko Market']);
  assert.equal(lm[1].nameRw, 'Isoko rya Kimironko');
});

test('a quick message parsed without text is an error, not a blank row', () => {
  assert.throws(
    () => parseQuickMessages("export const QUICK_MESSAGES: QuickMessage[] = [\n  { id: 'qm_x', forRole: 'BOTH' },\n];"),
    /parsed with no text/,
  );
});

// -------------------------------------------------------- the real repo

test('the real repo generates a workbook whose header matches the live locales', () => {
  const live = loadInputs();
  assert.equal(live.model.counts.en, live.model.counts.fr);
  assert.equal(live.model.counts.en, live.model.counts.rw);
  assert.deepEqual(live.model.missingRw, []);
  assert.deepEqual(live.model.missingFr, []);
  assert.deepEqual(live.model.extraRw, []);
  const md = renderWorkbook(live.model, STAMP, live.notes);
  assert.match(md, new RegExp(`\\| English keys \\| ${live.model.counts.en} \\|`));
  assert.match(md, new RegExp(`\\| Kinyarwanda keys \\| ${live.model.counts.rw} \\|`));
  assert.equal(live.model.groups.length, new Set(live.model.rows.map((r) => r.namespace)).size);
});
