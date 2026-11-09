// COMPONENTS/JOURNEY/PARCEL-BADGE.TSX
//
// PARCEL-VISIBLE G4 — the field's exact report: "the driver cannot tell a
// parcel from a passenger."
//
// The feed payload has always carried `type`. The server even priority-orders
// the three parcel buckets ahead of everything else. The card rendered none
// of it, and <UrgentBadge> could not fill the gap: its contract is "returns
// null for any other journey type", so a plain GOODS parcel — the ordinary
// GoodsRequestPage booking, and the commonest parcel there is — showed NO
// marker at all. A motari scrolling the feed had nothing to distinguish a
// box of medicine from a person waiting on a corner.
//
// This is a SIBLING to <UrgentBadge> rather than an extension of it, and
// deliberately so: extending it would have to break either its null-for-
// anything-else contract or its two tier tables, both of which its own tests
// pin. The two badges compose — an URGENT_MESSENGER run shows "PARCEL" and
// "URGENT" side by side, which is what it is: a parcel, in a hurry.
//
// Renders for all three parcel-carrying types, because none of the existing
// badges names the CARGO. `urgent.badge` reads "URGENT" and `priority.badge`
// reads "PRIORITY"; neither tells a motari there is no passenger.

import React from 'react';
import { useTranslation } from 'react-i18next';

/**
 * The journey types that carry goods and no person. Mirrors the server's
 * `isCarryingPassenger` (shared/constants/parcel-weight.ts), which is the
 * same distinction read from the other side: PASSENGER carries a person,
 * everything else is a parcel run.
 */
const PARCEL_JOURNEY_TYPES = ['GOODS', 'PRIORITY_MESSENGER', 'URGENT_MESSENGER'];

export function isParcelJourney(journeyType: string | null | undefined): boolean {
  return typeof journeyType === 'string' && PARCEL_JOURNEY_TYPES.includes(journeyType);
}

interface Props {
  journeyType: string | null | undefined;
  size?: 'sm' | 'md';
}

export const ParcelBadge: React.FC<Props> = ({ journeyType, size = 'md' }) => {
  const { t } = useTranslation();

  if (!isParcelJourney(journeyType)) return null;

  const sizeClass = size === 'sm' ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-1';

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md font-bold bg-[#1B4F72]/10 text-[#1B4F72] ${sizeClass}`}
      role="status"
      aria-label={t('parcel.badgeAriaLabel')}
      data-testid="parcel-badge"
    >
      {t('parcel.badge')}
    </span>
  );
};

export default ParcelBadge;
