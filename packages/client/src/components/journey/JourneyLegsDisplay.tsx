// COMPONENTS/JOURNEY/JOURNEY-LEGS-DISPLAY.TSX
//
// R3-DELIVERY — visual list of a journey's intermediate stops. Used
// on both the customer side (preview before submission) and the
// driver side (driver-active mode with "Complete this stop" buttons
// that hit POST /api/journeys/:id/legs/:legId/complete).

import React from 'react';
import { useTranslation } from 'react-i18next';
import type {
  Leg,
  LegInput,
  ParcelCategory,
  ParcelSize,
  RecipientConfirmStatus,
} from '@bimoto/shared';
// PARCEL-CATEGORY — the label keys and the badge palette moved to
// lib/parcel-category, so a category reads the same word and the same
// colour on a leg, on a feed card, on the bid screen and in the
// motari's hands at the pickup.
import {
  parcelCategoryBadgeClass,
  parcelCategoryLabelKey,
} from '../../lib/parcel-category';

type DisplayLeg = Leg | (LegInput & { id?: string; status?: string; completedAt?: string | null });

// R3-RECIPIENT-CONFIRM-2 — truncate the recipient's verbatim SMS in the
// badge so a multi-part dispute message doesn't overflow the journey row.
// Full text remains in DB for the conflicts dashboard surface.
const DISPUTE_REASON_MAX = 60;
function truncateReason(reason: string | null | undefined): string {
  if (!reason) return '';
  const trimmed = reason.trim();
  return trimmed.length > DISPUTE_REASON_MAX
    ? `${trimmed.slice(0, DISPUTE_REASON_MAX - 1)}…`
    : trimmed;
}

interface Props {
  legs: DisplayLeg[];
  mode: 'preview' | 'driver-active';
  onCompleteStop?: (legId: string) => void;
  // R3-DELIVERY-NOTIFICATIONS-2 — driver taps "I'm at pickup" to flip
  // a PENDING GOODS_PICKUP leg to ACTIVE, firing the customer-arrived
  // SMS. Only rendered in driver-active mode.
  onActivateStop?: (legId: string) => void;
  /** NET-UX G3 — legId whose action POST is in flight; both stop-action
   * buttons disable for it so a double-tap can't fire twice. */
  pendingLegId?: string | null;
  // R3-DELIVERY-V2 — reorder stops via up/down arrow buttons. Only
  // meaningful in 'preview' mode (the customer is composing the
  // journey); driver-active mode never renders the controls.
  onReorder?: (fromIndex: number, toIndex: number) => void;
}

function parcelBadgeClass(size: ParcelSize): string {
  switch (size) {
    case 'SMALL':
      return 'bg-gray-100 text-gray-700';
    case 'MEDIUM':
      return 'bg-amber-100 text-amber-800';
    case 'LARGE':
      return 'bg-orange-100 text-orange-800';
  }
}


export const JourneyLegsDisplay: React.FC<Props> = ({
  legs,
  mode,
  onCompleteStop,
  onActivateStop,
  pendingLegId = null,
  onReorder,
}) => {
  const { t } = useTranslation();
  if (!legs || legs.length === 0) return null;

  return (
    <div data-testid="journey-legs-display" className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        {t('delivery.driverStopList')}
      </h3>
      <ol className="space-y-2">
        {legs.map((leg, idx) => {
          const sequence = idx + 1;
          const isCompleted = leg.status === 'COMPLETED';
          const isGoods =
            leg.type === 'GOODS_DROPOFF' || leg.type === 'GOODS_PICKUP';
          const legId = (leg as { id?: string }).id;
          return (
            <li
              key={legId ?? `leg-${idx}`}
              data-testid={`leg-row-${idx}`}
              className={`rounded-lg border p-3 ${
                isCompleted
                  ? 'border-green-200 bg-green-50'
                  : 'border-gray-200 bg-white'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-[#1B4F72]">
                      {t('delivery.stopOrderLabel', { n: sequence })}
                    </span>
                    {isGoods && leg.parcelSize && (
                      <span
                        data-testid={`parcel-size-badge-${idx}`}
                        className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${parcelBadgeClass(
                          leg.parcelSize as ParcelSize,
                        )}`}
                      >
                        {leg.parcelSize}
                      </span>
                    )}
                    {isGoods && leg.parcelCategory && (
                      <span
                        data-testid={`parcel-category-badge-${idx}`}
                        data-category={leg.parcelCategory}
                        className={`parcel-category-badge text-[10px] font-medium px-1.5 py-0.5 rounded ${parcelCategoryBadgeClass(
                          leg.parcelCategory as ParcelCategory,
                        )}`}
                      >
                        {t(parcelCategoryLabelKey(leg.parcelCategory as ParcelCategory))}
                      </span>
                    )}
                    {isCompleted && (
                      <span
                        data-testid={`leg-completed-${idx}`}
                        className="text-[10px] font-medium text-green-700"
                      >
                        ✓ {t('delivery.driverStopCompleted', {
                          time: leg.completedAt
                            ? new Date(leg.completedAt as string).toLocaleTimeString()
                            : '',
                        })}
                      </span>
                    )}
                    {/* R3-RECIPIENT-CONFIRM (+ R3-RECIPIENT-CONFIRM-2) — recipient
                        acknowledgement badge. Three variants drive icon, color, and
                        label:
                          - EXPLICIT_REPLY (green ✓) — recipient SMS-replied a
                            confirmation keyword. Same visual as legacy
                            R3-RECIPIENT-CONFIRM rows (status NULL +
                            recipientConfirmedAt set), since those were all
                            explicit replies pre-R3-RECIPIENT-CONFIRM-2.
                          - AUTO_TIMEOUT (amber ⏰) — recipient never replied;
                            auto-confirm-recipient cron stamped at 24h.
                          - DISPUTED (red ⚠) — recipient flagged the parcel as
                            wrong/damaged; verbatim SMS body shown as reason.
                        Surfaced only on GOODS_DROPOFF legs. */}
                    {leg.type === 'GOODS_DROPOFF' &&
                      (leg as { recipientConfirmedAt?: string | null }).recipientConfirmedAt && (() => {
                        const recipientLeg = leg as {
                          recipientConfirmedAt: string;
                          recipientConfirmStatus?: RecipientConfirmStatus | null;
                          recipientDisputeReason?: string | null;
                        };
                        const status = recipientLeg.recipientConfirmStatus ?? 'EXPLICIT_REPLY';
                        const time = new Date(recipientLeg.recipientConfirmedAt).toLocaleTimeString();
                        let icon: string;
                        let className: string;
                        let label: string;
                        if (status === 'AUTO_TIMEOUT') {
                          icon = '⏰';
                          className =
                            'recipient-confirmed-badge text-[10px] font-medium text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded';
                          label = t('delivery.recipientAutoConfirmed', { time });
                        } else if (status === 'DISPUTED') {
                          icon = '⚠';
                          className =
                            'recipient-confirmed-badge text-[10px] font-medium text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded';
                          label = t('delivery.recipientDisputed', {
                            reason: truncateReason(recipientLeg.recipientDisputeReason),
                          });
                        } else {
                          icon = '✓';
                          className =
                            'recipient-confirmed-badge text-[10px] font-medium text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded';
                          label = t('delivery.recipientConfirmed', { time });
                        }
                        return (
                          <span
                            data-testid={`recipient-confirmed-${idx}`}
                            data-status={status}
                            className={className}
                          >
                            {icon} {label}
                          </span>
                        );
                      })()}
                  </div>
                  <p className="text-sm text-gray-900 mt-0.5 break-words">
                    {leg.name}
                  </p>
                  {leg.contactName && (
                    <p className="text-xs text-gray-600 mt-0.5">
                      {leg.contactName}
                      {leg.contactPhone ? ` · ${leg.contactPhone}` : ''}
                    </p>
                  )}
                </div>
                {mode === 'driver-active' && !isCompleted && legId && (
                  <div className="flex flex-col gap-1">
                    {/* R3-DELIVERY-NOTIFICATIONS-2 — driver taps before
                        completion when they reach the pickup point.
                        Surfaces only on PENDING GOODS_PICKUP legs; once
                        flipped to ACTIVE the button hides. */}
                    {leg.type === 'GOODS_PICKUP' &&
                      leg.status === 'PENDING' &&
                      onActivateStop && (
                        <button
                          type="button"
                          onClick={() => onActivateStop(legId)}
                          disabled={pendingLegId === legId}
                          data-testid={`activate-stop-${idx}`}
                          className="min-h-[44px] px-3 py-1.5 rounded-lg border border-[#1B4F72] bg-white text-[#1B4F72] text-xs font-medium hover:bg-[#1B4F72]/5 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {t('delivery.imAtPickup')}
                        </button>
                      )}
                    {onCompleteStop && (
                      <button
                        type="button"
                        onClick={() => onCompleteStop(legId)}
                        disabled={pendingLegId === legId}
                        data-testid={`complete-stop-${idx}`}
                        className="min-h-[44px] px-3 py-1.5 rounded-lg bg-[#1B4F72] text-white text-xs font-medium hover:bg-[#163d59] disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {t('delivery.driverCompleteStop')}
                      </button>
                    )}
                  </div>
                )}
                {/* R3-DELIVERY-V2 — up/down reorder controls. Customer-
                    only ('preview' mode); the up/down arrows swap the
                    stop with its neighbor and the parent re-stamps
                    sequence numbers at submission time. */}
                {mode === 'preview' && onReorder && (
                  <div className="flex flex-col gap-1">
                    <button
                      type="button"
                      onClick={() => onReorder(idx, idx - 1)}
                      disabled={idx === 0}
                      data-testid={`stop-move-up-${idx}`}
                      aria-label={t('delivery.moveStopUp')}
                      className="min-h-[28px] min-w-[28px] px-1.5 rounded border border-gray-300 bg-white text-xs text-gray-700 hover:border-gray-400 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => onReorder(idx, idx + 1)}
                      disabled={idx === legs.length - 1}
                      data-testid={`stop-move-down-${idx}`}
                      aria-label={t('delivery.moveStopDown')}
                      className="min-h-[28px] min-w-[28px] px-1.5 rounded border border-gray-300 bg-white text-xs text-gray-700 hover:border-gray-400 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      ↓
                    </button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
};

export default JourneyLegsDisplay;
