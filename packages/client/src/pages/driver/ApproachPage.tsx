import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { PlaceDescription } from '../../components/journey/PlaceDescription';
import { ChildTravelNotice } from '../../components/journey/ChildTravelNotice';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Spinner } from '../../components/ui/Spinner';
import { ChatBubble } from '../../components/chat/ChatBubble';
import { ChatInput } from '../../components/chat/ChatInput';
import { ChatEntryButton } from '../../components/chat/ChatEntryButton';
import { QuickMessages } from '../../components/chat/QuickMessages';
import { EmergencySOS } from '../../components/safety/EmergencySOS';
import { useSocket } from '../../hooks/useSocket';
import { useOwnPosition } from '../../hooks/useOwnPosition';
import { DriverNavMap } from '../../components/map/DriverNavMap';
import { useAuthStore } from '../../stores/auth.store';
import { useJourneyStore } from '../../stores/journey.store';
import { useChatStore } from '../../stores/chat.store';
import { useUIStore } from '../../stores/ui.store';
import { JourneyStatus, type VehicleType } from '@bimoto/shared';
import { apiFetch, apiErrorFromResponse } from '../../lib/api';
import { presentApiError } from '../../lib/api-error-presenter';

// SETTLE-UP G4 — how long the motari is asked to keep going on an
// unconfirmed fare. Mirrors UNPAID_MATCH_GRACE_MS in
// server/src/jobs/unpaid-match-reaper.job.ts, which is what actually
// releases him; this constant only names that window on his screen. If
// the reaper's window ever moves, this moves with it.
const UNPAID_MATCH_GRACE_MINUTES = 10;

// The motari's payment line, derived from the escrow the journey GET
// already returns. HELD (and the settled states past it) mean the money
// is really there; PENDING and FAILED both mean "not yet", which is the
// distinction that matters to someone deciding whether to ride across
// Kigali. Anything else — no escrow row at all — says nothing rather
// than guessing.
type PaymentLine = { tone: 'ok' | 'pending'; key: string } | null;

function paymentLineFor(escrowStatus: string | undefined | null): PaymentLine {
  switch (escrowStatus) {
    case 'HELD':
    case 'RELEASED':
      return { tone: 'ok', key: 'approach.paymentConfirmed' };
    case 'PENDING':
    case 'FAILED':
      return { tone: 'pending', key: 'approach.paymentSettling' };
    default:
      return null;
  }
}

export const ApproachPage: React.FC = () => {
  const { t } = useTranslation();
  const { id: journeyId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const currentUserId = user?.id;
  const { activeJourney, setActiveJourney } = useJourneyStore();
  const { messages, setMessages, addMessage } = useChatStore();
  const { showToast } = useUIStore();

  // Real-time chat: socket pushes 'new-message' into the chat store.
  useSocket(journeyId);

  // COCKPIT G1 — the driver's own position for his own map. A watch,
  // not the dashboard's one-shot read: this screen is what he is riding
  // with. The watch is torn down with the page.
  const ownCoords = useOwnPosition();

  const [isLoading, setIsLoading] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  const journeyStatus =
    (activeJourney?.status as JourneyStatus | undefined) ?? JourneyStatus.MATCHED;
  const journeyVehicleType =
    (activeJourney?.vehiclePreference ??
      activeJourney?.driver?.driverProfile?.vehicleType ??
      null) as VehicleType | null;

  // SETTLE-UP G4 — the escrow is already on the journey this page
  // fetches (journey.service.getJourneyById includes it), so this costs
  // no new request and no polling loop.
  const paymentLine = useMemo(
    () => paymentLineFor((activeJourney as { escrow?: { status?: string } } | null)?.escrow?.status),
    [activeJourney],
  );

  // Map inputs. A journey with no pickup coordinates renders no map at
  // all rather than a map of nowhere — the address text below still
  // tells the motari where to go.
  const pickupPoint = useMemo(() => {
    const j = activeJourney as { pickupLat?: number; pickupLng?: number } | null;
    return typeof j?.pickupLat === 'number' && typeof j?.pickupLng === 'number'
      ? { lat: j.pickupLat, lng: j.pickupLng }
      : null;
  }, [activeJourney]);

  const ownPoint = useMemo(
    () => (ownCoords ? { lat: ownCoords.lat, lng: ownCoords.lng } : null),
    [ownCoords],
  );

  const lastReceivedQuickMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (m.senderId !== currentUserId && m.quickMessageId) return m.quickMessageId;
    }
    return undefined;
  }, [messages, currentUserId]);

  // Fetch journey and messages
  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const [journeyRes, msgRes] = await Promise.all([
          apiFetch(`/api/journeys/${journeyId}`, {
            credentials: 'include',
          }),
          apiFetch(`/api/journeys/${journeyId}/messages`, {
            credentials: 'include',
          }),
        ]);

        if (journeyRes.ok) {
          const data = await journeyRes.json();
          setActiveJourney(data);
        }
        if (msgRes.ok) {
          const msgData = await msgRes.json();
          setMessages(msgData);
        }
      } catch (err) {
        presentApiError(err);
      } finally {
        setIsLoading(false);
      }
    };

    if (journeyId) fetchData();
  }, [journeyId, setActiveJourney, setMessages, showToast, t]);

  // R3-N-1 — driver honest withdrawal. Per the design spec §1.2 rule 4
  // "honest drivers have a graceful out", drivers post DRIVER_CAN_NOT_MAKE_IT
  // and bear a smaller mark (driverInitiatedCancellationCount) than a
  // silent no-show (noShowCount).
  const handleDriverWithdraw = useCallback(async () => {
    setIsCancelling(true);
    try {
      const res = await apiFetch(`/api/journeys/${journeyId}/cancel`, {
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ reason: 'DRIVER_CAN_NOT_MAKE_IT' }),
      });
      if (!res.ok) throw await apiErrorFromResponse(res);
      showToast(t('approach.withdrawSuccess'), 'info');
      navigate('/driver', { replace: true });
    } catch (err) {
      presentApiError(err);
    } finally {
      setIsCancelling(false);
      setCancelModalOpen(false);
    }
  }, [journeyId, showToast, navigate, t]);

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

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-[#1B4F72] text-white px-4 py-4">
        <h1 className="text-lg font-bold">{t('approach.title')}</h1>
        {activeJourney?.customer && (
          <p className="text-sm text-white/70 mt-1">
            {t('approach.pickingUp', { name: activeJourney.customer.nickname })}
          </p>
        )}
      </div>

      {/* SETTLE-UP G4 — the motari's payment line. PAY-TRUTH G2's
          keep-match window means a journey can sit MATCHED over a FAILED
          or PENDING escrow for ten minutes, and until now the driver
          riding toward that pickup had no way to know. It informs; it
          never blocks — no disabled buttons, no gate on the trip. */}
      {paymentLine && (
        <div
          data-testid="approach-payment-line"
          className={
            paymentLine.tone === 'ok'
              ? 'bg-green-50 border-b border-green-100 px-4 py-2 text-sm text-green-800'
              : 'bg-amber-50 border-b border-amber-100 px-4 py-2 text-sm text-amber-900'
          }
        >
          {t(paymentLine.key, { minutes: UNPAID_MATCH_GRACE_MINUTES })}
        </div>
      )}

      {/* COCKPIT G2 — the map, where the grey "Map view" rectangle used
          to be. Offline-capable tiles (BaseTileLayer picks a downloaded
          region when one covers the view), the motari's own position and
          the pickup pin, joined by the real road route when the
          directions proxy answers and by the shared dashed connector
          when it can't. Same 224 px band the placeholder occupied, so
          nothing below it moved. */}
      {pickupPoint && (
        <DriverNavMap origin={ownPoint} target={pickupPoint} targetKind="pickup" />
      )}

      {/* Navigation info */}
      {activeJourney && (
        <div className="bg-white px-4 py-3 border-b">
          <div className="flex items-center gap-2 text-sm text-gray-700">
            <svg className="w-4 h-4 text-green-700 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <circle cx="10" cy="10" r="4" />
            </svg>
            <span>{t('approach.pickupAt')}</span>
          </div>
          <p className="ml-6 text-sm font-medium text-gray-900">{activeJourney.pickupName}</p>
          <PlaceDescription
            target="pickup"
            text={(activeJourney as { pickupDescription?: string }).pickupDescription}
            className="ml-6 mt-1"
          />
          {/* TEAM-SAID G1 — still on his screen while he rides to the
              pickup, so a child at the kerb is never a surprise. */}
          <ChildTravelNotice
            travellingWithChild={
              (activeJourney as { travellingWithChild?: boolean }).travellingWithChild
            }
            className="ml-6 mt-1"
          />
          {/* PILOT-GUARD Item 6(b) — an ETA line used to sit here reading
              `activeJourney.driverEtaMinutes`. No API payload and no
              model carries that field, so the condition was always
              falsy and the line has never rendered on any build. Same
              dead-read class as #191/#192, on a screen neither touched.
              Removed rather than wired: this is the motari's own
              approach screen, and his ETA to the pickup is not a number
              the server computes for him. */}
        </div>
      )}

      {/* Quick Messages */}
      <div className="bg-white px-4 border-b">
        <QuickMessages
          onSend={(id, text) => sendMessage(text, id)}
          journeyStatus={journeyStatus}
          lastReceivedQuickMessageId={lastReceivedQuickMessageId}
          vehicleType={journeyVehicleType}
        />
      </div>

      {/* Chat Panel */}
      <div className="flex-1 flex flex-col">
        <button
          onClick={() => setChatOpen(!chatOpen)}
          className="w-full px-4 py-3 bg-white border-b flex items-center justify-between min-h-[44px]"
        >
          <span className="text-sm font-medium text-gray-700">
            {t('approach.chat')} {messages.length > 0 && `(${messages.length})`}
          </span>
          <svg
            className={`w-5 h-5 text-gray-500 transition-transform ${chatOpen ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {chatOpen && (
          <div className="flex-1 flex flex-col bg-gray-50">
            <div className="flex-1 overflow-y-auto px-4 py-3 max-h-64">
              {messages.length === 0 ? (
                <p className="text-center text-sm text-gray-500 py-4">{t('chat.noMessages')}</p>
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

            <ChatInput onSend={(text) => sendMessage(text)} />
          </div>
        )}
      </div>

      {/* Driver honest-withdrawal action bar (R3-N-1). The deliberate
          surface here is what differentiates this from a silent no-show
          on the server side: tapping the button posts
          DRIVER_CAN_NOT_MAKE_IT, attributing to
          driverInitiatedCancellationCount instead of noShowCount. */}
      <div className="sticky bottom-0 bg-white border-t px-4 py-3 space-y-2">
        {/* FIELD-CLOSE G2 — thumb-reachable chat entry (icon + word)
            to the full-screen ChatPage at the existing route. */}
        {journeyId && (
          <ChatEntryButton journeyId={journeyId} messageCount={messages.length} />
        )}
        <Button
          fullWidth
          variant="danger"
          onClick={() => setCancelModalOpen(true)}
        >
          {t('approach.cantMakeTrip')}
        </Button>
      </div>

      <Modal
        isOpen={cancelModalOpen}
        onClose={() => setCancelModalOpen(false)}
        title={t('approach.cantMakeTripTitle')}
      >
        <p className="text-sm text-gray-600 mb-4">
          {t('approach.cantMakeTripConfirm')}
        </p>
        <div className="flex gap-3">
          <Button
            fullWidth
            variant="secondary"
            onClick={() => setCancelModalOpen(false)}
            disabled={isCancelling}
          >
            {t('common.no')}
          </Button>
          <Button
            fullWidth
            variant="danger"
            loading={isCancelling}
            onClick={handleDriverWithdraw}
          >
            {t('common.yes')}
          </Button>
        </div>
      </Modal>

      {/* RED-BUTTON G3 — the motari's own SOS, in the same floating
          position his passenger's carries (MatchedPage / InProgressPage).
          Available from the approach onward, because that is when he is
          already riding toward somebody he has not met. Same component,
          same 112-first sheet: the endpoint resolves "your contacts" by
          who is calling. */}
      {journeyId && <EmergencySOS journeyId={journeyId} />}
    </div>
  );
};

export default ApproachPage;
