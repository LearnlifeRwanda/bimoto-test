// I18N-TRUTH G5 — the freshness guard (same shape as scripts/wiring-audit/check.ts).
//
// Regenerates the review workbook and the native-review queue in memory and
// fails when the committed files differ. A PR that adds a UI string without
// running `pnpm i18n:review` therefore turns CI red, which is the whole
// point: the file that told translators it audited 232 keys while the app
// shipped 1088 could drift silently, and this one cannot.
//
// Run: pnpm i18n:review:check

import * as path from 'node:path';
import {
  QUEUE_PATH,
  WORKBOOK_PATH,
  renderQueue,
  renderStable,
  renderWorkbook,
  stripStamp,
  type Model,
  type Notes,
  type Stamp,
} from './generate';
import { REPO_ROOT, loadInputs, readIfPresent } from './load';

export interface DriftResult {
  ok: boolean;
  errors: string[];
}

/** Where two markdown documents first diverge, in reader-usable terms. */
export function firstDifference(expected: string, actual: string): string {
  const e = expected.split('\n');
  const a = actual.split('\n');
  for (let i = 0; i < Math.max(e.length, a.length); i++) {
    if (e[i] === a[i]) continue;
    return (
      `line ${i + 1}:\n` +
      `      committed: ${a[i] === undefined ? '(end of file)' : JSON.stringify(a[i].slice(0, 160))}\n` +
      `      generated: ${e[i] === undefined ? '(end of file)' : JSON.stringify(e[i].slice(0, 160))}`
    );
  }
  return 'files differ in trailing whitespace only';
}

export function checkFile(relPath: string, expected: string, committed: string | null): DriftResult {
  if (committed === null) {
    return { ok: false, errors: [`${relPath} is missing — run \`pnpm i18n:review\` and commit it.`] };
  }
  if (committed === expected) return { ok: true, errors: [] };

  const stampOnly = stripStamp(committed) === stripStamp(expected);
  const detail = stampOnly
    ? 'only the generation stamp differs, which means the file was hand-edited'
    : firstDifference(expected, committed);
  return {
    ok: false,
    errors: [
      `${relPath} is out of date — it does not match what the generator produces from the ` +
        `current locale files.\n      ${detail}\n      Fix: run \`pnpm i18n:review\` and commit the result. ` +
        `Do not edit ${relPath} by hand; translator prose belongs in scripts/i18n-review/notes.json.`,
    ],
  };
}

export function runCheck(
  root: string,
  model: Model,
  notes: Notes,
  stamp: Stamp,
): DriftResult {
  const errors: string[] = [];
  for (const [rel, render] of [
    [WORKBOOK_PATH, (s: Stamp) => renderWorkbook(model, s, notes)],
    [QUEUE_PATH, (s: Stamp) => renderQueue(model, s, notes)],
  ] as const) {
    const committed = readIfPresent(path.join(root, rel));
    const expected = renderStable(render, stamp, committed);
    errors.push(...checkFile(rel, expected, committed).errors);
  }
  return { ok: errors.length === 0, errors };
}

/* istanbul ignore next — CLI entry */
if (require.main === module) {
  const root = REPO_ROOT;
  const { model, notes } = loadInputs(root);
  // The stamp only matters when the body already differs (renderStable
  // reuses the committed stamp otherwise), so a fixed value keeps the
  // guard's own behaviour independent of the clock.
  const result = runCheck(root, model, notes, { commit: 'pending', date: '0000-00-00' });

  for (const e of result.errors) console.error(`FAIL: ${e}`);
  if (!result.ok) {
    console.error(
      `\ni18n-review-check: ${result.errors.length} stale file(s). The review workbook is generated, ` +
        'not maintained — regenerate it in the same PR that changes a string.',
    );
    process.exit(1);
  }
  console.log(
    `i18n-review-check: OK — ${WORKBOOK_PATH} and ${QUEUE_PATH} match the locale files ` +
      `(${model.counts.en} en / ${model.counts.fr} fr / ${model.counts.rw} rw, digest ${model.digest})`,
  );
}
