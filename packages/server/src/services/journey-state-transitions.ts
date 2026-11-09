// Dispatch Q (4/7) — chokepoint for journey state-exit side effects.
//
// Whenever a journey transitions OUT of REQUESTED status (matched,
// expired, cancelled, disputed, ...), in-process timers tied to that
// journey must be cleaned up. Today that's just suggest-up emits (K3),
// but cascade-broadcast cron and other timers may join later — adding
// them to this helper means every state-flipper inherits the cleanup
// without remembering to call each one individually.
//
// Idempotent: safe to call multiple times for the same journey.
// Errors are caught + logged so callers don't have to wrap.

import { cancelSuggestUpEmits } from './customer-modes/suggest-up-scheduler';

export function onJourneyExitsRequested(
  journeyId: string,
  reason: string,
): void {
  // K3 — cancel scheduled suggest-up tier emits
  try {
    cancelSuggestUpEmits(journeyId);
  } catch (err) {
    console.warn('[journey-state-transitions] cancel-suggest-up-failed', {
      journeyId,
      reason,
      err: err instanceof Error ? err.message : String(err),
    });
  }

  // Future: cancel cascade broadcasts (K1) when those become per-journey
  // timers (today they're per-cron-tick so no cancellation needed).
  // Future: cancel any other in-process timers tied to the journey.
}
