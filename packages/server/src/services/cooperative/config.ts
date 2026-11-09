// Dispatch M — cooperative leader dashboard config. Every constant
// here is env-overridable so an operator can re-tune defaults without
// a redeploy. No magic numbers anywhere else in the cooperative
// services — they all read from this module.

export const DISPATCH_DEFAULT_ETA_MINUTES = parseInt(
  process.env.M_DISPATCH_DEFAULT_ETA ?? '5',
  10,
);

export const COOPERATIVE_DEFAULT_COMMISSION_RATE = parseFloat(
  process.env.M_COOP_DEFAULT_COMMISSION ?? '0.0',
);

export const DASHBOARD_DEFAULT_PERIOD_DAYS = parseInt(
  process.env.M_DASHBOARD_DEFAULT_DAYS ?? '7',
  10,
);

export const DASHBOARD_MAX_PERIOD_DAYS = parseInt(
  process.env.M_DASHBOARD_MAX_DAYS ?? '90',
  10,
);

export const DRIVER_LIST_PAGE_SIZE = parseInt(
  process.env.M_DRIVER_PAGE_SIZE ?? '50',
  10,
);

export const DRIVER_LIST_MAX_PAGE_SIZE = parseInt(
  process.env.M_DRIVER_MAX_PAGE_SIZE ?? '200',
  10,
);

export const APPROVE_REQUIRES_MIN_RATING = parseFloat(
  process.env.M_APPROVE_MIN_RATING ?? '3.0',
);

export const COOPERATIVE_REASON_MIN_LENGTH = parseInt(
  process.env.M_COOP_REASON_MIN_LENGTH ?? '5',
  10,
);

export const DISPATCH_DEFAULT_DISTANCE_KM = parseFloat(
  process.env.M_DISPATCH_DEFAULT_DISTANCE_KM ?? '3.0',
);
