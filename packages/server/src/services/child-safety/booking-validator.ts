import type { VehicleType } from '@prisma/client';
import { LEGAL_THRESHOLDS } from './legal-thresholds';

// R3-CHILD — booking-time validation for child-passenger trips.
//
// Pure function (no IO, no prisma) so it can be exercised cheaply in
// unit tests and reused on both routes (createJourney) and any future
// admin / cooperative reconciliation flows. Returns either:
//   - { allowed: true, requirements } — the trip can proceed; the
//     requirements object tells the route layer whether helmet
//     confirmation / guardian phone are needed
//   - { allowed: false, blockReason, blockCode } — the trip is blocked;
//     the route returns 422 with these fields
//
// All numerical thresholds resolve via LEGAL_THRESHOLDS, so the entire
// gating logic can be retuned by editing legal-thresholds.ts alone.

export type ChildBookingInput = {
  vehicleType: VehicleType;
  childAgeYears: number | null | undefined;
  hasChildPassenger: boolean;
  isUnaccompaniedMinor: boolean;
};

export type ChildBlockCode =
  | 'CHILD_TOO_YOUNG_FOR_MOTO'
  | 'CHILD_TOO_YOUNG_FOR_E_MOTO'
  | 'CHILD_TOO_YOUNG_FOR_BIKE'
  | 'CHILD_TOO_YOUNG_FOR_E_BIKE'
  | 'UNACCOMPANIED_MINOR_NOT_ALLOWED'
  | 'CHILD_AGE_REQUIRED'
  | 'CHILD_AGE_INVALID';

export type ChildBookingRequirements = {
  requireHelmetConfirmation: boolean;
  requireGuardianPhone: boolean;
};

export type ChildBookingResult =
  | { allowed: true; requirements: ChildBookingRequirements }
  | { allowed: false; blockReason: string; blockCode: ChildBlockCode };

export function validateChildBooking(input: ChildBookingInput): ChildBookingResult {
  // Pass-through: no child declared = no validation. Keeps non-child
  // bookings exactly identical to the pre-R3-CHILD path.
  if (!input.hasChildPassenger) {
    return {
      allowed: true,
      requirements: { requireHelmetConfirmation: false, requireGuardianPhone: false },
    };
  }

  const age = input.childAgeYears;
  if (age == null) {
    return {
      allowed: false,
      blockReason: 'Child age is required when travelling with a child.',
      blockCode: 'CHILD_AGE_REQUIRED',
    };
  }
  if (!Number.isInteger(age) || age < 0 || age > 17) {
    return {
      allowed: false,
      blockReason: 'Child age must be a whole number between 0 and 17.',
      blockCode: 'CHILD_AGE_INVALID',
    };
  }

  const minAge = minAgeForVehicle(input.vehicleType);
  if (age < minAge) {
    return {
      allowed: false,
      blockReason: `Children under ${minAge} cannot ride on ${input.vehicleType} in Rwanda. Please choose another vehicle type.`,
      blockCode: blockCodeForVehicle(input.vehicleType),
    };
  }

  // Pilot v1 does not support unaccompanied minors. The
  // MIN_AGE_UNACCOMPANIED_MINOR threshold is 18 by default, so any
  // declared minor (age < 18) trips this branch.
  if (input.isUnaccompaniedMinor && age < LEGAL_THRESHOLDS.MIN_AGE_UNACCOMPANIED_MINOR) {
    return {
      allowed: false,
      blockReason: 'Unaccompanied minor trips are not yet supported in the pilot.',
      blockCode: 'UNACCOMPANIED_MINOR_NOT_ALLOWED',
    };
  }

  const requireHelmetConfirmation =
    (input.vehicleType === 'MOTO' || input.vehicleType === 'E_MOTO') &&
    age <= LEGAL_THRESHOLDS.MAX_CHILD_HELMET_AGE_BAND;
  const requireGuardianPhone = input.isUnaccompaniedMinor;

  return {
    allowed: true,
    requirements: { requireHelmetConfirmation, requireGuardianPhone },
  };
}

function minAgeForVehicle(v: VehicleType): number {
  switch (v) {
    case 'MOTO':
      return LEGAL_THRESHOLDS.MIN_AGE_MOTO_PASSENGER;
    case 'E_MOTO':
      return LEGAL_THRESHOLDS.MIN_AGE_E_MOTO_PASSENGER;
    case 'BIKE':
      return LEGAL_THRESHOLDS.MIN_AGE_BIKE_PASSENGER;
    case 'E_BIKE':
      return LEGAL_THRESHOLDS.MIN_AGE_E_BIKE_PASSENGER;
  }
}

function blockCodeForVehicle(v: VehicleType): ChildBlockCode {
  switch (v) {
    case 'MOTO':
      return 'CHILD_TOO_YOUNG_FOR_MOTO';
    case 'E_MOTO':
      return 'CHILD_TOO_YOUNG_FOR_E_MOTO';
    case 'BIKE':
      return 'CHILD_TOO_YOUNG_FOR_BIKE';
    case 'E_BIKE':
      return 'CHILD_TOO_YOUNG_FOR_E_BIKE';
  }
}
