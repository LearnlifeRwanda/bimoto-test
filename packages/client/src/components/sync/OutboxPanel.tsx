// COMPONENTS/SYNC/OUTBOX-PANEL.TSX
//
// CHROME-C G2 — what OutboxBanner was, minus the two strips.
//
// OUTBOX G3 gave the shell two lines about held bookings: a calm strip
// while one waited, and a green strip offering the ride once one had
// gone out. Both displaced content on every screen. Option C keeps
// what they SAID and drops the displacement: the waiting count and the
// offer are both badge contributions, the news arrives as a toast, and
// this panel is what the badge opens onto.
//
// The offer is still an OFFER and never a navigation — hauling somebody
// out of another screen because a background send finished would undo
// exactly the calm this feature exists to provide. What changed is that
// it no longer expires: the green strip vanished when dismissed and a
// 3 s toast vanishes on its own, whereas `lastSent` keeps the badge lit
// until the ride is actually viewed.
//
// Both queries are scoped to the signed-in user, keyed by user id
// rather than filtered after the fact, so a borrowed phone shows its
// new user nothing of the previous one's held bookings.

import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/dexie';
import { useAuthStore } from '../../stores/auth.store';
import { useOutboxStore } from '../../stores/outbox.store';
import { cancelOutboxEntry, outboxSummary } from '../../lib/outbox';
import type { OutboxEntry } from '../../db/tables';

/**
 * Held bookings waiting to go out, live. Exported so the header badge
 * can count them off the same query the list renders from.
 *
 * `loaded` distinguishes "Dexie has not answered yet" from "Dexie
 * answered, and there are none". Rendering does not care — both draw
 * nothing — but CHROME-C G3's toasts do: without it, the first resolve
 * of a phone that already holds two bookings looks exactly like two
 * bookings ARRIVING, and the shell shouts on every mount.
 */
export function usePendingOutbox(): { rows: OutboxEntry[]; loaded: boolean } {
  const userId = useAuthStore((s) => s.user?.id);
  // No default value: undefined IS the not-yet-answered signal.
  const rows = useLiveQuery(async () => {
    if (!userId) return [] as OutboxEntry[];
    const all = await db.outbox.where('userId').equals(userId).toArray();
    return all
      .filter((e) => e.status === 'PENDING')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [userId]);

  return { rows: rows ?? [], loaded: rows !== undefined };
}

export interface OutboxPanelProps {
  /** Closes the surface hosting this panel when a navigation happens. */
  onNavigate?: () => void;
}

export const OutboxPanel: React.FC<OutboxPanelProps> = ({ onNavigate }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const userId = useAuthStore((s) => s.user?.id);
  const { rows: pending } = usePendingOutbox();
  const lastSent = useOutboxStore((s) => s.lastSent);
  const clearSent = useOutboxStore((s) => s.clearSent);

  const handleCancel = useCallback(
    async (id: number | undefined) => {
      if (id == null || !userId) return;
      await cancelOutboxEntry(id, userId);
    },
    [userId],
  );

  const handleView = useCallback(() => {
    if (!lastSent) return;
    const { journeyId } = lastSent;
    clearSent();
    onNavigate?.();
    navigate(`/journey/${journeyId}/bids`);
  }, [lastSent, clearSent, navigate, onNavigate]);

  if (!userId) return null;
  if (!lastSent && pending.length === 0) return null;

  return (
    <section data-testid="outbox-panel">
      {lastSent && (
        <div className="mb-4" data-testid="outbox-sent-offer">
          <h3 className="text-sm font-semibold text-gray-900 mb-1">
            {t('outbox.sentTitle')}
          </h3>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleView}
              data-testid="outbox-sent-view"
              className="min-h-[44px] px-3 rounded-lg bg-green-700 text-white font-semibold text-sm"
            >
              {t('outbox.view')}
            </button>
            <button
              type="button"
              onClick={clearSent}
              data-testid="outbox-sent-dismiss"
              className="min-h-[44px] px-3 rounded-lg border border-green-700 text-green-900 text-sm"
            >
              {t('outbox.dismiss')}
            </button>
          </div>
        </div>
      )}

      {pending.length > 0 && (
        <>
          <h3 className="text-sm font-semibold text-gray-900 mb-2">
            {t('outbox.waitingTitle')}
          </h3>
          <ul className="divide-y divide-gray-200" role="list">
            {pending.map((entry) => {
              const { pickupName, destinationName } = outboxSummary(entry);
              return (
                <li key={entry.clientId} className="py-3" role="listitem">
                  <div className="text-sm font-medium text-gray-900">
                    {t('outbox.savedRoute', { from: pickupName, to: destinationName })}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {new Date(entry.createdAt).toLocaleString()}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCancel(entry.id)}
                    data-testid={`outbox-cancel-${entry.clientId}`}
                    className="mt-2 min-h-[44px] px-3 rounded-lg bg-gray-200 text-gray-800 text-sm hover:bg-gray-300"
                  >
                    {t('outbox.cancel')}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
};
