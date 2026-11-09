// R3-DRIVER-SCREENER — GDPR-posture lint. The 8 screener questions
// must never collect Law 058/2021 / GDPR Art. 9 special-category data.
// This test lints the catalogue's i18n keys and question ids against a
// disallowed-substring list. Adding a question whose key or id contains
// any of these substrings fails CI — which is the intended gate.

import { SCREENER_QUESTIONS } from '../questions.js';

const DISALLOWED_SUBSTRINGS = [
  'health',
  'medical',
  'religion',
  'ethnic',
  'national_id',
  'biometric',
];

describe('screener catalogue — GDPR posture', () => {
  it('no question key contains a disallowed special-category substring', () => {
    for (const q of SCREENER_QUESTIONS) {
      const haystack = `${q.id} ${q.i18nKey}`.toLowerCase();
      for (const banned of DISALLOWED_SUBSTRINGS) {
        expect(haystack.includes(banned)).toBe(false);
      }
    }
  });

  it('catalogue holds exactly 8 questions (frozen for this dispatch)', () => {
    expect(SCREENER_QUESTIONS.length).toBe(8);
  });

  it('every question has a stable id and an i18nKey under the screener namespace', () => {
    for (const q of SCREENER_QUESTIONS) {
      expect(q.id.length).toBeGreaterThan(0);
      expect(q.i18nKey.startsWith('screener.')).toBe(true);
    }
  });
});
