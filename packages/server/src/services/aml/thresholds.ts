// All thresholds env-overridable. Defaults conservative for the Kigali pilot
// (~2M-population context); see Dispatch C §2 for rationale on each value.

// Tier 1: hard-cap blocking (transaction refused if exceeded)
export const HARD_SINGLE_TX_RWF = Number(process.env.AML_HARD_SINGLE_TX_RWF ?? 5_000_000);
export const HARD_DAILY_CUMULATIVE_RWF = Number(process.env.AML_HARD_DAILY_RWF ?? 10_000_000);

// Tier 2: soft flagging (transaction proceeds, admin queue gets a row)
export const SOFT_SINGLE_TX_RWF = Number(process.env.AML_SOFT_SINGLE_TX_RWF ?? 1_000_000);
export const SOFT_DAILY_CUMULATIVE_RWF = Number(process.env.AML_SOFT_DAILY_RWF ?? 3_000_000);

// Pattern thresholds — Kigali-recalibrated (see dispatch §2 / §0)
export const PAIR_FREQ_24H_THRESHOLD = Number(process.env.AML_PAIR_FREQ_24H ?? 5);
export const PAIR_FREQ_7D_THRESHOLD = Number(process.env.AML_PAIR_FREQ_7D ?? 15);

export const VELOCITY_HOURLY_THRESHOLD = Number(process.env.AML_VELOCITY_HOURLY ?? 5);
// Exclude requests within N min after a CHARGE_FAILED audit event (legitimate retry).
export const VELOCITY_RETRY_EXCLUDE_MINUTES = Number(
  process.env.AML_VELOCITY_RETRY_EXCLUDE_MIN ?? 5,
);

export const NEW_ACCOUNT_RIDES_THRESHOLD = Number(process.env.AML_NEW_ACCOUNT_RIDES ?? 3);
export const NEW_ACCOUNT_AGE_DAYS = Number(process.env.AML_NEW_ACCOUNT_AGE_DAYS ?? 7);
export const NEW_ACCOUNT_HIGH_VALUE_RWF = Number(
  process.env.AML_NEW_ACCOUNT_HIGH_VALUE_RWF ?? 500_000,
);

export const PAYOUT_CONCENTRATION_THRESHOLD = Number(
  process.env.AML_PAYOUT_CONCENTRATION ?? 15,
);
export const PAYOUT_CONCENTRATION_AMOUNT_RWF = Number(
  process.env.AML_PAYOUT_CONCENTRATION_AMOUNT_RWF ?? 200_000,
);
export const PAYOUT_CONCENTRATION_AMOUNT_MIN_CUSTOMERS = Number(
  process.env.AML_PAYOUT_AMOUNT_MIN_CUSTOMERS ?? 10,
);

export const FAILURE_CLUSTER_THRESHOLD = Number(process.env.AML_FAILURE_CLUSTER ?? 5);

export const BURST_THRESHOLD = Number(process.env.AML_BURST_THRESHOLD ?? 20);
export const BURST_SPEND_RWF = Number(process.env.AML_BURST_SPEND_RWF ?? 100_000);
export const SILENCE_DAYS = Number(process.env.AML_SILENCE_DAYS ?? 14);

// AmlFlag idempotency window. recordFlag() merges duplicates within this window
// (updates metadata.lastDetectedAt) instead of creating new rows.
export const FLAG_DEDUPE_WINDOW_HOURS = Number(process.env.AML_DEDUPE_WINDOW_HOURS ?? 24);
