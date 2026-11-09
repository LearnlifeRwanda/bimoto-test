import { describe, test, expect } from 'vitest';
import { QUICK_MESSAGES, Language } from '@bimoto/shared';

// R3-CHILD — verifies the 12 child + 3 safety quick-messages are
// present, well-formed, and follow the existing review-status
// conventions (en/fr native-reviewed, rw placeholder for GAP-P4).

const CHILD_IDS = [
  'qm_child_travelling_with_child',
  'qm_child_drive_slower',
  'qm_child_child_afraid',
  'qm_child_has_helmet',
  'qm_child_no_helmet',
  'qm_child_have_seat',
  'qm_child_parent_calling',
  'qm_child_child_alone',
  'qm_child_child_picked_up',
  'qm_child_child_delivered',
  'qm_child_speaks_only_rw',
  'qm_child_call_parent_on_arrival',
];

const SAFETY_IDS = [
  'qm_safety_confirm_age',
  'qm_safety_cannot_carry_child',
  'qm_safety_helmets_required',
];

const ALL_NEW_IDS = [...CHILD_IDS, ...SAFETY_IDS];

describe('R3-CHILD child + safety quick-messages', () => {
  test('all 12 child IDs are present in the catalogue', () => {
    const ids = new Set(QUICK_MESSAGES.map((m) => m.id));
    const missing = CHILD_IDS.filter((id) => !ids.has(id));
    expect(missing).toEqual([]);
  });

  test('all 3 safety IDs are present in the catalogue', () => {
    const ids = new Set(QUICK_MESSAGES.map((m) => m.id));
    const missing = SAFETY_IDS.filter((id) => !ids.has(id));
    expect(missing).toEqual([]);
  });

  test('R3-CHILD adds exactly 15 new entries (catalogue grows from 60 to 75)', () => {
    const matching = QUICK_MESSAGES.filter((m) =>
      m.id.startsWith('qm_child_') || m.id.startsWith('qm_safety_'),
    );
    expect(matching).toHaveLength(15);
  });

  test('every new entry has en/fr native-reviewed and rw placeholder', () => {
    for (const id of ALL_NEW_IDS) {
      const qm = QUICK_MESSAGES.find((m) => m.id === id);
      expect(qm, `missing entry ${id}`).toBeDefined();
      expect(qm!.reviewStatus[Language.EN]).toBe('native-reviewed');
      expect(qm!.reviewStatus[Language.FR]).toBe('native-reviewed');
      expect(qm!.reviewStatus[Language.RW]).toBe('placeholder');
    }
  });

  test('every new entry has non-empty text in all 3 languages', () => {
    for (const id of ALL_NEW_IDS) {
      const qm = QUICK_MESSAGES.find((m) => m.id === id)!;
      for (const lang of [Language.EN, Language.RW, Language.FR] as const) {
        expect(qm.text[lang].trim().length).toBeGreaterThan(0);
      }
    }
  });

  test('every new entry has a valid forRole', () => {
    const VALID = new Set(['CUSTOMER', 'DRIVER', 'BOTH']);
    for (const id of ALL_NEW_IDS) {
      const qm = QUICK_MESSAGES.find((m) => m.id === id)!;
      expect(VALID.has(qm.forRole)).toBe(true);
    }
  });
});
