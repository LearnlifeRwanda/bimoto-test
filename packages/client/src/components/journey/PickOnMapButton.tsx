import React from 'react';
import { useTranslation } from 'react-i18next';

// BOOK-UNBLOCK G2 — explicit "Choose on map" affordance next to each
// address field. Pick-on-map already worked behind the sheet-collapse
// gesture; this control makes the same route discoverable. When address
// search is unavailable (geocode proxy 503 — LocationIQ key unset) the
// control renders as the visually primary way to set the point.

export interface PickOnMapButtonProps {
  target: 'pickup' | 'destination';
  /** Render as the primary (filled) control — address search is unavailable. */
  primary?: boolean;
  onClick: () => void;
}

export const PickOnMapButton: React.FC<PickOnMapButtonProps> = ({
  target,
  primary = false,
  onClick,
}) => {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      data-testid={`pick-on-map-${target}`}
      data-primary={primary ? 'true' : undefined}
      onClick={onClick}
      className={
        primary
          ? 'mt-2 w-full min-h-[44px] px-4 rounded-lg bg-[#1B4F72] text-white text-secondary font-medium flex items-center justify-center gap-2 hover:bg-[#164060] transition-colors'
          : 'mt-2 min-h-[44px] px-1 text-secondary font-medium text-[#1B4F72] underline flex items-center gap-2'
      }
    >
      <svg
        className="w-4 h-4 flex-shrink-0"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
        />
      </svg>
      {t('journey.pickOnMap')}
    </button>
  );
};

export default PickOnMapButton;
