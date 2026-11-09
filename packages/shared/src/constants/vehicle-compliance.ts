import { VehicleType } from '../types/user.js';

/**
 * Per-vehicle-type compliance requirements.
 *
 * When Rwanda publishes specific e-bike regulations, update the E_BIKE
 * entry here. The entire platform (onboarding, verification gate, helmet
 * reminder, bid cards, admin dashboard) adapts automatically.
 *
 * To add a new vehicle type in the future:
 * 1. Add the enum value to VehicleType
 * 2. Add an entry to this config
 * 3. Add i18n strings for the new type
 * 4. Run a Prisma migration to add the enum value
 * That's it. No other code changes needed.
 */
export interface VehicleComplianceConfig {
  /** Display name i18n key */
  nameKey: string;

  /** Whether a helmet confirmation dialog is shown before journey start */
  helmetRequired: boolean;

  /** Whether the vehicle must have a registration plate */
  registrationRequired: boolean;

  /** Whether the driver needs a RURA transport authorization */
  ruraRequired: boolean;

  /** Whether the driver needs a driving license (and which category) */
  licenseRequired: boolean;
  licenseCategory?: string; // e.g., "A" for motorcycles, "A1" for light motorcycles

  /** Whether third-party liability insurance is mandatory */
  insuranceRequired: boolean;

  /** Whether cooperative membership is required */
  cooperativeRequired: boolean;

  /** Whether this vehicle type is motorized (affects regulatory classification) */
  isMotorized: boolean;

  /** Whether this vehicle type is electric (for green transport tracking) */
  isElectric: boolean;

  /** Maximum plausible speed in km/h (used by GPS plausibility engine) */
  maxPlausibleSpeedKmh: number;

  /** Description shown during driver registration */
  registrationHintKey: string;
}

export const VEHICLE_COMPLIANCE: Record<string, VehicleComplianceConfig> = {
  [VehicleType.BIKE]: {
    nameKey: 'vehicles.bike',
    helmetRequired: false, // Not currently mandatory for adult bike riders in Rwanda
    registrationRequired: false, // Bicycles don't have plates
    ruraRequired: false, // Non-motorized transport exempt from RURA authorization
    licenseRequired: false, // No driving license needed for bicycles
    insuranceRequired: false, // Non-motorized vehicles exempt from mandatory insurance
    cooperativeRequired: false, // Bike-taxi cooperatives exist but membership not legally mandated
    isMotorized: false,
    isElectric: false,
    maxPlausibleSpeedKmh: 40, // Bicycle max realistic speed in Kigali
    registrationHintKey: 'vehicles.bikeRegistrationHint',
  },

  [VehicleType.MOTO]: {
    nameKey: 'vehicles.moto',
    helmetRequired: true, // Mandatory for both driver and passenger
    registrationRequired: true, // Registration plate required
    ruraRequired: true, // RURA transport authorization mandatory
    licenseRequired: true,
    licenseCategory: 'A', // Category A driving license
    insuranceRequired: true, // Third-party liability mandatory
    cooperativeRequired: true, // Cooperative membership mandatory since July 2023
    isMotorized: true,
    isElectric: false,
    maxPlausibleSpeedKmh: 90, // Motorcycle max realistic speed in Kigali
    registrationHintKey: 'vehicles.motoRegistrationHint',
  },

  [VehicleType.E_MOTO]: {
    nameKey: 'vehicles.emoto',
    helmetRequired: true, // Same as MOTO — mandatory
    registrationRequired: true, // Same as MOTO — registration plate required
    ruraRequired: true, // Same as MOTO — RURA authorization mandatory
    licenseRequired: true,
    licenseCategory: 'A', // Same license category as petrol motos
    insuranceRequired: true, // Same as MOTO — mandatory
    cooperativeRequired: true, // Same as MOTO
    isMotorized: true,
    isElectric: true,
    maxPlausibleSpeedKmh: 80, // E-motos typically capped at ~80 km/h
    registrationHintKey: 'vehicles.emotoRegistrationHint',
  },

  [VehicleType.E_BIKE]: {
    nameKey: 'vehicles.ebike',
    helmetRequired: true, // PRECAUTIONARY: e-bikes are faster than regular bikes (25-45 km/h).
    // Rwanda hasn't codified this yet, but we default to requiring helmets
    // for safety. Change to false if regulations clarify otherwise.
    registrationRequired: false, // ASSUMPTION: e-bikes under 250W/25km/h treated like bicycles.
    // If Rwanda classifies them as mopeds, change to true.
    ruraRequired: false, // ASSUMPTION: non-classified as motor vehicle.
    // If Rwanda requires RURA auth for e-bikes, change to true.
    licenseRequired: false, // ASSUMPTION: no license needed for low-power e-bikes.
    // If Rwanda requires A1 license, change to true + set licenseCategory.
    insuranceRequired: false, // ASSUMPTION: follows bicycle classification.
    // If classified as motor vehicle, change to true.
    cooperativeRequired: false, // No e-bike taxi cooperatives exist yet.
    // If mandated, change to true.
    isMotorized: true, // E-bikes have a motor, even if low-power
    isElectric: true,
    maxPlausibleSpeedKmh: 50, // E-bike realistic max speed
    registrationHintKey: 'vehicles.ebikeRegistrationHint',
  },
};

/**
 * Get compliance config for a vehicle type. Returns MOTO config as
 * fallback for unknown types (safest default — most restrictive).
 */
export function getVehicleCompliance(vehicleType: string): VehicleComplianceConfig {
  return VEHICLE_COMPLIANCE[vehicleType] ?? VEHICLE_COMPLIANCE[VehicleType.MOTO];
}

/**
 * Check if a driver meets all compliance requirements for their vehicle type.
 * Returns a list of missing requirements (empty = fully compliant).
 */
export function checkDriverCompliance(
  vehicleType: string,
  driverProfile: {
    drivingLicenseNumber?: string | null;
    ruraAuthorizationNumber?: string | null;
    cooperativeName?: string | null;
    insuranceConfirmed?: boolean;
    registrationPlate?: string | null;
  },
): string[] {
  const config = getVehicleCompliance(vehicleType);
  const missing: string[] = [];

  if (config.licenseRequired && !driverProfile.drivingLicenseNumber) {
    missing.push('drivingLicense');
  }
  if (config.ruraRequired && !driverProfile.ruraAuthorizationNumber) {
    missing.push('ruraAuthorization');
  }
  if (config.cooperativeRequired && !driverProfile.cooperativeName) {
    missing.push('cooperativeMembership');
  }
  if (config.insuranceRequired && !driverProfile.insuranceConfirmed) {
    missing.push('insurance');
  }
  if (config.registrationRequired && !driverProfile.registrationPlate) {
    missing.push('registrationPlate');
  }

  return missing;
}
