// LAUNCH-TRUTH G6.1 — locale key-set parity gate.
//
// Fails CI (client-tests workflow runs this suite on every PR) when the
// three locale files diverge: every key in `en` must exist in `fr` and
// `rw`, and neither `fr` nor `rw` may carry keys `en` lacks — except
// rw translator-annotation keys, tolerated by the EXPLICIT rule below,
// not by silence. Before this gate, nothing in CI checked i18n at all;
// a missing key silently fell back to English at runtime.

import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const LOCALES_DIR = join(__dirname, '../../public/locales');

// The one sanctioned shape for rw-only keys: translator notes and
// namespace comments for the native-review workflow. Anything else
// rw-only is a divergence and fails.
const RW_ANNOTATION_KEY = /(^|\.)(_comment|_translatorNote_rw)$/;

function flattenKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v !== null && typeof v === 'object'
      ? flattenKeys(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  );
}

function loadKeys(locale: string): Set<string> {
  const raw = readFileSync(join(LOCALES_DIR, locale, 'translation.json'), 'utf8');
  return new Set(flattenKeys(JSON.parse(raw)));
}

const en = loadKeys('en');
const fr = loadKeys('fr');
const rw = loadKeys('rw');

describe('i18n locale parity (en / fr / rw)', () => {
  test('every en key exists in fr', () => {
    const missing = [...en].filter((k) => !fr.has(k));
    expect(missing).toEqual([]);
  });

  test('every en key exists in rw', () => {
    const missing = [...en].filter((k) => !rw.has(k));
    expect(missing).toEqual([]);
  });

  test('fr carries no keys en lacks', () => {
    const extra = [...fr].filter((k) => !en.has(k));
    expect(extra).toEqual([]);
  });

  test('rw carries no keys en lacks, except explicit translator annotations', () => {
    const extra = [...rw].filter((k) => !en.has(k) && !RW_ANNOTATION_KEY.test(k));
    expect(extra).toEqual([]);
  });

  test('rw-only annotation keys all match the sanctioned shape', () => {
    const annotations = [...rw].filter((k) => !en.has(k));
    for (const k of annotations) {
      expect(k).toMatch(RW_ANNOTATION_KEY);
    }
  });
});
