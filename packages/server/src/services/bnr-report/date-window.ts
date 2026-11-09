import { TIMEZONE } from './config';
import type { ReportPeriod } from './types';

const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function tzOffsetMinutes(at: Date, timezone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'shortOffset',
    hour: 'numeric',
    hour12: false,
  });
  const tzPart = dtf.formatToParts(at).find((p) => p.type === 'timeZoneName');
  const value = tzPart?.value ?? 'GMT';
  const m = value.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/);
  if (!m) return 0;
  const hours = parseInt(m[1], 10);
  const mins = m[2] ? parseInt(m[2], 10) : 0;
  const sign = hours < 0 ? -1 : 1;
  return hours * 60 + sign * mins;
}

function localMidnightUtc(year: number, month: number, timezone: string): Date {
  const guess = Date.UTC(year, month - 1, 1, 0, 0, 0, 0);
  const offsetMin = tzOffsetMinutes(new Date(guess), timezone);
  return new Date(guess - offsetMin * 60_000);
}

function ymInTz(date: Date, timezone: string): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  if (!y || !m) throw new Error(`Failed to format date in ${timezone}`);
  return { year: parseInt(y, 10), month: parseInt(m, 10) };
}

export function windowFor(period: string, timezone: string = TIMEZONE): ReportPeriod {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) throw new Error(`Invalid period "${period}"; expected "YYYY-MM"`);
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  if (month < 1 || month > 12) {
    throw new Error(`Invalid month in period "${period}"`);
  }
  const startUtc = localMidnightUtc(year, month, timezone);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const endUtc = localMidnightUtc(nextYear, nextMonth, timezone);
  return {
    period,
    startUtc,
    endUtc,
    label: `${MONTH_LABELS[month - 1]} ${year}`,
    timezone,
  };
}

export function priorPeriodFromNow(now: Date, timezone: string = TIMEZONE): string {
  const { year, month } = ymInTz(now, timezone);
  const priorMonth = month === 1 ? 12 : month - 1;
  const priorYear = month === 1 ? year - 1 : year;
  return `${priorYear}-${String(priorMonth).padStart(2, '0')}`;
}
