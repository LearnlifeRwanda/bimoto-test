/**
 * Durations that more than one package enforces.
 *
 * HYGIENE W3 G5 — every constant here was previously declared twice or
 * more, in different packages, with nothing but review keeping the copies
 * in step. The literal-drift guard (`pnpm constants:check`) now fails the
 * build if a time-constant name is declared in two packages again, so a
 * fourth copy of MS_PER_DAY cannot land quietly the way the third did.
 *
 * Every value below is the value the copies already agreed on. Nothing
 * here changes what the app does.
 */

/** One day in milliseconds. Was declared five times: four server files and one client component. */
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/* ---------------------------------------------- scheduled-ride leads ---- */

/**
 * Earliest a ride may be scheduled: one hour out. Enforced by the server's
 * validator, by the client's booking form, and by the shared createJourney
 * schema — three copies before this file existed.
 */
export const MIN_LEAD_TIME_MS = 60 * 60 * 1000;

/** Latest a ride may be scheduled: 30 days out. */
export const MAX_LEAD_TIME_MS = 30 * 24 * 60 * 60 * 1000;

/** Bidding opens 60 minutes before pickup. */
export const BID_WINDOW_LEAD_MS = 60 * 60 * 1000;

/** Auto-fallback fires 30 minutes before pickup. */
export const AUTO_FALLBACK_LEAD_MS = 30 * 60 * 1000;

/* ------------------------------------------- matched-journey gating ----- */

/**
 * Cancellation ATTRIBUTION after a match, and the pair of thresholds that
 * decides it. These are NOT the "choose another driver" rule — that one is
 * DRIVER_LATE_THRESHOLD_MINUTES in config.ts, and §E-3 established that the
 * 10 and the 12 are two separate rules rather than a disagreement.
 *
 * Both were written out verbatim in journey.service.ts and again in
 * MatchedPage.tsx, which is exactly the pair a UI and a server must never
 * hold separately: the screen would offer a cancellation the server then
 * attributed differently.
 */
export const MATCHED_NO_SHOW_THRESHOLD_MS = 8 * 60 * 1000;

/** The visibly-approaching-but-late case, distinct from a no-show. */
export const MATCHED_LATE_THRESHOLD_MS = 12 * 60 * 1000;

/* ------------------------------------------------- driver liveness ------ */

/**
 * LOCATION-LIFE A — how often an ONLINE driver re-asserts that they exist.
 *
 * Discovery's entire notion of "this motari is alive" is
 * `driverProfile.lastLocationAt`, and seven consumers gate on it: the
 * supply count, the cascade ring test, the urgent and supply broadcasts,
 * the auto-bid evaluator, and the request FEED itself. The server drops a
 * driver whose stamp is older than `K1_DRIVER_LOC_FRESH_SEC` (300 s).
 *
 * INVARIANT: `DRIVER_LIVENESS_PING_MS * 3 < K1_DRIVER_LOC_FRESH_SEC * 1000`
 * — 45 s < 300 s. The window must tolerate two missed beats, so a phone
 * that loses a fix, or is briefly throttled in the background, does not
 * fall out of discovery on the strength of one bad ping.
 *
 * The value is unchanged from the 15 s the driver dashboard already used;
 * only its home moved, out of one page's lifecycle (see
 * services/driver-liveness.ts for why that mattered).
 */
export const DRIVER_LIVENESS_PING_MS = 15_000;

/* --------------------------------------------------- account deletion --- */

/**
 * ACCOUNT-RIGHTS-CORE — the cancellable window between asking to be
 * deleted and being erased.
 *
 * Founder ruling D1 (20 Aug) fixes both the length and the UX: 72 hours,
 * during which the app behaves NORMALLY. Everything works — rides, SOS,
 * chat, money — with exactly one carve-out: no scheduled ride may be
 * booked for a time past the account's own deletion date, because that is
 * the one booking the account will not be there to take. Blocking states
 * (freeze, suspension) are untouched by the window in either direction.
 *
 * Hours rather than milliseconds because this is a number a human states
 * ("you have 72 hours to change your mind") and the client will render it
 * as such. The service converts once, at the point it computes
 * `executesAt`.
 *
 * Not the compliance clock. Law 058/2021 measures 30 days from
 * `DeletionRequest.requestedAt`; this constant governs only how long the
 * user has to change their mind, and 72h sits three orders of magnitude
 * inside that ceiling.
 */
export const ACCOUNT_DELETION_HOLD_HOURS = 72;
