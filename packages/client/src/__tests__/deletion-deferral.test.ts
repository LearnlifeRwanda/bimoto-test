// ACCOUNT-RIGHTS-SURFACE G6 — the map from reason code to words cannot
// grow a hole.
//
// The compile-time half of this guarantee is the `Record<DeferralReason,
// string>` in lib/deletion-deferral.ts: add a sixth member to the shared
// union without adding a row there and the CLIENT BUILD FAILS. That is the
// real gate, and it is not something a test can assert about itself.
//
// What this suite pins is everything the type system cannot: that the
// runtime tuple and the map agree in both directions, that every key the
// map names actually exists in all three locale files (a key that compiles
// and renders nothing is the same failure with extra steps), and that an
// unknown code degrades to silence rather than to a raw code on screen.

import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { DEFERRAL_REASONS, type DeferralReason } from '@bimoto/shared';
import { DEFERRAL_REASON_KEYS, deferralReasonKey } from '../lib/deletion-deferral';

const LOCALES = ['en', 'fr', 'rw'] as const;

// THE COMPILE-TIME PIN. This is not a runtime assertion — it is checked by
// `pnpm typecheck`, which compiles this file. A map missing a reason must
// not compile; @ts-expect-error asserts exactly that, and TypeScript fails
// the build if the error it expects STOPS happening. So if anyone ever
// loosens Record<DeferralReason, string> to Record<string, string>, this
// line goes red — which is the only way to test that a type is doing its
// job from inside the language it is written in.
// @ts-expect-error — a wording map that omits a reason is a build failure.
const INCOMPLETE_MAP_MUST_NOT_COMPILE: Record<DeferralReason, string> = {
  NON_TERMINAL_JOURNEY: 'deletion.deferredNonTerminalJourney',
};
void INCOMPLETE_MAP_MUST_NOT_COMPILE;

function resolve(locale: string, dotted: string): unknown {
  const raw = readFileSync(
    join(__dirname, '../../public/locales', locale, 'translation.json'),
    'utf8',
  );
  return dotted
    .split('.')
    .reduce<unknown>(
      (acc, part) =>
        acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined,
      JSON.parse(raw),
    );
}

describe('deferral reason wording map', () => {
  test('every reason in the shared union has a wording key', () => {
    const mapped = Object.keys(DEFERRAL_REASON_KEYS).sort();
    expect(mapped).toEqual([...DEFERRAL_REASONS].sort());
  });

  test('the map names no reason the union does not have', () => {
    for (const key of Object.keys(DEFERRAL_REASON_KEYS)) {
      expect(DEFERRAL_REASONS).toContain(key);
    }
  });

  test('every wording key resolves to a real string in en, fr and rw', () => {
    for (const reason of DEFERRAL_REASONS) {
      const key = DEFERRAL_REASON_KEYS[reason];
      for (const locale of LOCALES) {
        const value = resolve(locale, key);
        expect(typeof value, `${locale}:${key}`).toBe('string');
        expect((value as string).length, `${locale}:${key}`).toBeGreaterThan(0);
      }
    }
  });

  test('each reason maps to its OWN key — no two reasons share wording', () => {
    const keys = Object.values(DEFERRAL_REASON_KEYS);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('lookup returns the key for a known reason', () => {
    expect(deferralReasonKey('LIVE_ESCROW')).toBe('deletion.deferredLiveEscrow');
  });

  test('lookup is silent for null, undefined and an unknown code', () => {
    // Silence, not a raw code: if client and server ever drift, showing
    // "SOMETHING_NEW" to a motari is worse than showing nothing, because
    // the banner's own heading is still true without it.
    expect(deferralReasonKey(null)).toBeNull();
    expect(deferralReasonKey(undefined)).toBeNull();
    expect(deferralReasonKey('')).toBeNull();
    expect(deferralReasonKey('SOMETHING_NEW')).toBeNull();
  });
});
