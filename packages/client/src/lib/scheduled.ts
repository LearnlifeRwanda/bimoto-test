// SCHED-UI — client-side helpers for advance (SCHEDULED) bookings.
//
// HYGIENE W3 G5 — the lead-time bounds NO LONGER mirror the server's
// constants; they are the same constants. @bimoto/shared exports them
// (constants/time.ts) and both sides import from there, so the comment
// that used to end "if the server values change, these must change with
// them" describes a hazard that no longer exists. They are re-exported
// here because this module has been the client's import site since
// SCHED-UI. The values are unchanged.
import {
  AUTO_FALLBACK_LEAD_MS,
  BID_WINDOW_LEAD_MS,
  MAX_LEAD_TIME_MS,
  MIN_LEAD_TIME_MS,
} from '@bimoto/shared';

export { MIN_LEAD_TIME_MS, MAX_LEAD_TIME_MS, BID_WINDOW_LEAD_MS, AUTO_FALLBACK_LEAD_MS };

/**
 * Validate a datetime-local input value against the server's lead-time
 * bounds. Returns an i18n key mirroring the server's error-message keys
 * (errors.scheduledFor* family, see validators.ts / journey.service.ts),
 * or null when the value is acceptable.
 */
export function validateScheduledForLocal(
  value: string,
  now: Date = new Date(),
): string | null {
  if (!value) return 'errors.scheduledForRequired';
  const scheduled = new Date(value);
  if (Number.isNaN(scheduled.getTime())) return 'errors.scheduledForInvalid';
  const diff = scheduled.getTime() - now.getTime();
  if (diff < MIN_LEAD_TIME_MS) return 'errors.scheduledForTooSoon';
  if (diff > MAX_LEAD_TIME_MS) return 'errors.scheduledForTooFar';
  return null;
}

/**
 * Format a Date as a value for <input type="datetime-local"> in the
 * device's local timezone (Kigali is UTC+2, no DST — the platform's
 * Date handles the offset; no hand-rolled timezone math).
 */
export function toDatetimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** When drivers can start bidding: scheduledFor minus BID_WINDOW_LEAD_MS. */
export function bidWindowOpensAt(scheduledForIso: string): Date {
  return new Date(new Date(scheduledForIso).getTime() - BID_WINDOW_LEAD_MS);
}

/** Locale-formatted date+time for display (house style: device locale). */
export function formatScheduledDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/** Locale-formatted time-of-day for display. */
export function formatScheduledTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}
