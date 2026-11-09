// SERVICES/CUSTOMER-MODES/CONFIG.TS
//
// Env-overridable thresholds for Dispatch K3 — customer modes
// ("I'll wait" vs "I need to go") and progressive suggest-up.
//
//   CEILING_MULTIPLIER_MIN/MAX/DEFAULT = 1.0 / 2.0 / 1.3
//     The slider range and the predictable default. 1.3x of the
//     fair-price midpoint is the customer's commit-with-a-known-number
//     ceiling for NEED_TO_GO.
//
//   AUTO_ACCEPT_WINDOW_SECONDS = 60
//     Bids arriving more than this many seconds after a journey was
//     created can no longer auto-accept (window-expired). Manual
//     accept still works.
//
//   SUGGEST_UP_TIER_*_AT_SECONDS = 60 / 120
//     When each suggest-up tier becomes available. Customer sees
//     the "+50 RWF" button at 60s; the "+100 RWF" button appears
//     alongside at 120s.
//
// Pilot operators tune via env vars without redeploying.

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const CEILING_MULTIPLIER_MIN = envFloat('K3_CEILING_MIN', 1.0);
export const CEILING_MULTIPLIER_MAX = envFloat('K3_CEILING_MAX', 2.0);
export const CEILING_MULTIPLIER_DEFAULT = envFloat('K3_CEILING_DEFAULT', 1.3);

export const AUTO_ACCEPT_WINDOW_SECONDS = envInt(
  'K3_AUTO_ACCEPT_WINDOW_SEC',
  60,
);

export const SUGGEST_UP_TIER_1_AT_SECONDS = envInt(
  'K3_SUGGEST_UP_T1_SEC',
  60,
);
export const SUGGEST_UP_TIER_2_AT_SECONDS = envInt(
  'K3_SUGGEST_UP_T2_SEC',
  120,
);

export const SUGGEST_UP_TIER_1_AMOUNT_RWF = envInt(
  'K3_SUGGEST_UP_T1_RWF',
  50,
);
export const SUGGEST_UP_TIER_2_AMOUNT_RWF = envInt(
  'K3_SUGGEST_UP_T2_RWF',
  100,
);

export const SUGGEST_UP_VALID_AMOUNTS: ReadonlyArray<number> = [
  SUGGEST_UP_TIER_1_AMOUNT_RWF,
  SUGGEST_UP_TIER_2_AMOUNT_RWF,
];
