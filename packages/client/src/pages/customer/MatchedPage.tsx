import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Spinner } from '../../components/ui/Spinner';
import { ChatBubble } from '../../components/chat/ChatBubble';
import { ChatInput } from '../../components/chat/ChatInput';
import { ChatEntryButton } from '../../components/chat/ChatEntryButton';
import { QuickMessages } from '../../components/chat/QuickMessages';
import { useSocket } from '../../hooks/useSocket';
import { useDriverLocationStream } from '../../hooks/useDriverLocationStream';
import { useAuthStore } from '../../stores/auth.store';
import { useJourneyStore } from '../../stores/journey.store';
import { useChatStore } from '../../stores/chat.store';
import { useUIStore } from '../../stores/ui.store';
import { DriverApproachMap } from '../../components/journey/DriverApproachMap';
import { EmergencySOS } from '../../components/safety/EmergencySOS';
import { ApproachStatusBadge } from '../../components/journey/ApproachStatusBadge';
import { PickupVerifyCard } from '../../components/journey/PickupVerifyCard';
import { getDriverRatingInfo } from '../../lib/driver-rating';
import { DriverRatingSummary } from '../../components/rating/DriverRatingSummary';
import {
  DRIVER_LATE_THRESHOLD_MINUTES,
  JourneyStatus,
  MATCHED_LATE_THRESHOLD_MS,
  MATCHED_NO_SHOW_THRESHOLD_MS,
  type CommissionBreakdown,
  type VehicleType,
} from '@bimoto/shared';
import { apiFetch, apiErrorFromResponse } from '../../lib/api';
import { presentApiError } from '../../lib/api-error-presenter';
import {
  hasFullCommissionBreakdown,
  hasCustomerSafeCommission,
  type WireCommissionBreakdown,
} from '../../lib/commission-view';

// LAUNCH-TRUTH follow-up — typed view of the journey payload this page
// reads. useJourneyStore still types activeJourney as `any` (retyping
// the store ripples to every consumer and is deliberately a separate
// change), so this page casts ONCE at that boundary and reads every
// field off the typed value — no inline `as any` below.
//
// Recursive because `driver` in the payload is the user row with the
// profile nested under driver.driverProfile, while the legacy fallback
// reads the same display fields off a bare driverProfile object.
interface MatchedDriverInfo {
  nickname?: string;
  avgRating?: number;
  vehicleDescription?: string;
  registrationPlate?: string;
  vehicleType?: VehicleType;
  verificationStatus?: string;
  ruraAuthorizationNumber?: string | null;
  driverProfile?: MatchedDriverInfo | null;
}

interface ActiveJourney {
  status?: JourneyStatus;
  cancelReason?: string | null;
  matchedAt?: string | null;
  startedAt?: string | null;
  agreedPrice?: number | null;
  vehiclePreference?: VehicleType | null;
  pickupLat: number;
  pickupLng: number;
  driver?: MatchedDriverInfo | null;
  driverProfile?: MatchedDriverInfo | null;
  // CLEAN-SWEEP G1 — the WIRE shape, not the server's full one: this is
  // a customer screen and the redacted four are the normal payload here.
  commissionBreakdown?: WireCommissionBreakdown;
}

// GAP-CLOSE G1 / CLEAN-SWEEP G1 — the transparency block below reads the
// DRIVER's side of the money: totalCommissionAmount, totalCommissionRate
// and driverPayout. EXPORT-AND-LEDGER G4 deliberately OMITS exactly those
// from the breakdown a customer receives (toCustomerSafeCommission, in
// services/journey.service.ts — payout is reconstructible from price minus
// amount, so none of them may reach the passenger). This is a customer
// page, so the partial shape is the NORMAL shape here.
//
// CLEAN-SWEEP G1 moved the predicate out to lib/commission-view.ts: three
// more screens dereference the same fields off the same interface, and one
// guard with four consumers is what makes the fourth field report
// structurally impossible. See that module for the three shapes.
//
// The block is no longer skipped WHOLE for a customer, though. Skipping it
// also hid customerSavings, customerTier and feeWaiverApplied — three of
// the four fields the server DELIBERATELY GIVES the passenger — so the
// savings line vanished from the one screen that showed it. Founder ruling
// (25 Aug): the redacted shape renders a CUSTOMER VARIANT built from those
// four fields and nothing else. No commission totals, no driver payout, no
// fabricated zeros: a zero would be a lie about what the motari is paid,
// and the fare the customer owes is already on the screen above.

export const MatchedPage: React.FC = () => {
  const { t } = useTranslation();
  const { id: journeyId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const currentUserId = user?.id;
  const { activeJourney, setActiveJourney } = useJourneyStore();
  // The one boundary cast (see ActiveJourney above).
  const journey = activeJourney as ActiveJourney | null;
  // GAP-CLOSE G1 — aliased so the type predicates below narrow it.
  const commissionBreakdown = journey?.commissionBreakdown;
  const { messages, setMessages, addMessage } = useChatStore();
  const { showToast } = useUIStore();

  // Real-time chat: socket pushes 'new-message' into the chat store.
  useSocket(journeyId);

  // Real-time driver-approach map (R3-E). Only streams while the
  // journey is MATCHED — stops at IN_PROGRESS once the driver has
  // picked up the customer.
  const journeyStatus = journey?.status ?? JourneyStatus.MATCHED;
  const journeyVehicleType: VehicleType | null =
    journey?.vehiclePreference ??
    journey?.driver?.driverProfile?.vehicleType ??
    null;
  const {
    driverLocation,
    etaMinutes,
    etaConfidence,
    isLive,
    approachStatus,
    distanceMeters,
  } = useDriverLocationStream(journeyId, journeyStatus);

  const [isLoading, setIsLoading] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isRedispatching, setIsRedispatching] = useState(false);

  // Fetch journey details
  useEffect(() => {
    const fetchJourney = async () => {
      setIsLoading(true);
      try {
        const res = await apiFetch(`/api/journeys/${journeyId}`, {
          credentials: 'include',
        });
        if (res.ok) {
          const data = await res.json();
          setActiveJourney(data);
          // CLEAN-SWEEP G5 — the `driverEtaMinutes` read is GONE.
          //
          // #194's ledger recorded it and GAP-CLOSE did not sweep it: the
          // field exists in no API payload, no Prisma model and no shared
          // type (grep at this head returns only this read and the
          // pilot-guard test that pins its removal from ApproachPage).
          // The same dead read was cut from ApproachPage by that guard;
          // this was its twin, one screen over.
          //
          // MONEY-VIEW v2 G4 — and the machinery it fed is gone too.
          // #206 proved `etaSeconds` was always null; this dispatch
          // removed the state, the countdown, `formatEta` and the strip's
          // numeric arm, so there is no longer a dead path beside the
          // live stream that looks like a second ETA.
        }

        // Fetch messages
        const msgRes = await apiFetch(`/api/journeys/${journeyId}/messages`, {
          credentials: 'include',
        });
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

    if (journeyId) fetchJourney();
  }, [journeyId, setActiveJourney, setMessages, showToast, t]);

  // MONEY-VIEW v2 G4 — THE DEAD ETA PATH IS GONE, WHOLE.
  //
  // `etaSeconds` was set by exactly one read, `data.driverEtaMinutes`, and
  // #206 removed that read because the field exists in no API payload, no
  // Prisma model and no shared type. What it left behind was the
  // machinery: a state cell that could only ever be null, a 1-second
  // countdown that could never start, a `formatEta` with no caller that
  // could fire, and a fallback strip whose numeric arm was unreachable.
  //
  // Removed rather than repaired, because the LIVE ETA already exists one
  // element away: `useDriverLocationStream` supplies `etaMinutes`,
  // `etaConfidence`, `isLive`, `approachStatus` and `distanceMeters`, and
  // DriverApproachMap has rendered them since R3-E. There was never a
  // second ETA to show — only a second place that looked like it showed
  // one.
  //
  // The strip keeps its remaining arm and gains nothing. It is the
  // `!driverLocation` FALLBACK: when it shows there are no positions, so
  // there can be no ETA, and a number there would be invented. Status
  // text is its honest content. The map covers every case where a
  // position exists, so nothing is duplicated.

  const lastReceivedQuickMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (m.senderId !== currentUserId && m.quickMessageId) return m.quickMessageId;
    }
    return undefined;
  }, [messages, currentUserId]);

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

  // R3-N-1 — cancel modal becomes a reason picker. CUSTOMER_CHANGED_MIND
  // remains the default, DRIVER_NO_SHOW unlocks at matchedAt + 8min when
  // the driver has not yet started the journey, SAFETY_CONCERN is always
  // available.
  type CustomerCancelReason =
    | 'CUSTOMER_CHANGED_MIND'
    | 'DRIVER_NO_SHOW'
    | 'DRIVER_LATE'
    | 'SAFETY_CONCERN';

  const handleCancel = useCallback(
    async (reason: CustomerCancelReason) => {
      setIsCancelling(true);
      try {
        const res = await apiFetch(`/api/journeys/${journeyId}/cancel`, {
          method: 'POST',
          credentials: 'include',
          body: JSON.stringify({ reason }),
        });
        if (!res.ok) throw await apiErrorFromResponse(res);
        showToast(t('matched.cancelled'), 'info');
        navigate('/', { replace: true });
      } catch (err) {
        presentApiError(err);
      } finally {
        setIsCancelling(false);
        setCancelModalOpen(false);
      }
    },
    [journeyId, showToast, navigate, t],
  );

  // R3-N-4 — re-discovery banner. After the no-show-timeout cron (or
  // the customer's own DRIVER_NO_SHOW cancel) flips the journey to
  // CANCELLED with cancelReason=DRIVER_NO_SHOW, the customer can spawn
  // a fresh REQUESTED journey reusing pickup/destination.
  const handleRedispatch = useCallback(async () => {
    setIsRedispatching(true);
    try {
      const res = await apiFetch(`/api/journeys/${journeyId}/redispatch`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw await apiErrorFromResponse(res);
      const fresh = await res.json();
      setActiveJourney(fresh);
      navigate(`/journey/${fresh.id}/bids`, { replace: true });
    } catch (err) {
      presentApiError(err);
    } finally {
      setIsRedispatching(false);
    }
  }, [journeyId, setActiveJourney, navigate, showToast, t]);

  const wasCancelledForNoShow =
    journey?.status === 'CANCELLED' &&
    journey?.cancelReason === 'DRIVER_NO_SHOW';

  // R3-N-1 / R3-N-3 — DRIVER_NO_SHOW unlocks at matchedAt + 8 min when
  // the driver has not yet tapped Start Journey AND the server-derived
  // approachStatus says the driver is silent or lost. R3-N-3 adds
  // DRIVER_LATE for the visibly-approaching-but-late case so the
  // customer can cancel without falsely accusing a moving driver of
  // not showing up. When approachStatus is null (server unreachable),
  // we fall back to the time-only gate so the customer is never
  // stranded by a degraded backend.
  const elapsedSinceMatched = (() => {
    const matchedAt = journey?.matchedAt;
    if (!matchedAt) return 0;
    return Date.now() - new Date(matchedAt).getTime();
  })();
  const journeyStarted = !!journey?.startedAt;
  const matchedAtPresent = !!journey?.matchedAt;
  const noShowAvailable =
    matchedAtPresent &&
    !journeyStarted &&
    elapsedSinceMatched >= MATCHED_NO_SHOW_THRESHOLD_MS &&
    (approachStatus === 'silent' ||
      approachStatus === 'lost' ||
      approachStatus === null);
  const lateAvailable =
    matchedAtPresent &&
    !journeyStarted &&
    elapsedSinceMatched >= MATCHED_LATE_THRESHOLD_MS &&
    approachStatus === 'approaching';

  // MONEY-VIEW v2 G4 — the escape hatch, made real and made precise.
  //
  // It was `Date.now() - matchedTime > threshold && etaSeconds === 0`,
  // and BOTH halves were broken:
  //
  //   THE CLOCK measured time since the SCREEN OPENED (`matchedTime` was
  //   `useState(() => Date.now())`), so it reset on every reload — a
  //   passenger waiting 40 minutes who reopened the app was 0 minutes
  //   late again. It now anchors to `journey.matchedAt`, the column set
  //   in the same transaction as the REQUESTED->MATCHED transition
  //   (R3-N-1), which the cancel flow beside it has always used and which
  //   `elapsedSinceMatched` above already computes.
  //
  //   THE GATE required `etaSeconds === 0`, and #206 proved `etaSeconds`
  //   is always NULL. `null === 0` is false, so the whole condition was
  //   permanently false and this control could not appear at all. The
  //   "choose another driver" offer has been unreachable, on the screen
  //   where a stranded passenger needs it.
  //
  // WHAT REPLACES IT: late, AND the stream cannot vouch for him.
  //
  //   silent   no recent GPS — nobody can say where he is.
  //   lost     recent GPS, far from pickup, NOT closing.
  //   null     no status at all (server unreachable) — the same
  //            never-strand-the-customer fallback `noShowAvailable`
  //            above makes, for the same reason.
  //
  // And never on `approaching` or `arrived`. An ARRIVED driver is within
  // ARRIVED_RADIUS_M of the pickup: offering to replace him then is the
  // hole a naive time-only gate would leave open, and it is pinned. An
  // APPROACHING driver is demonstrably closing; if his GPS stops or he
  // stops closing, the server flips him to silent or lost and the button
  // appears on the next status frame, which is the right moment rather
  // than a guessed one.
  //
  // `etaMinutes` plays NO part in the gate. It is display-only: a stale
  // or optimistic number must not be able to keep a stranded passenger
  // from her way out, nor conjure the offer for a driver who is at the
  // kerb.
  const driverIsLateAndUnvouchedFor =
    matchedAtPresent &&
    elapsedSinceMatched > DRIVER_LATE_THRESHOLD_MINUTES * 60 * 1000 &&
    (approachStatus === 'silent' ||
      approachStatus === 'lost' ||
      approachStatus === null);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  const driver = journey?.driver || journey?.driverProfile;
  // DRIVER-ID v3 G5 — the journey payload nests profile fields under
  // driver.driverProfile; the jacket number renders only for a VERIFIED
  // profile (an unverified number must never look official).
  const driverProfile = journey?.driver?.driverProfile;
  const jacketNumber =
    driverProfile?.verificationStatus === 'VERIFIED'
      ? driverProfile?.ruraAuthorizationNumber
      : null;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* R3-N-4 — driver no-show banner. Shown only when this journey
          is CANCELLED with cancelReason=DRIVER_NO_SHOW (typically the
          system-derived 30-min auto-cancel). Spawns a fresh REQUESTED
          journey reusing pickup/destination via POST /redispatch. */}
      {wasCancelledForNoShow && (
        <div
          className="bg-red-50 border-b border-red-200 p-4"
          data-testid="no-show-banner"
        >
          <p className="text-secondary font-medium text-red-900">
            {t('matched.driverDidntShow')}
          </p>
          <Button
            fullWidth
            variant="primary"
            className="mt-3"
            onClick={handleRedispatch}
            loading={isRedispatching}
          >
            {t('matched.findAnotherDriver')}
          </Button>
        </div>
      )}
      {/* PILOT-INSTRUMENT — pickup-identity prompt. Appears only when
          the server-derived approachStatus hits 'arrived'; optional,
          dismissible, and never gates the ride. The answer feeds the
          V-4 (dynamic QR/PIN) evidence trigger. */}
      {journeyId && (
        <PickupVerifyCard
          journeyId={journeyId}
          approachStatus={approachStatus}
          jacketNumber={jacketNumber ?? null}
        />
      )}
      {/* Driver Card */}
      <div className="bg-white shadow-sm p-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-[#1B4F72]/10 flex items-center justify-center">
            <span className="text-title font-bold text-[#1B4F72]">
              {(driver?.nickname || '?')[0].toUpperCase()}
            </span>
          </div>
          <div className="flex-1">
            <p className="font-semibold text-gray-900 text-heading">
              {driver?.nickname || t('matched.driver')}
            </p>
            {/* RATE-DISPLAY G2 — same reputation strip as the bid cards.
                The journey payload nests the profile (avgRating is a
                Decimal-serialized string there); the shared accessor
                normalizes both that and the legacy flat fallback. */}
            <DriverRatingSummary info={getDriverRatingInfo(driver ?? null)} />
            {jacketNumber && (
              <p
                data-testid="jacket-number"
                className="text-secondary font-semibold text-[#1B4F72] mt-0.5"
              >
                {t('driver.jacketNumber', { number: jacketNumber })}
              </p>
            )}
            {driver?.vehicleDescription && (
              <p className="text-caption text-gray-500 mt-0.5">{driver.vehicleDescription}</p>
            )}
            {driver?.registrationPlate && (
              <p className="text-caption font-mono text-gray-600 mt-0.5">{driver.registrationPlate}</p>
            )}
          </div>
          <div className="text-right">
            <p className="text-heading font-bold text-[#1B4F72]">
              {journey?.agreedPrice?.toLocaleString()} <span className="text-caption font-normal">RWF</span>
            </p>
          </div>
        </div>
        {/* Commission breakdown (C4) */}
        {hasFullCommissionBreakdown(commissionBreakdown) && (
          <div className="mt-3 pt-3 border-t border-gray-100 space-y-1" data-testid="matched-transparency">
            <p className="text-caption text-gray-500">
              {commissionBreakdown.feeWaiverApplied
                ? t('transparency.feeWaivedLine', {
                    amount: commissionBreakdown.totalCommissionAmount.toLocaleString(),
                  })
                : t('transparency.platformFeeAmount', {
                    amount: commissionBreakdown.totalCommissionAmount.toLocaleString(),
                    rate: (commissionBreakdown.totalCommissionRate * 100).toFixed(1),
                  })}
            </p>
            <p className="text-caption text-gray-500">
              {t('transparency.driverReceives', { amount: commissionBreakdown.driverPayout.toLocaleString() })}
            </p>
            {commissionBreakdown.customerSavings > 0 && (
              <p className="text-caption text-green-700">
                {t('transparency.tierSavings', {
                  tier: commissionBreakdown.customerTier,
                  amount: commissionBreakdown.customerSavings,
                })}
              </p>
            )}
          </div>
        )}
        {/* CLEAN-SWEEP G1 — the CUSTOMER VARIANT.
            Reached when the breakdown is not the full shape but carries
            the customer-safe four. Renders those four and nothing else:
            no commission total, no rate, no driver payout, and no zeros
            standing in for them. The waiver line names no amount for the
            same reason — `feeWaivedLine` quotes totalCommissionAmount,
            which is exactly the field the passenger may not have. */}
        {!hasFullCommissionBreakdown(commissionBreakdown) &&
          hasCustomerSafeCommission(commissionBreakdown) && (
            <div
              className="mt-3 pt-3 border-t border-gray-100 space-y-1"
              data-testid="matched-transparency-customer"
            >
              <p className="text-caption text-gray-500">
                {t('transparency.customerTierLine', {
                  tier: commissionBreakdown.customerTier,
                })}
              </p>
              {commissionBreakdown.customerSavings > 0 && (
                <p className="text-caption text-green-700">
                  {t('transparency.tierSavings', {
                    tier: commissionBreakdown.customerTier,
                    amount: commissionBreakdown.customerSavings,
                  })}
                </p>
              )}
              {commissionBreakdown.feeWaiverApplied && (
                <p className="text-caption text-green-700" data-testid="matched-fee-waived">
                  {t('transparency.customerFeeWaived')}
                </p>
              )}
            </div>
          )}
      </div>

      {/* Live driver-approach map (R3-E). The ETA pill on the map is
          authoritative; the legacy fixed countdown below is shown only
          when no live location has arrived yet. */}
      {journey && (
        <div className="bg-white px-2 py-2">
          {/* FIELD-CLOSE G2 — name the feature. The live map has shown
              the driver moving since R3-E, but nothing labelled it, so
              the field team asked for a "track driver feature" that was
              already on screen. */}
          <h2
            className="px-2 pb-1 text-caption font-semibold uppercase tracking-wide text-gray-500"
            data-testid="tracking-heading"
          >
            {t('matched.liveTracking')}
          </h2>
          <DriverApproachMap
            customerLocation={{
              lat: journey.pickupLat,
              lng: journey.pickupLng,
            }}
            driverLocation={driverLocation ? { lat: driverLocation.lat, lng: driverLocation.lng } : null}
            etaMinutes={etaMinutes}
            etaConfidence={etaConfidence}
            isLive={isLive}
            driverAsOf={driverLocation?.asOf ?? null}
            driverName={driver?.nickname}
          />
          <div className="mt-2">
            <ApproachStatusBadge
              status={approachStatus}
              distanceMeters={distanceMeters}
              etaMinutes={etaMinutes}
              isLive={isLive}
            />
          </div>
        </div>
      )}

      {/* Fallback strip — shown only when we have NO live location.
          MONEY-VIEW v2 G4: its numeric arm is gone with the dead ETA path.
          When this strip shows there are no positions, so there can be no
          ETA and any number here would be invented; the live one renders
          on the map above whenever a position exists. Status text is the
          honest content, and it is what this strip has actually rendered
          since #206 — `etaSeconds` was provably always null. */}
      {!driverLocation && (
        <div className="bg-white px-4 py-3 text-center border-b">
          <p className="text-secondary text-gray-600">{t('matched.driverOnTheWay')}</p>
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

      {/* Chat Panel (collapsible) */}
      <div className="flex-1 flex flex-col">
        <button
          onClick={() => setChatOpen(!chatOpen)}
          className="w-full px-4 py-3 bg-white border-b flex items-center justify-between min-h-[44px]"
        >
          <span className="text-secondary font-medium text-gray-700">
            {t('matched.chat')} {messages.length > 0 && `(${messages.length})`}
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
            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-3 max-h-64">
              {messages.length === 0 ? (
                <p className="text-center text-secondary text-gray-500 py-4">{t('chat.noMessages')}</p>
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
            <ChatInput onSend={(text) => sendMessage(text)} />
          </div>
        )}
      </div>

      {/* Bottom Actions */}
      <div className="sticky bottom-0 bg-white border-t px-4 py-3 space-y-2">
        {/* FIELD-CLOSE G2 — thumb-reachable chat entry (icon + word)
            to the full-screen ChatPage at the existing route. */}
        {journeyId && (
          <ChatEntryButton journeyId={journeyId} messageCount={messages.length} />
        )}
        {driverIsLateAndUnvouchedFor && (
          <Button
            fullWidth
            variant="secondary"
            onClick={() => navigate(`/journey/${journeyId}/bids`)}
          >
            {t('matched.chooseAnother')}
          </Button>
        )}
        <Button
          fullWidth
          variant="danger"
          onClick={() => setCancelModalOpen(true)}
        >
          {t('matched.cancelRide')}
        </Button>
      </div>

      {/* Cancel Reason Picker (R3-N-1) — replaces the legacy binary
          Yes/No confirmation. Buttons are gated by current journey
          state so the user never sees a reason the server would
          reject. */}
      <Modal
        isOpen={cancelModalOpen}
        onClose={() => setCancelModalOpen(false)}
        title={t('matched.cancelTitle')}
      >
        <div className="space-y-2">
          <p className="text-secondary text-gray-600 mb-3">
            {t('matched.cancelReasonPrompt')}
          </p>
          <Button
            fullWidth
            variant="secondary"
            onClick={() => handleCancel('CUSTOMER_CHANGED_MIND')}
            loading={isCancelling}
          >
            {t('matched.cancelChangedPlans')}
          </Button>
          {noShowAvailable && (
            <Button
              fullWidth
              variant="danger"
              onClick={() => handleCancel('DRIVER_NO_SHOW')}
              loading={isCancelling}
            >
              {t('matched.cancelDriverNoShow')}
            </Button>
          )}
          {lateAvailable && (
            <Button
              fullWidth
              variant="secondary"
              onClick={() => handleCancel('DRIVER_LATE')}
              loading={isCancelling}
            >
              {t('matched.cancelDriverLate')}
            </Button>
          )}
          <Button
            fullWidth
            variant="danger"
            onClick={() => handleCancel('SAFETY_CONCERN')}
            loading={isCancelling}
          >
            {t('matched.cancelSafety')}
          </Button>
          <Button
            fullWidth
            variant="ghost"
            onClick={() => setCancelModalOpen(false)}
            disabled={isCancelling}
          >
            {t('common.dismiss')}
          </Button>
        </div>
      </Modal>

      {/* SOS-WIRE G2 — SOS is available from match onward, not only once
          the ride is IN_PROGRESS (the customer is already meeting the
          driver). RED-BUTTON G3 gave the motari the same button on his
          own screens; the endpoint now gates on participation, and
          resolves whose contacts to call from who is calling. */}
      {journeyId && <EmergencySOS journeyId={journeyId} />}
    </div>
  );
};

export default MatchedPage;
