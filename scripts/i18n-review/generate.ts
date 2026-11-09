// I18N-TRUTH G1–G4 — the review workbook and the native-review queue,
// built from the locale files instead of remembered.
//
// Everything below is pure: sources + committed manifests in, markdown
// out. No filesystem, no clock, no git — cli.ts supplies those. That is
// what makes `pnpm i18n:review` byte-deterministic and lets the CI guard
// (check.ts) regenerate in memory and compare.

import { createHash } from 'node:crypto';
import type { LandmarkEntry, QuickMessageEntry, Sources } from './sources';

export const GENERATOR = 'scripts/i18n-review';
/** Bump when the rendered shape changes, so the digest moves with it. */
export const FORMAT_VERSION = 1;

export const WORKBOOK_PATH = 'docs/i18n-rw-review.md';
export const QUEUE_PATH = 'docs/i18n-native-review-queue.md';

// ------------------------------------------------------------------ inputs

export interface Notes {
  translatorInstruction: string;
  sectionNotes: { quickMessages: string; landmarks: string };
  namespaceNotes: Record<string, string>;
  subtreeNotes: Record<string, string>;
  carriedOverGuidance: Array<{ title: string; body: string }>;
  queueFlags: Record<string, { source: string; note: string }>;
  keyNotes: Record<string, string>;
}

export interface Classification {
  brand: string[];
  properNoun: string[];
  genuinelyUntranslated: string[];
  formatTokens: string[];
  stubPrefixes: string[];
}

export interface Baseline {
  generatedFrom: string;
  generatedFromDescription: string;
  keys: string[];
}

export interface Stamp {
  /** Short commit the generator last ran against. */
  commit: string;
  /** ISO date (YYYY-MM-DD) of that run. */
  date: string;
}

// ------------------------------------------------------------------- model

export type SameAsEnReason = 'brand' | 'proper-noun' | 'placeholder' | 'untranslated' | 'needs-decision';

export interface Row {
  key: string;
  namespace: string;
  en: string;
  fr: string;
  rw: string;
  isNew: boolean;
  sameAsEn: SameAsEnReason | null;
  isStub: boolean;
  note: string;
}

export interface NamespaceGroup {
  namespace: string;
  note: string;
  rows: Row[];
}

export interface Model {
  counts: { en: number; fr: number; rw: number };
  /** en keys absent from fr / rw — must be empty; the parity suite owns this. */
  missingFr: string[];
  missingRw: string[];
  /** rw keys en lacks — must be empty since I18N-TRUTH G4. */
  extraRw: string[];
  groups: NamespaceGroup[];
  rows: Row[];
  newRows: Row[];
  sameAsEnRows: Row[];
  stubRows: Row[];
  baseline: Baseline;
  quickMessages: QuickMessageEntry[];
  landmarks: LandmarkEntry[];
  digest: string;
}

/** Code-point ordering — never locale-dependent, so CI matches a laptop. */
const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function classifySameAsEn(value: string, c: Classification): SameAsEnReason {
  if (c.brand.includes(value)) return 'brand';
  if (c.properNoun.includes(value)) return 'proper-noun';
  if (c.genuinelyUntranslated.includes(value)) return 'untranslated';

  // A pure format string: interpolation slots, digits, punctuation, mask
  // characters and unit tokens, with no prose left over.
  let residue = value.replace(/\{\{[^}]*\}\}/g, ' ');
  for (const token of c.formatTokens) {
    residue = residue.replace(new RegExp(`(^|[^\\p{L}])${token}($|[^\\p{L}])`, 'gu'), '$1 $2');
  }
  if (/^[\s\p{P}\p{S}\dX]*$/u.test(residue)) return 'placeholder';

  return 'needs-decision';
}

export function buildModel(
  sources: Sources,
  notes: Notes,
  classification: Classification,
  baseline: Baseline,
): Model {
  const { en, fr, rw } = sources.locales;
  const baselineKeys = new Set(baseline.keys);

  const keys = Object.keys(en).sort(byCodePoint);
  const rows: Row[] = keys.map((key) => {
    const rwValue = rw[key] ?? '';
    const sameAsEn = rwValue !== '' && rwValue === en[key] ? classifySameAsEn(rwValue, classification) : null;
    return {
      key,
      namespace: key.split('.')[0],
      en: en[key],
      fr: fr[key] ?? '',
      rw: rwValue,
      isNew: !baselineKeys.has(key),
      sameAsEn,
      isStub: classification.stubPrefixes.some((p) => rwValue.startsWith(p)),
      note: notes.keyNotes[key] ?? '',
    };
  });

  const namespaces = [...new Set(rows.map((r) => r.namespace))].sort(byCodePoint);
  const groups: NamespaceGroup[] = namespaces.map((namespace) => {
    const groupRows = rows.filter((r) => r.namespace === namespace);
    const subtree = Object.keys(notes.subtreeNotes)
      .filter((prefix) => prefix.split('.')[0] === namespace)
      .sort(byCodePoint)
      .map((prefix) => `\`${prefix}.*\` — ${notes.subtreeNotes[prefix]}`);
    const note = [notes.namespaceNotes[namespace] ?? '', ...subtree].filter(Boolean).join('\n\n');
    return { namespace, note, rows: groupRows };
  });

  const model: Omit<Model, 'digest'> = {
    counts: { en: keys.length, fr: Object.keys(fr).length, rw: Object.keys(rw).length },
    missingFr: keys.filter((k) => !(k in fr)),
    missingRw: keys.filter((k) => !(k in rw)),
    extraRw: Object.keys(rw).filter((k) => !(k in en)).sort(byCodePoint),
    groups,
    rows,
    newRows: rows.filter((r) => r.isNew),
    sameAsEnRows: rows.filter((r) => r.sameAsEn !== null),
    stubRows: rows.filter((r) => r.isStub),
    baseline,
    quickMessages: sources.quickMessages,
    landmarks: sources.landmarks,
  };

  return { ...model, digest: digestSources(sources, notes, classification, baseline) };
}

/**
 * Content identity of everything the workbook is derived from. It changes
 * exactly when a regeneration would change the file, which is what makes it
 * a freshness signal a reader can trust — unlike a hand-typed key count.
 */
export function digestSources(
  sources: Sources,
  notes: Notes,
  classification: Classification,
  baseline: Baseline,
): string {
  const hash = createHash('sha256');
  hash.update(`format:${FORMAT_VERSION}\n`);
  for (const file of Object.keys(sources.rawBytes).sort(byCodePoint)) {
    hash.update(`${file}\n${sources.rawBytes[file]}\n`);
  }
  hash.update(JSON.stringify([notes, classification, baseline]));
  return hash.digest('hex').slice(0, 16);
}

// --------------------------------------------------------------- rendering

/** Markdown table cells cannot hold a pipe or a newline. */
export function cell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>').trim();
}

function quote(text: string): string {
  return text
    .split('\n')
    .map((line) => (line === '' ? '>' : `> ${line}`))
    .join('\n');
}

function flagsOf(row: Row): string {
  const flags: string[] = [];
  if (row.isNew) flags.push('**NEW**');
  if (row.sameAsEn) flags.push(`same-as-EN: ${row.sameAsEn}`);
  if (row.isStub) flags.push('**STUB**');
  return flags.join('<br>');
}

const SAME_AS_EN_LEGEND: Record<SameAsEnReason, string> = {
  brand: 'A product or service name that keeps its own spelling in every language. Intentional — nothing to do.',
  'proper-noun': 'A name: language endonym, place, organisation. Intentional — nothing to do.',
  placeholder:
    'No prose at all — interpolation slots, digits, a phone or code mask, a unit. Intentional — nothing to do.',
  untranslated: 'Confirmed English text still shipping in the rw file. Needs a translation.',
  'needs-decision':
    'The generator will not guess. A native speaker decides whether the English word is the natural Kinyarwanda rendering or a gap.',
};

export function renderWorkbook(model: Model, stamp: Stamp, notes: Notes): string {
  const out: string[] = [];
  const p = (s = '') => out.push(s);

  p('# Bimoto Kinyarwanda Bilingual Review');
  p();
  p(quote(notes.translatorInstruction));
  p();
  p(
    quote(
      '**This file is generated. Do not edit it by hand** — run `pnpm i18n:review`\n' +
        'and your edit is gone. It is rewritten whole from the locale files on every\n' +
        'run, and CI fails a PR that adds a string without regenerating it, so what\n' +
        'you read below is what the app ships. Translator prose that must survive a\n' +
        'regeneration lives in `scripts/i18n-review/notes.json`.',
    ),
  );
  p();

  p('## What this file audited');
  p();
  p('| | |');
  p('|---|---|');
  p(`| English keys | ${model.counts.en} |`);
  p(`| French keys | ${model.counts.fr} |`);
  p(`| Kinyarwanda keys | ${model.counts.rw} |`);
  p(`| Canned chat phrases (\`QUICK_MESSAGES\`) | ${model.quickMessages.length} |`);
  p(`| Kigali landmarks (\`KIGALI_LANDMARKS\`) | ${model.landmarks.length} |`);
  p(`| Namespaces | ${model.groups.length} |`);
  p(`| New since the review baseline | ${model.newRows.length} |`);
  p(`| Kinyarwanda identical to English | ${model.sameAsEnRows.length} |`);
  p(`| Generator last run | ${stamp.date} at commit \`${stamp.commit}\` |`);
  p(`| Sources digest | \`${model.digest}\` |`);
  p();
  p('Sources read (as text, on every run):');
  p();
  p('- `packages/client/public/locales/en/translation.json`');
  p('- `packages/client/public/locales/fr/translation.json`');
  p('- `packages/client/public/locales/rw/translation.json`');
  p('- `packages/shared/src/constants/quick-messages.ts`');
  p('- `packages/shared/src/constants/locations.ts`');
  p();

  p('## Key parity');
  p();
  const parity: string[] = [];
  if (model.missingFr.length === 0) parity.push(`- Every one of the ${model.counts.en} English keys exists in French.`);
  else parity.push(`- **${model.missingFr.length} English keys missing from French:** ${model.missingFr.map((k) => `\`${k}\``).join(', ')}`);
  if (model.missingRw.length === 0)
    parity.push(`- Every one of the ${model.counts.en} English keys exists in Kinyarwanda.`);
  else parity.push(`- **${model.missingRw.length} English keys missing from Kinyarwanda:** ${model.missingRw.map((k) => `\`${k}\``).join(', ')}`);
  if (model.extraRw.length === 0) parity.push('- Kinyarwanda carries no keys English lacks.');
  else parity.push(`- **${model.extraRw.length} Kinyarwanda-only keys:** ${model.extraRw.map((k) => `\`${k}\``).join(', ')}`);
  parity.forEach(p);
  p();
  p(
    'The parity gate `packages/client/src/__tests__/i18n-parity.test.ts` fails CI on any of the above, ' +
      'so a missing key is caught before it reaches this file.',
  );
  p();

  p('## How to read the Flags column');
  p();
  p('| Flag | Meaning |');
  p('|------|---------|');
  p(
    `| **NEW** | Added since the review baseline (\`${model.baseline.generatedFrom.slice(0, 7)}\`). ` +
      'No native speaker has seen it yet — review these first. |',
  );
  for (const reason of Object.keys(SAME_AS_EN_LEGEND).sort(byCodePoint) as SameAsEnReason[]) {
    p(`| \`same-as-EN: ${reason}\` | The rw value is byte-identical to the en value. ${SAME_AS_EN_LEGEND[reason]} |`);
  }
  p('| **STUB** | The Kinyarwanda value is a placeholder marker, not a translation. Always a gap. |');
  p();
  p(
    `${model.sameAsEnRows.length} rows are byte-identical to their English source. ` +
      'Most are supposed to be; the category says which, and `needs-decision` marks ' +
      'the ones no rule can settle. They are listed together below so a reviewer can ' +
      'clear them in one pass instead of tripping over them one namespace at a time.',
  );
  p();

  // ------------------------------------------------- summary + special rows

  p('## Namespace summary');
  p();
  p('| Namespace | Keys | NEW | Same as EN | Needs decision | Notes |');
  p('|-----------|-----:|----:|-----------:|---------------:|------:|');
  for (const g of model.groups) {
    const neu = g.rows.filter((r) => r.isNew).length;
    const same = g.rows.filter((r) => r.sameAsEn !== null).length;
    const undecided = g.rows.filter((r) => r.sameAsEn === 'needs-decision').length;
    const noted = g.rows.filter((r) => r.note !== '').length;
    p(`| [\`${g.namespace}\`](#namespace-${g.namespace.toLowerCase()}) | ${g.rows.length} | ${neu} | ${same} | ${undecided} | ${noted} |`);
  }
  p(
    `| **total** | **${model.rows.length}** | **${model.newRows.length}** | **${model.sameAsEnRows.length}** | ` +
      `**${model.rows.filter((r) => r.sameAsEn === 'needs-decision').length}** | ` +
      `**${model.rows.filter((r) => r.note !== '').length}** |`,
  );
  p();

  p('## Review first: new since the baseline');
  p();
  p(
    `${model.newRows.length} keys arrived after \`${model.baseline.generatedFrom.slice(0, 7)}\` ` +
      `(${model.baseline.generatedFromDescription}).`,
  );
  p();
  if (model.newRows.length === 0) {
    p('_None — the baseline is current._');
  } else {
    p("| Key | English | Current RW (AI) | Reviewer's RW | Note |");
    p('|-----|---------|-----------------|---------------|------|');
    for (const r of model.newRows) {
      p(`| \`${r.key}\` | ${cell(r.en)} | ${cell(r.rw)} |  | ${cell(r.note)} |`);
    }
  }
  p();

  p('## Review first: Kinyarwanda identical to English');
  p();
  if (model.sameAsEnRows.length === 0) {
    p('_None._');
  } else {
    p("| Key | Value (identical in both) | Reason | Reviewer's RW | Note |");
    p('|-----|---------------------------|--------|---------------|------|');
    for (const r of model.sameAsEnRows) {
      p(`| \`${r.key}\` | ${cell(r.en)} | \`${r.sameAsEn}\` |  | ${cell(r.note)} |`);
    }
  }
  p();

  if (model.stubRows.length > 0) {
    p('## Review first: stub values');
    p();
    p('Kinyarwanda values that are markers rather than translations.');
    p();
    p("| Key | English | Current RW | Reviewer's RW |");
    p('|-----|---------|------------|---------------|');
    for (const r of model.stubRows) {
      p(`| \`${r.key}\` | ${cell(r.en)} | ${cell(r.rw)} |  |`);
    }
    p();
  }

  // -------------------------------------------------------- the full tables

  p('---');
  p();
  p('# `translation.json` — every key, side by side');
  p();

  for (const g of model.groups) {
    p(`## Namespace: \`${g.namespace}\``);
    p();
    if (g.note) {
      p(quote(g.note));
      p();
    }
    p("| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |");
    p('|-----|-------|---------|--------|-----------------|---------------|------|');
    for (const r of g.rows) {
      p(
        `| \`${r.key}\` | ${flagsOf(r)} | ${cell(r.en)} | ${cell(r.fr)} | ${cell(r.rw)} |  | ${cell(r.note)} |`,
      );
    }
    p();
  }

  p('---');
  p();
  p('# `QUICK_MESSAGES` (canned chat phrases)');
  p();
  p(quote(notes.sectionNotes.quickMessages));
  p();
  p("| ID | forRole | English | French | Current RW (AI) | Reviewer's RW |");
  p('|----|---------|---------|--------|-----------------|---------------|');
  for (const m of model.quickMessages) {
    p(`| \`${m.id}\` | ${cell(m.forRole)} | ${cell(m.en)} | ${cell(m.fr)} | ${cell(m.rw)} |  |`);
  }
  p();
  p(`_${model.quickMessages.length} messages parsed from \`packages/shared/src/constants/quick-messages.ts\`._`);
  p();

  p('---');
  p();
  p('# `KIGALI_LANDMARKS`');
  p();
  p(quote(notes.sectionNotes.landmarks));
  p();
  p("| English name | Category | French | Current RW (AI) | Reviewer's RW |");
  p('|--------------|----------|--------|-----------------|---------------|');
  for (const l of model.landmarks) {
    p(`| ${cell(l.name)} | ${cell(l.category)} | ${cell(l.nameFr)} | ${cell(l.nameRw)} |  |`);
  }
  p();
  p(`_${model.landmarks.length} landmarks parsed from \`packages/shared/src/constants/locations.ts\` and \`constants/landmarks/\`._`);
  p();

  p('---');
  p();
  p('# Translator guidance carried over from the hand-maintained workbook');
  p();
  p(
    quote(
      'These notes were written by hand between 2026-07-02 and 2026-07-23, when this\n' +
        'file was maintained by appending dated addenda. The addenda are gone — the\n' +
        'tables above are regenerated whole — but the tone guidance in them is human\n' +
        'work and still applies, so it is preserved verbatim in\n' +
        '`scripts/i18n-review/notes.json` and re-emitted here. Wording such as\n' +
        '"appended below" refers to the old file, not this one.',
    ),
  );
  p();
  for (const g of notes.carriedOverGuidance) {
    p(`### ${g.title}`);
    p();
    p(g.body);
    p();
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

export function renderQueue(model: Model, stamp: Stamp, notes: Notes): string {
  const out: string[] = [];
  const p = (s = '') => out.push(s);
  const byKey = new Map(model.rows.map((r) => [r.key, r]));

  p('# Kinyarwanda native-review queue');
  p();
  p(
    quote(
      '**This file is generated** by `pnpm i18n:review` from the same locale files\n' +
        `as the full workbook (\`${WORKBOOK_PATH}\`), so the two can never disagree.\n` +
        'Do not edit it by hand. Notes belong in `scripts/i18n-review/notes.json`.',
    ),
  );
  p();
  p(
    quote(
      '**Process:** a native reviewer works top-down, edits\n' +
        '`packages/client/public/locales/rw/translation.json` directly, then runs\n' +
        '`pnpm i18n:review:baseline && pnpm i18n:review` in the same commit to move\n' +
        'the baseline forward and clear the reviewed rows from this queue.\n' +
        '\n' +
        'Glossary and tone rules: `docs/i18n-glossary.md`, `docs/i18n-translator-brief.md`.',
    ),
  );
  p();

  p('## Standing truth');
  p();
  p(
    `All ${model.counts.rw} Kinyarwanda strings are AI-generated. None has been signed off ` +
      `by a native speaker, so the honest work list is the full workbook (\`${WORKBOOK_PATH}\`). ` +
      'This queue narrows that to what changed and what a human explicitly flagged.',
  );
  p();
  p(`_Generated ${stamp.date} at commit \`${stamp.commit}\`; sources digest \`${model.digest}\`._`);
  p();

  p('## Outstanding');
  p();
  p(`### New since the review baseline \`${model.baseline.generatedFrom.slice(0, 7)}\` (${model.newRows.length})`);
  p();
  p(model.baseline.generatedFromDescription);
  p();
  if (model.newRows.length === 0) {
    p('_Queue clear — no key has been added since the baseline._');
  } else {
    p('| Key | EN | Current RW (AI) | Note |');
    p('| --- | -- | --------------- | ---- |');
    for (const r of model.newRows) p(`| \`${r.key}\` | ${cell(r.en)} | ${cell(r.rw)} | ${cell(r.note)} |`);
  }
  p();

  const flagged = Object.keys(notes.queueFlags).sort(byCodePoint).filter((k) => byKey.has(k));
  const droppedFlags = Object.keys(notes.queueFlags).sort(byCodePoint).filter((k) => !byKey.has(k));
  p(`### Flagged by a human, still unreviewed (${flagged.length})`);
  p();
  p(
    'Rows a previous reviewer singled out with a reason. The English and Kinyarwanda ' +
      'columns are read live from the locale files, so a note can never outlive the string it describes.',
  );
  p();
  p('| Key | EN | Current RW (AI) | Flagged in | Note |');
  p('| --- | -- | --------------- | ---------- | ---- |');
  for (const key of flagged) {
    const r = byKey.get(key)!;
    const f = notes.queueFlags[key];
    p(`| \`${key}\` | ${cell(r.en)} | ${cell(r.rw)} | ${cell(f.source)} | ${cell(f.note)} |`);
  }
  p();
  if (droppedFlags.length > 0) {
    p(
      `_${droppedFlags.length} flagged key(s) no longer exist in the locale files and were dropped: ` +
        `${droppedFlags.map((k) => `\`${k}\``).join(', ')}. Remove them from \`notes.json\`._`,
    );
    p();
  }

  const undecided = model.rows.filter((r) => r.sameAsEn === 'needs-decision');
  p(`### Kinyarwanda identical to English, reason undecided (${undecided.length})`);
  p();
  p(
    'The generator could not tell whether these are correct as-is or untranslated. ' +
      'Each needs a yes/no from a native speaker; record the answer by translating the ' +
      'string, or by adding it to `scripts/i18n-review/classification.json`.',
  );
  p();
  if (undecided.length === 0) {
    p('_None._');
  } else {
    p('| Key | Value (identical in EN and RW) |');
    p('| --- | ----------------------------- |');
    for (const r of undecided) p(`| \`${r.key}\` | ${cell(r.en)} |`);
  }
  p();

  if (model.stubRows.length > 0) {
    p(`### Stub values (${model.stubRows.length})`);
    p();
    p('| Key | EN | Current RW |');
    p('| --- | -- | ---------- |');
    for (const r of model.stubRows) p(`| \`${r.key}\` | ${cell(r.en)} | ${cell(r.rw)} |`);
    p();
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

// --------------------------------------------------------- stamp stability
//
// The header carries a commit and a date, which are by nature not
// deterministic — and the CI guard compares bytes. Both hold at once
// because the stamp is only refreshed when the rest of the file actually
// changes: regenerating an unchanged tree reproduces the committed file
// exactly, while adding a string moves the digest, moves the body, and
// therefore moves the stamp too.

const STAMP_LINE = /^(\| Generator last run \| |_Generated ).*$/gm;

export function stripStamp(markdown: string): string {
  return markdown.replace(STAMP_LINE, '<stamp>');
}

export function readStamp(markdown: string): Stamp | null {
  const table = /^\| Generator last run \| (\d{4}-\d{2}-\d{2}) at commit `([^`]+)` \|$/m.exec(markdown);
  if (table) return { date: table[1], commit: table[2] };
  const line = /^_Generated (\d{4}-\d{2}-\d{2}) at commit `([^`]+)`/m.exec(markdown);
  return line ? { date: line[1], commit: line[2] } : null;
}

/**
 * Renders with `stamp`, unless the previous file says the same thing — in
 * which case the previous stamp is kept and the bytes are unchanged.
 */
export function renderStable(
  render: (stamp: Stamp) => string,
  stamp: Stamp,
  previous: string | null,
): string {
  const fresh = render(stamp);
  if (previous === null) return fresh;
  if (stripStamp(fresh) !== stripStamp(previous)) return fresh;
  const old = readStamp(previous);
  return old ? render(old) : fresh;
}
