// R3-DRIVER-SCREENER — Zod schema for screener submissions. Server
// validates with this before persisting; client uses the same shape for
// form validation. Mirrors ScreenerAnswers in screener/types.ts.

import { z } from 'zod';
import { CITY_BAND_KEYS } from '../constants/funnel.js';
import { VehicleType } from '../types/user.js';

const LICENCE_VALUES = ['yes', 'in_progress', 'no'] as const;
const RURA_VALUES = ['have', 'applying', 'not_yet'] as const;

export const screenerSubmissionSchema = z
  .object({
    is18OrOlder: z.boolean(),
    holdsDriversLicence: z.enum(LICENCE_VALUES),
    hasRuraAuthorisation: z.enum(RURA_VALUES),
    primaryVehicleType: z.nativeEnum(VehicleType),
    cooperativeId: z.string().min(1).nullable(),
    cooperativeNameProvided: z.string().min(1).max(200).nullable(),
    primaryCityBand: z.enum(
      CITY_BAND_KEYS as unknown as [string, ...string[]],
    ),
    weeklyAvailabilityHours: z.number().int().min(0).max(100),
    priorPlatformExperience: z.boolean(),
    priorPlatformMonths: z.number().int().min(0).max(240).nullable(),
  })
  .refine(
    (v) =>
      // If experience=false, months should be null. If true, months may be set or null.
      v.priorPlatformExperience || v.priorPlatformMonths == null,
    {
      message:
        'priorPlatformMonths must be null when priorPlatformExperience is false',
      path: ['priorPlatformMonths'],
    },
  );

export type ScreenerSubmissionInput = z.infer<typeof screenerSubmissionSchema>;
