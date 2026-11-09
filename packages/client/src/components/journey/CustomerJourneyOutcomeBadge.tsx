// R3-N-5 — customer journey-outcome badge for DRIVER_NO_SHOW journeys.
//
// The badge surfaces the asymmetric-attribution philosophy from the
// May 2026 design conversation to the customer side: every report a
// customer files with cancelReason=DRIVER_NO_SHOW now has a visible
// outcome on their history list. Five terminal states:
//
//   pendingReview         — < 24h since cancellation, no driver dispute yet
//   noDriverDispute       — >= 24h elapsed, driver did not file a dispute
//   driverDisputed        — driver filed a dispute, admin has not decided
//   disputeUpheld         — admin sided with the customer (UPHOLD_FLAG / NO_ACTION)
//   disputeOverturned     — admin sided with the driver (OVERTURN_FLAG)
//
// Hidden when cancelReason !== 'DRIVER_NO_SHOW'.

import React from 'react';
import { useTranslation } from 'react-i18next';

const PENDING_WINDOW_MS = 24 * 60 * 60 * 1000;

export type CustomerJourneyOutcomeState =
  | 'pendingReview'
  | 'noDriverDispute'
  | 'driverDisputed'
  | 'disputeUpheld'
  | 'disputeOverturned';

export interface CustomerJourneyOutcomeProps {
  cancelReason: string | null | undefined;
  cancelledAt: string | null | undefined;
  driverDisputedAt: string | null | undefined;
  noShowResolution: {
    decision: 'OVERTURN_FLAG' | 'UPHOLD_FLAG' | 'NO_ACTION' | null;
    decidedAt: string | null;
  } | null | undefined;
  now?: number;
}

export function deriveOutcomeState(
  props: CustomerJourneyOutcomeProps,
): CustomerJourneyOutcomeState | null {
  if (props.cancelReason !== 'DRIVER_NO_SHOW') return null;
  const now = props.now ?? Date.now();

  if (props.noShowResolution?.decision) {
    return props.noShowResolution.decision === 'OVERTURN_FLAG'
      ? 'disputeOverturned'
      : 'disputeUpheld';
  }
  if (props.driverDisputedAt) {
    return 'driverDisputed';
  }
  const cancelTime = props.cancelledAt
    ? new Date(props.cancelledAt).getTime()
    : null;
  if (cancelTime !== null && now - cancelTime >= PENDING_WINDOW_MS) {
    return 'noDriverDispute';
  }
  return 'pendingReview';
}

const LABEL_KEY: Record<CustomerJourneyOutcomeState, string> = {
  pendingReview: 'journeyHistory.badgePendingReview',
  noDriverDispute: 'journeyHistory.badgeNoDriverDispute',
  driverDisputed: 'journeyHistory.badgeDriverDisputed',
  disputeUpheld: 'journeyHistory.badgeDisputeUpheld',
  disputeOverturned: 'journeyHistory.badgeDisputeOverturned',
};

const STATE_STYLE: Record<CustomerJourneyOutcomeState, string> = {
  pendingReview: 'bg-yellow-50 text-yellow-700',
  noDriverDispute: 'bg-gray-100 text-gray-700',
  driverDisputed: 'bg-blue-50 text-blue-600',
  disputeUpheld: 'bg-[#27AE60]/10 text-[#27AE60]',
  disputeOverturned: 'bg-[#E74C3C]/10 text-[#E74C3C]',
};

export const CustomerJourneyOutcomeBadge: React.FC<CustomerJourneyOutcomeProps> = (
  props,
) => {
  const { t } = useTranslation();
  const state = deriveOutcomeState(props);
  if (!state) return null;
  return (
    <span
      data-testid="customer-journey-outcome-badge"
      data-state={state}
      className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded-full ${STATE_STYLE[state]}`}
    >
      {t(LABEL_KEY[state])}
    </span>
  );
};
