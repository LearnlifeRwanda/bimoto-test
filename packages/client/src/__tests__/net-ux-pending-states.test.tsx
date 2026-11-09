// NET-UX G4 — pending states block double submits.
//
// Two mechanisms cover the audited buttons: the shared Button's
// loading prop (disables + spinner while in flight) and the
// JourneyLegsDisplay pendingLegId contract for the delivery stop
// actions (plain buttons, disabled for the in-flight leg).

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { i18n } from './setup';
import { Button } from '../components/ui/Button';
import { JourneyLegsDisplay } from '../components/journey/JourneyLegsDisplay';
import type { Leg } from '@bimoto/shared';

beforeEach(async () => {
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      common: { loading: 'Loading' },
      delivery: {
        driverStopList: 'Stops on the way',
        stopOrderLabel: 'Stop {{n}}',
        driverCompleteStop: 'Complete this stop',
        imAtPickup: "I'm at pickup",
        parcelCategoryOther: 'Other',
      },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');
});

const pickupLeg: Leg = {
  id: 'leg-1',
  journeyId: 'j1',
  sequence: 0,
  type: 'GOODS_PICKUP',
  status: 'PENDING',
  lat: -1.95,
  lng: 30.06,
  name: 'Post office',
  parcelSize: 'MEDIUM',
  createdAt: '2026-07-20T00:00:00Z',
  updatedAt: '2026-07-20T00:00:00Z',
};

describe('Button pending state', () => {
  test('a loading button is disabled — a second tap cannot re-submit', () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Send</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);

    // submit went in flight — the page flips loading
    rerender(<Button onClick={onClick} loading>Send</Button>);
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('JourneyLegsDisplay stop-action pending contract', () => {
  test('the in-flight leg disables both stop actions; taps are no-ops', () => {
    const onActivate = vi.fn();
    const onComplete = vi.fn();
    const { rerender } = render(
      <JourneyLegsDisplay
        legs={[pickupLeg]}
        mode="driver-active"
        onActivateStop={onActivate}
        onCompleteStop={onComplete}
        pendingLegId={null}
      />,
    );
    fireEvent.click(screen.getByTestId('activate-stop-0'));
    expect(onActivate).toHaveBeenCalledTimes(1);

    // the POST is in flight for leg-1
    rerender(
      <JourneyLegsDisplay
        legs={[pickupLeg]}
        mode="driver-active"
        onActivateStop={onActivate}
        onCompleteStop={onComplete}
        pendingLegId="leg-1"
      />,
    );
    expect(screen.getByTestId('activate-stop-0')).toBeDisabled();
    expect(screen.getByTestId('complete-stop-0')).toBeDisabled();
    fireEvent.click(screen.getByTestId('activate-stop-0'));
    fireEvent.click(screen.getByTestId('complete-stop-0'));
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();
  });
});
