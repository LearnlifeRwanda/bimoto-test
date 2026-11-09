// COMPONENTS/JOURNEY/CHILD-PASSENGER-BADGE.TSX
//
// R3-CHILD — visual marker for journeys with a declared child
// passenger. Mirrors the UrgentBadge pattern: returns null when the
// flag is off so callers can drop it into a card unconditionally.
// Uses a warm amber palette to distinguish from the hot red of the
// urgent badge — both can appear on the same card.

import React from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  hasChildPassenger: boolean | null | undefined;
  size?: 'sm' | 'md';
}

export const ChildPassengerBadge: React.FC<Props> = ({ hasChildPassenger, size = 'md' }) => {
  const { t } = useTranslation();
  if (!hasChildPassenger) return null;

  const sizeClass =
    size === 'sm' ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-1';

  return (
    <span
      className={`inline-flex items-center rounded-md bg-amber-100 text-amber-800 font-semibold ${sizeClass}`}
      role="status"
      aria-label={t('child.badgeLabel')}
      data-testid="child-passenger-badge"
    >
      {t('child.badgeLabel')}
    </span>
  );
};

export default ChildPassengerBadge;
