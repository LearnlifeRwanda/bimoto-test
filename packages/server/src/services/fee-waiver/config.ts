// LAUNCH-TRUTH fee-waiver campaign parameters — founder-fixed 13 July
// 2026, env-overridable in the house style (see services/admin/config.ts)
// so an operator can re-tune without a redeploy. The caps are enforced
// server-side in the grant service, never in the UI.

// LIFETIME instrument: 12 grants total, for the pre-prototype test
// drivers. Permanent — a lifetime waiver never expires.
export const FEE_WAIVER_LIFETIME_MAX = parseInt(
  process.env.FEE_WAIVER_LIFETIME_MAX ?? '12',
  10,
);

// TEMPORARY instrument: 500 grants. The founder may raise this via env.
export const FEE_WAIVER_TEMPORARY_MAX = parseInt(
  process.env.FEE_WAIVER_TEMPORARY_MAX ?? '500',
  10,
);

// Initial TEMPORARY duration, measured from grantedAt.
export const FEE_WAIVER_TEMPORARY_MONTHS = parseInt(
  process.env.FEE_WAIVER_TEMPORARY_MONTHS ?? '6',
  10,
);

// Extension ceiling: a TEMPORARY waiver's expiresAt may never exceed
// grantedAt + this many months, regardless of how many extensions an
// admin grants.
export const FEE_WAIVER_TEMPORARY_MAX_TOTAL_MONTHS = parseInt(
  process.env.FEE_WAIVER_TEMPORARY_MAX_TOTAL_MONTHS ?? '12',
  10,
);
