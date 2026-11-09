const TIMEZONE = 'Africa/Kigali';

/** Date key (YYYY-MM-DD) of `now` as seen in Kigali (server may be UTC). */
export function kigaliDateKey(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Hour of day (0–23) of `now` as seen in Kigali. */
export function kigaliHour(now: Date): number {
  return parseInt(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: TIMEZONE,
      hour: '2-digit',
      hour12: false,
    }).format(now),
    10,
  );
}

/**
 * UTC instant of midnight in Kigali for the day containing `now`. Africa/
 * Kigali is UTC+2 with no DST, so the offset is constant. Use this — not
 * setUTCHours(0,0,0,0) — as the "start of today" cutoff for jobs scheduled
 * on Kigali hours, so the day boundary matches the scheduling timezone.
 */
export function kigaliStartOfDay(now: Date): Date {
  return new Date(`${kigaliDateKey(now)}T00:00:00.000+02:00`);
}

/**
 * Next UTC instant strictly after `now` at which any of the given Kigali
 * wall-clock hours occurs. Hours are on-the-hour (payout windows fire at
 * :00); if all of today's hours have passed, rolls to the earliest hour
 * tomorrow.
 */
export function nextKigaliHourInstant(now: Date, hours: number[]): Date {
  const sorted = [...hours].sort((a, b) => a - b);
  for (const dayOffset of [0, 1]) {
    const day = new Date(now.getTime() + dayOffset * 24 * 60 * 60 * 1000);
    for (const hour of sorted) {
      const instant = new Date(
        `${kigaliDateKey(day)}T${String(hour).padStart(2, '0')}:00:00.000+02:00`,
      );
      if (instant.getTime() > now.getTime()) return instant;
    }
  }
  // Unreachable for non-empty hours: tomorrow's earliest hour is always > now.
  throw new Error('nextKigaliHourInstant requires at least one hour');
}
