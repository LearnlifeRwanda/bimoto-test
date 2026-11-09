import { describe, test, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { i18n } from './setup';
import { ChildPassengerBadge } from '../components/journey/ChildPassengerBadge';

beforeEach(async () => {
  i18n.addResourceBundle(
    'en',
    'translation',
    { child: { badgeLabel: 'Child passenger' } },
    true,
    true,
  );
  await i18n.changeLanguage('en');
});

describe('ChildPassengerBadge — R3-CHILD', () => {
  test('renders the badge when hasChildPassenger=true', () => {
    render(<ChildPassengerBadge hasChildPassenger={true} />);
    const badge = screen.getByTestId('child-passenger-badge');
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toBe('Child passenger');
    expect(badge).toHaveAttribute('role', 'status');
    expect(badge).toHaveAttribute('aria-label', 'Child passenger');
  });

  test('returns null when hasChildPassenger=false', () => {
    const { container } = render(<ChildPassengerBadge hasChildPassenger={false} />);
    expect(container.firstChild).toBeNull();
  });

  test('returns null defensively for null and undefined', () => {
    const { container: c1 } = render(<ChildPassengerBadge hasChildPassenger={null} />);
    expect(c1.firstChild).toBeNull();
    const { container: c2 } = render(<ChildPassengerBadge hasChildPassenger={undefined} />);
    expect(c2.firstChild).toBeNull();
  });

  test('respects the size prop (sm vs md)', () => {
    const { rerender, container } = render(
      <ChildPassengerBadge hasChildPassenger={true} size="sm" />,
    );
    let badge = container.querySelector('[data-testid="child-passenger-badge"]');
    expect(badge?.className).toContain('text-[10px]');
    rerender(<ChildPassengerBadge hasChildPassenger={true} size="md" />);
    badge = container.querySelector('[data-testid="child-passenger-badge"]');
    expect(badge?.className).toContain('text-xs');
  });

  test('survives rerender from true -> false without leaving stale DOM', () => {
    const { rerender, container } = render(
      <ChildPassengerBadge hasChildPassenger={true} />,
    );
    expect(
      container.querySelector('[data-testid="child-passenger-badge"]'),
    ).not.toBeNull();
    rerender(<ChildPassengerBadge hasChildPassenger={false} />);
    expect(
      container.querySelector('[data-testid="child-passenger-badge"]'),
    ).toBeNull();
  });
});
