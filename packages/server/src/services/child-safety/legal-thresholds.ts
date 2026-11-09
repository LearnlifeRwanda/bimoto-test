// R3-CHILD — placeholder legal thresholds.
//
// !!! TODO(legal-research) !!!
// These values are conservative fail-closed placeholders pending
// RESEARCH-1 (Rwandan transport law). The booking-validator at
// services/child-safety/booking-validator.ts uses these thresholds
// to block under-age trips. Once RESEARCH-1 returns authoritative
// values, ops update this file (or, in a follow-up dispatch, an
// admin config UI). NO schema or code change is required for
// recalibration; only the constants below.
//
// The defaults are STRICTEST PLAUSIBLE READING — fail-closed:
//   - MIN_AGE_MOTO_PASSENGER = 12 (range per pilot spec §4.1: 8-12)
//   - MIN_AGE_BIKE_PASSENGER = 0 (no a-priori block; child seats common)
//   - MIN_AGE_UNACCOMPANIED_MINOR = 18 (no unaccompanied in pilot v1)
//   - MAX_CHILD_HELMET_AGE_BAND = 12 (children up to 12 require child-sized helmet)
//   - MAX_CHILD_PASSENGERS_PER_VEHICLE = 1 (two-up limit on motos; single child)
export const LEGAL_THRESHOLDS = {
  MIN_AGE_MOTO_PASSENGER: 12,
  MIN_AGE_E_MOTO_PASSENGER: 12,
  MIN_AGE_BIKE_PASSENGER: 0,
  MIN_AGE_E_BIKE_PASSENGER: 0,
  MIN_AGE_UNACCOMPANIED_MINOR: 18,
  MAX_CHILD_HELMET_AGE_BAND: 12,
  MAX_CHILD_PASSENGERS_PER_VEHICLE: 1,
} as const;

export type LegalThresholdKey = keyof typeof LEGAL_THRESHOLDS;
