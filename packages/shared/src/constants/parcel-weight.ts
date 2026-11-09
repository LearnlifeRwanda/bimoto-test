import { VehicleType } from '../types/user.js';

// FIELD-FIT G5 — what a machine may carry.
//
// These four numbers are the team's own, settled by the founder from the
// August document on 11 August, and they are reproduced here verbatim:
//
//   bicycle alone .................. up to 70 kg
//   bicycle with passenger ......... up to 10 kg
//   moto alone ..................... envelope-size parcels only
//   moto with passenger ............ up to 15 kg
//
// Two things to read carefully before changing anything here.
//
// "Alone" and "with passenger" are not a new concept: a parcel travels
// alone on a GOODS/messenger journey, and travels with a passenger when
// it rides along on a PASSENGER journey (the delivery-stop flow). That
// is the whole of the distinction — see isCarryingPassenger below.
//
// "Moto alone" is the one rule expressed as a size rather than a
// weight, exactly as the team wrote it. It is mapped onto the
// goodsSizeCategory taxonomy that already exists (SMALL / MEDIUM /
// LARGE) rather than given a parallel one of its own: envelope-size is
// SMALL. So a moto carrying only a parcel is limited by category and
// not by kilograms, and the other three rules are limited by kilograms
// and not by category.
//
// Delivery *speed* tiers (standard/express) are a separate, open
// question and are not represented here.

export const PARCEL_WEIGHT_RULES = {
  /** Bicycle carrying only a parcel. */
  BICYCLE_ALONE_MAX_KG: 70,
  /** Bicycle carrying a passenger, parcel riding along. */
  BICYCLE_WITH_PASSENGER_MAX_KG: 10,
  /** Moto carrying a passenger, parcel riding along. */
  MOTO_WITH_PASSENGER_MAX_KG: 15,
} as const;

/** Moto carrying only a parcel: envelope-size, i.e. the SMALL category. */
export const MOTO_ALONE_MAX_SIZE_CATEGORY = 'SMALL' as const;

/**
 * Is the moto-alone size rule a refusal, or something we say?
 *
 * OPEN QUESTION FOR THE TEAM — read before changing this to true.
 *
 * The other three rules are weight limits on a field that did not exist
 * until now, so enforcing them refuses nothing that was ever booked.
 * This one is different: it is a limit on `goodsSizeCategory`, which the
 * parcel form has always sent, and whose default is MEDIUM on a MOTO.
 * Enforcing it as written would refuse the single most ordinary parcel
 * booking in the app — a moto carrying a medium parcel — and with it
 * most of the existing parcel business. e2e/tests/create-ride-ui.spec.ts
 * asserts exactly that booking succeeds, because today it does.
 *
 * "Moto alone: envelope-size parcels only" reads like a statement about
 * what a motari should safely carry, and it may or may not have been
 * meant as a hard block on bookings that work today. That is not a
 * question this code should answer on its own, so for now the limit is
 * stated to the customer on the parcel form and recorded server-side,
 * and the booking still goes through.
 *
 * To turn it into a refusal: flip this to true. Nothing else changes —
 * validateParcelLoad already computes the violation, and the copy and
 * error code already exist.
 */
export const ENFORCE_MOTO_ALONE_SIZE_RULE = false;

export type GoodsSizeCategory = 'SMALL' | 'MEDIUM' | 'LARGE';

const SIZE_ORDER: GoodsSizeCategory[] = ['SMALL', 'MEDIUM', 'LARGE'];

/** BIKE and E_BIKE are bicycles; MOTO and E_MOTO are motos. */
export function isBicycle(vehicleType: string): boolean {
  return vehicleType === VehicleType.BIKE || vehicleType === VehicleType.E_BIKE;
}

/**
 * Does this journey carry a person as well as the parcel?
 *
 * PASSENGER journeys do (the parcel rides along on a delivery stop);
 * GOODS and the two messenger tiers are parcel-only runs.
 */
export function isCarryingPassenger(journeyType: string): boolean {
  return journeyType === 'PASSENGER';
}

export interface ParcelAllowance {
  /** Kilogram ceiling, or null when the rule is a size rule instead. */
  maxWeightKg: number | null;
  /** Largest permitted category, or null when any category is fine. */
  maxSizeCategory: GoodsSizeCategory | null;
  /** i18n key stating this limit to the customer. */
  copyKey: string;
}

/** The rule that applies to one vehicle on one kind of journey. */
export function getParcelAllowance(
  vehicleType: string,
  withPassenger: boolean,
): ParcelAllowance {
  if (isBicycle(vehicleType)) {
    return withPassenger
      ? {
          maxWeightKg: PARCEL_WEIGHT_RULES.BICYCLE_WITH_PASSENGER_MAX_KG,
          maxSizeCategory: null,
          copyKey: 'parcelWeight.bicycleWithPassenger',
        }
      : {
          maxWeightKg: PARCEL_WEIGHT_RULES.BICYCLE_ALONE_MAX_KG,
          maxSizeCategory: null,
          copyKey: 'parcelWeight.bicycleAlone',
        };
  }
  return withPassenger
    ? {
        maxWeightKg: PARCEL_WEIGHT_RULES.MOTO_WITH_PASSENGER_MAX_KG,
        maxSizeCategory: null,
        copyKey: 'parcelWeight.motoWithPassenger',
      }
    : {
        maxWeightKg: null,
        maxSizeCategory: MOTO_ALONE_MAX_SIZE_CATEGORY,
        copyKey: 'parcelWeight.motoAlone',
      };
}

export type ParcelLoadRefusal =
  | 'PARCEL_TOO_HEAVY_FOR_VEHICLE'
  | 'PARCEL_TOO_LARGE_FOR_VEHICLE';

export interface ParcelLoadResult {
  /** Should the booking be refused? */
  allowed: boolean;
  code?: ParcelLoadRefusal;
  /** i18n key for the refusal, naming the limit that was exceeded. */
  messageKey?: string;
  allowance: ParcelAllowance;
  /**
   * The declared parcel is outside a stated rule, but the booking is
   * allowed through anyway. Today this is only the moto-alone size rule
   * — see ENFORCE_MOTO_ALONE_SIZE_RULE. Callers should record it.
   */
  advisory?: ParcelLoadRefusal;
}

/**
 * Check a declared parcel against the rule for its vehicle.
 *
 * Additive by construction: an undeclared weight and an undeclared size
 * both pass, so every request that was valid before this existed is
 * still valid. Only a declaration that exceeds a stated limit is
 * refused.
 */
export function validateParcelLoad(input: {
  vehicleType: string;
  journeyType: string;
  weightKg?: number | null;
  sizeCategory?: string | null;
}): ParcelLoadResult {
  const withPassenger = isCarryingPassenger(input.journeyType);
  const allowance = getParcelAllowance(input.vehicleType, withPassenger);

  if (
    allowance.maxWeightKg != null &&
    input.weightKg != null &&
    input.weightKg > allowance.maxWeightKg
  ) {
    return {
      allowed: false,
      code: 'PARCEL_TOO_HEAVY_FOR_VEHICLE',
      messageKey: 'errors.parcelTooHeavyForVehicle',
      allowance,
    };
  }

  if (allowance.maxSizeCategory != null && input.sizeCategory) {
    const declared = SIZE_ORDER.indexOf(input.sizeCategory as GoodsSizeCategory);
    const permitted = SIZE_ORDER.indexOf(allowance.maxSizeCategory);
    if (declared > permitted) {
      // Stated either way; refused only once the team says so.
      if (!ENFORCE_MOTO_ALONE_SIZE_RULE) {
        return { allowed: true, allowance, advisory: 'PARCEL_TOO_LARGE_FOR_VEHICLE' };
      }
      return {
        allowed: false,
        code: 'PARCEL_TOO_LARGE_FOR_VEHICLE',
        messageKey: 'errors.parcelTooLargeForVehicle',
        allowance,
      };
    }
  }

  return { allowed: true, allowance };
}
