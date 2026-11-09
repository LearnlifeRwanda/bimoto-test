import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Spinner } from '../../components/ui/Spinner';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { useUIStore } from '../../stores/ui.store';
import { formatScheduledDateTime } from '../../lib/scheduled';
import { apiFetch, apiErrorFromResponse } from '../../lib/api';
import { presentApiError } from '../../lib/api-error-presenter';

// SCHED-UI G4 — "My scheduled rides": the driver's committed future
// SCHEDULED rides from GET /api/scheduled-rides (server orders by
// scheduledFor ascending, i.e. soonest first).
//
// FIELD-FIT G2 — the list now also carries rides the driver has only
// offered on, so a price and an ETA promised for a future ride are
// visible somewhere. The server labels each row `ASSIGNED` or
// `BID_PENDING`; this page shows which, and the empty state says the
// real reason it can be empty (offers on a scheduled ride open 60
// minutes before pickup).
export const ScheduledRidesPage: React.FC = () => {
  const { t } = useTranslation();
  const { showToast } = useUIStore();

  const [rides, setRides] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // NET-UX G3 — failed load is its own retryable state.
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const fetchRides = async () => {
      setIsLoading(true);
      setLoadFailed(false);
      try {
        const res = await apiFetch(`/api/scheduled-rides`, {
          credentials: 'include',
        });
        if (!res.ok) throw await apiErrorFromResponse(res);
        const data = await res.json();
        setRides(Array.isArray(data) ? data : []);
      } catch (err) {
        setLoadFailed(true);
        presentApiError(err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchRides();
  }, [showToast, t, reloadKey]);

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
        <h1 className="text-xl font-bold text-[#1B4F72] mb-6">
          {t('scheduled.driverListTitle')}
        </h1>

        {loadFailed ? (
          <ErrorState onRetry={() => setReloadKey((k) => k + 1)} />
        ) : rides.length === 0 ? (
          <EmptyState
            title={t('scheduled.driverListEmpty')}
            body={t('scheduled.driverListEmptyHint')}
            data-testid="driver-scheduled-empty"
          />
        ) : (
          <div className="space-y-3" data-testid="driver-scheduled-list">
            {rides.map((ride) => (
              <div
                key={ride.id}
                className="bg-white rounded-xl shadow-sm p-4"
                data-testid={`driver-scheduled-ride-${ride.id}`}
              >
                <div className="flex items-start justify-between mb-2">
                  <p className="text-sm font-semibold text-[#1B4F72]">
                    {ride.scheduledFor
                      ? formatScheduledDateTime(ride.scheduledFor)
                      : ''}
                  </p>
                  <span className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-600">
                    {t(`journey.status.${String(ride.status ?? '').toLowerCase()}`)}
                  </span>
                </div>

                {/* FIELD-FIT G2 — an offer is not a commitment; say which
                    one this row is before the route, because that is the
                    thing the motari came to the page to find out. */}
                <p
                  className={`text-xs font-semibold mb-2 ${
                    ride.commitment === 'ASSIGNED'
                      ? 'text-green-700'
                      : 'text-amber-700'
                  }`}
                  data-testid={`driver-scheduled-commitment-${ride.id}`}
                >
                  {ride.commitment === 'ASSIGNED'
                    ? t('scheduled.commitmentAssigned')
                    : t('scheduled.commitmentBidPending')}
                </p>
                <div className="flex items-center gap-2 text-sm text-gray-600 mb-1">
                  <svg className="w-3 h-3 text-green-700 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <circle cx="10" cy="10" r="5" />
                  </svg>
                  <span className="truncate">
                    {ride.pickupName || ''}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
                  <svg className="w-3 h-3 text-red-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <circle cx="10" cy="10" r="5" />
                  </svg>
                  <span className="truncate">
                    {ride.destinationName || ''}
                  </span>
                </div>
                {ride.agreedPrice != null ? (
                  <p className="text-xs text-gray-500">
                    {t('scheduled.agreedPrice')}:{' '}
                    <span className="font-semibold text-gray-700">
                      {Number(ride.agreedPrice).toLocaleString()} RWF
                    </span>
                  </p>
                ) : ride.myBid?.price != null ? (
                  <p className="text-xs text-gray-500">
                    {t('scheduled.yourOffer')}:{' '}
                    <span className="font-semibold text-gray-700">
                      {Number(ride.myBid.price).toLocaleString()} RWF
                    </span>
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ScheduledRidesPage;
