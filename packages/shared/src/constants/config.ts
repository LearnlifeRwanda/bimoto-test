/** Platform configuration constants */

/** Time in minutes before a journey request expires if no bids accepted */
export const JOURNEY_EXPIRY_MINUTES = 60;

/** Time in minutes before a bid expires if not accepted */
export const BID_EXPIRY_MINUTES = 30;

/** Time in minutes before awaiting-confirmation auto-confirms */
export const AUTO_CONFIRM_MINUTES = 120;

/** Maximum number of active bids a driver can have simultaneously */
export const MAX_ACTIVE_BIDS_PER_DRIVER = 5;

/** Maximum number of emergency contacts a user can store */
export const MAX_EMERGENCY_CONTACTS = 3;

/** Minimum rating stars (1-5) */
export const MIN_RATING = 1;

/** Maximum rating stars (1-5) */
export const MAX_RATING = 5;

/** Maximum GPS points per batch upload */
export const GPS_BATCH_MAX_POINTS = 50;

/** OTP expiry time in minutes */
export const OTP_EXPIRY_MINUTES = 5;

/** OTP length */
export const OTP_LENGTH = 6;

/** Maximum message length */
export const MAX_MESSAGE_LENGTH = 500;

/** Minimum price in RWF */
export const MIN_PRICE_RWF = 200;

/** Maximum price in RWF */
export const MAX_PRICE_RWF = 50000;

/** Driver search radius in kilometers */
export const DRIVER_SEARCH_RADIUS_KM = 5;

/** Kigali bounding box for location validation */
export const KIGALI_BOUNDS = {
  minLat: -2.05,
  maxLat: -1.85,
  minLng: 29.75,
  maxLng: 30.20,
};

/** Phone number regex for Rwanda (+250) */
export const RWANDA_PHONE_REGEX = /^\+250[0-9]{9}$/;

/** Nickname constraints */
export const NICKNAME_MIN_LENGTH = 2;
export const NICKNAME_MAX_LENGTH = 30;

/** Cancellation threshold before penalty */
export const CANCELLATION_PENALTY_THRESHOLD = 0.3;

/** Minimum completed rides before cancellation ratio is enforced */
export const CANCELLATION_MIN_RIDES = 5;

/** Minutes before the "choose another driver" button appears */
export const DRIVER_LATE_THRESHOLD_MINUTES = 10;

/** Hours within which a customer can dispute after auto-confirmation */
export const DISPUTE_WINDOW_HOURS = 24;

/**
 * GPS trace retention period in days (for dispute resolution).
 *
 * RIDE-TRACE G3 — tightened from 30 to 14 by founder decision (18 Aug),
 * alongside the decision to record the in-ride leg at all: a trace kept
 * for a fortnight settles a dispute raised within the 24-hour window
 * and is gone long before it becomes a history of anybody. The dispute
 * hold is what makes the shorter window safe — points on a journey in a
 * non-terminal or disputed status are held regardless of age until the
 * journey resolves (jobs/gps-retention.job.ts). Both facts are said out
 * loud to driver and passenger in the disclosure copy.
 *
 * This is the single source of truth: the sweep reads it as its default
 * retentionDays argument and nothing else hard-codes a number.
 */
export const GPS_TRACE_RETENTION_DAYS = 14;

/** Warning threshold for driver rating (after MIN_RIDES_FOR_RATING_ACTION rides) */
export const LOW_RATING_WARNING = 3.0;

/** Suspension threshold for driver rating */
export const SUSPENSION_THRESHOLD = 2.5;

/** Minimum rides before rating-based penalties apply */
export const MIN_RIDES_FOR_RATING_ACTION = 20;

/** Flag driver if withdrawal rate exceeds this percentage */
export const FREQUENT_WITHDRAWAL_THRESHOLD = 0.3;

/** Sync heartbeat interval in milliseconds */
export const SYNC_HEARTBEAT_MS = 15000;

/** Exponential backoff intervals for sync retry (milliseconds) */
export const SYNC_RETRY_BACKOFF_MS = [1000, 3000, 10000, 30000];

/** Current privacy policy version — increment to re-prompt all users */
export const CURRENT_PRIVACY_VERSION = '1.0';

/**
 * Current terms of service version.
 *
 * COMPLIANCE-ACK (founder, 24 Aug) — bumped 1.0 -> 2.0. The safety
 * acknowledgment (no babies or infants; exactly one passenger; nobody
 * below the legal minimum age) ships as part of terms v2.0, and THIS
 * BUMP IS THE ENFORCEMENT: needsConsent() in App.tsx compares the
 * stored termsAcceptedVersion against this constant, so every user who
 * accepted 1.0 is routed back through ConsentPage exactly once on their
 * next launch. There is no schema change and no new endpoint — the
 * acknowledgment rides the terms version that already existed.
 */
export const CURRENT_TERMS_VERSION = '2.0';

/**
 * Current driver terms version.
 *
 * COMPLIANCE-ACK — bumped 1.0 -> 2.0 so a NEW driver stamps the version
 * that carries the refuse-such-rides line.
 *
 * DOCUMENTED LIMITATION: nothing reads driverTermsVersion for staleness.
 * The only consumers are the write at DriverVerificationPage and the
 * schema column; needsConsent() checks privacy and general terms only.
 * So this bump alone does NOT re-prompt an existing driver — the
 * general-terms bump above is what reaches them, which is why the
 * driver's acknowledgment sentence also renders on ConsentPage for
 * DRIVER and BOTH roles. Building a driver-re-consent guard is
 * deliberately out of scope here.
 */
export const CURRENT_DRIVER_TERMS_VERSION = '2.0';

/** Maximum transaction amount per ride (RWF) — flag if exceeded */
export const AML_SINGLE_TRANSACTION_LIMIT = 100000; // 100,000 RWF (~$80)

/** Maximum daily transaction volume per user (RWF) */
export const AML_DAILY_VOLUME_LIMIT = 500000; // 500,000 RWF (~$400)

/** Flag if same driver+customer pair exceeds this many rides per day */
export const AML_SAME_PAIR_DAILY_LIMIT = 5;

/**
 * TEAM-SAID G2 — the mobile-money transfer fee on a payout, in RWF.
 *
 * The team settled item 11 on Option A (5 of 7): Bimoto pays this fee
 * on a driver's scheduled payout, and the driver pays it only when he
 * asks for an immediate, off-schedule withdrawal. Before this the
 * account screen listed the three payout choices without saying what
 * any of them cost, which is the gap the decision closes.
 *
 * This is a DISPLAY constant. No pilot money moves through it: nothing
 * in escrow, payout or settlement reads it, and the existing pilot fee
 * waiver (which concerns platform commission, a different thing
 * entirely) is untouched. It exists so the number the driver reads is
 * defined in one place rather than typed into three locale files, and
 * so that whoever wires the real charge post-pilot changes it here.
 */
export const PAYOUT_TRANSFER_FEE_RWF = 500;

// ── MONEY-PIN + APP-LOCK (founder ruling D25) ──────────────────────────
//
// Two codes, deliberately different LENGTHS. The money PIN is 4 digits;
// the optional device app-lock code is 6 or more. That separation is the
// confusion mitigation and it is load-bearing: the money PIN is never on
// the device, so the app-lock setup screen CANNOT compare a candidate
// code against it to reject a duplicate. It rejects by format instead —
// a 4-digit code is not a valid app-lock code, so the money PIN cannot
// be entered as one, and the helper text says exactly that.

/** Money-PIN length. Four digits — the number a motari types at money. */
export const MONEY_PIN_LENGTH = 4;

/**
 * Minimum app-lock code length. Six, so that no app-lock code can ever
 * equal the 4-digit money PIN by construction.
 */
export const APP_LOCK_MIN_LENGTH = 6;

/**
 * Upper bound on an app-lock code. Not a security limit — it stops a
 * stuck key producing a code nobody can retype, and gives the pad a
 * definite cap to enforce.
 */
export const APP_LOCK_MAX_LENGTH = 12;

/** Wrong money-PIN guesses allowed before the PIN locks for a while. */
export const MONEY_PIN_MAX_ATTEMPTS = 5;

/** How long the money PIN stays locked after the budget is exhausted. */
export const MONEY_PIN_LOCKOUT_MINUTES = 15;

/**
 * How long a proven money-PIN step-up stays good for. Short enough that a
 * handed-over phone does not carry an open money session for long, long
 * enough that a driver changing a setting is not asked twice in a row.
 */
export const MONEY_STEP_UP_TTL_MINUTES = 5;

/**
 * The delay between an SMS-proven money-PIN RESET and that new PIN going
 * live. Whoever holds the phone holds the SMS, so possession alone must
 * not reach the money TODAY — it reaches it tomorrow, loudly, with a day
 * in which the real owner (who knows the live PIN) can cancel it.
 */
export const MONEY_PIN_RESET_DELAY_HOURS = 24;
