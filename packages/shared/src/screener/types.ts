// R3-DRIVER-SCREENER — shared types for the 8-question driver eligibility
// screener. Imported by both server (driver-screener.service.ts) and
// client (DriverScreenerPage.tsx). Mirrors the Prisma DriverScreener
// model in packages/server/prisma/schema.prisma.

import type { VehicleType } from '../types/user.js';
import type { CityBand } from '../constants/funnel.js';

export type ScreenerLicenceStatus = 'yes' | 'in_progress' | 'no';
export type ScreenerRuraStatus = 'have' | 'applying' | 'not_yet';

export type ScreenerEligibilityOutcome =
  | 'eligible'
  | 'ineligible'
  | 'needs_follow_up';

export type ScreenerIneligibilityReason =
  | 'under_18'
  | 'no_drivers_licence'
  | 'needs_rura_path'
  | 'low_availability';

export interface ScreenerAnswers {
  is18OrOlder: boolean;
  holdsDriversLicence: ScreenerLicenceStatus;
  hasRuraAuthorisation: ScreenerRuraStatus;
  primaryVehicleType: VehicleType;
  cooperativeId: string | null;
  cooperativeNameProvided: string | null;
  primaryCityBand: CityBand;
  weeklyAvailabilityHours: number;
  priorPlatformExperience: boolean;
  priorPlatformMonths: number | null;
}

export type ScreenerSubmission = ScreenerAnswers;

export interface ScreenerEligibilityResult {
  result: ScreenerEligibilityOutcome;
  reason?: ScreenerIneligibilityReason;
}

export interface ScreenerSubmissionResponse {
  screenerId: string;
  eligibilityResult: ScreenerEligibilityOutcome;
  ineligibilityReason: ScreenerIneligibilityReason | null;
}
