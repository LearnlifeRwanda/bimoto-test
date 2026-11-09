// R3-N-5 — customer journey-outcome badge tests. Covers the five
// terminal states (pending review, no driver dispute, driver
// disputed, dispute upheld for the customer, dispute overturned).
import { describe, test, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { i18n } from './setup';
import {
  CustomerJourneyOutcomeBadge,
  deriveOutcomeState,
} from '../components/journey/CustomerJourneyOutcomeBadge';

beforeEach(async () => {
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      journeyHistory: {
        badgePendingReview: 'Reported, under review',
        badgeNoDriverDispute: 'Reported, driver did not dispute',
        badgeDriverDisputed: 'Driver disputed — admin reviewing',
        badgeDisputeUpheld: 'Dispute reviewed — your refund stands',
        badgeDisputeOverturned: 'Admin reversed — we apologise',
      },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');
});

describe('CustomerJourneyOutcomeBadge — R3-N-5', () => {
  test('renders pendingReview when cancelledAt < 24h and no driver dispute', () => {
    const cancelledAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    render(
      <CustomerJourneyOutcomeBadge
        cancelReason="DRIVER_NO_SHOW"
        cancelledAt={cancelledAt}
        driverDisputedAt={null}
        noShowResolution={null}
      />,
    );
    const badge = screen.getByTestId('customer-journey-outcome-badge');
    expect(badge).toHaveAttribute('data-state', 'pendingReview');
    expect(badge.textContent).toContain('under review');
  });

  test('renders noDriverDispute when cancelledAt >= 24h and no dispute filed', () => {
    const cancelledAt = new Date(
      Date.now() - 25 * 60 * 60 * 1000,
    ).toISOString();
    render(
      <CustomerJourneyOutcomeBadge
        cancelReason="DRIVER_NO_SHOW"
        cancelledAt={cancelledAt}
        driverDisputedAt={null}
        noShowResolution={null}
      />,
    );
    const badge = screen.getByTestId('customer-journey-outcome-badge');
    expect(badge).toHaveAttribute('data-state', 'noDriverDispute');
    expect(badge.textContent).toContain('did not dispute');
  });

  test('renders driverDisputed when driverDisputedAt set but admin not yet decided', () => {
    render(
      <CustomerJourneyOutcomeBadge
        cancelReason="DRIVER_NO_SHOW"
        cancelledAt={new Date().toISOString()}
        driverDisputedAt={new Date().toISOString()}
        noShowResolution={null}
      />,
    );
    const badge = screen.getByTestId('customer-journey-outcome-badge');
    expect(badge).toHaveAttribute('data-state', 'driverDisputed');
    expect(badge.textContent).toContain('admin reviewing');
  });

  test('renders disputeUpheld for the customer when admin decided UPHOLD_FLAG', () => {
    render(
      <CustomerJourneyOutcomeBadge
        cancelReason="DRIVER_NO_SHOW"
        cancelledAt={new Date().toISOString()}
        driverDisputedAt={new Date().toISOString()}
        noShowResolution={{ decision: 'UPHOLD_FLAG', decidedAt: new Date().toISOString() }}
      />,
    );
    const badge = screen.getByTestId('customer-journey-outcome-badge');
    expect(badge).toHaveAttribute('data-state', 'disputeUpheld');
    expect(badge.textContent).toContain('refund stands');
  });

  test('renders disputeOverturned when admin decided OVERTURN_FLAG (driver won)', () => {
    render(
      <CustomerJourneyOutcomeBadge
        cancelReason="DRIVER_NO_SHOW"
        cancelledAt={new Date().toISOString()}
        driverDisputedAt={new Date().toISOString()}
        noShowResolution={{ decision: 'OVERTURN_FLAG', decidedAt: new Date().toISOString() }}
      />,
    );
    const badge = screen.getByTestId('customer-journey-outcome-badge');
    expect(badge).toHaveAttribute('data-state', 'disputeOverturned');
    expect(badge.textContent).toContain('Admin reversed');
  });

  test('deriveOutcomeState returns null when cancelReason is not DRIVER_NO_SHOW', () => {
    expect(
      deriveOutcomeState({
        cancelReason: 'CUSTOMER_CHANGED_MIND',
        cancelledAt: new Date().toISOString(),
        driverDisputedAt: null,
        noShowResolution: null,
      }),
    ).toBeNull();
  });
});
