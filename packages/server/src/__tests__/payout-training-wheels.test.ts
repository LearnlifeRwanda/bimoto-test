import { getEffectivePreference } from '../services/payout/training-wheels';

describe('getEffectivePreference', () => {
  test('shifts < 3 + AT_SHIFT_END → TWICE_DAILY (override)', () => {
    expect(
      getEffectivePreference({ payoutPreference: 'AT_SHIFT_END', completedShifts: 0 }),
    ).toBe('TWICE_DAILY');
    expect(
      getEffectivePreference({ payoutPreference: 'AT_SHIFT_END', completedShifts: 2 }),
    ).toBe('TWICE_DAILY');
  });

  test('shifts < 3 + TWICE_DAILY → TWICE_DAILY (no override needed)', () => {
    expect(
      getEffectivePreference({ payoutPreference: 'TWICE_DAILY', completedShifts: 0 }),
    ).toBe('TWICE_DAILY');
  });

  test('shifts < 3 + DAILY_22H → DAILY_22H (driver chose, respect it)', () => {
    expect(
      getEffectivePreference({ payoutPreference: 'DAILY_22H', completedShifts: 0 }),
    ).toBe('DAILY_22H');
  });

  test('shifts >= 3 + AT_SHIFT_END → AT_SHIFT_END (override lifted)', () => {
    expect(
      getEffectivePreference({ payoutPreference: 'AT_SHIFT_END', completedShifts: 3 }),
    ).toBe('AT_SHIFT_END');
    expect(
      getEffectivePreference({ payoutPreference: 'AT_SHIFT_END', completedShifts: 47 }),
    ).toBe('AT_SHIFT_END');
  });

  test('boundary at exactly 3 — override is strictly < 3', () => {
    expect(
      getEffectivePreference({ payoutPreference: 'AT_SHIFT_END', completedShifts: 3 }),
    ).toBe('AT_SHIFT_END');
  });
});
