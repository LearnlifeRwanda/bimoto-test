import React from 'react';
import { useTranslation } from 'react-i18next';

// LANDMARKS G4 — the passenger's words, on the screens that need them.
//
// A description only exists when the passenger wrote one, so this renders
// nothing at all for every journey that has nothing to say. That is the
// whole contract: a request without a description looks exactly as it did
// before this field existed.

export interface PlaceDescriptionProps {
  target: 'pickup' | 'destination';
  text?: string | null;
  className?: string;
}

export const PlaceDescription: React.FC<PlaceDescriptionProps> = ({
  target,
  text,
  className = '',
}) => {
  const { t } = useTranslation();
  const trimmed = text?.trim();
  if (!trimmed) return null;
  return (
    <p
      className={`text-caption text-gray-600 italic ${className}`}
      data-testid={`${target}-description`}
    >
      <span className="not-italic font-medium text-gray-700">
        {t(
          target === 'pickup'
            ? 'journey.pickupDescriptionShown'
            : 'journey.destinationDescriptionShown',
        )}
        {': '}
      </span>
      {trimmed}
    </p>
  );
};

export default PlaceDescription;
