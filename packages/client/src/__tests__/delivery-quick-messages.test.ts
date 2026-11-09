import { describe, test, expect } from 'vitest';
import { QUICK_MESSAGES, Language } from '@bimoto/shared';

// R3-DELIVERY — verifies the 6 delivery quick-messages are present,
// well-formed, and follow the existing review-status conventions
// (en/fr native-reviewed, rw placeholder for GAP-P4).

const DELIVERY_IDS = [
  'qm_delivery_parcel_handed_off',
  'qm_delivery_recipient_signed',
  'qm_delivery_parcel_delivered',
  'qm_delivery_recipient_not_present',
  'qm_delivery_fragile_parcel',
  'qm_delivery_fee_paid_already',
];

describe('R3-DELIVERY delivery quick-messages', () => {
  test('all 6 delivery IDs are present in the catalogue', () => {
    const ids = new Set(QUICK_MESSAGES.map((m) => m.id));
    const missing = DELIVERY_IDS.filter((id) => !ids.has(id));
    expect(missing).toEqual([]);
  });

  test('R3-DELIVERY adds exactly 6 qm_delivery_* entries (catalogue grows from 81 to 87 at R3-DELIVERY, then to 91 at R3-PRIORITY)', () => {
    const matching = QUICK_MESSAGES.filter((m) => m.id.startsWith('qm_delivery_'));
    expect(matching).toHaveLength(6);
    expect(QUICK_MESSAGES).toHaveLength(91);
  });

  test('every delivery entry has en/fr native-reviewed and rw placeholder', () => {
    for (const id of DELIVERY_IDS) {
      const qm = QUICK_MESSAGES.find((m) => m.id === id);
      expect(qm, `missing entry ${id}`).toBeDefined();
      expect(qm!.reviewStatus[Language.EN]).toBe('native-reviewed');
      expect(qm!.reviewStatus[Language.FR]).toBe('native-reviewed');
      expect(qm!.reviewStatus[Language.RW]).toBe('placeholder');
    }
  });

  test('every delivery entry has non-empty text in all 3 languages', () => {
    for (const id of DELIVERY_IDS) {
      const qm = QUICK_MESSAGES.find((m) => m.id === id)!;
      for (const lang of [Language.EN, Language.RW, Language.FR] as const) {
        expect(qm.text[lang].trim().length).toBeGreaterThan(0);
      }
    }
  });

  test('every delivery entry has a valid forRole', () => {
    const VALID = new Set(['CUSTOMER', 'DRIVER', 'BOTH']);
    for (const id of DELIVERY_IDS) {
      const qm = QUICK_MESSAGES.find((m) => m.id === id)!;
      expect(VALID.has(qm.forRole)).toBe(true);
    }
  });

  test('forRole assignments match the dispatch table', () => {
    const expected: Record<string, 'CUSTOMER' | 'DRIVER' | 'BOTH'> = {
      qm_delivery_parcel_handed_off: 'DRIVER',
      qm_delivery_recipient_signed: 'DRIVER',
      qm_delivery_parcel_delivered: 'DRIVER',
      qm_delivery_recipient_not_present: 'DRIVER',
      qm_delivery_fragile_parcel: 'CUSTOMER',
      qm_delivery_fee_paid_already: 'CUSTOMER',
    };
    for (const [id, role] of Object.entries(expected)) {
      const qm = QUICK_MESSAGES.find((m) => m.id === id)!;
      expect(qm.forRole, `forRole mismatch on ${id}`).toBe(role);
    }
  });
});
