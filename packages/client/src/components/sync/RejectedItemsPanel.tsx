// COMPONENTS/SYNC/REJECTED-ITEMS-PANEL.TSX
//
// CHROME-C G2 — what RejectedEventsBanner was, minus the strip.
//
// The banner was two things welded together: a 45 px strip that
// displaced every screen's content whenever anything had been refused,
// and a modal listing the refusals with their actions. Option C keeps
// the second and throws away the first. The strip's job — "something
// needs you" — is now the badge on the header status; the list is what
// the badge opens onto.
//
// It still carries two kinds of refusal, because a refusal is a refusal
// and a passenger should not have to learn two places to look for one:
//
//   * sync events the server rejected (db.syncEvents rows with a
//     failReason), which CAN be retried. QUEUE-UNITY G2: scoped to the
//     signed-in user too, now that those rows carry an owner. A refusal
//     is addressed to the person whose action was refused, and offering
//     the next person on a shared phone a Retry button for it would
//     have re-sent it under their name;
//   * held bookings the server rejected on replay (db.outbox rows moved
//     to REJECTED). Scoped to the signed-in user — a borrowed phone
//     never shows the previous owner's refused booking — and NEVER
//     retried, only discarded, because a 4xx is a real answer and
//     re-sending it is how a queue starts shouting at a wall.

import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/dexie';
import { useAuthStore } from '../../stores/auth.store';
import { cancelOutboxEntry, outboxSummary } from '../../lib/outbox';
import type { PendingSyncEvent, OutboxEntry } from '../../db/tables';

function parseFailReason(raw: string | undefined): { code: string; message: string } {
  if (!raw) return { code: 'UNKNOWN', message: '' };
  const idx = raw.indexOf(':');
  if (idx === -1) return { code: raw.trim(), message: '' };
  return {
    code: raw.slice(0, idx).trim(),
    message: raw.slice(idx + 1).trim(),
  };
}

/**
 * The two refusal queues, live. Exported so the header badge can count
 * them without rendering the list — the count and the list read the
 * same Dexie queries, so they can never disagree.
 */
export function useRejectedItems() {
  const userId = useAuthStore((s) => s.user?.id);

  // No default values: undefined IS the not-yet-answered signal, which
  // is what lets CHROME-C G3's toasts tell a first resolve apart from
  // an arrival. Rendering treats both as empty.
  //
  // Scoped by userId, like the bookings below. A row stamped null —
  // written before the v5 upgrade taught the queue to say whose it was
  // — matches no user and so appears to nobody. That is deliberate:
  // quarantine hides them rather than offering them to a stranger.
  const rejectedEvents = useLiveQuery(async () => {
    if (!userId) return [] as PendingSyncEvent[];
    const rows = await db.syncEvents.where('userId').equals(userId).toArray();
    return rows.filter(
      (e) => !e.synced && e.failReason !== undefined && e.failReason !== null,
    );
  }, [userId]);

  const rejectedBookings = useLiveQuery(async () => {
    if (!userId) return [] as OutboxEntry[];
    const rows = await db.outbox.where('userId').equals(userId).toArray();
    return rows
      .filter((e) => e.status === 'REJECTED')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [userId]);

  const events: PendingSyncEvent[] = rejectedEvents ?? [];
  const bookings: OutboxEntry[] = rejectedBookings ?? [];

  return {
    rejectedEvents: events,
    rejectedBookings: bookings,
    count: events.length + bookings.length,
    loaded: rejectedEvents !== undefined && rejectedBookings !== undefined,
  };
}

export const RejectedItemsPanel: React.FC = () => {
  const { t } = useTranslation();
  const { rejectedEvents, rejectedBookings, count } = useRejectedItems();
  const userId = useAuthStore((s) => s.user?.id);

  // Owner-checked, like every write to a held booking. The list is
  // already scoped, so these guards are belt-and-braces — but a write
  // that re-arms a row for sending is exactly the write that must not
  // rely on the list above having been rendered correctly.
  const retryRejected = useCallback(
    async (id: number | undefined) => {
      if (id == null || !userId) return;
      const row = await db.syncEvents.get(id);
      if (!row || row.userId !== userId) return;
      // Clear the fail flag and let SyncManager pick the event up on next heartbeat.
      await db.syncEvents.update(id, { failReason: undefined, synced: false });
    },
    [userId],
  );

  const discardRejected = useCallback(
    async (id: number | undefined) => {
      if (id == null || !userId) return;
      const row = await db.syncEvents.get(id);
      if (!row || row.userId !== userId) return;
      await db.syncEvents.delete(id);
    },
    [userId],
  );

  // Owner-checked, like every other write to a held booking.
  const discardBooking = useCallback(
    async (id: number | undefined) => {
      if (id == null || !userId) return;
      await cancelOutboxEntry(id, userId);
    },
    [userId],
  );

  if (count === 0) return null;

  return (
    <section data-testid="rejected-items-panel">
      <h3 className="text-sm font-semibold text-gray-900 mb-2">
        {t('sync.banner.modalTitle')}
      </h3>
      <ul className="divide-y divide-gray-200" role="list">
        {rejectedBookings.map((entry) => {
          const { pickupName, destinationName } = outboxSummary(entry);
          return (
            <li key={`outbox-${entry.clientId}`} className="py-3" role="listitem">
              <div className="text-sm font-medium text-gray-900">
                {t('outbox.rejectedLabel')}
              </div>
              <div className="text-xs text-gray-700 mt-0.5">
                {t('outbox.savedRoute', { from: pickupName, to: destinationName })}
              </div>
              <div
                className="text-xs text-gray-600 mt-0.5"
                data-testid={`outbox-rejected-reason-${entry.clientId}`}
              >
                {/* The server's own reason. Server messages arrive as
                    i18n keys under the errors namespace; anything the
                    client has no translation for falls back to the
                    honest generic, so a raw key is never rendered at
                    a passenger. (Most create-refusal codes have no
                    client string today — the generic IS the answer
                    for those, not a placeholder.) */}
                {entry.failMessage
                  ? t(entry.failMessage, { defaultValue: t('outbox.rejectedGeneric') })
                  : t('outbox.rejectedGeneric')}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">
                {new Date(entry.createdAt).toLocaleString()}
              </div>
              <div className="flex gap-2 mt-2">
                {/* No retry: the server answered. Re-sending a
                    refusal is not persistence, it is noise. */}
                <button
                  type="button"
                  onClick={() => discardBooking(entry.id)}
                  data-testid={`outbox-discard-${entry.clientId}`}
                  className="min-h-[44px] px-3 rounded-lg bg-gray-200 text-gray-800 text-sm hover:bg-gray-300"
                >
                  {t('sync.banner.discard')}
                </button>
              </div>
            </li>
          );
        })}
        {rejectedEvents.map((rej) => {
          const { code, message } = parseFailReason(rej.failReason);
          return (
            <li key={rej.clientEventId} className="py-3" role="listitem">
              <div className="text-sm font-medium text-gray-900">
                {String(rej.eventType ?? rej.clientEventId)}
              </div>
              <div className="text-xs text-gray-600 mt-0.5">
                {t(`sync.rejection.${code}`, { defaultValue: message })}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">
                {new Date(rej.clientTimestamp).toLocaleString()}
              </div>
              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => retryRejected(rej.id)}
                  className="min-h-[44px] px-3 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700"
                >
                  {t('sync.banner.retry')}
                </button>
                <button
                  type="button"
                  onClick={() => discardRejected(rej.id)}
                  className="min-h-[44px] px-3 rounded-lg bg-gray-200 text-gray-800 text-sm hover:bg-gray-300"
                >
                  {t('sync.banner.discard')}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
};
