// I18N-TRUTH G1 — regenerate the Kinyarwanda review workbook and the
// native-review queue with one command:
//
//   pnpm i18n:review              rewrite both files from the locale files
//   pnpm i18n:review:baseline     move the NEW-marking baseline to today
//
// Both docs are rewritten WHOLE. Nothing is appended, no sibling addendum
// file is emitted, and running the command twice produces identical bytes
// (see renderStable in generate.ts for how the date/commit stamp stays
// deterministic). Human prose lives in notes.json, not in the output.

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { QUEUE_PATH, WORKBOOK_PATH, renderQueue, renderStable, renderWorkbook, type Stamp } from './generate';
import { REPO_ROOT, loadInputs, readIfPresent } from './load';

function currentStamp(root: string): Stamp {
  let commit = 'unknown';
  try {
    commit = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    // A tarball export or a shallow image has no git. The sources digest
    // is the load-bearing freshness signal; the commit is a convenience.
  }
  return { commit, date: new Date().toISOString().slice(0, 10) };
}

function acceptBaseline(root: string): number {
  const file = path.join(__dirname, 'baseline.json');
  const { model } = loadInputs(root);
  const previous = JSON.parse(fs.readFileSync(file, 'utf8'));
  const commit = currentStamp(root).commit;
  const next = {
    ...previous,
    generatedFrom: commit,
    generatedFromDescription: `Baseline accepted at commit ${commit} — every key present at that point has been through a review round.`,
    keys: model.rows.map((r) => r.key),
  };
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
  return next.keys.length;
}

function main(): void {
  const root = REPO_ROOT;

  if (process.argv.includes('--accept-baseline')) {
    const n = acceptBaseline(root);
    console.log(`i18n-review: baseline accepted — ${n} keys are no longer marked NEW`);
  }

  const { model, notes } = loadInputs(root);
  const stamp = currentStamp(root);

  const targets: Array<[string, string]> = [
    [WORKBOOK_PATH, renderStable((s) => renderWorkbook(model, s, notes), stamp, readIfPresent(path.join(root, WORKBOOK_PATH)))],
    [QUEUE_PATH, renderStable((s) => renderQueue(model, s, notes), stamp, readIfPresent(path.join(root, QUEUE_PATH)))],
  ];
  for (const [rel, text] of targets) fs.writeFileSync(path.join(root, rel), text);

  console.log(
    `i18n-review: ${model.counts.en} en / ${model.counts.fr} fr / ${model.counts.rw} rw keys across ` +
      `${model.groups.length} namespaces — ${model.newRows.length} NEW, ${model.sameAsEnRows.length} identical to EN ` +
      `(${model.rows.filter((r) => r.sameAsEn === 'needs-decision').length} needs-decision), ${model.stubRows.length} stub`,
  );
  console.log(`wrote ${WORKBOOK_PATH} and ${QUEUE_PATH} (digest ${model.digest})`);
}

/* istanbul ignore next — CLI entry */
if (require.main === module) main();
