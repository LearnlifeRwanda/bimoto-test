// PAGES/CUSTOMER/IN-PROGRESS-PAGE.TSX
//
// TEAM-ANSWERS G5 (OPEN DECISIONS item 16b, Kigali team, 18 August) —
// "both driver and passenger confirm the ride is done".
//
// The driver's half already existed: his End tap
// (POST /api/journeys/:id/end) moves the journey to
// AWAITING_CONFIRMATION. The passenger's half existed too, in the
// server — POST /api/journeys/:id/confirm, customerOnly, releasing the
// escrow — but it had been unreachable since DEADWOOD #163 deleted
// ConfirmPage, whose route no navigation ever reached. Only the 2-hour
// auto-confirm job ever called it.
//
// This wires it, and wires nothing else. The release path is INVOKED,
// not modified: the same endpoint, the same service, the same escrow
// transition the auto-confirm job has been driving all along. There is
// no second trigger for a release — there is one endpoint, and now two
// callers of it (this screen, and the clock).
//
// WHY THIS SCREEN. It is the one the passenger is already on when the
// driver taps End: /journey/:id/progress renders any journey by id with
// no status guard, and ActiveJourneyBanner now routes a returning
// passenger back to it (TEAM-ANSWERS G5 added AWAITING_CONFIRMATION to
// the customer's active statuses). The screen learns the ride ended
// from the JOURNEY_ENDED socket event the server has emitted since R3
// and useSocket now listens for.
//
// The copy names the fallback honestly: if she never taps it, the ride
// confirms itself after two hours and the motari is paid either way.
// That is true today, was true before this screen existed, and a
// passenger deserves to know it rather than believe the motari's money
// is being held hostage to her tap.
import React, { useCallback, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Spinner } from '../../components/ui/Spinner';
import { ChatEntryButton } from '../../components/chat/ChatEntryButton';
import { EmergencySOS } from '../../components/safety/EmergencySOS';
import { InterruptButton } from '../../components/safety/InterruptButton';
import { useSocket } from '../../hooks/useSocket';
import { useJourneyStore } from '../../stores/journey.store';
import { useUIStore } from '../../stores/ui.store';
import { apiFetch, apiErrorFromResponse } from '../../lib/api';
import { presentApiError } from '../../lib/api-error-presenter';

export const InProgressPage: React.FC = () => {
  const { t } = useTranslation();
  const { id: journeyId } = useParams<{ id: string }>();
  const { activeJourney, setActiveJourney } = useJourneyStore();
  const { showToast } = useUIStore();

  const [isLoading, setIsLoading] = useState(true);
  const [isInterrupting, setIsInterrupting] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Joins this journey's socket room, so the JOURNEY_ENDED the driver's
  // End tap emits reaches the store — same hook MatchedPage uses.
  useSocket(journeyId);

  const status = activeJourney?.status;
  const hasEnded = status === 'AWAITING_CONFIRMATION';
  const isConfirmed = status === 'COMPLETED';

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
          // Calculate elapsed from startedAt
          if (data.startedAt) {
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

  // Timer — stops once the driver has ended the ride; counting on past
  // the end would be a lie about how long the journey took.
  useEffect(() => {
    if (hasEnded || isConfirmed) return;
    const interval = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [hasEnded, isConfirmed]);

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // SOS-WIRE G2 — confirmation lives in InterruptButton's own dialog;
  // this runs only after the user confirmed there.
  const handleInterrupt = async () => {
    // NET-UX G3 — one interrupt POST at a time; re-taps are no-ops.
    if (isInterrupting) return;
    setIsInterrupting(true);
    try {
      const res = await apiFetch(`/api/journeys/${journeyId}/interrupt`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw await apiErrorFromResponse(res);
      showToast(t('inProgress.interrupted'), 'info');
    } catch (err) {
      presentApiError(err);
    } finally {
      setIsInterrupting(false);
    }
  };

  // TEAM-ANSWERS G5 — the passenger's half of item 16b. One tap, the
  // existing endpoint, nothing recomputed here.
  const handleConfirm = useCallback(async () => {
    if (isConfirming) return;
    setIsConfirming(true);
    try {
      const res = await apiFetch(`/api/journeys/${journeyId}/confirm`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw await apiErrorFromResponse(res);
      const updated = await res.json();
      setActiveJourney(updated);
      showToast(t('confirmArrival.done'), 'success');
    } catch (err) {
      presentApiError(err);
    } finally {
      setIsConfirming(false);
    }
  }, [journeyId, isConfirming, setActiveJourney, showToast, t]);

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
      <div className="bg-[#1B4F72] text-white px-4 py-5 text-center">
        <h1 className="text-heading font-bold uppercase tracking-wider">
          {hasEnded || isConfirmed ? t('confirmArrival.title') : t('inProgress.title')}
        </h1>
        <div className="mt-3">
          <p className="text-3xl font-mono font-bold">{formatDuration(elapsedSeconds)}</p>
          <p className="text-caption text-white/70 mt-1 uppercase">{t('inProgress.duration')}</p>
        </div>
      </div>

      {/* Mini Map placeholder */}
      <div className="bg-gray-200 flex-1 min-h-[240px] flex items-center justify-center relative">
        <p className="text-gray-500 text-secondary">{t('inProgress.mapPlaceholder')}</p>
        {/* GPS recording indicator */}
        <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-white/90 rounded-full px-3 py-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
          <span className="text-caption font-medium text-gray-700">{t('inProgress.recording')}</span>
        </div>
      </div>

      {/* Journey info */}
      {activeJourney && (
        <div className="bg-white px-4 py-3 border-t">
          <div className="flex items-center gap-2 text-secondary text-gray-600">
            <svg className="w-4 h-4 text-green-700 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <circle cx="10" cy="10" r="4" />
            </svg>
            <span className="truncate">{activeJourney.pickupName}</span>
          </div>
          <div className="flex items-center gap-2 text-secondary text-gray-600 mt-1">
            <svg className="w-4 h-4 text-red-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <circle cx="10" cy="10" r="4" />
            </svg>
            <span className="truncate">{activeJourney.destinationName}</span>
          </div>
        </div>
      )}

      {/* TEAM-ANSWERS G5 — the passenger says done. Appears only once
          the driver has ended the ride, and disappears once she has
          confirmed (or the clock did it for her). */}
      {hasEnded && (
        <div className="bg-white px-4 py-4 border-t" data-testid="confirm-arrival">
          <p className="text-secondary text-gray-700 mb-1">{t('confirmArrival.prompt')}</p>
          <p className="text-caption text-gray-500 mb-3">{t('confirmArrival.fallback')}</p>
          <Button
            fullWidth
            variant="success"
            loading={isConfirming}
            onClick={handleConfirm}
            data-testid="confirm-arrival-submit"
          >
            {t('confirmArrival.confirm')}
          </Button>
        </div>
      )}

      {isConfirmed && (
        <div className="bg-white px-4 py-4 border-t" data-testid="confirm-arrival-done">
          <p className="text-secondary text-green-700">{t('confirmArrival.done')}</p>
        </div>
      )}

      {/* FIELD-CLOSE G2 — chat entry (icon + word). This screen had no
          path to chat at all; the driver conversation continues at the
          existing /journey/:id/chat route. */}
      {journeyId && (
        <div className="sticky bottom-0 bg-white border-t px-4 py-3">
          <ChatEntryButton journeyId={journeyId} />
        </div>
      )}

      {/* SOS-WIRE G2 — floating safety actions. EmergencySOS notifies
          the platform AND keeps 112 one tap away; InterruptButton
          carries its own confirm dialog. */}
      {journeyId && <EmergencySOS journeyId={journeyId} />}
      <InterruptButton onInterruptJourney={handleInterrupt} />
    </div>
  );
};

export default InProgressPage;
