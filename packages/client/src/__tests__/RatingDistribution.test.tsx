// Tests for the RatingDistribution component
// (Dispatch R3-DRIVER-TIER-STATS-2).
import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import './setup';

import { RatingDistribution } from '../components/driver/RatingDistribution';

describe('RatingDistribution — R3-DRIVER-TIER-STATS-2', () => {
  test('renders all 5 star rows (5 → 1) even when counts are 0', () => {
    render(
      <RatingDistribution
        distribution={{ 1: 0, 2: 0, 3: 0, 4: 0, 5: 1 }}
        ariaLabel="ratings"
      />,
    );
    expect(screen.getByTestId('rating-dist-row-5')).toBeInTheDocument();
    expect(screen.getByTestId('rating-dist-row-4')).toBeInTheDocument();
    expect(screen.getByTestId('rating-dist-row-3')).toBeInTheDocument();
    expect(screen.getByTestId('rating-dist-row-2')).toBeInTheDocument();
    expect(screen.getByTestId('rating-dist-row-1')).toBeInTheDocument();
  });

  test('count labels reflect the distribution values', () => {
    render(
      <RatingDistribution
        distribution={{ 1: 0, 2: 1, 3: 1, 4: 2, 5: 3 }}
        ariaLabel="ratings"
      />,
    );
    expect(screen.getByTestId('rating-dist-count-5').textContent).toBe('3');
    expect(screen.getByTestId('rating-dist-count-4').textContent).toBe('2');
    expect(screen.getByTestId('rating-dist-count-3').textContent).toBe('1');
    expect(screen.getByTestId('rating-dist-count-2').textContent).toBe('1');
    expect(screen.getByTestId('rating-dist-count-1').textContent).toBe('0');
  });

  test('bar widths scale relative to the max bucket', () => {
    render(
      <RatingDistribution
        distribution={{ 1: 0, 2: 0, 3: 0, 4: 5, 5: 10 }}
        ariaLabel="ratings"
      />,
    );
    const fiveBar = screen.getByTestId('rating-dist-bar-5');
    const fourBar = screen.getByTestId('rating-dist-bar-4');
    const oneBar = screen.getByTestId('rating-dist-bar-1');
    expect(fiveBar.style.width).toBe('100%');
    expect(fourBar.style.width).toBe('50%');
    expect(oneBar.style.width).toBe('0%');
  });

  test('uses aria-label for accessibility', () => {
    render(
      <RatingDistribution
        distribution={{ 1: 0, 2: 0, 3: 0, 4: 0, 5: 1 }}
        ariaLabel="last-30-days ratings"
      />,
    );
    expect(screen.getByLabelText('last-30-days ratings')).toBeInTheDocument();
  });

  test('color-codes buckets by star value (4-5 green, 3 yellow, 1-2 red)', () => {
    render(
      <RatingDistribution
        distribution={{ 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 }}
        ariaLabel="ratings"
      />,
    );
    // green
    expect(screen.getByTestId('rating-dist-bar-5').style.backgroundColor).toBe(
      'rgb(34, 197, 94)',
    );
    expect(screen.getByTestId('rating-dist-bar-4').style.backgroundColor).toBe(
      'rgb(34, 197, 94)',
    );
    // yellow
    expect(screen.getByTestId('rating-dist-bar-3').style.backgroundColor).toBe(
      'rgb(234, 179, 8)',
    );
    // red
    expect(screen.getByTestId('rating-dist-bar-2').style.backgroundColor).toBe(
      'rgb(239, 68, 68)',
    );
    expect(screen.getByTestId('rating-dist-bar-1').style.backgroundColor).toBe(
      'rgb(239, 68, 68)',
    );
  });
});
