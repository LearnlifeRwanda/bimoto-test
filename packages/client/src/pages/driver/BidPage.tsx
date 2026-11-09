import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { PlaceDescription } from '../../components/journey/PlaceDescription';
import { ChildTravelNotice } from '../../components/journey/ChildTravelNotice';
import { DeliverySpeedTag } from '../../components/journey/DeliverySpeedTag';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { Spinner } from '../../components/ui/Spinner';
import { ValuePulse } from '../../components/ui/ValuePulse';
import { UrgentBadge } from '../../components/journey/UrgentBadge';
import { ChildPassengerBadge } from '../../components/journey/ChildPassengerBadge';
import { ChildAcknowledgmentModal } from '../../components/journey/ChildAcknowledgmentModal';
import { JourneyLegsDisplay } from '../../components/journey/JourneyLegsDisplay';
import { ParcelSummary } from '../../components/journey/ParcelSummary';
import { useAuthStore } from '../../stores/auth.store';
import { useJourneyStore } from '../../stores/journey.store';
import { useUIStore } from '../../stores/ui.store';
import { useSimulationStore } from '../../stores/simulation.store';
import { useSocket } from '../../hooks/useSocket';
import { getDriverTier, getVehicleCompliance, CUSTOMER_TIERS } from '@bimoto/shared';
import { apiFetch, apiErrorFromResponse } from '../../lib/api';
import { presentApiError } from '../../lib/api-error-presenter';

export const BidPage: React.FC = () => {
  const { t } = useTranslation();
  const { id: journeyId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { activeJourney, setActiveJourney } = useJourneyStore();
  const { showToast } = useUIStore();

  // SOCKET-FIX G3 — live wish-price updates arrive over the socket into
  // the journey store (useSocket's journey:wish-price-updated handler).
  // journey:wish-price-updated is emitted to the journey:<id> room, which
  // only journey parties may join, so today the live path works for a
  // matched driver revisiting this page; an unmatched bidder's join is
  // refused server-side (harmless) and still sees the price on fetch.
  // Re-broadcasting wish-price raises to ring drivers is a server-side
  // gap noted in the SOCKET-FIX report, out of scope for this wave.
  useSocket(journeyId);

  const [isLoading, setIsLoading] = useState(true);
  const [bidPrice, setBidPrice] = useState('');
  const [etaMinutes, setEtaMinutes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [bidSent, setBidSent] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  // R3-CHILD — driver must acknowledge child-passenger safety
  // expectations before the bid is submitted on a child journey.
  const [showChildAckModal, setShowChildAckModal] = useState(false);

  // COUNTER-READY G3 — the motari's side of the counter.
  //
  // False unless THIS server said otherwise at app start, so on a
  // dormant server nothing below is fetched and nothing is rendered.
  const counterBidEnabled = useSimulationStore((s) => s.counterBidEnabled);
  // His OWN bid on this journey, when it carries an unanswered counter.
  // Null in every other case, which is the common one.
  const [myCounteredBid, setMyCounteredBid] = useState<{
    id: string;
    price: number;
    counterAmountRwf: number;
  } | null>(null);
  const [respondingCounter, setRespondingCounter] = useState(false);

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
          // Pre-fill with wish price if available
          if (data.wishPrice) {
            setBidPrice(data.wishPrice.toString());
          }
        }
      } catch (err) {
        presentApiError(err);
      } finally {
        setIsLoading(false);
      }
    };

    if (journeyId) fetchJourney();
  }, [journeyId, setActiveJourney, showToast, t]);

  // Hoisted above the counter block below, which needs the signed-in
  // driver's id to find HIS bid in the journey's list.
  const { user } = useAuthStore();

  // COUNTER-READY G3 — does this journey carry an unanswered counter on
  // MY bid?
  //
  // GATED ON THE FLAG, so a dormant server is never even asked: the
  // effect returns before the fetch and `myCounteredBid` stays null, so
  // the whole surface below is unreachable. When the flag is on, the bid
  // list is the same one the passenger's screen reads; the server
  // attaches the counter columns only to the bid's own driver (and to
  // her), so a rival's counter is not in this response to be found.
  const loadMyCounter = useCallback(async () => {
    if (!counterBidEnabled || !journeyId || !user?.id) {
      setMyCounteredBid(null);
      return;
    }
    try {
      const res = await apiFetch(`/api/journeys/${journeyId}/bids`, {
        credentials: 'include',
      });
      if (!res.ok) return;
      const bids = await res.json();
      const mine = (bids as any[]).find(
        (b) =>
          b.driverId === user.id &&
          b.status === 'PENDING' &&
          b.counterAmountRwf != null &&
          b.counterOutcome == null,
      );
      setMyCounteredBid(
        mine
          ? {
              id: mine.id,
              price: mine.price,
              counterAmountRwf: mine.counterAmountRwf,
            }
          : null,
      );
    } catch {
      // Silent: a counter he cannot see is a counter he answers later.
      // The passenger's offer is unaffected either way.
    }
  }, [counterBidEnabled, journeyId, user?.id]);

  useEffect(() => {
    void loadMyCounter();
  }, [loadMyCounter, bidSent]);

  // COUNTER-READY G3 — accept or decline, on the one door that exists.
  //
  // ACCEPT goes through the server's two-step (predicated price-flip,
  // then the ordinary acceptBid), so by the time this resolves the
  // journey is MATCHED at the agreed number through the same escrow and
  // the same charge every accept takes. DECLINE leaves his own offer
  // PENDING at the price he first named — she can still take it — so the
  // screen goes back to what it was rather than closing.
  const handleRespondToCounter = useCallback(
    async (action: 'accept' | 'decline') => {
      if (!myCounteredBid || respondingCounter) return;
      setRespondingCounter(true);
      try {
        const res = await apiFetch(
          `/api/journeys/${journeyId}/bids/${myCounteredBid.id}/counter/respond`,
          {
            method: 'POST',
            credentials: 'include',
            body: JSON.stringify({ action }),
          },
        );
        if (!res.ok) throw await apiErrorFromResponse(res);
        setMyCounteredBid(null);
        showToast(
          t(action === 'accept' ? 'bid.counterAccepted' : 'bid.counterDeclined'),
          action === 'accept' ? 'success' : 'info',
        );
      } catch (err) {
        presentApiError(err);
        // Re-read rather than guess: the counter may have lapsed, or the
        // passenger may have matched with somebody else.
        void loadMyCounter();
      } finally {
        setRespondingCounter(false);
      }
    },
    [myCounteredBid, respondingCounter, journeyId, showToast, t, loadMyCounter],
  );

  const driverTotalRides = user?.driverProfile?.totalRides ?? 0;

  // Live payout calculator.
  //
  // LIVE-WIRE G4 — a number, not a band, whenever the server can give
  // one. The team's item 18 was exactly this: "you are bidding 1,200;
  // you will receive 1,100", not "you will receive between 1,100 and
  // 1,150".
  //
  // The range was never imprecision for its own sake — the total
  // commission is the driver's tier rate PLUS the CUSTOMER's tier rate,
  // and this screen only ever knew the first. So it spanned the whole
  // customer ladder, VIP to Regular. The journey payload now carries
  // `payoutContext` for a driver viewer (journey.service.getJourneyById),
  // which is the missing half; with it the answer collapses to one
  // number and `minPayout === maxPayout` makes every render site below
  // switch to the exact copy it already had.
  //
  // Without it — an older server, a journey fetched before the
  // context existed — this falls back to the honest band rather than
  // inventing a precision it does not have.
  const payoutContext = (activeJourney as {
    payoutContext?: {
      driverCommissionRate: number;
      customerCommissionRate: number;
      totalCommissionRate: number;
      driverTier: string;
      feeWaiverApplied: boolean;
    };
  } | null)?.payoutContext;

  const payoutRange = useMemo(() => {
    const price = parseInt(bidPrice, 10);
    if (!price || price <= 0) return null;

    const driverTier = getDriverTier(driverTotalRides);

    if (payoutContext) {
      // A pilot fee waiver means the motari keeps the whole fare.
      const exact = payoutContext.feeWaiverApplied
        ? price
        : price - Math.round(price * payoutContext.totalCommissionRate);
      return {
        driverTier,
        isExact: true as const,
        minPayout: exact,
        maxPayout: exact,
        minTotalRate: payoutContext.feeWaiverApplied ? 0 : payoutContext.totalCommissionRate,
        maxTotalRate: payoutContext.feeWaiverApplied ? 0 : payoutContext.totalCommissionRate,
        maxCustomerRate: payoutContext.customerCommissionRate,
        feeWaiverApplied: payoutContext.feeWaiverApplied,
      };
    }

    const sortedCustomerTiers = [...CUSTOMER_TIERS].sort((a, b) => a.commissionRate - b.commissionRate);
    const minCustomerRate = sortedCustomerTiers[0].commissionRate; // VIP: 1.5%
    const maxCustomerRate = sortedCustomerTiers[sortedCustomerTiers.length - 1].commissionRate; // Regular: 3.0%

    const minTotalRate = driverTier.commissionRate + minCustomerRate;
    const maxTotalRate = driverTier.commissionRate + maxCustomerRate;

    const minPayout = price - Math.round(price * maxTotalRate); // Worst case for driver
    const maxPayout = price - Math.round(price * minTotalRate); // Best case for driver

    return {
      driverTier,
      isExact: false as const,
      minPayout,
      maxPayout,
      minTotalRate,
      maxTotalRate,
      maxCustomerRate,
      feeWaiverApplied: false,
    };
  }, [bidPrice, driverTotalRides, payoutContext]);

  const handleShowConfirmation = () => {
    if (!bidPrice || parseInt(bidPrice, 10) <= 0) {
      showToast(t('bid.priceRequired'), 'error');
      return;
    }
    if (!etaMinutes || parseInt(etaMinutes, 10) <= 0) {
      showToast(t('bid.etaRequired'), 'error');
      return;
    }
    // R3-CHILD — interpose the acknowledgment modal before the price
    // confirmation modal when the journey carries a child passenger.
    if ((activeJourney as any)?.hasChildPassenger) {
      setShowChildAckModal(true);
      return;
    }
    setShowConfirmModal(true);
  };

  const handleChildAckConfirm = () => {
    setShowChildAckModal(false);
    setShowConfirmModal(true);
  };

  const handleChildAckCancel = () => {
    setShowChildAckModal(false);
  };

  // R3-DELIVERY — driver taps "Complete this stop" on an intermediate
  // leg. Hits the R3-LEGS endpoint; on success, mutates the leg's
  // status optimistically so the row turns green without a refetch.
  // NET-UX G3 — one leg action at a time; double-taps are no-ops.
  const [pendingLegId, setPendingLegId] = useState<string | null>(null);

  const handleCompleteStop = async (legId: string) => {
    if (!journeyId || pendingLegId) return;
    setPendingLegId(legId);
    try {
      const res = await apiFetch(
        `/api/journeys/${journeyId}/legs/${legId}/complete`,
        {
          method: 'POST',
          credentials: 'include',
        },
      );
      if (!res.ok) throw await apiErrorFromResponse(res);
      const current = activeJourney as any;
      const updatedLegs = (current?.legs ?? []).map((l: any) =>
        l.id === legId
          ? { ...l, status: 'COMPLETED', completedAt: new Date().toISOString() }
          : l,
      );
      setActiveJourney({ ...current, legs: updatedLegs });
    } catch (err) {
      presentApiError(err);
    } finally {
      setPendingLegId(null);
    }
  };

  // R3-DELIVERY-NOTIFICATIONS-2 — driver taps "I'm at pickup" on a
  // PENDING GOODS_PICKUP leg. Hits the activate endpoint, which fires
  // the customer-arrived SMS server-side.
  const handleActivateStop = async (legId: string) => {
    if (!journeyId || pendingLegId) return;
    setPendingLegId(legId);
    try {
      const res = await apiFetch(
        `/api/journeys/${journeyId}/legs/${legId}/activate`,
        {
          method: 'POST',
          credentials: 'include',
        },
      );
      if (!res.ok) throw await apiErrorFromResponse(res);
      const current = activeJourney as any;
      const updatedLegs = (current?.legs ?? []).map((l: any) =>
        l.id === legId ? { ...l, status: 'ACTIVE' } : l,
      );
      setActiveJourney({ ...current, legs: updatedLegs });
    } catch (err) {
      presentApiError(err);
    } finally {
      setPendingLegId(null);
    }
  };

  const handleSubmitBid = async () => {
    setShowConfirmModal(false);
    setIsSubmitting(true);
    try {
      const res = await apiFetch(`/api/journeys/${journeyId}/bids`, {
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          price: parseInt(bidPrice, 10),
          etaMinutes: parseInt(etaMinutes, 10),
        }),
      });

      if (!res.ok) throw await apiErrorFromResponse(res);

      setBidSent(true);
      showToast(t('bid.submitted'), 'success');
    } catch (err) {
      presentApiError(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-6">
      <div className="w-full max-w-sm mx-auto">
        {/* Back button */}
        <button
          onClick={() => navigate(-1)}
          className="min-h-[44px] min-w-[44px] flex items-center gap-1 text-[#1B4F72] text-sm font-medium mb-4"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          {t('common.back')}
        </button>

        {/* COUNTER-READY G3 — the counter, on the motari's own bid.
            ABOVE the journey details on purpose: it is the one thing on
            this screen that is waiting on him, and a decision buried
            under a route summary is a decision missed. Rendered only
            when the flag is on AND his own bid actually carries an
            unanswered counter — on a dormant server `myCounteredBid` can
            never be set, so this block does not exist. */}
        {counterBidEnabled && myCounteredBid && (
          <div
            className="bg-white rounded-xl shadow-sm p-4 mb-6 border-l-4 border-[#1B4F72]"
            data-testid="driver-counter-card"
          >
            <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-2">
              {t('bid.counterTitle')}
            </h2>
            <p className="text-secondary text-gray-600 mb-1">
              {t('bid.counterYourPrice', {
                price: myCounteredBid.price.toLocaleString(),
              })}
            </p>
            <p className="text-heading font-bold text-[#1B4F72] mb-3">
              {t('bid.counterTheirPrice', {
                amount: myCounteredBid.counterAmountRwf.toLocaleString(),
              })}
            </p>
            {/* Declining does NOT close his offer — it stays live at his
                own price and she can still take it. Said here so the
                button does not read as "give up the ride". */}
            <p className="text-caption text-gray-500 mb-3">
              {t('bid.counterDeclineNote', {
                price: myCounteredBid.price.toLocaleString(),
              })}
            </p>
            <div className="flex gap-2">
              <Button
                fullWidth
                size="sm"
                variant="success"
                loading={respondingCounter}
                disabled={respondingCounter}
                data-testid="counter-accept"
                onClick={() => handleRespondToCounter('accept')}
              >
                {t('bid.counterAcceptButton')}
              </Button>
              <Button
                fullWidth
                size="sm"
                variant="secondary"
                disabled={respondingCounter}
                data-testid="counter-decline"
                onClick={() => handleRespondToCounter('decline')}
              >
                {t('bid.counterDeclineButton')}
              </Button>
            </div>
          </div>
        )}

        {/* Journey Details */}
        {activeJourney && (
          <div className="bg-white rounded-xl shadow-sm p-4 mb-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide">
                {t('bid.journeyDetails')}
              </h2>
              {/* R3-T — URGENT badge in the journey details header so
                  drivers spot urgent jobs while reviewing the bid. */}
              <div className="flex gap-2">
                <UrgentBadge
                  journeyType={(activeJourney as any).type}
                  matchedAt={
                    (activeJourney as any).matchedAt ??
                    (activeJourney as any).createdAt
                  }
                />
                <ChildPassengerBadge
                  hasChildPassenger={(activeJourney as any).hasChildPassenger}
                />
              </div>
            </div>

            {/* Route */}
            <div className="space-y-2 mb-3">
              <div className="flex items-center gap-2 text-sm text-gray-700">
                <svg className="w-3 h-3 text-green-700 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <circle cx="10" cy="10" r="5" />
                </svg>
                <span>{activeJourney.pickupName}</span>
              </div>
              <PlaceDescription
                target="pickup"
                text={(activeJourney as { pickupDescription?: string }).pickupDescription}
                className="ml-5"
              />
              <div className="flex items-center gap-2 text-sm text-gray-700">
                <svg className="w-3 h-3 text-red-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <circle cx="10" cy="10" r="5" />
                </svg>
                <span>{activeJourney.destinationName}</span>
              </div>
              <PlaceDescription
                target="destination"
                text={(activeJourney as { destinationDescription?: string }).destinationDescription}
                className="ml-5"
              />
              {/* TEAM-SAID G1 — the passenger's advisory, on the screen
                  where the motari decides whether to come. */}
              <ChildTravelNotice
                travellingWithChild={
                  (activeJourney as { travellingWithChild?: boolean }).travellingWithChild
                }
              />
            </div>

            {/* Info chips */}
            <div className="flex flex-wrap gap-2 text-xs">
              {/* TEAM-SAID G3 — the delivery tier, so the motari knows
                  what he is bidding on. The tag is all express is:
                  he prices the urgency into his own bid. */}
              <DeliverySpeedTag
                deliverySpeed={(activeJourney as { deliverySpeed?: string }).deliverySpeed}
                standardDeliveryHours={
                  (activeJourney as { standardDeliveryHours?: number | null })
                    .standardDeliveryHours
                }
              />
              {/* PARCEL-VISIBLE G4 — the SAME two dead chips as the feed
                  card carried: `distance` and `vehicleType` are not fields
                  on Journey, and never were. Fixed here too because the two
                  screens are one defect, and a bid page that shows no
                  distance while the card it was opened from does is worse
                  than either alone. `estimatedDistance` is already in km. */}
              {typeof activeJourney.estimatedDistance === 'number' && (
                <span
                  data-testid="bid-distance"
                  className="bg-gray-100 text-gray-600 px-2 py-1 rounded"
                >
                  {activeJourney.estimatedDistance.toFixed(1)} km
                </span>
              )}
              <span
                data-testid="bid-vehicle"
                className="bg-gray-100 text-gray-600 px-2 py-1 rounded"
              >
                {/* PILOT-UX G4 — vehicleTypes.* never existed in any
                    locale; label via the shared compliance matrix. */}
                {activeJourney.vehiclePreference
                  ? t(getVehicleCompliance(activeJourney.vehiclePreference).nameKey)
                  : t('journey.any_vehicle')}
              </span>
              {activeJourney.wishPrice && (
                <ValuePulse
                  value={activeJourney.wishPrice}
                  className="bg-[#1B4F72]/10 text-[#1B4F72] px-2 py-1 rounded font-medium"
                >
                  {t('bid.wishPrice', { price: activeJourney.wishPrice.toLocaleString() })}
                </ValuePulse>
              )}
            </div>

            {/* PARCEL-CATEGORY — what the parcel IS, on the screen where
                he accepts it.

                DEVIATION, NAMED. The dispatch expected a parcel block
                here to add the category badge to. There was none: an
                ordinary GoodsRequestPage booking is LEG-LESS, so the
                JourneyLegsDisplay below renders nothing for it and this
                screen showed a bidding motari no size, no weight, no
                fragile warning and no description — on the one screen
                where he commits to carrying the thing. The feed card he
                opened it from showed all four (PARCEL-VISIBLE G4).

                Every field has been on the wire the whole time: the
                #191 raw-body E2E pins that goodsSizeCategory,
                goodsWeightKg, goodsDescription and goodsFragile all
                REMAIN in the pre-match body this page fetches. Nothing
                new is collected or transmitted to render this, and the
                component is the same one the feed card uses, so the two
                screens cannot say different things about one parcel.

                It renders itself away entirely when there is nothing to
                say, which is every passenger journey. */}
            <ParcelSummary
              sizeCategory={(activeJourney as any).goodsSizeCategory}
              weightKg={(activeJourney as any).goodsWeightKg}
              fragile={(activeJourney as any).goodsFragile}
              description={(activeJourney as any).goodsDescription}
              category={(activeJourney as any).parcelCategory}
            />

            {/* Customer info */}
            {activeJourney.customer && (
              <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center">
                  <span className="text-xs font-bold text-gray-500">
                    {(activeJourney.customer.nickname || '?')[0].toUpperCase()}
                  </span>
                </div>
                <span className="text-sm text-gray-700">{activeJourney.customer.nickname}</span>
              </div>
            )}

            {/* R3-DELIVERY — multi-stop preview / driver-active stop list.
                Stops display read-only at bid time; "Complete this stop"
                buttons activate once the journey is IN_PROGRESS. */}
            {(activeJourney as any).legs && (activeJourney as any).legs.length > 0 && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                <JourneyLegsDisplay
                  legs={(activeJourney as any).legs}
                  mode={
                    (activeJourney as any).status === 'IN_PROGRESS'
                      ? 'driver-active'
                      : 'preview'
                  }
                  onCompleteStop={handleCompleteStop}
                  onActivateStop={handleActivateStop}
                  pendingLegId={pendingLegId}
                />
              </div>
            )}
          </div>
        )}

        {/* Bid Form or Status */}
        {bidSent ? (
          <div className="bg-white rounded-xl shadow-sm p-6 text-center">
            <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-[#27AE60]/10 flex items-center justify-center">
              <svg className="w-6 h-6 text-[#27AE60]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-gray-900 mb-1">
              {t('bid.offerSent')}
            </h2>
            <p className="text-sm text-gray-500 mb-1">
              {t('bid.waitingForCustomer')}
            </p>
            <p className="text-lg font-bold text-[#1B4F72] mt-3">
              {parseInt(bidPrice, 10).toLocaleString()} RWF
            </p>
            {payoutRange && (
              <p className="text-sm text-gray-600 mt-1">
                {payoutRange.minPayout === payoutRange.maxPayout
                  ? t('transparency.youWillReceiveExact', { amount: payoutRange.minPayout.toLocaleString() })
                  : t('transparency.youWillReceiveRange', { min: payoutRange.minPayout.toLocaleString(), max: payoutRange.maxPayout.toLocaleString() })
                }
              </p>
            )}
            <p className="text-xs text-gray-500">
              {t('bid.etaLabel', { min: etaMinutes })}
            </p>
            <Button
              fullWidth
              variant="secondary"
              className="mt-6"
              onClick={() => navigate(-1)}
            >
              {t('bid.backToDashboard')}
            </Button>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm p-4 space-y-5">
            <h2 className="text-base font-semibold text-gray-900">
              {t('bid.makeOffer')}
            </h2>

            <Input
              label={t('bid.yourPrice')}
              type="number"
              value={bidPrice}
              onChange={(e) => setBidPrice(e.target.value)}
              placeholder={t('bid.pricePlaceholder')}
              suffix="RWF"
            />

            {/* Live Payout Calculator (D2) */}
            {payoutRange && (
              <div className="bg-[#1B4F72]/5 rounded-lg p-3 space-y-1.5">
                <p className="text-xs font-semibold text-[#1B4F72] uppercase tracking-wide">
                  {t('transparency.whatYoullReceive')}
                </p>
                <p className="text-xs text-gray-600">
                  {t('transparency.yourTier', { tier: payoutRange.driverTier.tier, rate: (payoutRange.driverTier.commissionRate * 100).toFixed(1) })}
                </p>
                {payoutRange.isExact ? (
                  <p className="text-xs text-gray-600">
                    {t('transparency.totalPlatformFeeExact', {
                      rate: (payoutRange.maxTotalRate * 100).toFixed(1),
                    })}
                  </p>
                ) : (
                  <>
                    <p className="text-xs text-gray-600">
                      {t('transparency.customerCommissionUpTo', { rate: (payoutRange.maxCustomerRate * 100).toFixed(1) })}
                    </p>
                    <p className="text-xs text-gray-600">
                      {t('transparency.totalPlatformFeeRange', {
                        min: (payoutRange.minTotalRate * 100).toFixed(1),
                        max: (payoutRange.maxTotalRate * 100).toFixed(1),
                      })}
                    </p>
                  </>
                )}
                <p className="text-sm font-bold text-[#1B4F72] mt-1">
                  {payoutRange.minPayout === payoutRange.maxPayout
                    ? t('transparency.youWillReceiveExact', { amount: payoutRange.minPayout.toLocaleString() })
                    : t('transparency.youWillReceiveRange', { min: payoutRange.minPayout.toLocaleString(), max: payoutRange.maxPayout.toLocaleString() })
                  }
                </p>
                {!payoutRange.isExact && (
                  <p className="text-[10px] text-gray-500">
                    {t('transparency.exactAmountDependsOnCustomer')}
                  </p>
                )}
              </div>
            )}

            <Input
              label={t('bid.etaMinutesLabel')}
              type="number"
              value={etaMinutes}
              onChange={(e) => setEtaMinutes(e.target.value)}
              placeholder={t('bid.etaPlaceholder')}
              suffix="min"
            />

            <Button
              fullWidth
              size="lg"
              loading={isSubmitting}
              onClick={handleShowConfirmation}
              disabled={!bidPrice || !etaMinutes}
            >
              {t('bid.submitOffer')}
            </Button>
          </div>
        )}

        {/* R3-CHILD — driver acknowledgment modal opens BEFORE the
            price-confirmation modal for child-passenger journeys. */}
        <ChildAcknowledgmentModal
          open={showChildAckModal}
          onConfirm={handleChildAckConfirm}
          onCancel={handleChildAckCancel}
        />

        {/* Bid Confirmation Modal (D3) */}
        <Modal
          isOpen={showConfirmModal}
          onClose={() => setShowConfirmModal(false)}
          title={t('transparency.confirmOffer')}
        >
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">{t('bid.yourPrice')}</span>
              <span className="font-semibold text-gray-900">{parseInt(bidPrice, 10).toLocaleString()} RWF</span>
            </div>
            {payoutRange && (
              <>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">{t('transparency.yourTier', { tier: payoutRange.driverTier.tier, rate: (payoutRange.driverTier.commissionRate * 100).toFixed(1) })}</span>
                </div>
                {payoutRange.isExact ? (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">
                      {t('transparency.youWillReceiveExact', {
                        amount: payoutRange.minPayout.toLocaleString(),
                      })}
                    </span>
                  </div>
                ) : (
                  <>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">{t('transparency.guaranteedMinimum', { amount: payoutRange.minPayout.toLocaleString() })}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">{t('transparency.possibleMax', { amount: payoutRange.maxPayout.toLocaleString() })}</span>
                    </div>
                  </>
                )}
              </>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">ETA</span>
              <span className="font-semibold">{etaMinutes} min</span>
            </div>
            <p className="text-xs text-gray-500 pt-2 border-t">
              {t('transparency.priceBinding')}
            </p>
            <div className="flex gap-3 pt-2">
              <Button fullWidth variant="secondary" onClick={() => setShowConfirmModal(false)}>
                {t('common.cancel')}
              </Button>
              <Button fullWidth loading={isSubmitting} onClick={handleSubmitBid}>
                {t('transparency.submitOffer')}
              </Button>
            </div>
          </div>
        </Modal>
      </div>
    </div>
  );
};

export default BidPage;
