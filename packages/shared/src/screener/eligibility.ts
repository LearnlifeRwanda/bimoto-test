// R3-DRIVER-SCREENER — pure eligibility evaluator. No DB, no IO, no
// side effects. Imported by both server (for the authoritative result
// stored on submit) and client (for local pre-render). Same function,
// same answers → same result.

import type {
  ScreenerAnswers,
  ScreenerEligibilityResult,
} from './types.js';
import { getVehicleCompliance } from '../constants/vehicle-compliance.js';

export const SCREENER_MIN_WEEKLY_AVAILABILITY_HOURS = 5 as const;

export function evaluateEligibility(
  answers: ScreenerAnswers,
): ScreenerEligibilityResult {
  // BIKE-GATE — licence and RURA authorization only screen out
  // applicants whose primary vehicle type actually requires them per
  // the vehicle-compliance matrix (a bicycle applicant needs neither).
  const compliance = getVehicleCompliance(answers.primaryVehicleType);
  if (!answers.is18OrOlder) {
    return { result: 'ineligible', reason: 'under_18' };
  }
  if (compliance.licenseRequired && answers.holdsDriversLicence === 'no') {
    return { result: 'ineligible', reason: 'no_drivers_licence' };
  }
  if (compliance.ruraRequired && answers.hasRuraAuthorisation === 'not_yet') {
    return { result: 'needs_follow_up', reason: 'needs_rura_path' };
  }
  if (answers.weeklyAvailabilityHours < SCREENER_MIN_WEEKLY_AVAILABILITY_HOURS) {
    return { result: 'needs_follow_up', reason: 'low_availability' };
  }
  return { result: 'eligible' };
}
