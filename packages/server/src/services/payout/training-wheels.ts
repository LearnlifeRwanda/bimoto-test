export type PayoutPref = 'AT_SHIFT_END' | 'TWICE_DAILY' | 'DAILY_22H';

const TRAINING_WHEELS_SHIFT_THRESHOLD = 3;

export interface UserPrefShape {
  payoutPreference: PayoutPref;
  completedShifts: number;
}

/**
 * New drivers (<3 completed shifts) who haven't explicitly opted into
 * AT_SHIFT_END or DAILY_22H get TWICE_DAILY by default — so they receive
 * earnings at 06:00 and 18:00 without needing to learn the toggle. Once
 * they've completed 3 shifts, the override lifts and their stored
 * preference is honored as-is.
 */
export function getEffectivePreference(user: UserPrefShape): PayoutPref {
  if (
    user.completedShifts < TRAINING_WHEELS_SHIFT_THRESHOLD &&
    user.payoutPreference === 'AT_SHIFT_END'
  ) {
    return 'TWICE_DAILY';
  }
  return user.payoutPreference;
}
