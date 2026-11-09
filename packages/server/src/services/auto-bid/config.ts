// SERVICES/AUTO-BID/CONFIG.TS
//
// Env-overridable thresholds for Dispatch K2 — driver auto-bid rules.
// Pilot operators can tune limits without redeploying. Defaults:
//
//   MAX_RULES_PER_DRIVER          = 5     ("up to 5 pre-configured rules")
//   MAX_AUTO_BIDS_PER_DRIVER_PER_HOUR = 30 (rolling 60-min window)
//   FLAT_BID_MIN_RWF / FLAT_BID_MAX_RWF = 100 / 50000
//   PERCENT_BID_MIN  / PERCENT_BID_MAX  = 50  / 200      (i.e. 50%-200%)
//   DEFAULT_ETA_MINUTES                 = 5  (driver hasn't typed anything)
//   RATE_LIMIT_WINDOW_MINUTES           = 60
//
// Do NOT lower MAX_RULES_PER_DRIVER below 5 without admin awareness:
// the driver UI promises "up to 5 rules" and shrinking that breaks
// existing drivers.

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const MAX_RULES_PER_DRIVER = envInt('K2_MAX_RULES', 5);

export const MAX_AUTO_BIDS_PER_DRIVER_PER_HOUR = envInt(
  'K2_MAX_BIDS_HOUR',
  30,
);

export const FLAT_BID_MIN_RWF = envInt('K2_FLAT_MIN', 100);
export const FLAT_BID_MAX_RWF = envInt('K2_FLAT_MAX', 50_000);

export const PERCENT_BID_MIN = envFloat('K2_PERCENT_MIN', 50);
export const PERCENT_BID_MAX = envFloat('K2_PERCENT_MAX', 200);

// Default ETA when an auto-bid fires — the driver hasn't typed
// anything, so we use a conservative pickup time.
export const DEFAULT_ETA_MINUTES = envInt('K2_DEFAULT_ETA_MIN', 5);

export const RATE_LIMIT_WINDOW_MINUTES = envInt('K2_RATE_WINDOW_MIN', 60);

// Pickup-distance bounds for rule definition. Drivers can configure
// any threshold inside this band.
export const MIN_PICKUP_DISTANCE_M = envInt('K2_MIN_PICKUP_M', 1);
export const MAX_PICKUP_DISTANCE_M = envInt('K2_MAX_PICKUP_M', 10_000);

// Ride-distance bounds (pickup → destination) for rule definition.
export const MIN_RIDE_DISTANCE_M = envInt('K2_MIN_RIDE_M', 1);
export const MAX_RIDE_DISTANCE_M = envInt('K2_MAX_RIDE_M', 50_000);

// Hard timeout for the cascade-integration evaluator batch.
export const CASCADE_EVAL_TIMEOUT_MS = envInt('K2_CASCADE_TIMEOUT_MS', 5_000);
