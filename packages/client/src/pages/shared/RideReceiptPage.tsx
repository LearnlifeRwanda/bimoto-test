// MONEY-UX G1 — per-ride receipt. Reads GET /api/journeys/:id (which
// carries the escrow row and, for matched-or-later journeys, the
// server-computed commissionBreakdown) and shows the honest money
// story for one ride: date, route, vehicle, what was paid, the
// platform fee (or the pilot fee-waiver line), and what the driver
// received. Every amount is rendered exactly as the server reported
// it — nothing is recomputed client-side. Lines with no data are
// hidden, and a completed ride with no money data at all says so
// plainly instead of faking zeros.
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { Spinner } from '../../components/ui/Spinner';
import { ErrorState } from '../../components/ui/ErrorState';
import { RateRideCard } from '../../components/rating/RateRideCard';
import { useAuthStore } from '../../stores/auth.store';
import {
  hasFullCommissionBreakdown,
  type WireCommissionBreakdown,
} from '../../lib/commission-view';
import { apiFetch, apiErrorFromResponse } from '../../lib/api';
import { presentApiError } from '../../lib/api-error-presenter';

// MONEY-VIEW v2 G1 — what the escrow row looks like ON THE WIRE, which is
// no longer one shape. `GET /api/journeys/:id` projects the row per viewer
// (`toCustomerEscrowView` / `toDriverEscrowView`, journey.service.ts), so
// this page — a screen BOTH roles reach — receives:
//
//   customer → { id, amount, status, releasedAt, customerTier,
//                customerCommissionRate, feeWaiverApplied }
//   driver   → the settlement columns as well.
//
// So the motari's three — `commission`, `driverPayout`,
// `waivedCommissionAmount` — are OPTIONAL here, exactly as
// `WireCommissionBreakdown` made the breakdown's fields optional for the
// same reason (CLEAN-SWEEP G1): a type that promises fields the wire does
// not carry is how `driverReceived` came to print the driver's net on the
// passenger's receipt in the first place.
interface ReceiptEscrow {
  id: string;
  amount: number;
  commission?: number | null;
  driverPayout?: number | null;
  status: string;
  waivedCommissionAmount?: number | null;
  /** Derived server-side; the customer's view of a waiver is a boolean. */
  feeWaiverApplied?: boolean;
  releasedAt?: string | null;
}

interface ReceiptJourney {
  id: string;
  status: string;
  pickupName?: string;
  destinationName?: string;
  vehiclePreference?: string | null;
  agreedPrice?: number | null;
  createdAt: string;
  endedAt?: string | null;
  confirmedAt?: string | null;
  escrow?: ReceiptEscrow | null;
  commissionBreakdown?: WireCommissionBreakdown;
  // COCKPIT G4 — who rode this as the passenger, so the stars are only
  // offered to them. The journey GET already returns it.
  customer?: { id: string } | null;
  // TRUE-WORDS G5.1 — the viewer's own stars for this ride, or null when
  // they have not rated it. Carried by the same GET, so a reopened receipt
  // shows what was sent instead of offering the stars a second time.
  // TEAM-ANSWERS G2 — `reason` joins the same read, so a reopened
  // receipt shows the whole of what was sent.
  myRating?: {
    stars: number;
    comment?: string | null;
    reason?: string | null;
    createdAt?: string;
  } | null;
}

const formatDateTime = (dateStr: string) => {
  const d = new Date(dateStr);
  return `${d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

export const RideReceiptPage: React.FC = () => {
  const { t } = useTranslation();
  const { id: journeyId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const currentUserId = useAuthStore((s) => s.user?.id);

  const [journey, setJourney] = useState<ReceiptJourney | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const fetchJourney = async () => {
      setIsLoading(true);
      setLoadFailed(false);
      try {
        const res = await apiFetch(`/api/journeys/${journeyId}`, {
          credentials: 'include',
        });
        if (!res.ok) throw await apiErrorFromResponse(res);
        const data = await res.json();
        if (!cancelled) setJourney(data);
      } catch (err) {
        if (!cancelled) {
          setLoadFailed(true);
          presentApiError(err);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    if (journeyId) fetchJourney();
    return () => {
      cancelled = true;
    };
  }, [journeyId, reloadKey]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (loadFailed || !journey) {
    return (
      <div className="min-h-screen bg-gray-50 px-4 py-6">
        <ErrorState onRetry={() => setReloadKey((k) => k + 1)} />
      </div>
    );
  }

  const rawBreakdown = journey.commissionBreakdown;
  const escrow = journey.escrow;

  // CLEAN-SWEEP G1 — this page is a CUSTOMER surface (the rating gate
  // below requires journey.customer.id === currentUserId) reading
  // `GET /api/journeys/:id`, which is the very route that hands a
  // customer the redacted four and omits totalCommissionAmount. The old
  // `breakdown ? breakdown.totalCommissionAmount : …` therefore produced
  // `undefined` on every customer receipt, `undefined !== null` passed
  // the render guard below, and `feeAmount.toLocaleString()` threw —
  // the MatchedPage crash, on a second screen, live. So the breakdown is
  // consulted for money only when it is the FULL shape; otherwise the
  // escrow row (server truth, already on this payload) answers, exactly
  // as it does when no breakdown was computed at all.
  const breakdown = hasFullCommissionBreakdown(rawBreakdown) ? rawBreakdown : null;

  // Amounts come from the breakdown when the server computed a full one,
  // from the raw escrow row otherwise. Both are server truth; neither is
  // ever derived on the client. `bidPrice` is customer-safe, so the total
  // the passenger PAID may still come off a redacted breakdown.
  const totalPaid = rawBreakdown?.bidPrice ?? escrow?.amount ?? journey.agreedPrice ?? null;
  const driverReceived = breakdown?.driverPayout ?? escrow?.driverPayout ?? null;
  const feeWaived = breakdown
    ? breakdown.feeWaiverApplied === true
    : rawBreakdown?.feeWaiverApplied === true ||
      escrow?.feeWaiverApplied === true ||
      (escrow?.waivedCommissionAmount ?? 0) > 0;
  // Under a waiver the meaningful figure is what the fee WOULD have
  // been (the charged fee is 0); unwaived, it is the charged fee.
  const feeAmount = breakdown
    ? breakdown.totalCommissionAmount
    : feeWaived
      ? (escrow?.waivedCommissionAmount ?? null)
      : (escrow?.commission ?? null);
  const hasMoneyData = totalPaid !== null || driverReceived !== null || feeAmount !== null;

  const receiptDate = journey.confirmedAt ?? journey.endedAt ?? journey.createdAt;

  // COCKPIT G4 — the stars, on the one screen a finished ride already
  // has. The server's own preconditions, checked here so the UI never
  // offers a tap it knows will be refused: the journey must be COMPLETED,
  // and the rater must be a participant — the passenger side, since the
  // driver's counterpart rating has no surface of its own and inventing
  // one is a product decision, not cleanup.
  const canRate =
    journey.status === 'COMPLETED' &&
    !!currentUserId &&
    journey.customer?.id === currentUserId;

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-6">
      <div className="w-full max-w-sm mx-auto">
        <button
          onClick={() => navigate(-1)}
          className="mb-4 text-secondary text-gray-500 hover:underline min-h-[44px] flex items-center"
          data-testid="receipt-back"
        >
          ← {t('common.goBack')}
        </button>

        <div className="bg-white rounded-xl shadow-sm p-4" data-testid="ride-receipt">
          <h1 className="text-title font-bold text-[#1B4F72] mb-1">
            {t('transparency.rideReceipt')}
          </h1>
          <p className="text-caption text-gray-500 mb-3" data-testid="receipt-date">
            {formatDateTime(receiptDate)}
          </p>

          {/* Route */}
          {(journey.pickupName || journey.destinationName) && (
            <div className="space-y-1 mb-3" data-testid="receipt-route">
              {journey.pickupName && (
                <div className="flex items-center gap-2 text-secondary text-gray-700">
                  <svg className="w-3 h-3 text-green-700 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <circle cx="10" cy="10" r="5" />
                  </svg>
                  <span className="truncate">{journey.pickupName}</span>
                </div>
              )}
              {journey.destinationName && (
                <div className="flex items-center gap-2 text-secondary text-gray-700">
                  <svg className="w-3 h-3 text-red-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <circle cx="10" cy="10" r="5" />
                  </svg>
                  <span className="truncate">{journey.destinationName}</span>
                </div>
              )}
            </div>
          )}

          {/* Vehicle */}
          {journey.vehiclePreference && (
            <div className="flex justify-between text-secondary mb-3" data-testid="receipt-vehicle">
              <span className="text-gray-500">{t('receipt.vehicle')}</span>
              <span className="text-gray-700">
                {t(`vehicleTypeInfo.${journey.vehiclePreference.toLowerCase()}.label`)}
              </span>
            </div>
          )}

          <hr className="mb-3" />

          {/* Money lines — each renders only when the server sent it. */}
          <div className="space-y-2 text-secondary">
            {totalPaid !== null && (
              <div className="flex justify-between" data-testid="receipt-total-paid">
                <span className="text-gray-600">{t('transparency.totalPaid')}</span>
                <span className="font-semibold">{totalPaid.toLocaleString()} RWF</span>
              </div>
            )}

            {feeAmount !== null && (
              <div className="flex justify-between" data-testid="receipt-platform-fee">
                <span className="text-gray-600">
                  {t('transparency.platformFee')}
                  {breakdown && ` (${(breakdown.totalCommissionRate * 100).toFixed(1)}%)`}
                </span>
                {feeWaived ? (
                  <span className="text-green-700" data-testid="receipt-fee-waived">
                    {t('transparency.feeWaivedAmount', { amount: feeAmount.toLocaleString() })}
                  </span>
                ) : (
                  <span className="text-red-600">-{feeAmount.toLocaleString()} RWF</span>
                )}
              </div>
            )}

            {driverReceived !== null && (
              <div className="flex justify-between" data-testid="receipt-driver-received">
                <span className="text-gray-600">{t('transparency.netReceived')}</span>
                <span className="font-semibold text-[#1B4F72]">
                  {driverReceived.toLocaleString()} RWF
                </span>
              </div>
            )}
          </div>

          {feeWaived && (
            <p className="text-caption text-green-700 mt-3">{t('transparency.feeWaivedNote')}</p>
          )}

          {!hasMoneyData && (
            <p className="text-secondary text-gray-500" data-testid="receipt-no-money-data">
              {t('receipt.missingMoneyData')}
            </p>
          )}

          {/* Payment status from the escrow row, when one exists. */}
          {escrow && (
            <div className="flex justify-between text-caption mt-4 pt-3 border-t border-gray-100" data-testid="receipt-payment-status">
              <span className="text-gray-500">{t('receipt.paymentStatus')}</span>
              <span className="font-medium text-gray-700">
                {t(`payments.status.${escrow.status}`, { defaultValue: escrow.status })}
              </span>
            </div>
          )}
        </div>

        {canRate && journeyId && (
          <RateRideCard
            journeyId={journeyId}
            initialRating={journey.myRating?.stars ?? null}
            initialReason={journey.myRating?.reason ?? null}
            initialComment={journey.myRating?.comment ?? null}
          />
        )}
      </div>
    </div>
  );
};

export default RideReceiptPage;
