import React from 'react';
import { useTranslation } from 'react-i18next';

export interface StarRatingProps {
  value: number;
  onChange?: (value: number) => void;
  readonly?: boolean;
  /**
   * RATE-DISPLAY — 'sm' renders compact display-only stars for card
   * surfaces (bid cards, driver header). The default 'md' keeps the
   * original 44px touch targets used by the interactive rating flow.
   */
  size?: 'sm' | 'md';
}

export const StarRating: React.FC<StarRatingProps> = ({
  value,
  onChange,
  readonly = false,
  size = 'md',
}) => {
  const { t } = useTranslation();

  const stars = [1, 2, 3, 4, 5];

  return (
    <div
      className="flex items-center gap-1"
      role={readonly ? 'img' : 'radiogroup'}
      aria-label={t('rating.label', { value })}
    >
      {stars.map((star) => {
        const isFilled = star <= value;
        return (
          <button
            key={star}
            type="button"
            onClick={() => {
              if (!readonly && onChange) {
                onChange(star);
              }
            }}
            disabled={readonly}
            className={`
              ${size === 'sm' ? '' : 'min-w-[44px] min-h-[44px]'} flex items-center justify-center
              transition-colors duration-150
              ${readonly ? 'cursor-default' : 'cursor-pointer hover:scale-110 active:scale-95'}
            `}
            role={readonly ? undefined : 'radio'}
            aria-checked={readonly ? undefined : star === value}
            aria-label={t('rating.star', { n: star })}
          >
            <svg
              className={`${size === 'sm' ? 'w-4 h-4' : 'w-8 h-8'} ${isFilled ? 'text-[#F39C12]' : 'text-gray-300'}`}
              fill={isFilled ? 'currentColor' : 'none'}
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={isFilled ? 0 : 1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
              />
            </svg>
          </button>
        );
      })}
    </div>
  );
};
