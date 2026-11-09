// COMPONENTS/DRIVER/SPARKLINE.TSX
//
// Dispatch R3-DRIVER-TIER-STATS-2 — 4-week weekly-earnings trend
// micro-chart on the expanded driver-stats card. Pure SVG, no chart
// library; the bundle is mobile-targeted and a chart lib would dwarf
// the chart's actual byte footprint.
//
// Renders nothing when fewer than 2 data points exist (a 1-point
// "line" is meaningless). The most recent point gets a filled dot so
// the eye lands on "where am I right now". The y-axis baseline is
// zero (not min(data)) so a flat trend reads as flat, not as growth
// off a non-zero floor.

import React from 'react';

interface SparklinePoint {
  weekStart: string;
  earningsRwf: number;
}

interface SparklineProps {
  data: SparklinePoint[];
  ariaLabel: string;
}

export const Sparkline: React.FC<SparklineProps> = ({ data, ariaLabel }) => {
  if (data.length < 2) return null;

  const maxEarnings = Math.max(...data.map((d) => d.earningsRwf), 1);
  const yMax = maxEarnings * 1.1; // 10% headroom so the peak doesn't kiss the top edge

  const points = data
    .map((d, i) => {
      const x = (i / (data.length - 1)) * 100;
      const y = 50 - (d.earningsRwf / yMax) * 50;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  const last = data[data.length - 1];
  const lastX = 100;
  const lastY = 50 - (last.earningsRwf / yMax) * 50;

  return (
    <svg
      viewBox="0 0 100 50"
      preserveAspectRatio="none"
      style={{ width: '100%', height: 50, overflow: 'visible' }}
      role="img"
      aria-label={ariaLabel}
      data-testid="driver-stats-sparkline"
    >
      <polyline
        points={points}
        fill="none"
        stroke="#2E75B6"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle
        cx={lastX}
        cy={lastY}
        r="2.5"
        fill="#2E75B6"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
};

export default Sparkline;
