import {
  validateScheduledFor,
  validatePickupCoords,
  computeBidWindowTimes,
  BID_WINDOW_LEAD_MS,
  AUTO_FALLBACK_LEAD_MS,
} from '../services/scheduled-rides/validators';
import { AppError } from '../middleware/error-handler';

describe('scheduled-rides/validators', () => {
  describe('validateScheduledFor', () => {
    const now = new Date('2026-05-04T12:00:00Z');

    test('accepts a time exactly 1h in the future', () => {
      const t = new Date(now.getTime() + 60 * 60 * 1000);
      expect(() => validateScheduledFor(t, now)).not.toThrow();
    });

    test('rejects times less than 1h in the future', () => {
      const t = new Date(now.getTime() + 30 * 60 * 1000);
      expect(() => validateScheduledFor(t, now)).toThrow(AppError);
      try {
        validateScheduledFor(t, now);
      } catch (e: any) {
        expect(e.code).toBe('SCHEDULED_FOR_TOO_SOON');
      }
    });

    test('rejects times more than 30 days in the future', () => {
      const t = new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000);
      expect(() => validateScheduledFor(t, now)).toThrow(AppError);
      try {
        validateScheduledFor(t, now);
      } catch (e: any) {
        expect(e.code).toBe('SCHEDULED_FOR_TOO_FAR');
      }
    });

    test('rejects an invalid Date (NaN)', () => {
      const t = new Date('invalid');
      expect(() => validateScheduledFor(t, now)).toThrow(AppError);
    });
  });

  describe('validatePickupCoords', () => {
    test('accepts coords inside Kigali bounds', () => {
      expect(() => validatePickupCoords(-1.95, 29.87)).not.toThrow();
    });

    test('rejects coords outside the bounding box', () => {
      expect(() => validatePickupCoords(0, 0)).toThrow(AppError);
    });

    test('rejects NaN coords', () => {
      expect(() => validatePickupCoords(NaN, 29.87)).toThrow(AppError);
    });
  });

  describe('computeBidWindowTimes', () => {
    test('computes bidWindowOpensAt as scheduledFor - 1h', () => {
      const scheduledFor = new Date('2026-05-04T14:00:00Z');
      const { bidWindowOpensAt, autoFallbackAt } = computeBidWindowTimes(scheduledFor);
      expect(bidWindowOpensAt.getTime()).toBe(scheduledFor.getTime() - BID_WINDOW_LEAD_MS);
      expect(autoFallbackAt.getTime()).toBe(scheduledFor.getTime() - AUTO_FALLBACK_LEAD_MS);
    });

    test('returns ordered times: opens before fallback before scheduled', () => {
      const scheduledFor = new Date('2026-05-04T14:00:00Z');
      const { bidWindowOpensAt, autoFallbackAt } = computeBidWindowTimes(scheduledFor);
      expect(bidWindowOpensAt.getTime()).toBeLessThan(autoFallbackAt.getTime());
      expect(autoFallbackAt.getTime()).toBeLessThan(scheduledFor.getTime());
    });
  });
});
