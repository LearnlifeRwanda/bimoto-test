// FIELD-CLOSE G2 — a findable front door for chat. The full-screen
// ChatPage has been routed at /journey/:id/chat all along, but nothing
// in the app navigated there (only push notifications deep-linked it),
// so the field team reported chat as a missing feature. This button is
// the visible entry: icon PLUS the word (never an icon alone), sized
// for thumbs, dropped into the action area of every matched/active
// screen on both sides of the ride.

import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

interface ChatEntryButtonProps {
  journeyId: string;
  /** Shown as a count bubble so unread context is visible pre-tap. */
  messageCount?: number;
}

export const ChatEntryButton: React.FC<ChatEntryButtonProps> = ({
  journeyId,
  messageCount,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <button
      type="button"
      onClick={() => navigate(`/journey/${journeyId}/chat`)}
      data-testid="chat-entry"
      className="w-full min-h-[48px] px-4 py-2.5 rounded-lg border border-[#1B4F72] bg-white text-[#1B4F72] flex items-center justify-center gap-2 text-sm font-semibold hover:bg-[#1B4F72]/5 transition-colors"
    >
      <svg
        className="w-5 h-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
        />
      </svg>
      <span>{t('chat.title')}</span>
      {typeof messageCount === 'number' && messageCount > 0 && (
        <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-[#1B4F72] text-white text-xs font-bold flex items-center justify-center">
          {messageCount}
        </span>
      )}
    </button>
  );
};
