import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_MESSAGE_LENGTH } from '@bimoto/shared';

export interface ChatInputProps {
  onSend: (text: string) => void;
}

export const ChatInput: React.FC<ChatInputProps> = ({ onSend }) => {
  const { t } = useTranslation();
  const [text, setText] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    onSend(trimmed);
    setText('');
  };

  const remaining = MAX_MESSAGE_LENGTH - text.length;

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-2 p-2 bg-white border-t border-gray-200">
      <div className="flex-1 relative">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX_MESSAGE_LENGTH))}
          placeholder={t('chat.inputPlaceholder')}
          className="w-full min-h-[44px] px-3 py-2.5 rounded-full border border-gray-300 text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#1B4F72] focus:border-[#1B4F72]"
          maxLength={MAX_MESSAGE_LENGTH}
          aria-label={t('chat.inputPlaceholder')}
        />
        {text.length > 0 && remaining <= 50 && (
          <span
            className={`absolute right-3 bottom-1 text-[10px] ${
              remaining <= 10 ? 'text-[#E74C3C]' : 'text-gray-500'
            }`}
          >
            {remaining}
          </span>
        )}
      </div>
      <button
        type="submit"
        disabled={text.trim().length === 0}
        className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full bg-[#1B4F72] text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#164060] active:bg-[#123550] transition-colors"
        aria-label={t('chat.send')}
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
        </svg>
      </button>
    </form>
  );
};
