// SCHED-UI G6 — unit tests for the client-side scheduled-booking
// helpers. The lead bounds mirror the server's validators.ts; these
// tests pin the mirrored literals so a drift is caught in review.
import { describe, test, expect } from 'vitest';
import {
  MIN_LEAD_TIME_MS,
  MAX_LEAD_TIME_MS,
  BID_WINDOW_LEAD_MS,
  AUTO_FALLBACK_LEAD_MS,
  validateScheduledForLocal,
  toDatetimeLocalValue,
  bidWindowOpensAt,
} from '../lib/scheduled';

describe('scheduled lib', () => {
  test('mirrored constants match the server values', () => {
    expect(MIN_LEAD_TIME_MS).toBe(60 * 60 * 1000);
    expect(MAX_LEAD_TIME_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(BID_WINDOW_LEAD_MS).toBe(60 * 60 * 1000);
    expect(AUTO_FALLBACK_LEAD_MS).toBe(30 * 60 * 1000);
  });

  test('validateScheduledForLocal — empty value is required', () => {
    expect(validateScheduledForLocal('')).toBe('errors.scheduledForRequired');
  });

  test('validateScheduledForLocal — unparseable value is invalid', () => {
    expect(validateScheduledForLocal('not-a-date')).toBe('errors.scheduledForInvalid');
  });

  test('validateScheduledForLocal — below the 1-hour lead is too soon', () => {
    const now = new Date('2026-07-23T10:00:00');
    expect(validateScheduledForLocal('2026-07-23T10:59', now)).toBe(
      'errors.scheduledForTooSoon',
    );
  });

  test('validateScheduledForLocal — exactly 1 hour is accepted', () => {
    const now = new Date('2026-07-23T10:00:00');
    expect(validateScheduledForLocal('2026-07-23T11:00', now)).toBeNull();
  });

  test('validateScheduledForLocal — beyond 30 days is too far', () => {
    const now = new Date('2026-07-23T10:00:00');
    expect(validateScheduledForLocal('2026-08-23T10:01', now)).toBe(
      'errors.scheduledForTooFar',
    );
  });

  test('toDatetimeLocalValue round-trips through new Date()', () => {
    const d = new Date(2026, 6, 23, 9, 5);
    const v = toDatetimeLocalValue(d);
    expect(v).toBe('2026-07-23T09:05');
    expect(new Date(v).getTime()).toBe(d.getTime());
  });

  test('bidWindowOpensAt is scheduledFor minus 60 minutes', () => {
    const iso = '2026-07-23T12:00:00.000Z';
    expect(bidWindowOpensAt(iso).toISOString()).toBe('2026-07-23T11:00:00.000Z');
  });
});
