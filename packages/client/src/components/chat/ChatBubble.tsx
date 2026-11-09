import React from 'react';
import { useTranslation } from 'react-i18next';
import { QUICK_MESSAGES } from '@bimoto/shared';
import type { Language, Message } from '@bimoto/shared';

export interface ChatBubbleProps {
  message: Message;
  isMine: boolean;
}

export const ChatBubble: React.FC<ChatBubbleProps> = ({ message, isMine }) => {
  const { t, i18n } = useTranslation();
  const lang = (i18n.language || 'en') as Language;

  // Re-localize canned messages on the receiver side via the structured
  // catalog. Fall back to message.text if the id no longer exists in the
  // catalog (drift) or it's a free-text message.
  const displayText =
    message.isQuickMessage && message.quickMessageId
      ? QUICK_MESSAGES.find((qm) => qm.id === message.quickMessageId)?.text[lang] ??
        message.text
      : message.text;

  const timestamp = new Date(message.createdAt);
  const timeStr = timestamp.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div
      className={`flex mb-2 ${isMine ? 'justify-end' : 'justify-start'}`}
    >
      <div
        className={`
          max-w-[80%] px-3 py-2 rounded-2xl
          ${
            isMine
              ? 'bg-[#1B4F72] text-white rounded-br-md'
              : 'bg-gray-100 text-gray-900 rounded-bl-md'
          }
        `}
      >
        <p className="text-sm break-words">{displayText}</p>
        <p
          className={`text-[10px] mt-1 ${
            isMine ? 'text-white/70' : 'text-gray-600'
          }`}
          aria-label={t('chat.sentAt', { time: timeStr })}
        >
          {timeStr}
        </p>
      </div>
    </div>
  );
};
