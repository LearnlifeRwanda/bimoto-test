// COMPONENTS/JOURNEY/SAVED-OFFLINE-NOTICE.TSX
//
// OUTBOX G2 — what a passenger sees when they book in a dead zone.
//
// The thing this replaces is a red toast reading "Could not create the
// ride", which was a lie: the ride WAS created, on this phone, and it is
// waiting. So the screen says what is true — saved here, going out the
// moment there is signal — shows the passenger their own route back so
// they can see it is the right one, and offers the only two things they
// can actually do about it: leave it, or take it back.
//
// Shared by the two pages that create a journey (NewJourneyPage,
// GoodsRequestPage) so a held ride and a held parcel read identically.

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/Button';
import { cancelOutboxEntry, outboxSummary } from '../../lib/outbox';
import type { OutboxEntry } from '../../db/tables';

export interface SavedOfflineNoticeProps {
  entry: OutboxEntry;
  /** The user this entry belongs to — the cancel is owner-checked. */
  userId: string;
  /** "Cancel this booking" completed: the entry is gone. */
  onCancelled: () => void;
  /** "Done": leave the booking queued and go on with the day. */
  onDone: () => void;
}

export const SavedOfflineNotice: React.FC<SavedOfflineNoticeProps> = ({
  entry,
  userId,
  onCancelled,
  onDone,
}) => {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const { pickupName, destinationName } = outboxSummary(entry);

  const handleCancel = async () => {
    if (entry.id == null) return;
    setBusy(true);
    await cancelOutboxEntry(entry.id, userId);
    setBusy(false);
    onCancelled();
  };

  return (
    <div
      className="w-full max-w-sm mx-auto px-4 py-6"
      data-testid="saved-offline-notice"
      role="status"
    >
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
        <h2 className="text-title font-bold text-[#1B4F72]">
          {t('outbox.savedTitle')}
        </h2>
        <p className="mt-2 text-secondary text-gray-700">
          {t('outbox.savedBody')}
        </p>
        <p
          className="mt-3 text-secondary font-medium text-gray-900"
          data-testid="saved-offline-route"
        >
          {t('outbox.savedRoute', { from: pickupName, to: destinationName })}
        </p>
      </div>

      <div className="mt-6 space-y-3">
        <Button onClick={onDone} fullWidth data-testid="saved-offline-done">
          {t('outbox.done')}
        </Button>
        <button
          type="button"
          onClick={handleCancel}
          disabled={busy}
          data-testid="saved-offline-cancel"
          className="w-full min-h-[44px] px-4 rounded-lg border border-gray-300 bg-white text-secondary font-medium text-gray-700 disabled:opacity-50"
        >
          {t('outbox.cancel')}
        </button>
      </div>
    </div>
  );
};

export default SavedOfflineNotice;
