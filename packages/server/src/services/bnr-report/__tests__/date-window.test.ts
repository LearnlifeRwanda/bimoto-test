import { windowFor, priorPeriodFromNow } from '../date-window';

describe('bnr-report date-window', () => {
  test('windowFor("2026-04") yields Africa/Kigali month bounds in UTC', () => {
    const w = windowFor('2026-04');
    expect(w.startUtc.toISOString()).toBe('2026-03-31T22:00:00.000Z');
    expect(w.endUtc.toISOString()).toBe('2026-04-30T22:00:00.000Z');
    expect(w.label).toBe('April 2026');
    expect(w.period).toBe('2026-04');
    expect(w.timezone).toBe('Africa/Kigali');
  });

  test('boundary instant: 21:59:59.999Z on last day is included; 22:00:00Z is not', () => {
    const w = windowFor('2026-04');
    const lastIncluded = new Date('2026-04-30T21:59:59.999Z');
    const firstExcluded = new Date('2026-04-30T22:00:00.000Z');
    expect(lastIncluded.getTime() >= w.startUtc.getTime()).toBe(true);
    expect(lastIncluded.getTime() < w.endUtc.getTime()).toBe(true);
    expect(firstExcluded.getTime() < w.endUtc.getTime()).toBe(false);
    expect(firstExcluded.getTime() >= w.endUtc.getTime()).toBe(true);
  });

  test('malformed period strings throw', () => {
    expect(() => windowFor('2026')).toThrow();
    expect(() => windowFor('2026-13')).toThrow();
    expect(() => windowFor('abc')).toThrow();
    expect(() => windowFor('2026-00')).toThrow();
  });

  test('priorPeriodFromNow on May 1 02:30 Kigali returns "2026-04"', () => {
    const now = new Date('2026-05-01T02:30:00+02:00');
    expect(priorPeriodFromNow(now)).toBe('2026-04');
  });

  test('priorPeriodFromNow wraps year on Jan 1 02:30 Kigali → "2025-12"', () => {
    const now = new Date('2026-01-01T02:30:00+02:00');
    expect(priorPeriodFromNow(now)).toBe('2025-12');
  });

  test('windowFor handles December and rolls into next year', () => {
    const w = windowFor('2025-12');
    expect(w.startUtc.toISOString()).toBe('2025-11-30T22:00:00.000Z');
    expect(w.endUtc.toISOString()).toBe('2025-12-31T22:00:00.000Z');
    expect(w.label).toBe('December 2025');
  });
});
