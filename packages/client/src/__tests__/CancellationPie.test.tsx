// Tests for the CancellationPie component
// (Dispatch R3-DRIVER-TIER-STATS-2).
import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import './setup';

import { CancellationPie } from '../components/driver/CancellationPie';

describe('CancellationPie — R3-DRIVER-TIER-STATS-2', () => {
  test('renders nothing for an empty breakdown', () => {
    const { container } = render(<CancellationPie breakdown={{}} ariaLabel="reasons" />);
    expect(container.firstChild).toBeNull();
  });

  test('renders nothing when all counts are zero', () => {
    const { container } = render(
      <CancellationPie breakdown={{ DRIVER_LATE: 0 }} ariaLabel="reasons" />,
    );
    expect(container.firstChild).toBeNull();
  });

  test('renders one wedge per non-zero reason and a legend entry per wedge', () => {
    render(
      <CancellationPie
        breakdown={{ DRIVER_LATE: 1, CUSTOMER_CHANGED_MIND: 3 }}
        ariaLabel="reasons"
      />,
    );
    expect(screen.getByTestId('pie-wedge-DRIVER_LATE')).toBeInTheDocument();
    expect(screen.getByTestId('pie-wedge-CUSTOMER_CHANGED_MIND')).toBeInTheDocument();
    const root = screen.getByTestId('driver-stats-cancellation-pie');
    expect(root.textContent).toContain('DRIVER_LATE');
    expect(root.textContent).toContain('CUSTOMER_CHANGED_MIND');
  });

  test('color-codes wedges by reason category', () => {
    render(
      <CancellationPie
        breakdown={{
          DRIVER_LATE: 1,
          CUSTOMER_CHANGED_MIND: 1,
          SAFETY_CONCERN: 1,
          BOTH_NO_SHOW: 1,
        }}
        ariaLabel="reasons"
      />,
    );
    expect(screen.getByTestId('pie-wedge-DRIVER_LATE').getAttribute('fill')).toBe('#ef4444');
    expect(screen.getByTestId('pie-wedge-CUSTOMER_CHANGED_MIND').getAttribute('fill')).toBe(
      '#3b82f6',
    );
    expect(screen.getByTestId('pie-wedge-SAFETY_CONCERN').getAttribute('fill')).toBe('#a855f7');
    expect(screen.getByTestId('pie-wedge-BOTH_NO_SHOW').getAttribute('fill')).toBe('#9ca3af');
  });

  test('single-reason pie renders a full circle, not a degenerate arc', () => {
    render(
      <CancellationPie breakdown={{ DRIVER_NO_SHOW: 4 }} ariaLabel="reasons" />,
    );
    const root = screen.getByTestId('driver-stats-cancellation-pie');
    expect(root.querySelector('circle')).not.toBeNull();
    expect(root.querySelector('path')).toBeNull();
    expect(root.textContent).toContain('100%');
  });

  test('largeArc flag is set when a wedge exceeds 50% of the pie', () => {
    render(
      <CancellationPie
        breakdown={{ DRIVER_NO_SHOW: 8, CUSTOMER_CHANGED_MIND: 2 }}
        ariaLabel="reasons"
      />,
    );
    const big = screen.getByTestId('pie-wedge-DRIVER_NO_SHOW');
    const d = big.getAttribute('d')!;
    // SVG arc command: A rx ry x-axis-rotation large-arc-flag sweep-flag x y
    // For a >50% wedge the large-arc-flag (5th param of A) must be 1.
    const m = d.match(/A\s+\S+\s+\S+\s+\S+\s+(\S+)\s+\S+/);
    expect(m).not.toBeNull();
    expect(m![1]).toBe('1');
  });

  test('percentages sum to ~100 and the legend reports each portion', () => {
    render(
      <CancellationPie
        breakdown={{ DRIVER_LATE: 1, CUSTOMER_CHANGED_MIND: 3 }}
        ariaLabel="reasons"
      />,
    );
    const root = screen.getByTestId('driver-stats-cancellation-pie');
    // CUSTOMER_CHANGED_MIND 3/4 = 75%; DRIVER_LATE 1/4 = 25%.
    expect(root.textContent).toContain('75%');
    expect(root.textContent).toContain('25%');
  });
});
