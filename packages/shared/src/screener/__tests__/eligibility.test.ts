// R3-DRIVER-SCREENER — unit tests for the pure eligibility evaluator.
// One branch per test. No DB, no mocks — pure function in, pure result
// out.

import { evaluateEligibility } from '../eligibility.js';
import type { ScreenerAnswers } from '../types.js';
import { VehicleType } from '../../types/user.js';

function baseEligibleAnswers(): ScreenerAnswers {
  return {
    is18OrOlder: true,
    holdsDriversLicence: 'yes',
    hasRuraAuthorisation: 'have',
    primaryVehicleType: VehicleType.MOTO,
    cooperativeId: null,
    cooperativeNameProvided: null,
    primaryCityBand: 'kigali_dense',
    weeklyAvailabilityHours: 20,
    priorPlatformExperience: false,
    priorPlatformMonths: null,
  };
}

describe('evaluateEligibility', () => {
  it('eligible when all required answers pass', () => {
    const result = evaluateEligibility(baseEligibleAnswers());
    expect(result).toEqual({ result: 'eligible' });
  });

  it('ineligible under_18 when is_18_or_older=false', () => {
    const answers = { ...baseEligibleAnswers(), is18OrOlder: false };
    expect(evaluateEligibility(answers)).toEqual({
      result: 'ineligible',
      reason: 'under_18',
    });
  });

  it('ineligible no_drivers_licence when holdsDriversLicence=no', () => {
    const answers = {
      ...baseEligibleAnswers(),
      holdsDriversLicence: 'no' as const,
    };
    expect(evaluateEligibility(answers)).toEqual({
      result: 'ineligible',
      reason: 'no_drivers_licence',
    });
  });

  it('needs_follow_up needs_rura_path when hasRuraAuthorisation=not_yet', () => {
    const answers = {
      ...baseEligibleAnswers(),
      hasRuraAuthorisation: 'not_yet' as const,
    };
    expect(evaluateEligibility(answers)).toEqual({
      result: 'needs_follow_up',
      reason: 'needs_rura_path',
    });
  });

  it('needs_follow_up low_availability when weeklyAvailabilityHours<5', () => {
    const answers = { ...baseEligibleAnswers(), weeklyAvailabilityHours: 4 };
    expect(evaluateEligibility(answers)).toEqual({
      result: 'needs_follow_up',
      reason: 'low_availability',
    });
  });

  it('boundary: weeklyAvailabilityHours=5 is eligible (gate is strictly less than)', () => {
    const answers = { ...baseEligibleAnswers(), weeklyAvailabilityHours: 5 };
    expect(evaluateEligibility(answers)).toEqual({ result: 'eligible' });
  });

  it('under_18 takes precedence over licence/rura/availability problems', () => {
    const answers: ScreenerAnswers = {
      ...baseEligibleAnswers(),
      is18OrOlder: false,
      holdsDriversLicence: 'no',
      hasRuraAuthorisation: 'not_yet',
      weeklyAvailabilityHours: 0,
    };
    expect(evaluateEligibility(answers)).toEqual({
      result: 'ineligible',
      reason: 'under_18',
    });
  });

  it('eligibility is pure — repeated calls return identical results', () => {
    const answers = baseEligibleAnswers();
    const a = evaluateEligibility(answers);
    const b = evaluateEligibility(answers);
    expect(a).toEqual(b);
  });
});

// BIKE-GATE — licence/RURA screening is compliance-conditional: it only
// applies to vehicle types whose compliance-matrix entry requires them.
describe('evaluateEligibility — vehicle-aware screening', () => {
  it('BIKE applicant with no licence and no RURA path is eligible', () => {
    const answers: ScreenerAnswers = {
      ...baseEligibleAnswers(),
      primaryVehicleType: VehicleType.BIKE,
      holdsDriversLicence: 'no',
      hasRuraAuthorisation: 'not_yet',
    };
    expect(evaluateEligibility(answers)).toEqual({ result: 'eligible' });
  });

  it('E_BIKE applicant with no licence and no RURA path is eligible', () => {
    const answers: ScreenerAnswers = {
      ...baseEligibleAnswers(),
      primaryVehicleType: VehicleType.E_BIKE,
      holdsDriversLicence: 'no',
      hasRuraAuthorisation: 'not_yet',
    };
    expect(evaluateEligibility(answers)).toEqual({ result: 'eligible' });
  });

  it('BIKE applicant is still screened for age', () => {
    const answers: ScreenerAnswers = {
      ...baseEligibleAnswers(),
      primaryVehicleType: VehicleType.BIKE,
      is18OrOlder: false,
    };
    expect(evaluateEligibility(answers)).toEqual({
      result: 'ineligible',
      reason: 'under_18',
    });
  });

  it('BIKE applicant is still screened for availability', () => {
    const answers: ScreenerAnswers = {
      ...baseEligibleAnswers(),
      primaryVehicleType: VehicleType.BIKE,
      holdsDriversLicence: 'no',
      weeklyAvailabilityHours: 2,
    };
    expect(evaluateEligibility(answers)).toEqual({
      result: 'needs_follow_up',
      reason: 'low_availability',
    });
  });

  it('E_MOTO applicant without a licence stays ineligible (motorized rules unchanged)', () => {
    const answers: ScreenerAnswers = {
      ...baseEligibleAnswers(),
      primaryVehicleType: VehicleType.E_MOTO,
      holdsDriversLicence: 'no',
    };
    expect(evaluateEligibility(answers)).toEqual({
      result: 'ineligible',
      reason: 'no_drivers_licence',
    });
  });
});
