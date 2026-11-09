// COMPONENTS/DRIVER/DRIVER-STATS-CARD.TSX
//
// Dispatch R3-DRIVER-TIER-STATS — driver self-assessment widget on
// the Dashboard. Fetches /api/driver/stats once on mount and renders
// a 4-stat grid (acceptance rate, avg acceptance time, completion
// rate, weekly earnings vs cohort median).
//
// Null ratio fields render as "No data yet" rather than "0%" so a
// driver who hasn't bid anything in the window doesn't see a
// misleading zero. The cohort delta strip below the weekly-earnings
// stat only appears when the cohort has >=3 drivers (server-side
// guard) AND the median is positive (avoids divide-by-zero).
//
// Dispatch R3-DRIVER-TIER-STATS-2 — adds an expand toggle below the
// 4-stat grid that reveals four explanatory visualizations
// (sparkline / rating histogram / cancellation pie / per-vehicle
// cohort breakdown). Collapsed by default so a new driver isn't
// overwhelmed; each section is conditionally hidden when the
// underlying data is empty.

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Spinner } from '../ui/Spinner';
import { useAuthStore } from '../../stores/auth.store';
import { StarRating } from '../rating/StarRating';
import { getDriverRatingInfo } from '../../lib/driver-rating';
import { Sparkline } from './Sparkline';
import {
  RatingDistribution,
  RatingDistributionData,
} from './RatingDistribution';
import { CancellationPie } from './CancellationPie';
import { CohortBreakdown, CohortBreakdownRow } from './CohortBreakdown';
import { apiFetch } from '../../lib/api';

export interface DriverStats {
  windowDays: number;
  acceptanceRate: number | null;
  totalBids: number;
  avgAcceptanceTimeMinutes: number | null;
  completionRate: number | null;
  totalTerminalJourneys: number;
  weeklyEarningsRwf: number;
  cohortMedianEarningsRwf: number | null;
  vehicleType: string | null;
  // R3-DRIVER-TIER-STATS-2
  weeklyEarningsTrend?: Array<{ weekStart: string; earningsRwf: number }>;
  customerRatingDistribution?: RatingDistributionData | null;
  totalRatings?: number;
  cancellationReasonsBreakdown?: { [reason: string]: number } | null;
  totalCancelledJourneys?: number;
  cohortBreakdownByVehicleType?: CohortBreakdownRow[];
}

interface StatTileProps {
  label: string;
  value: string;
  detail?: string;
  detailDirection?: 'up' | 'down' | null;
  testId: string;
}

const StatTile: React.FC<StatTileProps> = ({ label, value, detail, detailDirection, testId }) => (
  <div className="bg-white rounded-lg p-3 shadow-sm" data-testid={testId}>
    <div className="text-xs text-gray-500 uppercase tracking-wide">{label}</div>
    <div className="text-xl font-bold text-gray-900 mt-1">{value}</div>
    {detail && (
      <div
        className={`text-xs mt-1 ${
          detailDirection === 'up'
            ? 'text-[#27AE60] font-medium'
            : detailDirection === 'down'
              ? 'text-[#E74C3C] font-medium'
              : 'text-gray-500'
        }`}
        data-delta-direction={detailDirection ?? undefined}
      >
        {detail}
      </div>
    )}
  </div>
);

export const DriverStatsCard: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const [stats, setStats] = useState<DriverStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/api/driver/stats`, {
          credentials: 'include',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: DriverStats = await res.json();
        if (!cancelled) {
          setStats(data);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setError(true);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div
        className="mx-4 mt-4 bg-white rounded-xl shadow-sm p-4 flex justify-center"
        data-testid="driver-stats-card-loading"
      >
        <Spinner size="sm" />
      </div>
    );
  }

  // Graceful degradation: render nothing on fetch error so the
  // dashboard doesn't get an angry red banner for a non-critical
  // widget.
  if (error || !stats) return null;

  const noData = t('driver.stats.noData');

  const acceptanceValue =
    stats.acceptanceRate === null ? noData : `${Math.round(stats.acceptanceRate * 100)}%`;
  const acceptanceDetail = t('driver.stats.acceptanceDenominator', { n: stats.totalBids });

  const acceptanceTimeValue =
    stats.avgAcceptanceTimeMinutes === null
      ? noData
      : t('driver.stats.minutesValue', { n: stats.avgAcceptanceTimeMinutes.toFixed(1) });

  const completionValue =
    stats.completionRate === null ? noData : `${Math.round(stats.completionRate * 100)}%`;
  const completionDetail = t('driver.stats.completionDenominator', { n: stats.totalTerminalJourneys });

  const earningsValue = `RWF ${stats.weeklyEarningsRwf.toLocaleString()}`;

  let earningsDetail: string | undefined;
  let earningsDirection: 'up' | 'down' | null = null;
  if (
    stats.cohortMedianEarningsRwf !== null &&
    stats.cohortMedianEarningsRwf > 0
  ) {
    const deltaPct = Math.round(
      ((stats.weeklyEarningsRwf - stats.cohortMedianEarningsRwf) /
        stats.cohortMedianEarningsRwf) *
        100,
    );
    if (deltaPct >= 0) {
      earningsDetail = t('driver.stats.aboveCohortMedian', { pct: deltaPct });
      earningsDirection = 'up';
    } else {
      earningsDetail = t('driver.stats.belowCohortMedian', { pct: -deltaPct });
      earningsDirection = 'down';
    }
  }

  const trend = stats.weeklyEarningsTrend ?? [];
  const ratingDist = stats.customerRatingDistribution ?? null;
  const totalRatings = stats.totalRatings ?? 0;
  const cancellationBreakdown = stats.cancellationReasonsBreakdown ?? null;
  const totalCancelled = stats.totalCancelledJourneys ?? 0;
  const cohortRows = stats.cohortBreakdownByVehicleType ?? [];

  const hasAnyExtended =
    trend.length >= 2 ||
    ratingDist !== null ||
    cancellationBreakdown !== null ||
    cohortRows.length > 0;

  return (
    <div
      className="mx-4 mt-4 bg-gray-100 rounded-xl p-3"
      data-testid="driver-stats-card"
    >
      <h3 className="text-sm font-semibold text-gray-700 mb-2 px-1">
        {t('driver.stats.title', { windowDays: stats.windowDays })}
      </h3>

      {/* RATE-DISPLAY G3 — the driver's own standing. avgRating /
          totalRides come from the authed profile (the stats endpoint
          returns only the histogram + window aggregates); the shared
          accessor also absorbs the Decimal-as-string avgRating the raw
          profile row serializes to. All-time numbers, so they sit above
          the windowed grid. */}
      {(() => {
        if (!user?.driverProfile) return null;
        const ratingInfo = getDriverRatingInfo(user);
        return (
          <div
            className="bg-white rounded-lg p-3 shadow-sm mb-2"
            data-testid="driver-stats-my-rating"
          >
            <div className="text-xs text-gray-500 uppercase tracking-wide">
              {t('driver.stats.myRating')}
            </div>
            {ratingInfo.avgRating === null ? (
              <div
                className="text-sm text-gray-500 mt-1"
                data-testid="driver-stats-my-rating-empty"
              >
                {t('driver.stats.noRatingsYet')}
              </div>
            ) : (
              <div className="flex items-center gap-2 mt-1">
                <StarRating value={ratingInfo.avgRating} readonly size="sm" />
                <span
                  className="text-xl font-bold text-gray-900"
                  data-testid="driver-stats-my-rating-value"
                >
                  {ratingInfo.avgRating.toFixed(1)}
                </span>
              </div>
            )}
            {ratingInfo.completedRides !== null && (
              <div
                className="text-xs text-gray-500 mt-1"
                data-testid="driver-stats-my-rides"
              >
                {t('reliability.rides', { count: ratingInfo.completedRides })}
              </div>
            )}
          </div>
        );
      })()}

      <div className="grid grid-cols-2 gap-2">
        <StatTile
          label={t('driver.stats.acceptanceRate')}
          value={acceptanceValue}
          detail={acceptanceDetail}
          testId="driver-stats-acceptance"
        />
        <StatTile
          label={t('driver.stats.avgAcceptanceTime')}
          value={acceptanceTimeValue}
          testId="driver-stats-acceptance-time"
        />
        <StatTile
          label={t('driver.stats.completionRate')}
          value={completionValue}
          detail={completionDetail}
          testId="driver-stats-completion"
        />
        <StatTile
          label={t('driver.stats.weeklyEarnings')}
          value={earningsValue}
          detail={earningsDetail}
          detailDirection={earningsDirection}
          testId="driver-stats-earnings"
        />
      </div>

      {hasAnyExtended && (
        <>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="w-full mt-3 py-2 px-3 text-xs font-medium text-gray-700 bg-white rounded-lg shadow-sm hover:bg-gray-50"
            aria-expanded={expanded}
            data-testid="driver-stats-toggle"
          >
            {expanded ? t('driver.stats.hideMore') : t('driver.stats.showMore')}
          </button>

          {expanded && (
            <div
              className="mt-3 space-y-4"
              data-testid="driver-stats-extended"
            >
              {trend.length >= 2 && (
                <section data-testid="driver-stats-extended-trend">
                  <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2 px-1">
                    {t('driver.stats.earningsTrendTitle')}
                  </h4>
                  <div className="bg-white rounded-lg p-3 shadow-sm">
                    <Sparkline
                      data={trend}
                      ariaLabel={t('driver.stats.earningsTrendAria')}
                    />
                  </div>
                </section>
              )}

              {ratingDist && (
                <section data-testid="driver-stats-extended-ratings">
                  <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2 px-1">
                    {t('driver.stats.ratingDistTitle', { n: totalRatings })}
                  </h4>
                  <div className="bg-white rounded-lg p-3 shadow-sm">
                    <RatingDistribution
                      distribution={ratingDist}
                      ariaLabel={t('driver.stats.ratingDistAria')}
                    />
                  </div>
                </section>
              )}

              {cancellationBreakdown && (
                <section data-testid="driver-stats-extended-cancellations">
                  <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2 px-1">
                    {t('driver.stats.cancellationTitle', { n: totalCancelled })}
                  </h4>
                  <div className="bg-white rounded-lg p-3 shadow-sm">
                    <CancellationPie
                      breakdown={cancellationBreakdown}
                      ariaLabel={t('driver.stats.cancellationAria')}
                    />
                  </div>
                </section>
              )}

              {cohortRows.length > 0 && (
                <section data-testid="driver-stats-extended-cohort">
                  <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2 px-1">
                    {t('driver.stats.cohortBreakdownTitle')}
                  </h4>
                  <CohortBreakdown
                    rows={cohortRows}
                    acceptanceLabel={t('driver.stats.acceptanceRate')}
                    completionLabel={t('driver.stats.completionRate')}
                    earningsLabel={t('driver.stats.weeklyEarnings')}
                    cohortSizeLabel={(n) =>
                      t('driver.stats.cohortSize', { n })
                    }
                  />
                </section>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default DriverStatsCard;
