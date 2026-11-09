// ACCOUNT-RIGHTS-SURFACE G4 — reason code to plain-language key, and the
// compiler's guarantee that the map is complete.
//
// The server writes a CODE (`LIVE_ESCROW`). A person waiting past their
// own deadline must be shown a SENTENCE that names what is in the way and
// what ends it. That translation is this map, and the one thing it must
// never do is grow a hole: a sixth reason added to the union with no
// wording here would render nothing, or a raw code, at exactly the moment
// the user is least willing to be confused by the app.
//
// `Record<DeferralReason, ...>` is what prevents that. The union lives in
// @bimoto/shared precisely so this file can be typed against it — add a
// member there without adding a row here and the client build FAILS. That
// is the whole design; the accompanying test pins it against the runtime
// tuple as well, so a reason cannot be added to one and not the other.

import { DEFERRAL_REASONS, type DeferralReason } from '@bimoto/shared';

/**
 * Full literal key strings, not template-built ones: the used-keys gate
 * (i18n-used-keys.test.ts, rule 3) resolves dotted literals under a known
 * namespace, so every one of these is verified to exist in en, fr and rw
 * without needing a DYNAMIC_KEYS entry.
 */
export const DEFERRAL_REASON_KEYS: Record<DeferralReason, string> = {
  NON_TERMINAL_JOURNEY: 'deletion.deferredNonTerminalJourney',
  LIVE_ESCROW: 'deletion.deferredLiveEscrow',
  // CUTGUARD v2 G5 — three reasons the obligation audit added. The
  // compiler required these rows the moment the union grew, which is
  // exactly what this Record is for.
  OPEN_BID: 'deletion.deferredOpenBid',
  UNRESOLVED_EMERGENCY: 'deletion.deferredUnresolvedEmergency',
  ACCOUNT_FROZEN: 'deletion.deferredAccountFrozen',
  POSITIVE_DRIVER_BALANCE: 'deletion.deferredPositiveDriverBalance',
  IN_FLIGHT_PAYOUT: 'deletion.deferredInFlightPayout',
  SCHEDULED_PAYOUT: 'deletion.deferredScheduledPayout',
};

/**
 * The wording key for a reason the server sent, or null.
 *
 * Null for an unrecognised code as well as for no code at all. The server
 * only ever writes union members, so an unrecognised one means client and
 * server have drifted — and in that case saying nothing is better than
 * showing `LIVE_ESCROW` to a motari. The banner falls back to its plain
 * "waiting on one thing" heading, which is still true.
 */
export function deferralReasonKey(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return (DEFERRAL_REASONS as readonly string[]).includes(reason)
    ? DEFERRAL_REASON_KEYS[reason as DeferralReason]
    : null;
}
