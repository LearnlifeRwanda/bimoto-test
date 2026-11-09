// NET-UX G3 — the ONE error-state design for list screens.
//
// Renders when a screen's data FAILED to load — distinct from
// EmptyState, so a dead tunnel never masquerades as "no rides yet".
// Copy follows the G2 taxonomy defaults (honest, no blame on the
// user's phone) and always offers a Retry wired to the page's fetch.
// Connectivity-wide messaging stays with the G1 banner; this component
// only owns the failed area of the screen.

import React from 'react';
import { useTranslation } from 'react-i18next';

export interface ErrorStateProps {
  /** Re-run the load that failed. */
  onRetry: () => void;
  /** Optional already-translated override of the default headline. */
  title?: string;
  'data-testid'?: string;
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  onRetry,
  title,
  'data-testid': testId,
}) => {
  const { t } = useTranslation();
  return (
    <div
      className="flex flex-col items-center justify-center text-center py-12 px-6"
      role="alert"
      data-testid={testId ?? 'error-state'}
    >
      <svg
        className="w-12 h-12 text-gray-300"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12 18.75h.008v.008H12v-.008z"
        />
      </svg>
      <p className="mt-3 text-gray-600 font-medium">{title ?? t('states.loadFailed')}</p>
      <p className="mt-1 text-sm text-gray-500">{t('states.loadFailedHint')}</p>
      <button
        onClick={onRetry}
        className="mt-4 min-h-[44px] px-5 py-2 rounded-lg bg-[#1B4F72] text-white text-sm font-medium hover:bg-[#164060] active:bg-[#123550]"
      >
        {t('common.retry')}
      </button>
    </div>
  );
};
