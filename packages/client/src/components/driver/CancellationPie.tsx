// COMPONENTS/DRIVER/CANCELLATION-PIE.TSX
//
// Dispatch R3-DRIVER-TIER-STATS-2 — cancellation-reasons pie on the
// expanded driver-stats card. Wedges colored by category so the
// driver can answer "is it me or is it the customers?" at a glance:
//   DRIVER_*        — red tones (on me)
//   CUSTOMER_*      — blue tones (on them)
//   SAFETY_CONCERN  — purple (separate concern)
//   BOTH_NO_SHOW    — gray
//
// Handles the single-category case (one wedge = 100%) by drawing a
// full circle rather than degenerate arc geometry.

import React from 'react';

interface CancellationPieProps {
  breakdown: { [reason: string]: number };
  ariaLabel: string;
}

function colorForReason(reason: string): string {
  if (reason.startsWith('DRIVER_')) return '#ef4444';
  if (reason.startsWith('CUSTOMER_')) return '#3b82f6';
  if (reason === 'SAFETY_CONCERN') return '#a855f7';
  return '#9ca3af';
}

const CENTER = 50;
const RADIUS = 40;

function pointOnCircle(angleRad: number): [number, number] {
  // -PI/2 rotates so 0 rad sits at 12 o'clock instead of 3 o'clock.
  return [
    CENTER + RADIUS * Math.cos(angleRad - Math.PI / 2),
    CENTER + RADIUS * Math.sin(angleRad - Math.PI / 2),
  ];
}

export const CancellationPie: React.FC<CancellationPieProps> = ({
  breakdown,
  ariaLabel,
}) => {
  const entries = Object.entries(breakdown).filter(([, c]) => c > 0);
  if (entries.length === 0) return null;

  const total = entries.reduce((sum, [, c]) => sum + c, 0);

  // Sort largest-slice-first so the legend reads in order of impact.
  entries.sort((a, b) => b[1] - a[1]);

  // Special case: a single category fills the whole pie. SVG arcs
  // can't represent a 360° wedge with a single path, so draw a circle.
  if (entries.length === 1) {
    const [reason, count] = entries[0];
    return (
      <div
        className="cancellation-pie flex items-start gap-3"
        role="img"
        aria-label={ariaLabel}
        data-testid="driver-stats-cancellation-pie"
      >
        <svg
          viewBox="0 0 100 100"
          style={{ width: 96, height: 96, flexShrink: 0 }}
          aria-hidden
        >
          <circle
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
            fill={colorForReason(reason)}
            data-testid={`pie-wedge-${reason}`}
          />
        </svg>
        <ul className="text-xs flex-1 list-none p-0 m-0 space-y-1">
          <li className="flex items-center gap-2">
            <span
              className="inline-block w-3 h-3 rounded-sm shrink-0"
              style={{ backgroundColor: colorForReason(reason) }}
              aria-hidden
            />
            <span className="text-gray-700">
              {reason} — {count} (100%)
            </span>
          </li>
        </ul>
      </div>
    );
  }

  let cumulative = 0;
  const wedges = entries.map(([reason, count]) => {
    const startAngle = (cumulative / total) * 2 * Math.PI;
    cumulative += count;
    const endAngle = (cumulative / total) * 2 * Math.PI;
    const [x1, y1] = pointOnCircle(startAngle);
    const [x2, y2] = pointOnCircle(endAngle);
    const portion = count / total;
    const largeArc = portion > 0.5 ? 1 : 0;
    const path = `M ${CENTER} ${CENTER} L ${x1.toFixed(3)} ${y1.toFixed(3)} A ${RADIUS} ${RADIUS} 0 ${largeArc} 1 ${x2.toFixed(3)} ${y2.toFixed(3)} Z`;
    return {
      reason,
      count,
      portion,
      path,
      color: colorForReason(reason),
    };
  });

  return (
    <div
      className="cancellation-pie flex items-start gap-3"
      role="img"
      aria-label={ariaLabel}
      data-testid="driver-stats-cancellation-pie"
    >
      <svg
        viewBox="0 0 100 100"
        style={{ width: 96, height: 96, flexShrink: 0 }}
        aria-hidden
      >
        {wedges.map((w) => (
          <path
            key={w.reason}
            d={w.path}
            fill={w.color}
            stroke="#ffffff"
            strokeWidth="0.5"
            data-testid={`pie-wedge-${w.reason}`}
          />
        ))}
      </svg>
      <ul className="text-xs flex-1 list-none p-0 m-0 space-y-1">
        {wedges.map((w) => (
          <li key={w.reason} className="flex items-center gap-2">
            <span
              className="inline-block w-3 h-3 rounded-sm shrink-0"
              style={{ backgroundColor: w.color }}
              aria-hidden
            />
            <span className="text-gray-700">
              {w.reason} — {w.count} ({Math.round(w.portion * 100)}%)
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default CancellationPie;
