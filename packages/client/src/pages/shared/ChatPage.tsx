import React, { useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
import { Spinner } from '../../components/ui/Spinner';
import { ChatBubble } from '../../components/chat/ChatBubble';
import { ChatInput } from '../../components/chat/ChatInput';
import { QuickMessages } from '../../components/chat/QuickMessages';
import { useSocket } from '../../hooks/useSocket';
import { useAuthStore } from '../../stores/auth.store';
import { useJourneyStore } from '../../stores/journey.store';
import { useChatStore } from '../../stores/chat.store';
import { useUIStore } from '../../stores/ui.store';
import { JourneyStatus, type VehicleType } from '@bimoto/shared';
import { apiFetch, apiErrorFromResponse } from '../../lib/api';
import { presentApiError } from '../../lib/api-error-presenter';

export const ChatPage: React.FC = () => {
  const { t } = useTranslation();
  const { id: journeyId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const currentUserId = user?.id;
  const { messages, setMessages, addMessage, isLoading: storeLoading, setLoading } = useChatStore();
  const { activeJourney } = useJourneyStore();
  const { showToast } = useUIStore();

  const journeyStatus = activeJourney?.status as JourneyStatus | undefined;
  const journeyVehicleType =
    (activeJourney?.vehiclePreference ??
      activeJourney?.driver?.driverProfile?.vehicleType ??
      null) as VehicleType | null;

  const lastReceivedQuickMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (m.senderId !== currentUserId && m.quickMessageId) return m.quickMessageId;
    }
    return undefined;
  }, [messages, currentUserId]);

  // Connect to the socket and join this journey's room. The hook's
  // 'new-message' handler addMessage()s into the chat store, which dedupes
  // by id against the optimistic local entry from sendMessage().
  useSocket(journeyId);

  // Fetch messages
  useEffect(() => {
    const fetchMessages = async () => {
      setLoading(true);
      try {
        const res = await apiFetch(`/api/journeys/${journeyId}/messages`, {
          credentials: 'include',
        });
        if (!res.ok) throw await apiErrorFromResponse(res);
        const data = await res.json();
        setMessages(data);
      } catch (err) {
        presentApiError(err);
      } finally {
        setLoading(false);
      }
    };

    if (journeyId) fetchMessages();
  }, [journeyId, setMessages, setLoading, showToast, t]);

  const sendMessage = useCallback(
    async (text: string, quickMessageId?: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      try {
        const res = await apiFetch(`/api/journeys/${journeyId}/messages`, {
          method: 'POST',
          credentials: 'include',
          body: JSON.stringify({
            text: trimmed,
            isQuickMessage: !!quickMessageId,
            quickMessageId,
          }),
        });

        if (!res.ok) throw await apiErrorFromResponse(res);

        const msg = await res.json();
        addMessage(msg);
      } catch (err) {
        presentApiError(err);
      }
    },
    [journeyId, addMessage, showToast, t],
  );

  if (storeLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-white px-4 py-3 border-b flex items-center gap-3 sticky top-0 z-10">
        <button
          onClick={() => navigate(-1)}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-[#1B4F72]"
          aria-label={t('common.back')}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <h1 className="text-base font-semibold text-gray-900">{t('chat.title')}</h1>
          {/* DRIVER-ID v3 G5 — jacket number in the chat header so the
              customer can match the person at pickup. VERIFIED only. */}
          {activeJourney?.driver?.driverProfile?.verificationStatus === 'VERIFIED' &&
            activeJourney?.driver?.driverProfile?.ruraAuthorizationNumber && (
              <p data-testid="jacket-number" className="text-xs font-semibold text-[#1B4F72]">
                {t('driver.jacketNumber', {
                  number: activeJourney.driver.driverProfile.ruraAuthorizationNumber,
                })}
              </p>
            )}
        </div>
      </div>

      {/* Quick Messages Bar */}
      <div className="bg-white px-4 border-b">
        <QuickMessages
          onSend={(id, text) => sendMessage(text, id)}
          journeyStatus={journeyStatus}
          lastReceivedQuickMessageId={lastReceivedQuickMessageId}
          vehicleType={journeyVehicleType}
        />
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500 text-sm">{t('chat.noMessages')}</p>
          </div>
        ) : (
          messages.map((msg) => (
            <ChatBubble
              key={msg.id}
              message={msg}
              isMine={msg.senderId === currentUserId}
            />
          ))
        )}
      </div>

      {/* Chat Input */}
      <div className="sticky bottom-0">
        <ChatInput onSend={(text) => sendMessage(text)} />
      </div>
    </div>
  );
};

export default ChatPage;
