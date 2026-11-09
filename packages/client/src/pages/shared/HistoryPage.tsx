import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Spinner } from '../../components/ui/Spinner';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { useUIStore } from '../../stores/ui.store';
import { useAuthStore } from '../../stores/auth.store';
import { CustomerJourneyOutcomeBadge } from '../../components/journey/CustomerJourneyOutcomeBadge';
import { formatScheduledDateTime } from '../../lib/scheduled';
import { apiFetch, apiErrorFromResponse } from '../../lib/api';
import { presentApiError } from '../../lib/api-error-presenter';
import {
  hasCustomerSafeCommission,
  hasFullCommissionBreakdown,
  type WireCommissionBreakdown,
} from '../../lib/commission-view';
import { JourneyStatus } from '@bimoto/shared';

// CLEAN-SWEEP G2 — every JourneyStatus, so no row can render a colourless
// pill. Five of the ten were missing and fell through to the grey
// fallback: MATCHED, AWAITING_CONFIRMATION, INTERRUPTED, EXPIRED and
// REQUESTED. `status.*` already carries all ten labels, so this was
// colour drift alone. (`PENDING` was in this map and is not a
// JourneyStatus at all; it is dropped.)
export const STATUS_COLORS: Record<JourneyStatus, string> = {
  [JourneyStatus.SCHEDULED]: 'bg-indigo-50 text-indigo-600',
  [JourneyStatus.REQUESTED]: 'bg-yellow-50 text-yellow-600',
  [JourneyStatus.MATCHED]: 'bg-blue-50 text-blue-600',
  [JourneyStatus.IN_PROGRESS]: 'bg-blue-50 text-blue-600',
  [JourneyStatus.AWAITING_CONFIRMATION]: 'bg-amber-50 text-amber-700',
  [JourneyStatus.COMPLETED]: 'bg-[#27AE60]/10 text-[#27AE60]',
  [JourneyStatus.CANCELLED]: 'bg-gray-100 text-gray-500',
  [JourneyStatus.INTERRUPTED]: 'bg-orange-50 text-orange-700',
  [JourneyStatus.DISPUTED]: 'bg-[#E74C3C]/10 text-[#E74C3C]',
  [JourneyStatus.EXPIRED]: 'bg-gray-100 text-gray-500',
};

interface Journey {
  id: string;
  pickupName: string;
  destinationName: string;
  status: string;
  agreedPrice?: number;
  rating?: number;
  createdAt: string;
  completedAt?: string;
  // GAP-CLOSE G3 — scheduling fields. GET /api/journeys carries every
  // scalar on the row (getJourneys does no `select`), so these arrive
  // already; nothing on this screen used to read them.
  scheduledFor?: string | null;
  bidWindowOpensAt?: string | null;
  // R3-N-5 — fields used by CustomerJourneyOutcomeBadge for
  // DRIVER_NO_SHOW journeys. Server attaches noShowResolution from the
  // RESOLVE_DRIVER_NO_SHOW_DISPUTE AdminAction row, when present.
  cancelReason?: string | null;
  cancelledAt?: string | null;
  driverDisputedAt?: string | null;
  noShowResolution?: {
    decision: 'OVERTURN_FLAG' | 'UPHOLD_FLAG' | 'NO_ACTION' | null;
    decidedAt: string | null;
  } | null;
  // CLEAN-SWEEP G1 — the shared type, not a tenth hand-copy of it. The
  // guard below is the shared predicate, and a predicate cannot narrow a
  // structurally-identical local twin.
  commissionBreakdown?: WireCommissionBreakdown;
}

// CLEAN-SWEEP G5/§0.7 — THE TWO ENTRANCES TO ScheduledRidePage.
//
// A customer reaches the same screen from two surfaces, on two different
// queries, and neither knows about the other. This is documented rather
// than consolidated: "different surfaces, different queries, no
// duplicated component" is the accepted state, and the next
// scheduled-rides dispatch should know it before it starts rather than
// discover it halfway through.
//
//   1. THE HOME SHEET — components/journey/UpcomingRidesSection.tsx, on
//      GET /api/scheduled-rides/customer. A dedicated endpoint: the
//      server filters to future bookingMode=SCHEDULED rides and orders
//      them soonest-first, and the section renders nothing when empty.
//   2. THE RIDES LIST — pages/shared/HistoryPage.tsx ("My Journey"), on
//      GET /api/journeys?history=true. Still not a time filter: on the
//      CUSTOMER arm `history` is read and deliberately ignored, because
//      `customerId: userId` already IS her rides, so getJourneys returns
//      every journey of this customer and the screen PARTITIONS what it
//      already has (isUpcomingScheduledRide). This is the surface the
//      field reporter actually opened (team item lmHAk6VU-3).
//
//      RIDES-REACH G1 — what DID change: `history` is a declared key now
//      (journeyQuerySchema), and on the DRIVER arm it means "my rides"
//      and selects `where: { driverId }` with no coordinates required.
//      Until then Zod stripped it, so a motari opening this same tab
//      sent what looked like a coordinate-less discovery query and got
//      400 LOCATION_REQUIRED — the tab was an ErrorState for every
//      DRIVER-role account.
//
// Both navigate to /journey/:id/scheduled and share ScheduledRidePage
// itself — there is no duplicated component, only duplicated reach. The
// consequence that matters: a filtering change made on one entrance does
// NOT reach the other. CLEAN-SWEEP G2 widened the rides-list partition to
// survive the SCHEDULED -> REQUESTED window flip; the home sheet survives
// that flip for an unrelated reason — its server-side filter is already
// `status IN (SCHEDULED, REQUESTED, MATCHED) AND scheduledFor > now`
// (routes/scheduled-ride.routes.ts:113-122). Two mechanisms, one
// behaviour, and no test spans both.
//
// They are not the same set, either: the home sheet keeps a MATCHED ride
// (it is still upcoming), while the rides list deliberately hands a
// matched ride to the ordinary journey surfaces. Same screen, two
// reaches, two different answers to "which rides are upcoming" — which is
// the thing to decide deliberately before either is changed again.
/**
 * CLEAN-SWEEP G2 — a booked-for-later ride, before it has a driver.
 *
 * GAP-CLOSE partitioned on `status === 'SCHEDULED'` alone, and the
 * bid-window-opener job (jobs/bid-window-opener.job.ts) flips
 * SCHEDULED -> REQUESTED an hour before pickup. At that flip the row fell
 * out of Upcoming and landed in the history list below — an inert row
 * that expands to nothing and opens nothing, which is exactly the dead
 * state GAP-CLOSE had just cured for SCHEDULED. The customer lost the
 * ride at the moment it started attracting bids.
 *
 * So the predicate is scheduled-ORIGIN and pre-match, not one status:
 * `scheduledFor != null` is what makes it a booked-for-later ride at all
 * (an instant hail has no such column), and the two statuses are the two
 * it passes through before a driver exists. The row survives the flip in
 * place, and the tap keeps working: ScheduledRidePage redirects to the
 * bid list the moment it reads status REQUESTED
 * (ScheduledRidePage.tsx:42-45), which is where a customer with live bids
 * should be.
 *
 * MATCHED onwards is deliberately NOT here. Once a ride has a driver it
 * belongs to the ordinary journey surfaces, and its history row is a real
 * row with a real outcome.
 *
 * BOTH-RIDES/D28 — this predicate is applied to the PASSENGER list ONLY,
 * and that is load-bearing. A BOTH account now also fetches the rides it
 * DROVE, and a ride a motari drives for a passenger who booked it for
 * later carries `scheduledFor` on the same journey row. #208 pinned that
 * such a row stays out of Upcoming because it is MATCHED-or-later, but
 * the cheaper guarantee is structural: the driven list is never fed to
 * this filter at all (see `upcoming` below, which reads `journeys` and
 * never `driven`).
 */
function isUpcomingScheduledRide(j: Journey): boolean {
  return (
    j.scheduledFor != null &&
    (j.status === JourneyStatus.SCHEDULED || j.status === JourneyStatus.REQUESTED)
  );
}

// BOTH-RIDES/D28 — hoisted out of the component unchanged. They close
// over nothing, and both sections' rows now format the same way because
// they run the same function rather than a copy of it.
const formatDate = (dateStr: string) => {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
};

const formatTime = (dateStr: string) => {
  const d = new Date(dateStr);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

/**
 * BOTH-RIDES/D28 — ONE ROW, TWO SECTIONS.
 *
 * This is the history row exactly as it stood inline in `past.map(...)`,
 * lifted into a component so the motari section can render the same row
 * rather than a second copy of it. Nothing about the markup, the
 * testids, the guards or the order of the two money blocks changed: it
 * is a move, and the pure-role DOM is byte-identical to #208's.
 *
 * The reason it can serve both lists unchanged is the standing pattern
 * this screen already runs on — SHAPE, NOT ROLE. A driven row carries
 * the full settlement breakdown and renders the driver block
 * (`hasFullCommissionBreakdown`); a passenger row carries the
 * customer-safe four and renders the #207 variant. Neither block asks
 * who is looking; the payload already said.
 */
interface JourneyRowProps {
  journey: Journey;
  isExpanded: boolean;
  onToggle: () => void;
}

const JourneyRow: React.FC<JourneyRowProps> = ({ journey, isExpanded, onToggle }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="bg-white rounded-xl shadow-sm overflow-hidden">
      <button
        onClick={onToggle}
        data-testid={`history-row-${journey.id}`}
        className="w-full p-4 text-left hover:shadow-md transition-shadow"
      >
        {/* Date & Status */}
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-gray-500">
            {formatDate(journey.createdAt)} {formatTime(journey.createdAt)}
          </span>
          <div className="flex items-center gap-1.5">
            <CustomerJourneyOutcomeBadge
              cancelReason={journey.cancelReason}
              cancelledAt={journey.cancelledAt}
              driverDisputedAt={journey.driverDisputedAt}
              noShowResolution={journey.noShowResolution}
            />
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              STATUS_COLORS[journey.status as JourneyStatus] || 'bg-gray-100 text-gray-500'
            }`}>
              {t(`status.${journey.status}`)}
            </span>
          </div>
        </div>

        {/* Route */}
        <div className="space-y-1 mb-2">
          <div className="flex items-center gap-2 text-sm text-gray-700">
            <svg className="w-3 h-3 text-green-700 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <circle cx="10" cy="10" r="5" />
            </svg>
            <span className="truncate">{journey.pickupName}</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-700">
            <svg className="w-3 h-3 text-red-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <circle cx="10" cy="10" r="5" />
            </svg>
            <span className="truncate">{journey.destinationName}</span>
          </div>
        </div>

        {/* Price & Rating */}
        <div className="flex items-center justify-between">
          {journey.agreedPrice ? (
            <div>
              <span className="text-sm font-bold text-[#1B4F72]">
                {journey.agreedPrice.toLocaleString()} RWF
              </span>
              {hasFullCommissionBreakdown(journey.commissionBreakdown) && (
                journey.commissionBreakdown.feeWaiverApplied ? (
                  <span className="text-[10px] text-green-700 ml-2" data-testid="fee-waived-chip">
                    {t('transparency.feeWaivedChip')}
                  </span>
                ) : (
                  <span className="text-[10px] text-gray-500 ml-2">
                    {t('transparency.platformFee')} {(journey.commissionBreakdown.totalCommissionRate * 100).toFixed(1)}%
                  </span>
                )
              )}
              {/* MONEY-VIEW v2 G3 — the CUSTOMER's chip. She gets
                  the waiver as a fact and never a rate: the rate
                  times the price IS the commission, which is the
                  number #202 exists to withhold. */}
              {!hasFullCommissionBreakdown(journey.commissionBreakdown) &&
                hasCustomerSafeCommission(journey.commissionBreakdown) &&
                journey.commissionBreakdown.feeWaiverApplied && (
                  <span
                    className="text-[10px] text-green-700 ml-2"
                    data-testid="fee-waived-chip"
                  >
                    {t('transparency.feeWaivedChip')}
                  </span>
                )}
            </div>
          ) : (
            <span className="text-sm text-gray-500">-</span>
          )}

          {journey.rating && (
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <svg
                  key={star}
                  className={`w-3.5 h-3.5 ${
                    star <= journey.rating! ? 'text-yellow-400' : 'text-gray-200'
                  }`}
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
              ))}
            </div>
          )}
        </div>
      </button>

      {/* Expanded commission breakdown (D7, C6). MONEY-UX G1 —
          the panel also opens for COMPLETED rides whose list
          payload carries no breakdown, so the receipt link
          below stays reachable. */}
      {isExpanded && (hasFullCommissionBreakdown(journey.commissionBreakdown) || hasCustomerSafeCommission(journey.commissionBreakdown) || journey.status === 'COMPLETED') && (
        <div className="px-4 pb-4 pt-0 border-t border-gray-100">
          {hasFullCommissionBreakdown(journey.commissionBreakdown) && (
          <div className="space-y-1.5 text-xs pt-3">
            <div className="flex justify-between">
              <span className="text-gray-500">{t('transparency.totalPaid')}</span>
              <span className="font-medium">{journey.commissionBreakdown.bidPrice.toLocaleString()} RWF</span>
            </div>
            {journey.commissionBreakdown.feeWaiverApplied ? (
              <div className="flex justify-between">
                <span className="text-gray-500">{t('transparency.platformFee')} ({(journey.commissionBreakdown.totalCommissionRate * 100).toFixed(1)}%)</span>
                <span className="text-green-700" data-testid="fee-waived-amount">
                  {t('transparency.feeWaivedAmount', { amount: journey.commissionBreakdown.totalCommissionAmount.toLocaleString() })}
                </span>
              </div>
            ) : (
              <>
                <div className="flex justify-between">
                  <span className="text-gray-500">{t('transparency.driverCommission', { tier: journey.commissionBreakdown.driverTier, rate: (journey.commissionBreakdown.driverCommissionRate * 100).toFixed(1) })}</span>
                  <span className="text-red-600">-{Math.round(journey.commissionBreakdown.bidPrice * journey.commissionBreakdown.driverCommissionRate).toLocaleString()} RWF</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">{t('transparency.customerCommission', { tier: journey.commissionBreakdown.customerTier, rate: (journey.commissionBreakdown.customerCommissionRate * 100).toFixed(1) })}</span>
                  <span className="text-red-600">-{Math.round(journey.commissionBreakdown.bidPrice * journey.commissionBreakdown.customerCommissionRate).toLocaleString()} RWF</span>
                </div>
              </>
            )}
            <hr />
            <div className="flex justify-between font-medium">
              <span className="text-gray-700">{t('transparency.netReceived')}</span>
              <span className="text-[#1B4F72]">{journey.commissionBreakdown.driverPayout.toLocaleString()} RWF</span>
            </div>
          </div>
          )}

          {/* MONEY-VIEW v2 G3 — the CUSTOMER VARIANT, the same
              one CLEAN-SWEEP G1 built for MatchedPage and for the
              same reason: the server hands a passenger the
              customer-safe FOUR, and the full block above reads
              driverPayout, rates and the commission total, none
              of which she has. So she gets her tier, what it
              saved her, and whether the fee was waived — and no
              zeros standing in for the rest, because a fabricated
              0 is a lie about what the motari is paid.

              The waiver line names no amount: the amount IS
              totalCommissionAmount, the field the redaction
              exists to withhold. Ordered after the full block and
              mutually exclusive with it, so a driver's row (which
              satisfies both predicates, the full shape being a
              superset) renders the full block only. */}
          {!hasFullCommissionBreakdown(journey.commissionBreakdown) &&
            hasCustomerSafeCommission(journey.commissionBreakdown) && (
              <div
                className="space-y-1.5 text-xs pt-3"
                data-testid={`history-transparency-customer-${journey.id}`}
              >
                <div className="flex justify-between">
                  <span className="text-gray-500">{t('transparency.totalPaid')}</span>
                  <span className="font-medium">
                    {journey.commissionBreakdown.bidPrice.toLocaleString()} RWF
                  </span>
                </div>
                <p className="text-caption text-gray-500">
                  {t('transparency.customerTierLine', {
                    tier: journey.commissionBreakdown.customerTier,
                  })}
                </p>
                {journey.commissionBreakdown.customerSavings > 0 && (
                  <p className="text-caption text-green-700">
                    {t('transparency.tierSavings', {
                      tier: journey.commissionBreakdown.customerTier,
                      amount: journey.commissionBreakdown.customerSavings,
                    })}
                  </p>
                )}
                {journey.commissionBreakdown.feeWaiverApplied && (
                  <p
                    className="text-caption text-green-700"
                    data-testid={`history-fee-waived-${journey.id}`}
                  >
                    {t('transparency.customerFeeWaived')}
                  </p>
                )}
              </div>
            )}

          {/* MONEY-UX G1 — full receipt for completed rides. */}
          {journey.status === 'COMPLETED' && (
            <button
              onClick={() => navigate(`/journey/${journey.id}/receipt`)}
              data-testid={`history-receipt-link-${journey.id}`}
              className="mt-3 w-full min-h-[44px] rounded-lg border border-[#1B4F72]/30 text-sm font-medium text-[#1B4F72] hover:bg-[#1B4F72]/5 transition-colors"
            >
              {t('receipt.viewReceipt')}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export const HistoryPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { showToast } = useUIStore();

  // BOTH-RIDES/D28 — the ONE role read on this screen, and it reads the
  // store exactly the way BottomNav does (`user?.role`, compared against
  // the literal 'BOTH'): `User.role` is typed `string` in auth.store.ts,
  // and BottomNav's NAV_TABS_BY_ROLE is the authority on the three values
  // it can carry. No shared enum is imported, because no client file
  // imports one today and this dispatch is not the place to start.
  //
  // Everything else on the screen stays shape-driven. The role decides
  // ONE thing — whether a second list is fetched and sectioned — and
  // never how a row is rendered. A pure CUSTOMER and a pure DRIVER take
  // the same path they took at #208, one fetch and no headers.
  const user = useAuthStore((s) => s.user);
  const isBoth = user?.role === 'BOTH';

  const [journeys, setJourneys] = useState<Journey[]>([]);
  // BOTH-RIDES/D28 — the rides he DROVE. Stays empty for every pure role,
  // because the fetch that fills it is not issued for them.
  const [driven, setDriven] = useState<Journey[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // NET-UX G3 — a failed load is its own state, never a fake "no rides".
  const [loadFailed, setLoadFailed] = useState(false);
  // BOTH-RIDES/D28 — the driven list's OWN failure. Two lists, two
  // fetches, two failure flags: one arm erroring must not blank the
  // other, so a BOTH account whose driver call 500s still sees every
  // ride she took, under a section-local ErrorState for the half that
  // did not arrive.
  const [drivenLoadFailed, setDrivenLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    // BOTH-RIDES/D28 — the passenger fetch, UNCHANGED. Same path, same
    // credentials, same error handling; a BOTH account's call carries no
    // `viewAs`, so getJourneys resolves effectiveRole 'customer' and this
    // is her rides, exactly as before.
    const fetchPassengerRides = async () => {
      try {
        const res = await apiFetch(`/api/journeys?history=true`, {
          credentials: 'include',
        });
        if (!res.ok) throw await apiErrorFromResponse(res);
        const data = await res.json();
        setJourneys(data);
      } catch (err) {
        setLoadFailed(true);
        presentApiError(err);
      }
    };

    // BOTH-RIDES/D28 — the second knock, and the whole server-side change
    // this dispatch needs: none.
    //
    // `viewAs=driver` is a declared key (journeyQuerySchema) that the
    // handler passes straight through, and getJourneys reads it BEFORE
    // the BOTH-defaults-to-customer rule — `viewAs || (role === BOTH ?
    // 'customer' : ...)`. So this resolves effectiveRole 'driver', and
    // `history=true` takes #208's own-rides branch: `where: { driverId:
    // userId }`, no coordinate required, the settlement view attached to
    // the rows he drove. The door has been open since #208; the page
    // just never knocked.
    const fetchDrivenRides = async () => {
      try {
        const res = await apiFetch(`/api/journeys?viewAs=driver&history=true`, {
          credentials: 'include',
        });
        if (!res.ok) throw await apiErrorFromResponse(res);
        const data = await res.json();
        setDriven(data);
      } catch (err) {
        setDrivenLoadFailed(true);
        presentApiError(err);
      }
    };

    const fetchHistory = async () => {
      setIsLoading(true);
      setLoadFailed(false);
      setDrivenLoadFailed(false);
      // Parallel, and independently caught: neither promise can reject,
      // so `Promise.all` here is "both have settled", not "both
      // succeeded". A pure role issues exactly ONE request — the second
      // is not merely ignored, it is never made.
      await Promise.all([fetchPassengerRides(), ...(isBoth ? [fetchDrivenRides()] : [])]);
      setIsLoading(false);
    };

    fetchHistory();
  }, [showToast, t, reloadKey, isBoth]);

  // GAP-CLOSE G3 — the re-access hole (team item lmHAk6VU-3: "when you
  // leave the confirmation page of a scheduled ride you cannot access it
  // back").
  //
  // No second query: GET /api/journeys?history=true is NOT filtered to
  // past rides. `history` is a declared key now (RIDES-REACH G1), but on
  // the CUSTOMER arm it is read and ignored — `customerId: userId` is
  // already her whole answer — so getJourneys still runs with status
  // undefined and returns EVERY journey of this customer, SCHEDULED rows
  // included.
  // They have been arriving all along and rendering as inert history rows
  // that expand to nothing and open nothing. So this partitions what is
  // already here rather than fetching it twice (CustomerHomePage's
  // UpcomingRidesSection is the other entrance, on GET
  // /api/scheduled-rides/customer; this is the surface the reporter
  // actually opened — the "My Journey" tab).
  //
  // BOTH-RIDES/D28 — it partitions `journeys`, the PASSENGER list, and
  // nothing else. `driven` is not in this expression and must not enter
  // it: a ride a motari drove for somebody who booked it for later
  // carries `scheduledFor` on the same row, and Upcoming is a passenger's
  // own booking, not a shift he is about to work.
  const upcoming = journeys
    .filter(isUpcomingScheduledRide)
    .sort((a, b) => {
      // Soonest first. A row without scheduledFor cannot be ordered by it
      // and sinks below the ones that can.
      const at = a.scheduledFor ? new Date(a.scheduledFor).getTime() : Infinity;
      const bt = b.scheduledFor ? new Date(b.scheduledFor).getTime() : Infinity;
      return at - bt;
    });
  // The exact complement, so a row is in one list or the other and never
  // in both: the partition is `p` and `!p`, not two independent filters.
  const past = journeys.filter((j) => !isUpcomingScheduledRide(j));

  // BOTH-RIDES/D28 — the driven list is PLAIN: no Upcoming partition, no
  // second bucket, newest first. The server already orders the own-rides
  // branch `createdAt: desc`; sorting here too makes the promise the
  // page's own rather than a detail of the arm that answered it.
  const drivenNewestFirst = [...driven].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  // BOTH-RIDES/D28 — the ENTIRE existing render tree, lifted into a
  // binding and not otherwise touched: the load-failure state, the
  // empty state, the Upcoming section and the past list, in that order
  // and with those exact guards. A pure role renders this in the same
  // slot it has always occupied, so its DOM is unchanged.
  const passengerBody = loadFailed ? (
    <ErrorState onRetry={() => setReloadKey((k) => k + 1)} />
  ) : journeys.length === 0 ? (
    <EmptyState title={t('history.empty')} body={t('history.emptyHint')} />
  ) : (
    <>
    {upcoming.length > 0 && (
      <div className="mb-6" data-testid="history-upcoming-section">
        <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-2">
          {t('scheduled.upcomingTitle')}
        </h2>
        <div className="space-y-2">
          {upcoming.map((ride) => (
            <button
              key={ride.id}
              type="button"
              onClick={() => navigate(`/journey/${ride.id}/scheduled`)}
              data-testid={`history-upcoming-row-${ride.id}`}
              className="w-full text-left p-3 min-h-[44px] rounded-xl bg-white border border-gray-200 shadow-sm hover:shadow-md transition-shadow"
            >
              <p className="text-sm font-semibold text-[#1B4F72]">
                {ride.scheduledFor ? formatScheduledDateTime(ride.scheduledFor) : ''}
              </p>
              <p className="text-xs text-gray-600 truncate mt-0.5">
                {ride.destinationName}
              </p>
            </button>
          ))}
        </div>
      </div>
    )}
    <div className="space-y-3">
      {past.map((journey) => (
        <JourneyRow
          key={journey.id}
          journey={journey}
          isExpanded={expandedId === journey.id}
          onToggle={() => setExpandedId(expandedId === journey.id ? null : journey.id)}
        />
      ))}
    </div>
    </>
  );

  // BOTH-RIDES/D28 — the motari half. Built ONLY when the account is
  // BOTH (a pure role never evaluates it, and never renders a header).
  //
  // An empty driven list renders the empty state rather than nothing:
  // D28 exists so the screen tells the whole truth, and a section that
  // silently vanishes when it has no rows is the screen quietly
  // choosing which half of a dual-role account to admit to. The hint
  // line is deliberately omitted here — `history.emptyHint` says
  // "Request your first ride", which is the passenger's instruction and
  // false advice for a motari with no completed jobs.
  const motariBody = drivenLoadFailed ? (
    <ErrorState
      onRetry={() => setReloadKey((k) => k + 1)}
      data-testid="history-driven-error"
    />
  ) : drivenNewestFirst.length === 0 ? (
    <EmptyState title={t('history.empty')} data-testid="history-driven-empty" />
  ) : (
    <div className="space-y-3">
      {drivenNewestFirst.map((journey) => (
        <JourneyRow
          key={journey.id}
          journey={journey}
          isExpanded={expandedId === journey.id}
          onToggle={() => setExpandedId(expandedId === journey.id ? null : journey.id)}
        />
      ))}
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-6">
      <div className="w-full max-w-sm mx-auto">
        <h1 className="text-xl font-bold text-[#1B4F72] mb-6">
          {t('history.title')}
        </h1>

        {/* BOTH-RIDES/D28 — the fork, and the only one on this screen.
            A legacy BOTH account gets two labelled sections; every pure
            role gets `passengerBody` in the exact slot it has always
            rendered in, with no wrapper and no header above it. */}
        {isBoth ? (
          <>
            <div className="mb-6" data-testid="history-section-passenger">
              <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-2">
                {t('history.sectionAsPassenger')}
              </h2>
              {passengerBody}
            </div>
            <div data-testid="history-section-motari">
              <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-2">
                {t('history.sectionAsMotari')}
              </h2>
              {motariBody}
            </div>
          </>
        ) : (
          passengerBody
        )}
      </div>
    </div>
  );
};

export default HistoryPage;
