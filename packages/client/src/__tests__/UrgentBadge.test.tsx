// __TESTS__/URGENT-BADGE.TEST.TSX
//
// R3-T — driver-facing badge that marks URGENT_MESSENGER journeys
// in lists and on bid pages. Returns null for any other journey
// type so callers can drop it into a card unconditionally.
//
// R3-EXPRESS — when matchedAt is provided, the badge renders an
// escalation indicator showing "waiting Nm" that escalates colour
// at 5 min and 10 min thresholds, and re-renders every 60 s while
// mounted.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { i18n } from './setup';
import { UrgentBadge, urgencyTier } from '../components/journey/UrgentBadge';

beforeEach(async () => {
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      urgent: {
        badge: 'URGENT',
        badgeAriaLabel: 'Urgent delivery',
        waitingMinutes: 'waiting {{minutes}}m',
        waitingJustNow: 'just now',
      },
      priority: {
        badge: 'PRIORITY',
        badgeAriaLabel: 'Priority delivery',
        waitingMinutes: 'waiting {{minutes}}m',
      },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');
});

describe('UrgentBadge — R3-T', () => {
  test('renders the URGENT label for URGENT_MESSENGER journey type', () => {
    render(<UrgentBadge journeyType="URGENT_MESSENGER" />);
    const badge = screen.getByTestId('urgent-badge');
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toContain('URGENT');
    expect(badge).toHaveAttribute('role', 'status');
    expect(badge).toHaveAttribute('aria-label', 'Urgent delivery');
  });

  test('returns null for PASSENGER (no badge mounted)', () => {
    const { container } = render(<UrgentBadge journeyType="PASSENGER" />);
    expect(container.firstChild).toBeNull();
  });

  test('returns null for GOODS (no badge mounted)', () => {
    const { container } = render(<UrgentBadge journeyType="GOODS" />);
    expect(container.firstChild).toBeNull();
  });

  test('returns null defensively for null and undefined journey type', () => {
    const { container: c1 } = render(<UrgentBadge journeyType={null} />);
    expect(c1.firstChild).toBeNull();
    const { container: c2 } = render(<UrgentBadge journeyType={undefined} />);
    expect(c2.firstChild).toBeNull();
  });

  test('respects the size prop (sm vs md) via className', () => {
    const { rerender, container } = render(
      <UrgentBadge journeyType="URGENT_MESSENGER" size="sm" />,
    );
    let badge = container.querySelector('[data-testid="urgent-badge"]');
    expect(badge?.className).toContain('text-[10px]');
    rerender(<UrgentBadge journeyType="URGENT_MESSENGER" size="md" />);
    badge = container.querySelector('[data-testid="urgent-badge"]');
    expect(badge?.className).toContain('text-xs');
  });

  test('survives rerender from URGENT_MESSENGER -> GOODS without leaving stale DOM', () => {
    // Defends a future regression where memoization could keep the
    // badge mounted after a journey type changed under the same key.
    const { rerender, container } = render(
      <UrgentBadge journeyType="URGENT_MESSENGER" />,
    );
    expect(container.querySelector('[data-testid="urgent-badge"]')).not.toBeNull();
    rerender(<UrgentBadge journeyType="GOODS" />);
    expect(container.querySelector('[data-testid="urgent-badge"]')).toBeNull();
  });
});

describe('urgencyTier helper — R3-EXPRESS / R3-PRIORITY', () => {
  test('default tier (URGENT) — returns fresh for 0..4 minutes', () => {
    expect(urgencyTier(0)).toBe('fresh');
    expect(urgencyTier(4)).toBe('fresh');
  });
  test('default tier (URGENT) — returns approaching for 5..9 minutes', () => {
    expect(urgencyTier(5)).toBe('approaching');
    expect(urgencyTier(9)).toBe('approaching');
  });
  test('default tier (URGENT) — returns overdue at 10+ minutes', () => {
    expect(urgencyTier(10)).toBe('overdue');
    expect(urgencyTier(60)).toBe('overdue');
  });

  test('explicit URGENT tier matches default behaviour', () => {
    expect(urgencyTier(7, 'URGENT')).toBe('approaching');
    expect(urgencyTier(11, 'URGENT')).toBe('overdue');
  });

  test('PRIORITY tier escalates at 10 / 20 minutes (looser than URGENT)', () => {
    expect(urgencyTier(0, 'PRIORITY')).toBe('fresh');
    expect(urgencyTier(9, 'PRIORITY')).toBe('fresh');
    expect(urgencyTier(10, 'PRIORITY')).toBe('approaching');
    expect(urgencyTier(19, 'PRIORITY')).toBe('approaching');
    expect(urgencyTier(20, 'PRIORITY')).toBe('overdue');
  });

  test('same elapsed produces different tiers for URGENT vs PRIORITY (smallest-wrongness gate)', () => {
    // 7 minutes is approaching for URGENT but still fresh for PRIORITY.
    expect(urgencyTier(7, 'URGENT')).toBe('approaching');
    expect(urgencyTier(7, 'PRIORITY')).toBe('fresh');
  });
});

describe('UrgentBadge escalation indicator — R3-EXPRESS', () => {
  // Pin "now" so test results are deterministic regardless of when
  // the suite runs. The component reads Date.now() at mount and on
  // each interval tick.
  const NOW = new Date('2026-05-08T12:00:00.000Z');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('renders the URGENT label without elapsed pill when matchedAt is null', () => {
    render(
      <UrgentBadge journeyType="URGENT_MESSENGER" matchedAt={null} />,
    );
    expect(screen.getByTestId('urgent-badge-label').textContent).toBe('URGENT');
    expect(
      screen.queryByTestId('urgent-badge-elapsed'),
    ).not.toBeInTheDocument();
  });

  test('renders "just now" when matchedAt is at the current minute (tier=fresh)', () => {
    render(
      <UrgentBadge
        journeyType="URGENT_MESSENGER"
        matchedAt={new Date(NOW.getTime() - 30_000)}
      />,
    );
    expect(screen.getByTestId('urgent-badge-elapsed').textContent).toBe(
      'just now',
    );
    expect(screen.getByTestId('urgent-badge')).toHaveAttribute(
      'data-tier',
      'fresh',
    );
  });

  test('renders "waiting 7m" with tier=approaching when matchedAt is 7 minutes ago', () => {
    render(
      <UrgentBadge
        journeyType="URGENT_MESSENGER"
        matchedAt={new Date(NOW.getTime() - 7 * 60_000)}
      />,
    );
    expect(screen.getByTestId('urgent-badge-elapsed').textContent).toBe(
      'waiting 7m',
    );
    const badge = screen.getByTestId('urgent-badge');
    expect(badge).toHaveAttribute('data-tier', 'approaching');
    expect(badge.className).toContain('amber');
  });

  test('renders "waiting 12m" with tier=overdue when matchedAt is 12 minutes ago', () => {
    render(
      <UrgentBadge
        journeyType="URGENT_MESSENGER"
        matchedAt={new Date(NOW.getTime() - 12 * 60_000).toISOString()}
      />,
    );
    expect(screen.getByTestId('urgent-badge-elapsed').textContent).toBe(
      'waiting 12m',
    );
    expect(screen.getByTestId('urgent-badge')).toHaveAttribute(
      'data-tier',
      'overdue',
    );
  });

  test('caps the elapsed counter at 999m for very-old timestamps', () => {
    render(
      <UrgentBadge
        journeyType="URGENT_MESSENGER"
        matchedAt={new Date(NOW.getTime() - 5_000 * 60_000)}
      />,
    );
    expect(screen.getByTestId('urgent-badge-elapsed').textContent).toBe(
      'waiting 999m',
    );
  });

  test('re-renders every 60s so the elapsed counter ticks without parent re-render', () => {
    render(
      <UrgentBadge
        journeyType="URGENT_MESSENGER"
        matchedAt={new Date(NOW.getTime() - 4 * 60_000)}
      />,
    );
    // t=0: 4 min elapsed, fresh tier.
    expect(screen.getByTestId('urgent-badge-elapsed').textContent).toBe(
      'waiting 4m',
    );
    expect(screen.getByTestId('urgent-badge')).toHaveAttribute(
      'data-tier',
      'fresh',
    );
    // Advance 60s — elapsed becomes 5 min, tier flips to approaching.
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByTestId('urgent-badge-elapsed').textContent).toBe(
      'waiting 5m',
    );
    expect(screen.getByTestId('urgent-badge')).toHaveAttribute(
      'data-tier',
      'approaching',
    );
  });

  test('cleans up its setInterval on unmount', () => {
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    const { unmount } = render(
      <UrgentBadge
        journeyType="URGENT_MESSENGER"
        matchedAt={new Date(NOW.getTime() - 60_000)}
      />,
    );
    unmount();
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});

describe('UrgentBadge — R3-PRIORITY variant', () => {
  const NOW = new Date('2026-05-10T12:00:00.000Z');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('renders the PRIORITY label for PRIORITY_MESSENGER journey type', () => {
    render(<UrgentBadge journeyType="PRIORITY_MESSENGER" />);
    const badge = screen.getByTestId('urgent-badge');
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toContain('PRIORITY');
    expect(badge).toHaveAttribute('aria-label', 'Priority delivery');
    expect(badge).toHaveAttribute('data-badge-tier', 'PRIORITY');
  });

  test('PRIORITY badge uses amber palette in fresh state (vs URGENT red)', () => {
    const { container } = render(
      <UrgentBadge journeyType="PRIORITY_MESSENGER" />,
    );
    const badge = container.querySelector('[data-testid="urgent-badge"]');
    expect(badge?.className).toContain('amber');
    expect(badge?.className).not.toContain('red');
  });

  test('returns null for PASSENGER even with PRIORITY i18n bundle present', () => {
    const { container } = render(<UrgentBadge journeyType="PASSENGER" />);
    expect(container.firstChild).toBeNull();
  });

  test('PRIORITY at 9 min stays fresh (URGENT thresholds would say approaching)', () => {
    render(
      <UrgentBadge
        journeyType="PRIORITY_MESSENGER"
        matchedAt={new Date(NOW.getTime() - 9 * 60_000)}
      />,
    );
    expect(screen.getByTestId('urgent-badge')).toHaveAttribute(
      'data-tier',
      'priority-fresh',
    );
  });

  test('PRIORITY at 10 min flips to approaching', () => {
    render(
      <UrgentBadge
        journeyType="PRIORITY_MESSENGER"
        matchedAt={new Date(NOW.getTime() - 10 * 60_000)}
      />,
    );
    expect(screen.getByTestId('urgent-badge')).toHaveAttribute(
      'data-tier',
      'priority-approaching',
    );
  });

  test('PRIORITY at 20 min flips to overdue', () => {
    render(
      <UrgentBadge
        journeyType="PRIORITY_MESSENGER"
        matchedAt={new Date(NOW.getTime() - 20 * 60_000)}
      />,
    );
    expect(screen.getByTestId('urgent-badge')).toHaveAttribute(
      'data-tier',
      'priority-overdue',
    );
  });

  test('PRIORITY badge uses priority.waitingMinutes i18n key', () => {
    render(
      <UrgentBadge
        journeyType="PRIORITY_MESSENGER"
        matchedAt={new Date(NOW.getTime() - 5 * 60_000)}
      />,
    );
    expect(screen.getByTestId('urgent-badge-elapsed').textContent).toBe(
      'waiting 5m',
    );
  });
});
