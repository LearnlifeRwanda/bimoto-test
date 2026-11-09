// HOOKS/USE-OUTBOX-TOASTS.TS
//
// CHROME-C G3 — the events announce themselves, then leave.
//
// A held booking going out, or a booking coming back refused, used to
// be a strip: it appeared across the top of every screen, pushed the
// whole page down, and stayed until dismissed. That is the wrong shape
// for news. News arrives, is read, and goes; what still needs a DECISION
// stays, and the badge on the header status is where staying happens.
//
// So this watches for arrivals and speaks once per arrival:
//
//   * a booking saved to the outbox → "Saved on this phone" (the words
//     are #167's own, unchanged);
//   * a held booking sent → the offer's headline. The "View the ride"
//     action is NOT on the toast — see below — it is in the detail
//     sheet, kept alive by the badge until the ride is viewed;
//   * a refusal arriving → the refusal count.
//
// WHY NO ACTION BUTTON ON THE TOAST (CHROME-C G1 §7.2b). ui.store's API
// is showToast(message, type) — no action parameter — and Toast renders
// a message plus a close button on a fixed 3 s timer. Adding an action
// means changing the toast system, which this dispatch forbids and
// names as an invariant. Nothing is lost by the constraint: every
// action the toast might have carried is on the badge, one tap away,
// and it persists instead of expiring after three seconds.
//
// EDGE-TRIGGERED, not level-triggered: each effect fires on a COUNT
// GOING UP, so cancelling one held booking of three does not announce
// the remaining two.
//
// And edge-triggered is not enough on its own, because Dexie answers
// asynchronously: a phone that already holds two bookings renders once
// with zero and then resolves to two, which is indistinguishable from
// two bookings ARRIVING unless someone is watching for it. That is why
// both queries report `loaded` and why the seed waits for it — without
// that wait the shell shouts on every single mount, which is exactly
// the noise Option C exists to remove.

import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../stores/ui.store';
import { useOutboxStore } from '../stores/outbox.store';
import { usePendingOutbox } from '../components/sync/OutboxPanel';
import { useRejectedItems } from '../components/sync/RejectedItemsPanel';

export function useOutboxToasts(): void {
  const { t } = useTranslation();
  const showToast = useUIStore((s) => s.showToast);
  const { rows: pending, loaded: pendingLoaded } = usePendingOutbox();
  const { count: rejectedCount, loaded: rejectedLoaded } = useRejectedItems();
  const lastSent = useOutboxStore((s) => s.lastSent);

  // Seeded from whatever is already there the moment Dexie has actually
  // answered, so a mount never announces history.
  const seededRef = useRef(false);
  const seeded = seededRef.current;
  const prevPending = useRef(0);
  const prevRejected = useRef(0);
  // The sent notice needs no async wait — useOutboxStore is synchronous,
  // so its value on the FIRST render already is the pre-existing one.
  // It still needs seeding: AppShell is mounted per route, so a
  // navigation remounts this hook, and without a seed a still-unviewed
  // offer would be re-announced on every screen change.
  const prevSentId = useRef<string | null | undefined>(undefined);
  if (prevSentId.current === undefined) {
    prevSentId.current = lastSent?.journeyId ?? null;
  }

  useEffect(() => {
    if (seededRef.current) return;
    if (!pendingLoaded || !rejectedLoaded) return;
    seededRef.current = true;
    prevPending.current = pending.length;
    prevRejected.current = rejectedCount;
  }, [pendingLoaded, rejectedLoaded, pending.length, rejectedCount]);

  useEffect(() => {
    if (!seededRef.current) return;
    if (pending.length > prevPending.current) {
      showToast(t('outbox.savedToast'), 'info');
    }
    prevPending.current = pending.length;
  }, [pending.length, seeded, showToast, t]);

  useEffect(() => {
    if (!seededRef.current) return;
    if (rejectedCount > prevRejected.current) {
      showToast(t('sync.banner.failedCount', { count: rejectedCount }), 'error');
    }
    prevRejected.current = rejectedCount;
  }, [rejectedCount, seeded, showToast, t]);

  useEffect(() => {
    const id = lastSent?.journeyId ?? null;
    if (id && id !== prevSentId.current) {
      showToast(t('outbox.sentTitle'), 'success');
    }
    prevSentId.current = id;
  }, [lastSent, seeded, showToast, t]);
}

export default useOutboxToasts;
