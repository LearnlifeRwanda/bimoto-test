import { validateChildBooking } from '../booking-validator';

describe('child-safety/booking-validator', () => {
  describe('no child passenger declared', () => {
    it('passes through with empty requirements', () => {
      const result = validateChildBooking({
        vehicleType: 'MOTO',
        childAgeYears: null,
        hasChildPassenger: false,
        isUnaccompaniedMinor: false,
      });
      expect(result.allowed).toBe(true);
      if (result.allowed) {
        expect(result.requirements.requireHelmetConfirmation).toBe(false);
        expect(result.requirements.requireGuardianPhone).toBe(false);
      }
    });

    it('passes through even with child age set (toggle off wins)', () => {
      const result = validateChildBooking({
        vehicleType: 'MOTO',
        childAgeYears: 5,
        hasChildPassenger: false,
        isUnaccompaniedMinor: false,
      });
      expect(result.allowed).toBe(true);
    });
  });

  describe('age missing or invalid', () => {
    it('blocks when child declared but age is null', () => {
      const result = validateChildBooking({
        vehicleType: 'MOTO',
        childAgeYears: null,
        hasChildPassenger: true,
        isUnaccompaniedMinor: false,
      });
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.blockCode).toBe('CHILD_AGE_REQUIRED');
      }
    });

    it('blocks when age is undefined', () => {
      const result = validateChildBooking({
        vehicleType: 'MOTO',
        childAgeYears: undefined,
        hasChildPassenger: true,
        isUnaccompaniedMinor: false,
      });
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.blockCode).toBe('CHILD_AGE_REQUIRED');
      }
    });

    it('blocks when age is negative', () => {
      const result = validateChildBooking({
        vehicleType: 'BIKE',
        childAgeYears: -1,
        hasChildPassenger: true,
        isUnaccompaniedMinor: false,
      });
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.blockCode).toBe('CHILD_AGE_INVALID');
      }
    });

    it('blocks when age >= 18 (adult, not a child)', () => {
      const result = validateChildBooking({
        vehicleType: 'BIKE',
        childAgeYears: 18,
        hasChildPassenger: true,
        isUnaccompaniedMinor: false,
      });
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.blockCode).toBe('CHILD_AGE_INVALID');
      }
    });

    it('blocks when age is unrealistically high', () => {
      const result = validateChildBooking({
        vehicleType: 'MOTO',
        childAgeYears: 99,
        hasChildPassenger: true,
        isUnaccompaniedMinor: false,
      });
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.blockCode).toBe('CHILD_AGE_INVALID');
      }
    });
  });

  describe('vehicle minimum age', () => {
    it('blocks MOTO + age 11 with CHILD_TOO_YOUNG_FOR_MOTO', () => {
      const result = validateChildBooking({
        vehicleType: 'MOTO',
        childAgeYears: 11,
        hasChildPassenger: true,
        isUnaccompaniedMinor: false,
      });
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.blockCode).toBe('CHILD_TOO_YOUNG_FOR_MOTO');
        expect(result.blockReason).toContain('MOTO');
      }
    });

    it('allows MOTO + age 12; requires helmet confirmation', () => {
      const result = validateChildBooking({
        vehicleType: 'MOTO',
        childAgeYears: 12,
        hasChildPassenger: true,
        isUnaccompaniedMinor: false,
      });
      expect(result.allowed).toBe(true);
      if (result.allowed) {
        expect(result.requirements.requireHelmetConfirmation).toBe(true);
        expect(result.requirements.requireGuardianPhone).toBe(false);
      }
    });

    it('allows MOTO + age 13; helmet not required (above helmet age band)', () => {
      const result = validateChildBooking({
        vehicleType: 'MOTO',
        childAgeYears: 13,
        hasChildPassenger: true,
        isUnaccompaniedMinor: false,
      });
      expect(result.allowed).toBe(true);
      if (result.allowed) {
        expect(result.requirements.requireHelmetConfirmation).toBe(false);
      }
    });

    it('blocks E_MOTO + age 11 with CHILD_TOO_YOUNG_FOR_E_MOTO', () => {
      const result = validateChildBooking({
        vehicleType: 'E_MOTO',
        childAgeYears: 11,
        hasChildPassenger: true,
        isUnaccompaniedMinor: false,
      });
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.blockCode).toBe('CHILD_TOO_YOUNG_FOR_E_MOTO');
      }
    });

    it('allows BIKE + age 5; helmet confirmation NOT required (bicycles are not in the band)', () => {
      const result = validateChildBooking({
        vehicleType: 'BIKE',
        childAgeYears: 5,
        hasChildPassenger: true,
        isUnaccompaniedMinor: false,
      });
      expect(result.allowed).toBe(true);
      if (result.allowed) {
        expect(result.requirements.requireHelmetConfirmation).toBe(false);
      }
    });

    it('allows E_BIKE + age 4', () => {
      const result = validateChildBooking({
        vehicleType: 'E_BIKE',
        childAgeYears: 4,
        hasChildPassenger: true,
        isUnaccompaniedMinor: false,
      });
      expect(result.allowed).toBe(true);
    });
  });

  describe('unaccompanied minor', () => {
    it('blocks unaccompanied minor on BIKE + age 17', () => {
      const result = validateChildBooking({
        vehicleType: 'BIKE',
        childAgeYears: 17,
        hasChildPassenger: true,
        isUnaccompaniedMinor: true,
      });
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.blockCode).toBe('UNACCOMPANIED_MINOR_NOT_ALLOWED');
      }
    });

    it('blocks unaccompanied minor on MOTO + age 16', () => {
      const result = validateChildBooking({
        vehicleType: 'MOTO',
        childAgeYears: 16,
        hasChildPassenger: true,
        isUnaccompaniedMinor: true,
      });
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.blockCode).toBe('UNACCOMPANIED_MINOR_NOT_ALLOWED');
      }
    });
  });
});
