import { describe, test, expect } from 'vitest';
import { QUICK_MESSAGES, JourneyStatus, Language, VehicleType } from '@bimoto/shared';

const ORIGINAL_IDS = [
  'qm_on_my_way',
  'qm_arrived',
  'qm_waiting',
  'qm_where_are_you',
  'qm_almost_there',
  'qm_stuck_traffic',
  'qm_cancel_please',
  'qm_thank_you',
  'qm_5_minutes',
  'qm_call_me',
];

const VALID_JOURNEY_STATUSES = new Set(Object.values(JourneyStatus));
const VALID_LANGUAGES = [Language.EN, Language.RW, Language.FR] as const;
const VALID_REVIEW_STATUSES = new Set(['native-reviewed', 'placeholder']);

describe('QUICK_MESSAGES catalogue integrity', () => {
  test('every responseSet entry references a valid catalogue ID', () => {
    const ids = new Set(QUICK_MESSAGES.map((qm) => qm.id));
    const offenders: Array<{ id: string; refersTo: string }> = [];
    for (const qm of QUICK_MESSAGES) {
      for (const ref of qm.responseSet) {
        if (!ids.has(ref)) offenders.push({ id: qm.id, refersTo: ref });
      }
    }
    expect(offenders).toEqual([]);
  });

  test('every contexts entry is a valid JourneyStatus enum value', () => {
    const offenders: Array<{ id: string; status: string }> = [];
    for (const qm of QUICK_MESSAGES) {
      for (const status of qm.contexts) {
        if (!VALID_JOURNEY_STATUSES.has(status)) {
          offenders.push({ id: qm.id, status });
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test('every entry has a non-empty string for all 3 locales', () => {
    const offenders: Array<{ id: string; missing: string }> = [];
    for (const qm of QUICK_MESSAGES) {
      for (const lang of VALID_LANGUAGES) {
        const value = qm.text[lang];
        if (typeof value !== 'string' || value.trim().length === 0) {
          offenders.push({ id: qm.id, missing: lang });
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test('every entry has a valid reviewStatus for each of the 3 locales', () => {
    const offenders: Array<{ id: string; lang: string; status: unknown }> = [];
    for (const qm of QUICK_MESSAGES) {
      for (const lang of VALID_LANGUAGES) {
        const status = qm.reviewStatus[lang];
        if (!VALID_REVIEW_STATUSES.has(status)) {
          offenders.push({ id: qm.id, lang, status });
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test('catalogue contains all 10 original IDs (regression guard)', () => {
    const ids = new Set(QUICK_MESSAGES.map((qm) => qm.id));
    const missing = ORIGINAL_IDS.filter((id) => !ids.has(id));
    expect(missing).toEqual([]);
  });

  test('catalogue size is in the expected R3-DELIVERY range (75 to 95)', () => {
    expect(QUICK_MESSAGES.length).toBeGreaterThanOrEqual(75);
    expect(QUICK_MESSAGES.length).toBeLessThanOrEqual(95);
  });

  // R3-V — vehicleTypes filter integrity. Mirrors the runtime filter in
  // QuickMessages.tsx so a bad data entry surfaces here rather than at runtime.
  describe('vehicleTypes filter', () => {
    const VALID_VEHICLE_TYPES = new Set(Object.values(VehicleType));

    function filterByVehicle(vehicleType: VehicleType | null) {
      return QUICK_MESSAGES.filter((qm) => {
        if (!qm.vehicleTypes || qm.vehicleTypes.length === 0) return true;
        if (!vehicleType) return true;
        return qm.vehicleTypes.includes(vehicleType);
      });
    }

    test('every vehicleTypes entry references a valid VehicleType', () => {
      const offenders: Array<{ id: string; vt: string }> = [];
      for (const qm of QUICK_MESSAGES) {
        for (const vt of qm.vehicleTypes ?? []) {
          if (!VALID_VEHICLE_TYPES.has(vt)) offenders.push({ id: qm.id, vt });
        }
      }
      expect(offenders).toEqual([]);
    });

    test('messages without vehicleTypes are universal across all vehicle types', () => {
      const universals = QUICK_MESSAGES.filter(
        (qm) => !qm.vehicleTypes || qm.vehicleTypes.length === 0,
      );
      for (const qm of universals) {
        for (const vt of Object.values(VehicleType)) {
          expect(filterByVehicle(vt).map((m) => m.id)).toContain(qm.id);
        }
      }
    });

    test('MOTO-only message is filtered out for BIKE journeys', () => {
      const motoOnly = QUICK_MESSAGES.find(
        (qm) =>
          qm.vehicleTypes?.includes(VehicleType.MOTO) &&
          !qm.vehicleTypes.includes(VehicleType.BIKE),
      );
      expect(motoOnly).toBeDefined();
      const visibleForBike = filterByVehicle(VehicleType.BIKE).map((m) => m.id);
      expect(visibleForBike).not.toContain(motoOnly!.id);
    });

    test('null vehicleType bypasses the filter (every message survives)', () => {
      const everything = filterByVehicle(null);
      expect(everything.length).toBe(QUICK_MESSAGES.length);
    });
  });
});
