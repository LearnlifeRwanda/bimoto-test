// R3-DRIVER-SCREENER — server-side screener service. Wraps the pure
// eligibility function (in @bimoto/shared) with persistence: upsert
// 1:1 against DriverProfile, map shared answer literals to Prisma
// enums, return the authoritative eligibility result.

import prisma from '../prisma';
import {
  evaluateEligibility,
  VehicleType,
  type ScreenerAnswers,
  type ScreenerEligibilityResult as SharedEligibilityResult,
  type ScreenerEligibilityOutcome,
  type ScreenerIneligibilityReason as SharedIneligibilityReason,
  type ScreenerLicenceStatus,
  type ScreenerRuraStatus,
} from '@bimoto/shared';
import type {
  ScreenerLicenceStatus as PrismaLicenceStatus,
  ScreenerRuraStatus as PrismaRuraStatus,
  ScreenerEligibilityResult as PrismaEligibilityResult,
  ScreenerIneligibilityReason as PrismaIneligibilityReason,
} from '@prisma/client';

export class DriverProfileNotFoundError extends Error {
  constructor() {
    super('driver_profile_not_found');
    this.name = 'DriverProfileNotFoundError';
  }
}

const LICENCE_TO_PRISMA: Record<ScreenerLicenceStatus, PrismaLicenceStatus> = {
  yes: 'YES',
  in_progress: 'IN_PROGRESS',
  no: 'NO',
};

const LICENCE_FROM_PRISMA: Record<PrismaLicenceStatus, ScreenerLicenceStatus> = {
  YES: 'yes',
  IN_PROGRESS: 'in_progress',
  NO: 'no',
};

const RURA_TO_PRISMA: Record<ScreenerRuraStatus, PrismaRuraStatus> = {
  have: 'HAVE',
  applying: 'APPLYING',
  not_yet: 'NOT_YET',
};

const RURA_FROM_PRISMA: Record<PrismaRuraStatus, ScreenerRuraStatus> = {
  HAVE: 'have',
  APPLYING: 'applying',
  NOT_YET: 'not_yet',
};

const ELIGIBILITY_TO_PRISMA: Record<
  ScreenerEligibilityOutcome,
  PrismaEligibilityResult
> = {
  eligible: 'ELIGIBLE',
  ineligible: 'INELIGIBLE',
  needs_follow_up: 'NEEDS_FOLLOW_UP',
};

const ELIGIBILITY_FROM_PRISMA: Record<
  PrismaEligibilityResult,
  ScreenerEligibilityOutcome
> = {
  ELIGIBLE: 'eligible',
  INELIGIBLE: 'ineligible',
  NEEDS_FOLLOW_UP: 'needs_follow_up',
};

const INELIGIBILITY_TO_PRISMA: Record<
  SharedIneligibilityReason,
  PrismaIneligibilityReason
> = {
  under_18: 'UNDER_18',
  no_drivers_licence: 'NO_DRIVERS_LICENCE',
  needs_rura_path: 'NEEDS_RURA_PATH',
  low_availability: 'LOW_AVAILABILITY',
};

const INELIGIBILITY_FROM_PRISMA: Record<
  PrismaIneligibilityReason,
  SharedIneligibilityReason
> = {
  UNDER_18: 'under_18',
  NO_DRIVERS_LICENCE: 'no_drivers_licence',
  NEEDS_RURA_PATH: 'needs_rura_path',
  LOW_AVAILABILITY: 'low_availability',
};

export interface SubmitScreenerResult {
  screenerId: string;
  eligibilityResult: ScreenerEligibilityOutcome;
  ineligibilityReason: SharedIneligibilityReason | null;
}

export async function submitScreener(
  userId: string,
  submission: ScreenerAnswers,
): Promise<SubmitScreenerResult> {
  const driverProfile = await prisma.driverProfile.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!driverProfile) {
    throw new DriverProfileNotFoundError();
  }

  const evaluation: SharedEligibilityResult = evaluateEligibility(submission);
  const eligibilityResult: PrismaEligibilityResult =
    ELIGIBILITY_TO_PRISMA[evaluation.result];
  const ineligibilityReason: PrismaIneligibilityReason | null = evaluation.reason
    ? INELIGIBILITY_TO_PRISMA[evaluation.reason]
    : null;

  const data = {
    driverProfileId: driverProfile.id,
    is18OrOlder: submission.is18OrOlder,
    holdsDriversLicence: LICENCE_TO_PRISMA[submission.holdsDriversLicence],
    hasRuraAuthorisation: RURA_TO_PRISMA[submission.hasRuraAuthorisation],
    primaryVehicleType: submission.primaryVehicleType,
    cooperativeId: submission.cooperativeId,
    cooperativeNameProvided: submission.cooperativeNameProvided,
    primaryCityBand: submission.primaryCityBand,
    weeklyAvailabilityHours: submission.weeklyAvailabilityHours,
    priorPlatformExperience: submission.priorPlatformExperience,
    priorPlatformMonths: submission.priorPlatformMonths,
    eligibilityResult,
    ineligibilityReason,
  };

  const row = await prisma.driverScreener.upsert({
    where: { driverProfileId: driverProfile.id },
    create: data,
    update: {
      ...data,
      // completedAt remains at row creation; resubmits update everything
      // else but do not reset the stamp. Restating timestamp on resubmit
      // would distort the funnel-metrics cohort attribution.
    },
  });

  return {
    screenerId: row.id,
    eligibilityResult: ELIGIBILITY_FROM_PRISMA[row.eligibilityResult],
    ineligibilityReason: row.ineligibilityReason
      ? INELIGIBILITY_FROM_PRISMA[row.ineligibilityReason]
      : null,
  };
}

export interface GetScreenerResult {
  submission: ScreenerAnswers;
  eligibilityResult: ScreenerEligibilityOutcome;
  ineligibilityReason: SharedIneligibilityReason | null;
  completedAt: Date;
}

export async function getScreenerForDriver(
  userId: string,
): Promise<GetScreenerResult | null> {
  const driverProfile = await prisma.driverProfile.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!driverProfile) return null;

  const row = await prisma.driverScreener.findUnique({
    where: { driverProfileId: driverProfile.id },
  });
  if (!row) return null;

  const submission: ScreenerAnswers = {
    is18OrOlder: row.is18OrOlder,
    holdsDriversLicence: LICENCE_FROM_PRISMA[row.holdsDriversLicence],
    hasRuraAuthorisation: RURA_FROM_PRISMA[row.hasRuraAuthorisation],
    // Prisma's $Enums.VehicleType is a string union with the same
    // members as the shared VehicleType enum, but TypeScript treats
    // them as nominally distinct — the cast bridges the boundary.
    primaryVehicleType: row.primaryVehicleType as VehicleType,
    cooperativeId: row.cooperativeId,
    cooperativeNameProvided: row.cooperativeNameProvided,
    primaryCityBand: row.primaryCityBand as ScreenerAnswers['primaryCityBand'],
    weeklyAvailabilityHours: row.weeklyAvailabilityHours,
    priorPlatformExperience: row.priorPlatformExperience,
    priorPlatformMonths: row.priorPlatformMonths,
  };

  return {
    submission,
    eligibilityResult: ELIGIBILITY_FROM_PRISMA[row.eligibilityResult],
    ineligibilityReason: row.ineligibilityReason
      ? INELIGIBILITY_FROM_PRISMA[row.ineligibilityReason]
      : null,
    completedAt: row.completedAt,
  };
}
