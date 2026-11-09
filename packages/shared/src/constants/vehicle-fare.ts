// ANY-VEHICLE G2 — the per-vehicle fare-band multiplier, in shared.
//
// These four numbers were born in the server's fair-price.service
// (R3-V) and are still applied there, on every fair-price response.
// They move here — values UNCHANGED — because the any-vehicle request
// needs them on the CLIENT too: when the customer picks "Any", the
// fair-price endpoint is called once with no vehicle type (so the
// response is the vehicle-agnostic base band), and the per-kind
// "typical price" column is that base scaled by these.
//
// Copying them into the client instead would have created exactly the
// drift this repo's constants guard exists to catch: two ladders that
// agree today and quietly disagree after the first calibration from
// operational data. There is one ladder, and it lives here.

import { VehicleType } from '../types/user.js';

/**
 * Per-vehicle-type fare-band multipliers. BIKE is cheaper than MOTO
 * (slower, less professional capital). E_MOTO is slightly pricier
 * (electric premium). E_BIKE sits between BIKE and MOTO. Calibrated
 * for the Kigali pilot; revise from operational data.
 */
export const VEHICLE_FARE_MULTIPLIER: Record<string, number> = {
  [VehicleType.BIKE]: 0.7,
  [VehicleType.E_BIKE]: 0.85,
  [VehicleType.MOTO]: 1.0,
  [VehicleType.E_MOTO]: 1.05,
};

/**
 * The multiplier for a vehicle type. A null/absent type is the
 * any-vehicle case and scales by 1.0 — the base band as computed.
 * An unknown type also falls back to 1.0 rather than throwing: a
 * price hint must never be the thing that breaks a booking form.
 */
export function vehicleFareMultiplier(
  vehicleType: VehicleType | string | null | undefined,
): number {
  if (!vehicleType) return 1.0;
  return VEHICLE_FARE_MULTIPLIER[String(vehicleType)] ?? 1.0;
}
