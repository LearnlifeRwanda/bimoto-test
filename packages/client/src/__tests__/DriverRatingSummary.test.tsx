// Tests for the DriverRatingSummary strip (Dispatch RATE-DISPLAY).
//
// The stub i18n in setup.ts doesn't register the rating/reliability
// namespaces, so untranslated keys render as the key string itself —
// assertions below lean on data-testids and key names.
import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import './setup';

import { DriverRatingSummary } from '../components/rating/DriverRatingSummary';

describe('DriverRatingSummary — RATE-DISPLAY', () => {
  test('rated driver with ≥5 rides: stars + numeric average + reliability pill', () => {
    render(
      <DriverRatingSummary info={{ avgRating: 4.8, completedRides: 30 }} />,
    );
    expect(screen.getByTestId('driver-rating-summary')).toBeInTheDocument();
    expect(screen.getByTestId('driver-rating-average').textContent).toBe('4.8');
    // ReliabilityBadge's rated variant: "4.8 · {{count}} rides"
    expect(screen.getByText(/4\.8 ·/)).toBeInTheDocument();
    expect(
      screen.queryByTestId('driver-rating-new-driver'),
    ).not.toBeInTheDocument();
  });

  test('rated driver under 5 rides: stars render, the rated pill does not (badge shows its New-driver variant)', () => {
    render(
      <DriverRatingSummary info={{ avgRating: 4.2, completedRides: 3 }} />,
    );
    expect(screen.getByTestId('driver-rating-average').textContent).toBe('4.2');
    // No "avg · rides" pill under the badge's 5-ride gate…
    expect(screen.queryByText(/4\.2 ·/)).not.toBeInTheDocument();
    // …the badge's own New-driver pill appears instead.
    expect(screen.getByText('reliability.newDriver')).toBeInTheDocument();
  });

  test('rated driver with unknown rides count: stars only, no badge at all', () => {
    render(
      <DriverRatingSummary info={{ avgRating: 4.2, completedRides: null }} />,
    );
    expect(screen.getByTestId('driver-rating-average').textContent).toBe('4.2');
    expect(screen.queryByText(/reliability\./)).not.toBeInTheDocument();
  });

  test('unrated driver: calm New-driver label, never NaN stars', () => {
    const { container } = render(
      <DriverRatingSummary info={{ avgRating: null, completedRides: 0 }} />,
    );
    expect(screen.getByTestId('driver-rating-new-driver')).toBeInTheDocument();
    expect(
      screen.queryByTestId('driver-rating-summary'),
    ).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/NaN/);
  });
});
