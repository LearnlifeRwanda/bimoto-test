// Tests for the Sparkline component (Dispatch R3-DRIVER-TIER-STATS-2).
import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import './setup';

import { Sparkline } from '../components/driver/Sparkline';

describe('Sparkline — R3-DRIVER-TIER-STATS-2', () => {
  test('renders nothing for fewer than 2 data points', () => {
    const { container } = render(
      <Sparkline data={[{ weekStart: '2026-04-01', earningsRwf: 1000 }]} ariaLabel="trend" />,
    );
    expect(container.firstChild).toBeNull();
  });

  test('renders nothing for empty data', () => {
    const { container } = render(<Sparkline data={[]} ariaLabel="trend" />);
    expect(container.firstChild).toBeNull();
  });

  test('renders an SVG polyline with the right number of points', () => {
    render(
      <Sparkline
        data={[
          { weekStart: '2026-04-01', earningsRwf: 5000 },
          { weekStart: '2026-04-08', earningsRwf: 7500 },
          { weekStart: '2026-04-15', earningsRwf: 9000 },
          { weekStart: '2026-04-22', earningsRwf: 11000 },
        ]}
        ariaLabel="4-week earnings"
      />,
    );
    const svg = screen.getByTestId('driver-stats-sparkline');
    expect(svg.tagName.toLowerCase()).toBe('svg');
    const polyline = svg.querySelector('polyline');
    expect(polyline).not.toBeNull();
    const pts = polyline!.getAttribute('points')!.trim().split(/\s+/);
    expect(pts).toHaveLength(4);
  });

  test('most-recent point gets an emphasis dot', () => {
    render(
      <Sparkline
        data={[
          { weekStart: '2026-04-01', earningsRwf: 5000 },
          { weekStart: '2026-04-08', earningsRwf: 11000 },
        ]}
        ariaLabel="trend"
      />,
    );
    const svg = screen.getByTestId('driver-stats-sparkline');
    expect(svg.querySelector('circle')).not.toBeNull();
  });

  test('uses aria-label for accessibility', () => {
    render(
      <Sparkline
        data={[
          { weekStart: '2026-04-01', earningsRwf: 5000 },
          { weekStart: '2026-04-08', earningsRwf: 11000 },
        ]}
        ariaLabel="4-week earnings trend"
      />,
    );
    expect(screen.getByLabelText('4-week earnings trend')).toBeInTheDocument();
  });

  test('handles all-zero earnings without divide-by-zero', () => {
    render(
      <Sparkline
        data={[
          { weekStart: '2026-04-01', earningsRwf: 0 },
          { weekStart: '2026-04-08', earningsRwf: 0 },
          { weekStart: '2026-04-15', earningsRwf: 0 },
          { weekStart: '2026-04-22', earningsRwf: 0 },
        ]}
        ariaLabel="flat"
      />,
    );
    const svg = screen.getByTestId('driver-stats-sparkline');
    const polyline = svg.querySelector('polyline');
    expect(polyline).not.toBeNull();
    // All Ys should equal 50 (baseline) — no NaN.
    expect(polyline!.getAttribute('points')).not.toContain('NaN');
  });
});
