import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Spinner } from '../../components/ui/Spinner';
import { useUIStore } from '../../stores/ui.store';
import {
  bidWindowOpensAt,
  formatScheduledDateTime,
} from '../../lib/scheduled';
import { apiFetch, apiErrorFromResponse } from '../../lib/api';
import { presentApiError } from '../../lib/api-error-presenter';

// SCHED-UI G2 — customer state screen for a SCHEDULED journey. The one
// thing this screen must make unmistakable: nothing is wrong while the
// ride waits — bidding opens 60 minutes before pickup by design, and
// auto-fallback picks the cheapest on-time offer 30 minutes before
// pickup (services/scheduled-rides/auto-fallback.ts).
export const ScheduledRidePage: React.FC = () => {
  const { t } = useTranslation();
  const { id: journeyId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { showToast } = useUIStore();

  const [journey, setJourney] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  useEffect(() => {
    const fetchJourney = async () => {
      setIsLoading(true);
      try {
        const res = await apiFetch(`/api/journeys/${journeyId}`, {
          credentials: 'include',
        });
        if (!res.ok) throw await apiErrorFromResponse(res);
        const data = await res.json();
        setJourney(data);
        // Once the bid window has opened (SCHEDULED -> REQUESTED via the
        // bid-window-opener job) this screen's job is done — hand over to
        // the normal bid list.
        if (data.status === 'REQUESTED') {
          navigate(`/journey/${journeyId}/bids`, { replace: true });
        }
      } catch (err) {
        presentApiError(err);
      } finally {
        setIsLoading(false);
      }
    };
    if (journeyId) fetchJourney();
  }, [journeyId, navigate, showToast, t]);

  // Cancel goes through the existing journey-cancel flow (same endpoint
  // and reason taxonomy as MatchedPage).
  const handleCancel = useCallback(async () => {
    setIsCancelling(true);
    try {
      const res = await apiFetch(`/api/journeys/${journeyId}/cancel`, {
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ reason: 'CUSTOMER_CHANGED_MIND' }),
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
  }, [journeyId, showToast, navigate, t]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!journey) {
    return (
      <div className="min-h-screen bg-gray-50 px-4 py-12 text-center text-sm text-gray-500">
        {t('errors.generic')}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-6">
      <div className="w-full max-w-sm mx-auto" data-testid="scheduled-state-screen">
        <h1 className="text-xl font-bold text-[#1B4F72] mb-4">
          {t('scheduled.title')}
        </h1>

        {/* Route summary — same visual language as BidListPage. */}
        <div className="bg-white rounded-xl shadow-sm p-4 mb-4">
          <div className="flex items-center gap-2 text-sm text-gray-600 mb-1">
            <svg className="w-4 h-4 text-green-700" fill="currentColor" viewBox="0 0 20 20">
              <circle cx="10" cy="10" r="4" />
            </svg>
            <span className="truncate">
              {journey.pickupName}
            </span>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <svg className="w-4 h-4 text-red-600" fill="currentColor" viewBox="0 0 20 20">
              <circle cx="10" cy="10" r="4" />
            </svg>
            <span className="truncate">
              {journey.destinationName}
            </span>
          </div>
        </div>

        {journey.scheduledFor && (
          <div className="bg-white rounded-xl shadow-sm p-4 mb-4 space-y-2">
            <p className="text-base font-semibold text-gray-900" data-testid="scheduled-pickup-time">
              {t('scheduled.pickupAt', {
                time: formatScheduledDateTime(journey.scheduledFor),
              })}
            </p>
            <p className="text-sm text-gray-600" data-testid="scheduled-bidding-opens">
              {t('scheduled.biddingOpensAt', {
                time: formatScheduledDateTime(
                  bidWindowOpensAt(journey.scheduledFor).toISOString(),
                ),
              })}
            </p>
          </div>
        )}

        {/* GAP-CLOSE G3 — the way in to the offers.
            The bid-window-opener job flips SCHEDULED -> REQUESTED, and the
            loader above hands over to the bid list the moment it sees
            REQUESTED. Between bidWindowOpensAt passing and that job's next
            tick the ride sits here with offers already arriving and no way
            to look at them. This is that door: the same /bids route, shown
            only once the window the server stamped on the row has opened.
            No new endpoint, and nothing rendered before the window — the
            bid list would be empty by design. */}
        {journey.bidWindowOpensAt &&
          new Date(journey.bidWindowOpensAt).getTime() <= Date.now() && (
            <Button
              fullWidth
              onClick={() => navigate(`/journey/${journeyId}/bids`)}
              data-testid="scheduled-view-offers"
              className="mb-3"
            >
              {t('scheduled.viewOffers')}
            </Button>
          )}

        {/* Reassurance: waiting is by design. */}
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 mb-3">
          <p className="text-sm text-blue-900">{t('scheduled.waitingNote')}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-3 mb-6">
          <p className="text-xs text-gray-600" data-testid="scheduled-fallback-note">
            {t('scheduled.fallbackNote')}
          </p>
        </div>

        <Button
          fullWidth
          variant="secondary"
          onClick={() => setCancelModalOpen(true)}
          data-testid="scheduled-cancel-button"
        >
          {t('scheduled.cancelRide')}
        </Button>

        <Modal
          isOpen={cancelModalOpen}
          onClose={() => setCancelModalOpen(false)}
          title={t('scheduled.cancelConfirmTitle')}
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-600">{t('scheduled.cancelConfirmBody')}</p>
            <div className="flex gap-3">
              <Button
                fullWidth
                variant="secondary"
                onClick={() => setCancelModalOpen(false)}
              >
                {t('common.back')}
              </Button>
              <Button
                fullWidth
                variant="danger"
                loading={isCancelling}
                onClick={handleCancel}
                data-testid="scheduled-cancel-confirm"
              >
                {t('scheduled.cancelRide')}
              </Button>
            </div>
          </div>
        </Modal>
      </div>
    </div>
  );
};

export default ScheduledRidePage;
