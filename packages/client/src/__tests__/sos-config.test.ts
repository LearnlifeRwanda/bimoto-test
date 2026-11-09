// __TESTS__/SOS-CONFIG.TEST.TS
//
// QUEUE-UNITY G4 — the red button's reflexes are config now, so the
// config is a safety surface and gets tested like one.
//
// Two kinds of claim here. The defaults, because they are a founder
// decision and a decision that can drift back by accident was never
// made. And the parser's refusals, because a mistyped env var on a
// build machine must never be able to ship an emergency button with a
// zero-length or NaN hold — the failure mode of a safety control is
// "behaves as designed", not "crashes loudly" and not "fires on a
// brush".

import { describe, test, expect } from 'vitest';
import {
  SOS_HOLD_MS,
  SOS_CANCEL_MS,
  SOS_HOLD_MS_DEFAULT,
  SOS_CANCEL_MS_DEFAULT,
  _durationMsForTests as durationMs,
} from '../config/sos';

describe('SOS durations — the defaults', () => {
  test('the hold is 1000 ms', () => {
    // Raised from FLIGHT-RECORDER's 700 by founder decision: the hold
    // is one of three gates now (hold → confirm → cancel window), so it
    // can afford more margin for pockets, knees, rain and gloves.
    expect(SOS_HOLD_MS_DEFAULT).toBe(1000);
  });

  test('the cancel window is unchanged at 3000 ms', () => {
    expect(SOS_CANCEL_MS_DEFAULT).toBe(3000);
  });

  test('with no env vars set, the exported values ARE the defaults', () => {
    // Under vitest neither VITE_SOS_* is defined, which is also the
    // shipped-build case whenever the deployer does not set them.
    expect(SOS_HOLD_MS).toBe(SOS_HOLD_MS_DEFAULT);
    expect(SOS_CANCEL_MS).toBe(SOS_CANCEL_MS_DEFAULT);
  });
});

describe('SOS durations — the parser refuses anything unusable', () => {
  const FALLBACK = 1234;

  test('a plain integer is taken', () => {
    expect(durationMs('1500', FALLBACK)).toBe(1500);
  });

  test('a decimal is rounded, not truncated to zero', () => {
    expect(durationMs('1500.6', FALLBACK)).toBe(1501);
  });

  test.each([
    ['undefined', undefined],
    ['empty', ''],
    ['whitespace', '   '],
    ['not a number', 'soon'],
    ['zero', '0'],
    ['negative', '-500'],
    ['NaN literal', 'NaN'],
    ['Infinity', 'Infinity'],
  ])('%s falls back rather than shipping a broken hold', (_label, raw) => {
    expect(durationMs(raw as string | undefined, FALLBACK)).toBe(FALLBACK);
  });

  test('a very long hold is honoured — the field may want one', () => {
    // No upper clamp on purpose. If Kigali says three seconds, three
    // seconds is what a deployer should be able to ship without asking.
    expect(durationMs('3000', FALLBACK)).toBe(3000);
  });
});

describe('SOS durations — what the module deliberately is not', () => {
  test('the values are constants, resolved once at module load', () => {
    // Vite inlines import.meta.env at BUILD time. There is no live
    // flip: tuning means a rebuild. Asserting the type keeps anyone
    // from turning these into getters and implying otherwise.
    expect(typeof SOS_HOLD_MS).toBe('number');
    expect(typeof SOS_CANCEL_MS).toBe('number');
    expect(Number.isInteger(SOS_HOLD_MS)).toBe(true);
    expect(Number.isInteger(SOS_CANCEL_MS)).toBe(true);
  });
});
