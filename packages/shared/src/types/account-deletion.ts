// ACCOUNT-RIGHTS-SURFACE G1 — the deferral vocabulary, in the one package
// both sides can see.
//
// The union was born in the server's deletion-execution job (#195), which
// is still its only WRITER and still owns every rule about when each
// reason applies. It moves here for one reason: AR-SURFACE gives the
// person waiting a plain-language sentence per reason, and that mapping
// lives on the client. A client `Record<DeferralReason, string>` typed
// against a server-only union is not typed against anything — it would be
// a hand-copied list that silently rots the day a sixth reason is added.
//
// With the union here, the client's map is checked by the compiler: add a
// reason to this file without adding its wording, and the client build
// fails. That is the whole point of the move. Nothing about the job's
// behaviour, its export names, or the database column changes: the job
// re-exports `DeferralReason` from here, so every existing importer of it
// keeps working unchanged.

/**
 * Every reason the execution job may record for passing a due deletion
 * over. Ordered as the job checks them (`firstBlockingReason`), which is
 * also the order of "most likely to be what the user is actually waiting
 * on" — a ride in progress is common, a positive driver balance is not.
 *
 * A tuple, not a bare union, so runtime code (tests, an admin filter) can
 * enumerate the reasons without re-listing them.
 */
export const DEFERRAL_REASONS = [
  'NON_TERMINAL_JOURNEY',
  'LIVE_ESCROW',
  // CUTGUARD v2 G5 (B-4, proven live) — an OPEN BID is an outstanding
  // offer: a passenger can accept it and pay into the account. The
  // blocking-fact list read five facts and a bid was not one of them, so
  // a driver with a PENDING bid was erased, a passenger then accepted
  // from "Deleted User", and her money was HELD against an anonymised
  // account she could not text.
  'OPEN_BID',
  'UNRESOLVED_EMERGENCY',
  'ACCOUNT_FROZEN',
  'POSITIVE_DRIVER_BALANCE',
  // CUTGUARD v2 G5 — money already ON ITS WAY to this driver, found by
  // auditing every User relation against the schema rather than by
  // extending a hand-list.
  //
  //   IN_FLIGHT_PAYOUT   — a DriverPayoutBatch still PENDING at the
  //                        processor. Erase now and the settlement
  //                        webhook lands on an anonymised account.
  //   SCHEDULED_PAYOUT   — a PayoutPreferenceChangeLog with
  //                        payoutFired:false and a due date. The row IS
  //                        the schedule (preference-change-payout.job),
  //                        so erasing leaves a job about to pay a person
  //                        who no longer exists.
  'IN_FLIGHT_PAYOUT',
  'SCHEDULED_PAYOUT',
] as const;

/**
 * Machine-readable reason a due deletion has not executed yet, as written
 * to `DeletionRequest.deferredReason` and read back by `GET /api/users/me`
 * and the admin deletion-requests list.
 */
export type DeferralReason = (typeof DEFERRAL_REASONS)[number];
