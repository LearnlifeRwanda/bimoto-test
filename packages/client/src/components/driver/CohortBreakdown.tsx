// COMPONENTS/DRIVER/COHORT-BREAKDOWN.TSX
//
// Dispatch R3-DRIVER-TIER-STATS-2 — per-VehicleType cohort breakdown
// on the expanded driver-stats card. Tabular layout: one row per
// VehicleType the driver participates in, showing the cohort's
// median acceptance / completion / weekly-earnings against which the
// driver can self-compare.
//
// For v1 most drivers have a single VehicleType so the table has
// one row — but the shape is forward-compatible with multi-vehicle
// drivers that a future enhancement may surface. Median fields can
// be null when the cohort is below the min-size threshold; that
// renders as "—".

import React from 'react';

export interface CohortBreakdownRow {
  vehicleType: string;
  isDriverOwnVehicleType: boolean;
  cohortMedianAcceptanceRate: number | null;
  cohortMedianCompletionRate: number | null;
  cohortMedianWeeklyEarningsRwf: number | null;
  cohortDriverCount: number;
}

interface CohortBreakdownProps {
  rows: CohortBreakdownRow[];
  acceptanceLabel: string;
  completionLabel: string;
  earningsLabel: string;
  cohortSizeLabel: (n: number) => string;
}

function formatPct(value: number | null): string {
  if (value === null) return '—';
  return `${Math.round(value * 100)}%`;
}

function formatRwf(value: number | null): string {
  if (value === null) return '—';
  return `RWF ${value.toLocaleString()}`;
}

export const CohortBreakdown: React.FC<CohortBreakdownProps> = ({
  rows,
  acceptanceLabel,
  completionLabel,
  earningsLabel,
  cohortSizeLabel,
}) => {
  if (rows.length === 0) return null;

  return (
    <div
      className="cohort-breakdown space-y-2"
      data-testid="driver-stats-cohort-breakdown"
    >
      {rows.map((row) => (
        <div
          key={row.vehicleType}
          className="bg-white rounded-lg p-3 shadow-sm"
          data-testid={`cohort-row-${row.vehicleType}`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-gray-900">
              {row.vehicleType}
            </span>
            <span className="text-xs text-gray-500">
              {cohortSizeLabel(row.cohortDriverCount)}
            </span>
          </div>
          <dl className="grid grid-cols-3 gap-2 text-xs">
            <div>
              <dt className="text-gray-500">{acceptanceLabel}</dt>
              <dd
                className="font-medium text-gray-900 mt-0.5 tabular-nums"
                data-testid={`cohort-row-${row.vehicleType}-acceptance`}
              >
                {formatPct(row.cohortMedianAcceptanceRate)}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">{completionLabel}</dt>
              <dd
                className="font-medium text-gray-900 mt-0.5 tabular-nums"
                data-testid={`cohort-row-${row.vehicleType}-completion`}
              >
                {formatPct(row.cohortMedianCompletionRate)}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">{earningsLabel}</dt>
              <dd
                className="font-medium text-gray-900 mt-0.5 tabular-nums"
                data-testid={`cohort-row-${row.vehicleType}-earnings`}
              >
                {formatRwf(row.cohortMedianWeeklyEarningsRwf)}
              </dd>
            </div>
          </dl>
        </div>
      ))}
    </div>
  );
};

export default CohortBreakdown;
