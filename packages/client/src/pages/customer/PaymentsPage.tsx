// MONEY-UX G2 — the customer's payment home. Three sections over data
// that already exists: recent payments (completed rides from
// GET /api/journeys, each opening its G1 receipt), the current ride's
// payment state (GET /api/payments/:escrowId/status when an active
// journey carries an escrow), and how payment works (the existing
// MoMo/card choice explained — the client stores no payment-method
// preference, so this is an explanation, not a setting).
//
// MONEY-UX G3 — while the server reports simulated payments, a
// non-dismissible line at the top says so in the banner's words. No
// balance or total figure is shown anywhere: there is no customer
// wallet, and this page must not pretend one exists.
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Spinner } from '../../components/ui/Spinner';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { useSimulationStore } from '../../stores/simulation.store';
import { apiFetch, apiErrorFromResponse } from '../../lib/api';
import { presentApiError } from '../../lib/api-error-presenter';

interface PaymentsJourney {
  id: string;
  status: string;
  pickupName?: string;
  destinationName?: string;
  agreedPrice?: number | null;
  createdAt: string;
  confirmedAt?: string | null;
  escrow?: {
    id: string;
    amount: number;
    status: string;
  } | null;
}

// Journey statuses during which the ride's payment is live on this page.
const ACTIVE_STATUSES = ['MATCHED', 'IN_PROGRESS', 'AWAITING_CONFIRMATION'];

const formatDate = (dateStr: string) => {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

// Live escrow state for the active ride, from the existing status
// endpoint. Its failure is its own inline state — it must not take
// down the rest of the page.
const ActiveRidePayment: React.FC<{ journey: PaymentsJourney }> = ({ journey }) => {
  const { t } = useTranslation();
  const [escrowStatus, setEscrowStatus] = useState<string | null>(null);
  const [statusFailed, setStatusFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const escrowId = journey.escrow?.id;

  useEffect(() => {
    if (!escrowId) return;
    let cancelled = false;
    const fetchStatus = async () => {
      setStatusFailed(false);
      try {
        const res = await apiFetch(`/api/payments/${escrowId}/status`, {
          credentials: 'include',
        });
        if (!res.ok) throw await apiErrorFromResponse(res);
        const data = await res.json();
        if (!cancelled) setEscrowStatus(data.status);
      } catch {
        if (!cancelled) setStatusFailed(true);
      }
    };
    fetchStatus();
    return () => {
      cancelled = true;
    };
  }, [escrowId, reloadKey]);

  return (
    <div className="bg-white rounded-xl shadow-sm p-4" data-testid="payments-active-ride">
      <div className="flex items-center justify-between mb-1">
        <span className="text-secondary text-gray-700 truncate">
          {journey.pickupName} → {journey.destinationName}
        </span>
        {journey.agreedPrice != null && (
          <span className="text-secondary font-bold text-[#1B4F72] flex-shrink-0 ml-2">
            {journey.agreedPrice.toLocaleString()} RWF
          </span>
        )}
      </div>

      {escrowId ? (
        statusFailed ? (
          <div className="flex items-center justify-between mt-1">
            <span className="text-caption text-[#E74C3C]" data-testid="payments-active-status-failed">
              {t('payments.statusFetchFailed')}
            </span>
            <button
              onClick={() => setReloadKey((k) => k + 1)}
              className="text-caption text-[#1B4F72] underline min-h-[44px]"
            >
              {t('payment.retry')}
            </button>
          </div>
        ) : escrowStatus ? (
          <p className="text-caption text-gray-600 mt-1" data-testid="payments-active-status">
            {t(`payments.status.${escrowStatus}`, { defaultValue: escrowStatus })}
          </p>
        ) : (
          <Spinner size="sm" />
        )
      ) : (
        // No escrow yet (pre-acceptance edge) — say how payment will
        // happen instead of showing nothing.
        <p className="text-caption text-gray-500 mt-1" data-testid="payments-active-no-escrow">
          {t('payments.howItWorks')}
        </p>
      )}
    </div>
  );
};

export const PaymentsPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const paymentsSimulated = useSimulationStore((s) => s.paymentsMode === 'simulated');

  const [journeys, setJourneys] = useState<PaymentsJourney[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const fetchJourneys = async () => {
      setIsLoading(true);
      setLoadFailed(false);
      try {
        const res = await apiFetch(`/api/journeys`, { credentials: 'include' });
        if (!res.ok) throw await apiErrorFromResponse(res);
        const data = await res.json();
        if (!cancelled) setJourneys(data);
      } catch (err) {
        if (!cancelled) {
          setLoadFailed(true);
          presentApiError(err);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    fetchJourneys();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  const activeJourney = journeys.find((j) => ACTIVE_STATUSES.includes(j.status)) ?? null;
  const completed = journeys.filter(
    (j) => j.status === 'COMPLETED' && (j.agreedPrice != null || j.escrow),
  );

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-6">
      <div className="w-full max-w-sm mx-auto">
        <h1 className="text-title font-bold text-[#1B4F72] mb-4">{t('payments.title')}</h1>

        {/* G3 — simulated mode said plainly, not dismissible here. */}
        {paymentsSimulated && (
          <div
            role="status"
            data-testid="payments-sim-note"
            className="mb-4 rounded-lg bg-amber-700 px-3 py-2 text-caption font-semibold text-white"
          >
            {t('simulation.banner')}
          </div>
        )}

        {loadFailed ? (
          <ErrorState onRetry={() => setReloadKey((k) => k + 1)} />
        ) : (
          <>
            {/* (b) Current ride's payment state, when one is active. */}
            {activeJourney && (
              <section className="mb-6">
                <h2 className="text-secondary font-semibold text-gray-700 mb-2">
                  {t('payments.activeTitle')}
                </h2>
                <ActiveRidePayment journey={activeJourney} />
              </section>
            )}

            {/* (a) Recent payments — completed rides, newest first
                (server order), each opening its receipt. */}
            <section className="mb-6">
              <h2 className="text-secondary font-semibold text-gray-700 mb-2">
                {t('payments.recentTitle')}
              </h2>
              {completed.length === 0 ? (
                <EmptyState title={t('payments.empty')} body={t('payments.emptyHint')} />
              ) : (
                <div className="space-y-2">
                  {completed.map((j) => (
                    <button
                      key={j.id}
                      onClick={() => navigate(`/journey/${j.id}/receipt`)}
                      data-testid={`payments-row-${j.id}`}
                      className="w-full bg-white rounded-xl shadow-sm p-4 text-left hover:shadow-md transition-shadow min-h-[44px]"
                    >
                      <div className="flex items-center justify-between">
                        <div className="min-w-0">
                          <p className="text-secondary text-gray-700 truncate">
                            {j.pickupName} → {j.destinationName}
                          </p>
                          <p className="text-caption text-gray-500">
                            {formatDate(j.confirmedAt ?? j.createdAt)}
                          </p>
                        </div>
                        <span className="text-secondary font-bold text-[#1B4F72] flex-shrink-0 ml-2">
                          {(j.escrow?.amount ?? j.agreedPrice ?? 0).toLocaleString()} RWF
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </section>

            {/* (c) How you pay — the existing MoMo/card choice explained.
                The choice itself is made when accepting an offer; the
                client stores no preference to edit here. */}
            <section data-testid="payments-method-section">
              <h2 className="text-secondary font-semibold text-gray-700 mb-2">
                {t('payment.method.label')}
              </h2>
              <div className="bg-white rounded-xl shadow-sm p-4 space-y-3">
                <p className="text-secondary text-gray-600">{t('payments.howItWorks')}</p>
                <div className="space-y-2 text-secondary">
                  <div>
                    <p className="font-medium text-gray-800">{t('payment.method.momo')}</p>
                    <p className="text-caption text-gray-500">{t('payment.method.momoHint')}</p>
                  </div>
                  <div>
                    <p className="font-medium text-gray-800">{t('payment.method.card')}</p>
                    <p className="text-caption text-gray-500">{t('payment.method.cardHint')}</p>
                  </div>
                </div>
                <p className="text-caption text-gray-500">{t('transparency.paymentHeldInEscrow')}</p>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
};

export default PaymentsPage;
