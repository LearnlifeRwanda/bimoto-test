import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Spinner } from '../../components/ui/Spinner';
import { ChatEntryButton } from '../../components/chat/ChatEntryButton';
import { EmergencySOS } from '../../components/safety/EmergencySOS';
import { useJourneyStore } from '../../stores/journey.store';
import { useUIStore } from '../../stores/ui.store';
import { useOwnPosition } from '../../hooks/useOwnPosition';
import { DriverNavMap } from '../../components/map/DriverNavMap';
import { useDriverLocationBroadcast } from '../../hooks/useDriverLocationBroadcast';
import { useRideTraceRecorder } from '../../hooks/useRideTraceRecorder';
import { getVehicleCompliance, JourneyStatus } from '@bimoto/shared';
import {
  hasFullCommissionBreakdown,
  type WireCommissionBreakdown,
} from '../../lib/commission-view';
import { apiFetch, apiErrorFromResponse } from '../../lib/api';
import { presentApiError } from '../../lib/api-error-presenter';
import { PlaceDescription } from '../../components/journey/PlaceDescription';
import { ReportRideCard } from '../../components/report/ReportRideCard';

type RidePhase = 'ready' | 'in_progress' | 'completed';

export const ActiveRidePage: React.FC = () => {
  const { t } = useTranslation();
  const { id: journeyId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { activeJourney, setActiveJourney } = useJourneyStore();
  const { showToast } = useUIStore();

  const [isLoading, setIsLoading] = useState(true);
  const [phase, setPhase] = useState<RidePhase>('ready');
  const [isStarting, setIsStarting] = useState(false);
  const [isEnding, setIsEnding] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [distanceCovered, setDistanceCovered] = useState(0);
  const [commissionBreakdown, setCommissionBreakdown] = useState<WireCommissionBreakdown | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Pre-pickup driver-approach broadcast (R3-E). Active only while the
  // journey is MATCHED — stops at IN_PROGRESS so the customer can no
  // longer see the driver's location after pickup.
  const broadcastState =
    phase === 'in_progress'
      ? JourneyStatus.IN_PROGRESS
      : phase === 'completed'
        ? JourneyStatus.COMPLETED
        : JourneyStatus.MATCHED;
  useDriverLocationBroadcast(journeyId, broadcastState);

  // RIDE-TRACE G2 — the recording, which starts exactly where the
  // broadcast above stops. Store-and-forward only: it emits nothing and
  // nobody can follow the ride live. `phase === 'in_progress'` is this
  // screen's own truth about the leg — the passenger is on the bike
  // between the start tap and the end tap, and that is the stretch the
  // trace is kept for.
  useRideTraceRecorder(journeyId, phase === 'in_progress');

  // Fetch journey
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
          if (data.commissionBreakdown) {
            setCommissionBreakdown(data.commissionBreakdown);
          }
          if (data.startedAt) {
            setPhase('in_progress');
            const elapsed = Math.floor((Date.now() - new Date(data.startedAt).getTime()) / 1000);
            setElapsedSeconds(Math.max(0, elapsed));
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

  // Timer
  useEffect(() => {
    if (phase === 'in_progress') {
      timerRef.current = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [phase]);

  // COCKPIT G1/G2 — GPS tracking during the ride. This was a
  // watchPosition whose success callback was an empty block with a
  // "in production, send coordinates to server" note: it drew power and
  // did nothing. The same watch now feeds the map, through the shared
  // useOwnPosition hook over the same `geolocation` façade, and it runs
  // from 'ready' rather than only 'in_progress' — the motari needs to
  // see where he is before he taps start, not after.
  const ownCoords = useOwnPosition(phase !== 'completed');

  const ownPoint = useMemo(
    () => (ownCoords ? { lat: ownCoords.lat, lng: ownCoords.lng } : null),
    [ownCoords],
  );

  // A journey with no destination coordinates renders no map rather than
  // a map of nowhere; the address text below still names the place.
  const destinationPoint = useMemo(() => {
    const j = activeJourney as {
      destinationLat?: number;
      destinationLng?: number;
    } | null;
    return typeof j?.destinationLat === 'number' &&
      typeof j?.destinationLng === 'number'
      ? { lat: j.destinationLat, lng: j.destinationLng }
      : null;
  }, [activeJourney]);

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleStartJourney = async () => {
    // Helmet confirmation — vehicle-type-aware
    const vehicleType = activeJourney?.driver?.driverProfile?.vehicleType || 'MOTO';
    const compliance = getVehicleCompliance(vehicleType);

    if (compliance.helmetRequired) {
      const helmetConfirmed = window.confirm(t('verification.helmetConfirm'));
      if (!helmetConfirmed) return;
    }

    setIsStarting(true);
    try {
      const res = await apiFetch(`/api/journeys/${journeyId}/start`, {
        method: 'POST',
        credentials: 'include',
      });

      if (!res.ok) throw await apiErrorFromResponse(res);

      const updated = await res.json();
      setActiveJourney(updated);
      setPhase('in_progress');
      setElapsedSeconds(0);
      showToast(t('activeRide.started'), 'success');
    } catch (err) {
      presentApiError(err);
    } finally {
      setIsStarting(false);
    }
  };

  const handleEndJourney = async () => {
    const confirmed = window.confirm(t('activeRide.endConfirm'));
    if (!confirmed) return;

    setIsEnding(true);
    try {
      const res = await apiFetch(`/api/journeys/${journeyId}/end`, {
        method: 'POST',
        credentials: 'include',
      });

      if (!res.ok) throw await apiErrorFromResponse(res);

      showToast(t('activeRide.ended'), 'success');
      setPhase('completed');
    } catch (err) {
      presentApiError(err);
    } finally {
      setIsEnding(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  // Ride Complete Receipt (D6)
  // CLEAN-SWEEP G1 — the shared guard. A driver gets the FULL shape from
  // `GET /api/journeys/:id` today, so this panel is not crashing; it
  // dereferences nine money fields off the same interface that carries
  // three different shapes, which is the whole reason the class exists.
  if (phase === 'completed' && hasFullCommissionBreakdown(commissionBreakdown)) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-sm bg-white rounded-xl shadow-sm p-6">
          <h2 className="text-heading font-bold text-gray-900 mb-4 text-center">{t('transparency.rideReceipt')}</h2>
          <div className="space-y-2 text-secondary">
            <div className="flex justify-between">
              <span className="text-gray-600">{t('transparency.totalPaid')}</span>
              <span className="font-semibold">{commissionBreakdown.bidPrice.toLocaleString()} RWF</span>
            </div>
            {/* LAUNCH-TRUTH G4 — waived case: one truthful fee line
                (nominal shown, charged 0) instead of per-side deduction
                lines that were not actually deducted. */}
            {commissionBreakdown.feeWaiverApplied ? (
              <div className="flex justify-between text-green-700">
                <span>{t('transparency.platformFee')} ({(commissionBreakdown.totalCommissionRate * 100).toFixed(1)}%)</span>
                <span data-testid="fee-waived-amount">
                  {t('transparency.feeWaivedAmount', { amount: commissionBreakdown.totalCommissionAmount.toLocaleString() })}
                </span>
              </div>
            ) : (
              <>
                <div className="flex justify-between text-red-600">
                  <span>{t('transparency.driverCommission', { tier: commissionBreakdown.driverTier, rate: (commissionBreakdown.driverCommissionRate * 100).toFixed(1) })}</span>
                  <span>-{Math.round(commissionBreakdown.bidPrice * commissionBreakdown.driverCommissionRate).toLocaleString()} RWF</span>
                </div>
                <div className="flex justify-between text-red-600">
                  <span>{t('transparency.customerCommission', { tier: commissionBreakdown.customerTier, rate: (commissionBreakdown.customerCommissionRate * 100).toFixed(1) })}</span>
                  <span>-{Math.round(commissionBreakdown.bidPrice * commissionBreakdown.customerCommissionRate).toLocaleString()} RWF</span>
                </div>
                <div className="flex justify-between text-red-600">
                  <span>{t('transparency.platformFee')} ({(commissionBreakdown.totalCommissionRate * 100).toFixed(1)}%)</span>
                  <span>-{commissionBreakdown.totalCommissionAmount.toLocaleString()} RWF</span>
                </div>
              </>
            )}
            <hr className="my-2" />
            <div className="flex justify-between text-body font-bold text-[#1B4F72]">
              <span>{t('transparency.netReceived')}</span>
              <span>{commissionBreakdown.driverPayout.toLocaleString()} RWF</span>
            </div>
          </div>
          {commissionBreakdown.feeWaiverApplied && (
            <p className="text-caption text-green-700 mt-3 text-center" data-testid="fee-waived-note">
              {t('transparency.feeWaivedNote')}
            </p>
          )}
          {!commissionBreakdown.feeWaiverApplied && commissionBreakdown.driverSavings > 0 && (
            <p className="text-caption text-green-700 mt-3 text-center">
              {t('transparency.tierSavings', { tier: commissionBreakdown.driverTier, amount: commissionBreakdown.driverSavings })}
            </p>
          )}
          <Button fullWidth className="mt-6" onClick={() => navigate('/driver', { replace: true })}>
            {t('confirm.goHome')}
          </Button>
          {/* TEAM-ANSWERS G3 — the driver's half of item 15. An
              understated link under the receipt, never a grade and never
              a step: the ride is already finished and the money is
              already settled by the time this appears. */}
          {journeyId && <ReportRideCard journeyId={journeyId} />}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className={`px-4 py-4 text-center ${phase === 'in_progress' ? 'bg-[#1B4F72]' : 'bg-white border-b'}`}>
        {phase === 'in_progress' ? (
          <>
            <div className="flex items-center justify-center gap-2 mb-2">
              <span className="w-2.5 h-2.5 rounded-full bg-red-400 animate-pulse" />
              <span className="text-caption text-white/70 uppercase tracking-wide">
                {t('activeRide.recording')}
              </span>
            </div>
            <p className="text-3xl font-mono font-bold text-white">{formatDuration(elapsedSeconds)}</p>
            <p className="text-caption text-white/80 mt-1">{t('activeRide.duration')}</p>
            {/* Persistent payout display (D5) */}
            {hasFullCommissionBreakdown(commissionBreakdown) && (
              <p className="text-secondary text-white/90 mt-2 font-medium">
                {t('transparency.rideInProgress', { amount: commissionBreakdown.driverPayout.toLocaleString() })}
              </p>
            )}
            {distanceCovered > 0 && (
              <p className="text-secondary text-white/80 mt-1">
                {(distanceCovered / 1000).toFixed(1)} km
              </p>
            )}
          </>
        ) : (
          <>
            <h1 className="text-title font-bold text-gray-900">{t('activeRide.readyToStart')}</h1>
            <p className="text-secondary text-gray-500 mt-1">{t('activeRide.readySubtitle')}</p>
          </>
        )}
      </div>

      {/* COCKPIT G2 — the way to the destination, where the grey "Map
          view" rectangle used to be. Same `flex-1 min-h-[240px]` box the
          placeholder occupied, so the ride controls below it keep their
          place above the fold on a 640 px screen. The GPS pill is passed
          through as map chrome rather than re-implemented. */}
      {destinationPoint ? (
        <DriverNavMap
          origin={ownPoint}
          target={destinationPoint}
          targetKind="destination"
          heightClass="flex-1 min-h-[240px]"
        >
          {phase === 'in_progress' && (
            <div className="absolute top-3 right-3 z-[1000] flex items-center gap-1.5 bg-white/90 rounded-full px-3 py-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
              <span className="text-caption font-medium text-gray-700">GPS</span>
            </div>
          )}
        </DriverNavMap>
      ) : (
        <div className="flex-1 min-h-[240px]" />
      )}

      {/* Journey info */}
      {activeJourney && (
        <div className="bg-white px-4 py-3 border-t">
          <div className="flex items-center gap-2 text-secondary text-gray-600">
            <svg className="w-3 h-3 text-green-700 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <circle cx="10" cy="10" r="5" />
            </svg>
            <span className="truncate">{activeJourney.pickupName}</span>
          </div>
          {/* FIELD-FIT G4 — LANDMARKS #157 put the passenger's own words
              about a place on BidPage, ApproachPage and ConfirmPage, but
              not here — so the description vanished exactly when the
              motari is driving to the door and needs it most. Same
              null-guarded component as ApproachPage: a journey with
              nothing written renders nothing at all. */}
          <PlaceDescription
            target="pickup"
            text={(activeJourney as { pickupDescription?: string }).pickupDescription}
            className="ml-5"
          />
          <div className="flex items-center gap-2 text-secondary text-gray-600 mt-1">
            <svg className="w-3 h-3 text-red-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <circle cx="10" cy="10" r="5" />
            </svg>
            <span className="truncate">{activeJourney.destinationName}</span>
          </div>
          <PlaceDescription
            target="destination"
            text={(activeJourney as { destinationDescription?: string }).destinationDescription}
            className="ml-5"
          />
          {/* The last 300 metres: the drop-off note the passenger wrote
              is the point of this screen once the ride is moving. */}
          <div className="mt-2 flex items-center justify-between">
            <span className="text-secondary text-gray-500">
              {activeJourney.customer?.nickname}
            </span>
            <span className="text-secondary font-bold text-[#1B4F72]">
              {activeJourney.agreedPrice?.toLocaleString()} RWF
            </span>
          </div>
          {/* Confirmed payout (D5) */}
          {hasFullCommissionBreakdown(commissionBreakdown) && (
            <p className="text-caption text-green-700 mt-1">
              {t('transparency.youWillReceiveExact', { amount: commissionBreakdown.driverPayout.toLocaleString() })}
            </p>
          )}
        </div>
      )}

      {/* Action Button */}
      <div className="sticky bottom-0 bg-white border-t px-4 py-4 space-y-2">
        {/* FIELD-CLOSE G2 — thumb-reachable chat entry (icon + word)
            to the full-screen ChatPage at the existing route. */}
        {journeyId && <ChatEntryButton journeyId={journeyId} />}
        {phase === 'ready' ? (
          <Button
            fullWidth
            size="lg"
            variant="success"
            loading={isStarting}
            onClick={handleStartJourney}
          >
            {t('activeRide.startJourney')}
          </Button>
        ) : (
          <Button
            fullWidth
            size="lg"
            variant="danger"
            loading={isEnding}
            onClick={handleEndJourney}
          >
            {t('activeRide.endJourney')}
          </Button>
        )}
      </div>

      {/* RED-BUTTON G3 — the same red button the passenger has, in the
          same floating position, for the whole ride. */}
      {journeyId && <EmergencySOS journeyId={journeyId} />}
    </div>
  );
};

export default ActiveRidePage;
