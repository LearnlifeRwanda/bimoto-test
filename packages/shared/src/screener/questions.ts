// R3-DRIVER-SCREENER — frozen catalogue of the 8 screener questions.
// Single source of truth for both server validation and client rendering.
// Adding a new question (or removing one) requires a coordinated change
// to the Prisma model + Zod schema + eligibility function.

import type {
  ScreenerLicenceStatus,
  ScreenerRuraStatus,
} from './types.js';
import { VehicleType } from '../types/user.js';
import type { CityBand } from '../constants/funnel.js';
import { CITY_BAND_KEYS } from '../constants/funnel.js';

export type ScreenerQuestionKind =
  | 'boolean'
  | 'enum'
  | 'integer'
  | 'optional-fk'
  | 'boolean-with-optional-int';

export interface ScreenerQuestionBase {
  id: string;
  i18nKey: string;
  required: boolean;
  /** Optional i18n key for per-question help text (rendered via HelpDisclosure). */
  helpKey?: string;
}

export interface BooleanQuestion extends ScreenerQuestionBase {
  kind: 'boolean';
}

export interface EnumQuestion<T extends string> extends ScreenerQuestionBase {
  kind: 'enum';
  options: readonly T[];
  i18nOptionKeyPrefix: string;
  /**
   * Optional i18n prefix for per-option descriptions. When set, the renderer
   * looks up `<prefix>.<optionValue>_description` and renders it as a caption
   * below each option label (missing keys render empty, not broken-key noise).
   */
  optionDescriptionKeyPrefix?: string;
}

export interface IntegerQuestion extends ScreenerQuestionBase {
  kind: 'integer';
  min: number;
  max: number;
}

export interface OptionalFkQuestion extends ScreenerQuestionBase {
  kind: 'optional-fk';
  freeTextI18nKey: string;
}

export interface BooleanWithOptionalIntQuestion extends ScreenerQuestionBase {
  kind: 'boolean-with-optional-int';
  optionalIntI18nKey: string;
  min: number;
  max: number;
}

export type ScreenerQuestion =
  | BooleanQuestion
  | EnumQuestion<ScreenerLicenceStatus>
  | EnumQuestion<ScreenerRuraStatus>
  | EnumQuestion<VehicleType>
  | EnumQuestion<CityBand>
  | IntegerQuestion
  | OptionalFkQuestion
  | BooleanWithOptionalIntQuestion;

const VEHICLE_TYPES: readonly VehicleType[] = [
  VehicleType.BIKE,
  VehicleType.MOTO,
  VehicleType.E_MOTO,
  VehicleType.E_BIKE,
];
const LICENCE_OPTIONS: readonly ScreenerLicenceStatus[] = ['yes', 'in_progress', 'no'];
const RURA_OPTIONS: readonly ScreenerRuraStatus[] = ['have', 'applying', 'not_yet'];

export const SCREENER_QUESTIONS: readonly ScreenerQuestion[] = [
  {
    id: 'is_18_or_older',
    i18nKey: 'screener.questions.is18OrOlder',
    helpKey: 'screener.help.is18OrOlder',
    kind: 'boolean',
    required: true,
  },
  {
    id: 'holds_drivers_licence',
    i18nKey: 'screener.questions.holdsDriversLicence',
    helpKey: 'screener.help.holdsDriversLicence',
    kind: 'enum',
    options: LICENCE_OPTIONS,
    i18nOptionKeyPrefix: 'screener.options.licence',
    optionDescriptionKeyPrefix: 'screener.options.licence',
    required: true,
  },
  {
    id: 'has_rura_authorisation',
    i18nKey: 'screener.questions.hasRuraAuthorisation',
    helpKey: 'screener.help.hasRuraAuthorisation',
    kind: 'enum',
    options: RURA_OPTIONS,
    i18nOptionKeyPrefix: 'screener.options.rura',
    optionDescriptionKeyPrefix: 'screener.options.rura',
    required: true,
  },
  {
    id: 'primary_vehicle_type',
    i18nKey: 'screener.questions.primaryVehicleType',
    helpKey: 'screener.help.primaryVehicleType',
    kind: 'enum',
    options: VEHICLE_TYPES,
    i18nOptionKeyPrefix: 'screener.options.vehicleType',
    optionDescriptionKeyPrefix: 'screener.options.vehicleType',
    required: true,
  },
  {
    id: 'cooperative_affiliation',
    i18nKey: 'screener.questions.cooperativeAffiliation',
    helpKey: 'screener.help.cooperativeAffiliation',
    kind: 'optional-fk',
    freeTextI18nKey: 'screener.questions.cooperativeNameProvided',
    required: false,
  },
  {
    id: 'primary_city_band',
    i18nKey: 'screener.questions.primaryCityBand',
    helpKey: 'screener.help.primaryCityBand',
    kind: 'enum',
    options: CITY_BAND_KEYS,
    i18nOptionKeyPrefix: 'screener.options.cityBand',
    required: true,
  },
  {
    id: 'weekly_availability_hours',
    i18nKey: 'screener.questions.weeklyAvailabilityHours',
    helpKey: 'screener.help.weeklyAvailabilityHours',
    kind: 'integer',
    min: 0,
    max: 100,
    required: true,
  },
  {
    id: 'prior_platform_experience',
    i18nKey: 'screener.questions.priorPlatformExperience',
    helpKey: 'screener.help.priorPlatformExperience',
    kind: 'boolean-with-optional-int',
    optionalIntI18nKey: 'screener.questions.priorPlatformMonths',
    min: 0,
    max: 240,
    required: true,
  },
] as const;

export const SCREENER_QUESTION_COUNT = SCREENER_QUESTIONS.length;
