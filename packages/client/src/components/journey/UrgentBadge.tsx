// COMPONENTS/JOURNEY/URGENT-BADGE.TSX
//
// R3-T / R3-PRIORITY — visual marker for the two faster-than-normal
// goods journey types. Renders a small pill on driver-side journey
// cards (bid list, dashboard, approach pages) so the driver can spot
// urgent + priority jobs at a glance. Returns null for any other
// journey type so callers can drop it into a card unconditionally.
//
// R3-EXPRESS — when matchedAt is provided, the badge renders an
// escalation indicator showing "waiting Nm" that grows from the
// fresh palette through approaching to overdue. The thresholds
// differ by tier:
//   URGENT  — 5 min / 10 min (tighter SLA window)
//   PRIORITY — 10 min / 20 min (no SLA window, looser display only)
// Re-renders every 60 s while mounted so the elapsed counter stays
// accurate without parent re-render. Cap at 999 minutes to avoid
// degenerate display.

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

export type UrgencyTier = 'fresh' | 'approaching' | 'overdue';
export type BadgeTier = 'URGENT' | 'PRIORITY';

const TIER_THRESHOLDS: Record<BadgeTier, { approaching: number; overdue: number }> = {
  URGENT: { approaching: 5, overdue: 10 },
  PRIORITY: { approaching: 10, overdue: 20 },
};

export function urgencyTier(
  minutes: number,
  tier: BadgeTier = 'URGENT',
): UrgencyTier {
  const thresholds = TIER_THRESHOLDS[tier];
  if (minutes >= thresholds.overdue) return 'overdue';
  if (minutes >= thresholds.approaching) return 'approaching';
  return 'fresh';
}

interface Props {
  journeyType: string | null | undefined;
  size?: 'sm' | 'md';
  // R3-EXPRESS — optional. When set, the badge renders an elapsed
  // "waiting Nm" pill alongside the label and escalates colour as
  // the wait grows. Accepts a Date instance OR an ISO string from
  // the API payload.
  matchedAt?: Date | string | null;
}

const URGENT_TONES: Record<UrgencyTier, string> = {
  fresh: 'bg-red-100 text-red-800',
  approaching: 'bg-amber-100 text-amber-900',
  overdue: 'bg-red-200 text-red-900',
};

const PRIORITY_TONES: Record<UrgencyTier, string> = {
  fresh: 'bg-amber-100 text-amber-800',
  approaching: 'bg-amber-200 text-amber-900',
  overdue: 'bg-orange-200 text-orange-900',
};

function tierForJourneyType(
  journeyType: string | null | undefined,
): BadgeTier | null {
  if (journeyType === 'URGENT_MESSENGER') return 'URGENT';
  if (journeyType === 'PRIORITY_MESSENGER') return 'PRIORITY';
  return null;
}

export const UrgentBadge: React.FC<Props> = ({
  journeyType,
  size = 'md',
  matchedAt = null,
}) => {
  const { t } = useTranslation();
  const [now, setNow] = useState<number>(() => Date.now());

  const badgeTier = tierForJourneyType(journeyType);

  useEffect(() => {
    if (!badgeTier || !matchedAt) return;
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [badgeTier, matchedAt]);

  if (!badgeTier) return null;

  const matchedAtMs = matchedAt
    ? matchedAt instanceof Date
      ? matchedAt.getTime()
      : new Date(matchedAt).getTime()
    : null;
  const minutes =
    matchedAtMs !== null && Number.isFinite(matchedAtMs)
      ? Math.min(999, Math.max(0, Math.floor((now - matchedAtMs) / 60_000)))
      : null;
  const escalation: UrgencyTier =
    minutes !== null ? urgencyTier(minutes, badgeTier) : 'fresh';

  const sizeClass =
    size === 'sm'
      ? 'text-[10px] px-1.5 py-0.5'
      : 'text-xs px-2 py-1';
  const toneClass =
    badgeTier === 'PRIORITY'
      ? PRIORITY_TONES[escalation]
      : URGENT_TONES[escalation];

  const labelKey = badgeTier === 'PRIORITY' ? 'priority.badge' : 'urgent.badge';
  const ariaKey =
    badgeTier === 'PRIORITY' ? 'priority.badgeAriaLabel' : 'urgent.badgeAriaLabel';
  const waitingMinutesKey =
    badgeTier === 'PRIORITY' ? 'priority.waitingMinutes' : 'urgent.waitingMinutes';

  // The data-tier attribute combines escalation level with the badge
  // tier so CSS / tests can target priority-specific styles without
  // breaking R3-EXPRESS's existing `fresh|approaching|overdue` selector.
  const dataTier =
    badgeTier === 'PRIORITY' ? `priority-${escalation}` : escalation;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md font-bold ${toneClass} ${sizeClass}`}
      role="status"
      aria-label={t(ariaKey)}
      data-testid="urgent-badge"
      data-tier={dataTier}
      data-badge-tier={badgeTier}
    >
      <span data-testid="urgent-badge-label">{t(labelKey)}</span>
      {minutes !== null && (
        <span
          className="font-medium opacity-80"
          data-testid="urgent-badge-elapsed"
        >
          {minutes < 1
            ? t('urgent.waitingJustNow')
            : t(waitingMinutesKey, { minutes })}
        </span>
      )}
    </span>
  );
};

export default UrgentBadge;
