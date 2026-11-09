import { describe, test, expect } from 'vitest';
import { QUICK_MESSAGES, Language } from '@bimoto/shared';

// R3-EXPRESS — verifies the 6 urgent-handoff quick-messages are
// present, well-formed, and follow the existing review-status
// conventions (en/fr native-reviewed, rw placeholder for GAP-P4).

const URGENT_IDS = [
  'qm_urgent_recipient_waiting',
  'qm_urgent_recipient_unavailable',
  'qm_urgent_handoff_only',
  'qm_urgent_signature_required',
  'qm_urgent_sealed_envelope',
  'qm_urgent_deadline_minutes',
];

describe('R3-EXPRESS urgent-handoff quick-messages', () => {
  test('all 6 urgent IDs are present in the catalogue', () => {
    const ids = new Set(QUICK_MESSAGES.map((m) => m.id));
    const missing = URGENT_IDS.filter((id) => !ids.has(id));
    expect(missing).toEqual([]);
  });

  test('R3-EXPRESS adds exactly 6 qm_urgent_* entries (catalogue grew from 75 to 81 at R3-EXPRESS, to 87 at R3-DELIVERY, and to 91 at R3-PRIORITY)', () => {
    const matching = QUICK_MESSAGES.filter((m) => m.id.startsWith('qm_urgent_'));
    expect(matching).toHaveLength(6);
    expect(QUICK_MESSAGES).toHaveLength(91);
  });

  test('every urgent entry has en/fr native-reviewed and rw placeholder', () => {
    for (const id of URGENT_IDS) {
      const qm = QUICK_MESSAGES.find((m) => m.id === id);
      expect(qm, `missing entry ${id}`).toBeDefined();
      expect(qm!.reviewStatus[Language.EN]).toBe('native-reviewed');
      expect(qm!.reviewStatus[Language.FR]).toBe('native-reviewed');
      expect(qm!.reviewStatus[Language.RW]).toBe('placeholder');
    }
  });

  test('every urgent entry has non-empty text in all 3 languages', () => {
    for (const id of URGENT_IDS) {
      const qm = QUICK_MESSAGES.find((m) => m.id === id)!;
      for (const lang of [Language.EN, Language.RW, Language.FR] as const) {
        expect(qm.text[lang].trim().length).toBeGreaterThan(0);
      }
    }
  });

  test('every urgent entry has a valid forRole', () => {
    const VALID = new Set(['CUSTOMER', 'DRIVER', 'BOTH']);
    for (const id of URGENT_IDS) {
      const qm = QUICK_MESSAGES.find((m) => m.id === id)!;
      expect(VALID.has(qm.forRole)).toBe(true);
    }
  });

  test('forRole assignments match the dispatch table', () => {
    const expected: Record<string, 'CUSTOMER' | 'DRIVER' | 'BOTH'> = {
      qm_urgent_recipient_waiting: 'DRIVER',
      qm_urgent_recipient_unavailable: 'DRIVER',
      qm_urgent_handoff_only: 'CUSTOMER',
      qm_urgent_signature_required: 'CUSTOMER',
      qm_urgent_sealed_envelope: 'CUSTOMER',
      qm_urgent_deadline_minutes: 'CUSTOMER',
    };
    for (const [id, role] of Object.entries(expected)) {
      const qm = QUICK_MESSAGES.find((m) => m.id === id)!;
      expect(qm.forRole, `forRole mismatch on ${id}`).toBe(role);
    }
  });
});
