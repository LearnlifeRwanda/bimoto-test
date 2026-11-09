// COMPONENTS/JOURNEY/CHILD-TRAVEL-NOTICE.TSX
//
// TEAM-SAID G1 — the one thing the passenger wanted the motari to know
// before he arrives: a child is coming on this trip.
//
// This is an advisory and nothing more. It is NOT ChildPassengerBadge,
// which belongs to the R3-CHILD declaration flow the pilot omits (fare
// premium, acknowledgment modal, child-safety validator, the 422 child
// taxonomy). The two are kept as separate components on purpose so
// that neither can quietly acquire the other's behaviour: this one
// reads `travellingWithChild` and renders a sentence.
//
// Like PlaceDescription, it returns null when there is nothing to say,
// so callers drop it into a card unconditionally and a request without
// the flag looks exactly as it did before the field existed.

import React from 'react';
import { useTranslation } from 'react-i18next';

export interface ChildTravelNoticeProps {
  travellingWithChild?: boolean | null;
  className?: string;
}

export const ChildTravelNotice: React.FC<ChildTravelNoticeProps> = ({
  travellingWithChild,
  className = '',
}) => {
  const { t } = useTranslation();
  if (!travellingWithChild) return null;
  return (
    <p
      className={`text-caption text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1 ${className}`}
      role="status"
      data-testid="child-travel-notice"
    >
      {t('childTravel.noticeToDriver')}
    </p>
  );
};

export default ChildTravelNotice;
