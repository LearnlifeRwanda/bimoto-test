// COMPONENTS/DRIVER/RATING-DISTRIBUTION.TSX
//
// Dispatch R3-DRIVER-TIER-STATS-2 — customer-rating histogram on the
// expanded driver-stats card. 5 rows (5★ at top → 1★ at bottom),
// each row's bar width proportional to count / max-bucket. Color-
// codes the buckets so the driver reads "good" vs "bad" at a glance:
// 4-5★ green, 3★ yellow, 1-2★ red.

import React from 'react';

export interface RatingDistributionData {
  1: number;
  2: number;
  3: number;
  4: number;
  5: number;
}

interface RatingDistributionProps {
  distribution: RatingDistributionData;
  ariaLabel: string;
}

const BUCKETS: Array<keyof RatingDistributionData> = [5, 4, 3, 2, 1];

function colorForStar(star: number): string {
  if (star >= 4) return '#22c55e';
  if (star >= 3) return '#eab308';
  return '#ef4444';
}

export const RatingDistribution: React.FC<RatingDistributionProps> = ({
  distribution,
  ariaLabel,
}) => {
  const max = Math.max(
    distribution[1],
    distribution[2],
    distribution[3],
    distribution[4],
    distribution[5],
    1,
  );

  return (
    <div
      className="rating-distribution flex flex-col gap-1"
      role="img"
      aria-label={ariaLabel}
      data-testid="driver-stats-rating-dist"
    >
      {BUCKETS.map((star) => {
        const count = distribution[star];
        const widthPct = (count / max) * 100;
        return (
          <div
            key={star}
            className="flex items-center gap-2 text-xs"
            data-testid={`rating-dist-row-${star}`}
          >
            <span
              className="w-10 shrink-0 text-gray-700 tabular-nums"
              aria-hidden
            >
              {'★'.repeat(star)}
            </span>
            <div className="flex-1 h-3 bg-gray-200 rounded overflow-hidden">
              <div
                className="h-full rounded"
                style={{
                  width: `${widthPct}%`,
                  backgroundColor: colorForStar(star),
                  minWidth: count > 0 ? 2 : 0,
                }}
                data-testid={`rating-dist-bar-${star}`}
              />
            </div>
            <span
              className="w-6 shrink-0 text-right text-gray-700 tabular-nums"
              data-testid={`rating-dist-count-${star}`}
            >
              {count}
            </span>
          </div>
        );
      })}
    </div>
  );
};

export default RatingDistribution;
