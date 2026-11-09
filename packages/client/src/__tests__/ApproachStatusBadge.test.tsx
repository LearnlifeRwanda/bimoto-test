// R3-N-3 — ApproachStatusBadge surfaces the four server-derived
// approach statuses (silent/approaching/arrived/lost) under the
// driver-approach map. Hidden when the stream isn't live.
import { describe, test, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { i18n } from './setup';
import { ApproachStatusBadge } from '../components/journey/ApproachStatusBadge';

beforeEach(async () => {
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      matched: {
        approach: {
          silent: "Driver hasn't started moving yet",
          approaching: 'Driver is approaching',
          arrived: 'Driver has arrived',
          lost: 'Driver appears to be lost',
          etaShort: '~{{minutes}} min',
        },
      },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');
});

describe('ApproachStatusBadge', () => {
  test('renders silent status with the silent label and grey styling', () => {
    render(
      <ApproachStatusBadge
        status="silent"
        distanceMeters={null}
        etaMinutes={null}
        isLive
      />,
    );
    const badge = screen.getByTestId('approach-status-badge');
    expect(badge).toHaveAttribute('data-status', 'silent');
    expect(badge.className).toContain('bg-gray-100');
    expect(screen.getByText("Driver hasn't started moving yet")).toBeInTheDocument();
  });

  test('renders approaching status with distance suffix and ETA', () => {
    render(
      <ApproachStatusBadge
        status="approaching"
        distanceMeters={320}
        etaMinutes={2}
        isLive
      />,
    );
    const badge = screen.getByTestId('approach-status-badge');
    expect(badge).toHaveAttribute('data-status', 'approaching');
    expect(badge.className).toContain('bg-green-100');
    expect(screen.getByText('Driver is approaching')).toBeInTheDocument();
    expect(screen.getByText(/320m/)).toBeInTheDocument();
    expect(screen.getByText(/~2 min/)).toBeInTheDocument();
  });

  test('renders arrived status with the arrived label and blue styling', () => {
    render(
      <ApproachStatusBadge
        status="arrived"
        distanceMeters={20}
        etaMinutes={1}
        isLive
      />,
    );
    const badge = screen.getByTestId('approach-status-badge');
    expect(badge).toHaveAttribute('data-status', 'arrived');
    expect(badge.className).toContain('bg-blue-100');
    expect(screen.getByText('Driver has arrived')).toBeInTheDocument();
  });

  test('renders lost status with the lost label and yellow styling', () => {
    render(
      <ApproachStatusBadge
        status="lost"
        distanceMeters={1100}
        etaMinutes={5}
        isLive
      />,
    );
    const badge = screen.getByTestId('approach-status-badge');
    expect(badge).toHaveAttribute('data-status', 'lost');
    expect(badge.className).toContain('bg-yellow-100');
    expect(screen.getByText('Driver appears to be lost')).toBeInTheDocument();
  });

  test('renders nothing when isLive is false', () => {
    render(
      <ApproachStatusBadge
        status="approaching"
        distanceMeters={500}
        etaMinutes={3}
        isLive={false}
      />,
    );
    expect(screen.queryByTestId('approach-status-badge')).not.toBeInTheDocument();
  });

  test('renders nothing when status is null even if live', () => {
    render(
      <ApproachStatusBadge
        status={null}
        distanceMeters={500}
        etaMinutes={3}
        isLive
      />,
    );
    expect(screen.queryByTestId('approach-status-badge')).not.toBeInTheDocument();
  });
});
