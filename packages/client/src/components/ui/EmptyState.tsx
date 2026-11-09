// NET-UX G3 — the ONE empty-state design for list screens.
//
// A list with no items renders this instead of a blank area: a soft
// icon, a friendly localized title, optionally a hint and an action.
// Pages pass already-translated strings — copy stays in the page's own
// namespace, the layout stays shared. Not for load failures: a fetch
// that failed renders ErrorState (retryable), never a misleading
// "nothing here yet".

import React from 'react';

export interface EmptyStateProps {
  /** Already-translated headline, e.g. t('history.empty'). */
  title: string;
  /** Optional already-translated supporting line. */
  body?: string;
  /** Optional custom icon; a neutral inbox glyph renders by default. */
  icon?: React.ReactNode;
  /** Optional action button (already-translated label). */
  actionLabel?: string;
  onAction?: () => void;
  'data-testid'?: string;
}

const defaultIcon = (
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
      d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-3.5a1 1 0 00-.8.4l-1.2 1.6a1 1 0 01-.8.4h-3.4a1 1 0 01-.8-.4l-1.2-1.6a1 1 0 00-.8-.4H4"
    />
  </svg>
);

export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  body,
  icon,
  actionLabel,
  onAction,
  'data-testid': testId,
}) => (
  <div
    className="flex flex-col items-center justify-center text-center py-12 px-6"
    role="status"
    data-testid={testId ?? 'empty-state'}
  >
    {icon ?? defaultIcon}
    <p className="mt-3 text-gray-500 font-medium">{title}</p>
    {body && <p className="mt-1 text-sm text-gray-500">{body}</p>}
    {actionLabel && onAction && (
      <button
        onClick={onAction}
        className="mt-4 min-h-[44px] px-5 py-2 rounded-lg bg-[#1B4F72] text-white text-sm font-medium hover:bg-[#164060] active:bg-[#123550]"
      >
        {actionLabel}
      </button>
    )}
  </div>
);
