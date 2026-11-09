// Admin moderation config — every constant here is env-overridable so an
// operator can re-tune thresholds without a redeploy.

export const NOTIFY_SMS_ON_FREEZE =
  (process.env.ADMIN_NOTIFY_SMS_ON_FREEZE ?? 'true') === 'true';

export const NOTIFY_SMS_ON_UNFREEZE =
  (process.env.ADMIN_NOTIFY_SMS_ON_UNFREEZE ?? 'true') === 'true';

export const FREEZE_SMS_TEMPLATE =
  process.env.ADMIN_FREEZE_SMS_TEMPLATE ??
  'Bimoto: Your account is under review. Contact support at +250 XXX XXX XXX. (Ref: ${id})';

export const UNFREEZE_SMS_TEMPLATE =
  process.env.ADMIN_UNFREEZE_SMS_TEMPLATE ??
  'Bimoto: Your account has been restored. You can now use the app normally.';

export const SOCKET_DISCONNECT_REASON =
  process.env.ADMIN_SOCKET_DISCONNECT_REASON ?? 'account-frozen';

export const STALE_DRIVER_NO_SHOW_THRESHOLD_MIN = parseInt(
  process.env.STALE_DRIVER_NO_SHOW_THRESHOLD_MIN ?? '10',
  10,
);

export const GPS_PLAUSIBILITY_RADIUS_KM = parseFloat(
  process.env.GPS_PLAUSIBILITY_RADIUS_KM ?? '2.0',
);

export const PHOTO_MISMATCH_QUEUE_HOURS = parseInt(
  process.env.PHOTO_MISMATCH_QUEUE_HOURS ?? '48',
  10,
);

export const BID_MANIPULATION_WITHDRAW_WINDOW_SEC = parseInt(
  process.env.BID_MANIPULATION_WITHDRAW_WINDOW_SEC ?? '60',
  10,
);

export const BID_MANIPULATION_PAIR_THRESHOLD = parseInt(
  process.env.BID_MANIPULATION_PAIR_THRESHOLD ?? '3',
  10,
);

export const BID_MANIPULATION_PAIR_WINDOW_DAYS = parseInt(
  process.env.BID_MANIPULATION_PAIR_WINDOW_DAYS ?? '7',
  10,
);

export const FROZEN_USER_AUTH_CACHE_TTL_MS = parseInt(
  process.env.FROZEN_USER_AUTH_CACHE_TTL_MS ?? '30000',
  10,
);

export const FROZEN_USER_AUTH_CACHE_MAX_ENTRIES = parseInt(
  process.env.FROZEN_USER_AUTH_CACHE_MAX_ENTRIES ?? '1000',
  10,
);

export const ADMIN_REASON_MIN_LENGTH = parseInt(
  process.env.ADMIN_REASON_MIN_LENGTH ?? '10',
  10,
);

export const ADMIN_LIST_DEFAULT_LIMIT = parseInt(
  process.env.ADMIN_LIST_DEFAULT_LIMIT ?? '50',
  10,
);

export const ADMIN_LIST_MAX_LIMIT = parseInt(
  process.env.ADMIN_LIST_MAX_LIMIT ?? '200',
  10,
);

// ACCOUNT-RIGHTS-SURFACE G1 — how far back the admin deletion-requests
// list carries EXECUTED erasures. Open requests are never time-bounded
// (an open request is open however old it is); this window only bounds the
// history tail, so the list stays useful without growing forever.
export const ADMIN_DELETION_REQUEST_HISTORY_DAYS = parseInt(
  process.env.ADMIN_DELETION_REQUEST_HISTORY_DAYS ?? '30',
  10,
);
