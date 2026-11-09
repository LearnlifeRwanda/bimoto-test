// SOCKET-FIX G6 — the wish-price pulse: a changed value reaches the
// rendered output and plays a brief cue; the initial render never
// pulses.

import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { ValuePulse } from '../components/ui/ValuePulse';

describe('ValuePulse (SOCKET-FIX G3)', () => {
  test('renders without pulsing initially, pulses when the value changes', () => {
    const { rerender } = render(
      <ValuePulse value={1000} className="chip">
        1,000 RWF
      </ValuePulse>,
    );
    const chip = screen.getByText('1,000 RWF');
    expect(chip).not.toHaveAttribute('data-pulsing');
    expect(chip.className).toBe('chip');

    rerender(
      <ValuePulse value={1500} className="chip">
        1,500 RWF
      </ValuePulse>,
    );
    const updated = screen.getByText('1,500 RWF');
    expect(updated).toHaveAttribute('data-pulsing', 'true');
    expect(updated.className).toContain('animate-pulse');
  });

  test('a rerender with the same value does not pulse', () => {
    const { rerender } = render(
      <ValuePulse value={1000} className="chip">
        1,000 RWF
      </ValuePulse>,
    );
    rerender(
      <ValuePulse value={1000} className="chip">
        1,000 RWF
      </ValuePulse>,
    );
    expect(screen.getByText('1,000 RWF')).not.toHaveAttribute('data-pulsing');
  });
});
