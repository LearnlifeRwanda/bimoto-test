// Tests for the CohortBreakdown component
// (Dispatch R3-DRIVER-TIER-STATS-2).
import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import './setup';

import { CohortBreakdown } from '../components/driver/CohortBreakdown';

const labels = {
  acceptanceLabel: 'Acceptance',
  completionLabel: 'Completion',
  earningsLabel: 'Weekly',
  cohortSizeLabel: (n: number) => `${n} drivers`,
};

describe('CohortBreakdown — R3-DRIVER-TIER-STATS-2', () => {
  test('renders nothing when there are no rows', () => {
    const { container } = render(<CohortBreakdown rows={[]} {...labels} />);
    expect(container.firstChild).toBeNull();
  });

  test('renders one row per cohort entry', () => {
    render(
      <CohortBreakdown
        rows={[
          {
            vehicleType: 'BIKE',
            isDriverOwnVehicleType: true,
            cohortMedianAcceptanceRate: 0.6,
            cohortMedianCompletionRate: 0.9,
            cohortMedianWeeklyEarningsRwf: 15000,
            cohortDriverCount: 12,
          },
        ]}
        {...labels}
      />,
    );
    expect(screen.getByTestId('cohort-row-BIKE')).toBeInTheDocument();
    expect(screen.getByTestId('cohort-row-BIKE-acceptance').textContent).toBe('60%');
    expect(screen.getByTestId('cohort-row-BIKE-completion').textContent).toBe('90%');
    expect(screen.getByTestId('cohort-row-BIKE-earnings').textContent).toBe('RWF 15,000');
  });

  test('renders em-dash for null median fields', () => {
    render(
      <CohortBreakdown
        rows={[
          {
            vehicleType: 'BIKE',
            isDriverOwnVehicleType: true,
            cohortMedianAcceptanceRate: null,
            cohortMedianCompletionRate: null,
            cohortMedianWeeklyEarningsRwf: null,
            cohortDriverCount: 2,
          },
        ]}
        {...labels}
      />,
    );
    expect(screen.getByTestId('cohort-row-BIKE-acceptance').textContent).toBe('—');
    expect(screen.getByTestId('cohort-row-BIKE-completion').textContent).toBe('—');
    expect(screen.getByTestId('cohort-row-BIKE-earnings').textContent).toBe('—');
  });

  test('cohort-size label reflects the cohortDriverCount', () => {
    render(
      <CohortBreakdown
        rows={[
          {
            vehicleType: 'MOTO',
            isDriverOwnVehicleType: true,
            cohortMedianAcceptanceRate: 0.5,
            cohortMedianCompletionRate: 0.8,
            cohortMedianWeeklyEarningsRwf: 20000,
            cohortDriverCount: 47,
          },
        ]}
        {...labels}
      />,
    );
    expect(screen.getByTestId('cohort-row-MOTO').textContent).toContain('47 drivers');
  });

  test('renders multiple rows when the driver has multiple vehicle types', () => {
    render(
      <CohortBreakdown
        rows={[
          {
            vehicleType: 'BIKE',
            isDriverOwnVehicleType: true,
            cohortMedianAcceptanceRate: 0.58,
            cohortMedianCompletionRate: 0.92,
            cohortMedianWeeklyEarningsRwf: 12000,
            cohortDriverCount: 8,
          },
          {
            vehicleType: 'E_BIKE',
            isDriverOwnVehicleType: false,
            cohortMedianAcceptanceRate: 0.65,
            cohortMedianCompletionRate: 0.88,
            cohortMedianWeeklyEarningsRwf: 18000,
            cohortDriverCount: 5,
          },
        ]}
        {...labels}
      />,
    );
    expect(screen.getByTestId('cohort-row-BIKE')).toBeInTheDocument();
    expect(screen.getByTestId('cohort-row-E_BIKE')).toBeInTheDocument();
  });
});
