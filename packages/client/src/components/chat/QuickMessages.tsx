import React from 'react';
import { useTranslation } from 'react-i18next';
import { QUICK_MESSAGES, JourneyStatus } from '@bimoto/shared';
import type { Language, VehicleType } from '@bimoto/shared';
import { useAuthStore } from '../../stores/auth.store';

export interface QuickMessagesProps {
  onSend: (quickMessageId: string, text: string) => void;
  /** Current journey status — narrows the catalogue to messages relevant
   *  to this state. Messages whose `contexts` is empty are treated as
   *  universal and survive any status filter. */
  journeyStatus?: JourneyStatus;
  /** ID of the most recent quick message received from the other party.
   *  Messages in that ID's responseSet sort to the top. */
  lastReceivedQuickMessageId?: string;
  /** R3-V — vehicle type for this journey. Messages with a non-empty
   *  vehicleTypes list are hidden when this prop doesn't match. When
   *  omitted, the filter is bypassed (every message survives). */
  vehicleType?: VehicleType | null;
}

export const QuickMessages: React.FC<QuickMessagesProps> = ({
  onSend,
  journeyStatus,
  lastReceivedQuickMessageId,
  vehicleType,
}) => {
  const { t, i18n } = useTranslation();
  const currentLang = (i18n.language || 'en') as Language;
  const role = useAuthStore((s) => s.user?.role);

  const candidateMessages = QUICK_MESSAGES.filter((qm) => {
    const roleMatch =
      qm.forRole === 'BOTH' || role === 'BOTH' || !role || qm.forRole === role;
    if (!roleMatch) return false;
    if (journeyStatus && qm.contexts.length > 0 && !qm.contexts.includes(journeyStatus)) {
      return false;
    }
    if (qm.vehicleTypes && qm.vehicleTypes.length > 0 && vehicleType) {
      if (!qm.vehicleTypes.includes(vehicleType)) return false;
    }
    return true;
  });

  const lastReceived = lastReceivedQuickMessageId
    ? QUICK_MESSAGES.find((qm) => qm.id === lastReceivedQuickMessageId)
    : null;
  const replySet = new Set(lastReceived?.responseSet ?? []);
  const visible = [...candidateMessages].sort((a, b) => {
    const aIsReply = replySet.has(a.id) ? 0 : 1;
    const bIsReply = replySet.has(b.id) ? 0 : 1;
    return aIsReply - bIsReply;
  });

  return (
    <div
      className="flex flex-row gap-2 overflow-x-auto py-2 px-1 scrollbar-hide"
      role="group"
      aria-label={t('chat.quickMessages')}
    >
      {visible.map((qm) => {
        const text = qm.text[currentLang] || qm.text.en;
        return (
          <button
            key={qm.id}
            onClick={() => onSend(qm.id, text)}
            className="flex-shrink-0 min-h-[44px] px-3 py-2 rounded-full bg-gray-100 text-sm text-gray-700 font-medium hover:bg-gray-200 active:bg-gray-300 transition-colors whitespace-nowrap"
            type="button"
          >
            {qm.icon ? (
              <span className="mr-1" aria-hidden="true">
                {qm.icon}
              </span>
            ) : null}
            {text}
          </button>
        );
      })}
    </div>
  );
};
