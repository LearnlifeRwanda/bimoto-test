import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { Spinner } from '../../components/ui/Spinner';
import { useUIStore } from '../../stores/ui.store';
import { apiFetch, apiErrorFromResponse } from '../../lib/api';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { presentApiError } from '../../lib/api-error-presenter';

interface CancelledJourney {
  id: string;
  pickupName: string;
  destinationName: string;
  cancelledAt: string;
  cancelReason: string | null;
  driverDisputedAt: string | null;
}

// R3-N-4 — driver-side no-show disputes surface. Lists the driver's
// recently cancelled journeys with cancelReason=DRIVER_NO_SHOW and lets
// the driver tap "Dispute this no-show" to file a dispute that an
// admin will review under the DRIVER_NO_SHOW_DISPUTE conflict.
export const NoShowDisputesPage: React.FC = () => {
  const { t } = useTranslation();
  const { showToast } = useUIStore();

  const [journeys, setJourneys] = useState<CancelledJourney[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const fetchCancelled = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await apiFetch(
        `/api/journeys?viewAs=driver&status=CANCELLED`,
        { credentials: 'include' },
      );
      if (!res.ok) throw await apiErrorFromResponse(res);
      const data: CancelledJourney[] = await res.json();
      setJourneys(
        data.filter((j) => j.cancelReason === 'DRIVER_NO_SHOW'),
      );
      setLoadFailed(false);
    } catch (err) {
      setLoadFailed(true);
      presentApiError(err);
    } finally {
      setIsLoading(false);
    }
  }, [showToast, t]);

  useEffect(() => {
    fetchCancelled();
  }, [fetchCancelled]);

  const handleDispute = useCallback(
    async (journeyId: string) => {
      setPendingId(journeyId);
      try {
        const res = await apiFetch(
          `/api/journeys/${journeyId}/dispute-no-show`,
          {
            method: 'POST',
            credentials: 'include',
          },
        );
        if (!res.ok) throw await apiErrorFromResponse(res);
        showToast(t('driver.disputeNoShowSubmitted'), 'info');
        await fetchCancelled();
      } catch (err) {
        presentApiError(err);
      } finally {
        setPendingId(null);
      }
    },
    [showToast, t, fetchCancelled],
  );

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4" data-testid="no-show-disputes-page">
      <h1 className="text-lg font-semibold text-gray-900 mb-4">
        {t('driver.cancelledTrips.title')}
      </h1>
      {loadFailed ? (
        <ErrorState onRetry={() => fetchCancelled()} />
      ) : journeys.length === 0 ? (
        <EmptyState title={t('driver.cancelledTrips.empty')} />
      ) : (
        <ul className="space-y-3">
          {journeys.map((j) => (
            <li
              key={j.id}
              className="bg-white shadow-sm p-3 rounded-md"
              data-testid="no-show-dispute-row"
            >
              <p className="text-sm font-medium text-gray-900">
                {j.pickupName} → {j.destinationName}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {new Date(j.cancelledAt).toLocaleString()}
              </p>
              {j.driverDisputedAt ? (
                <p className="mt-2 text-xs text-amber-700">
                  {t('driver.disputeNoShowSubmitted')}
                </p>
              ) : (
                <Button
                  fullWidth
                  variant="secondary"
                  className="mt-2"
                  onClick={() => handleDispute(j.id)}
                  loading={pendingId === j.id}
                >
                  {t('driver.disputeNoShow')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default NoShowDisputesPage;
