import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { i18n } from './setup';
import { JourneyLegsDisplay } from '../components/journey/JourneyLegsDisplay';
import type { Leg } from '@bimoto/shared';

beforeEach(async () => {
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      delivery: {
        driverStopList: 'Stops on the way',
        stopOrderLabel: 'Stop {{n}}',
        driverCompleteStop: 'Complete this stop',
        driverStopCompleted: 'Completed at {{time}}',
        parcelCategoryFood: 'Food',
        parcelCategoryElectronics: 'Electronics',
        parcelCategoryDocuments: 'Documents',
        parcelCategoryFragile: 'Fragile',
        parcelCategoryOther: 'Other',
        moveStopUp: 'Move stop up',
        moveStopDown: 'Move stop down',
        recipientConfirmed: 'Recipient confirmed receipt at {{time}}',
        recipientAutoConfirmed: 'Auto-confirmed after 24h (no reply) at {{time}}',
        recipientDisputed: 'Recipient disputed: {{reason}}',
      },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');
});

const baseLeg: Leg = {
  id: 'leg-1',
  journeyId: 'j1',
  sequence: 0,
  type: 'GOODS_DROPOFF',
  status: 'PENDING',
  lat: -1.95,
  lng: 30.06,
  name: 'Post office',
  parcelSize: 'MEDIUM',
  createdAt: '2026-05-08T00:00:00Z',
  updatedAt: '2026-05-08T00:00:00Z',
};

describe('JourneyLegsDisplay — R3-DELIVERY', () => {
  test('returns nothing for an empty legs array', () => {
    const { container } = render(<JourneyLegsDisplay legs={[]} mode="preview" />);
    expect(container.firstChild).toBeNull();
  });

  test('renders N legs with parcel-size badges (numbered Stop 1, Stop 2 …)', () => {
    const legs: Leg[] = [
      { ...baseLeg, id: 'a', parcelSize: 'SMALL' },
      { ...baseLeg, id: 'b', sequence: 1, parcelSize: 'LARGE', name: 'Office' },
    ];
    render(<JourneyLegsDisplay legs={legs} mode="preview" />);
    expect(screen.getByText('Stop 1')).toBeInTheDocument();
    expect(screen.getByText('Stop 2')).toBeInTheDocument();
    expect(screen.getByTestId('parcel-size-badge-0').textContent).toBe('SMALL');
    expect(screen.getByTestId('parcel-size-badge-1').textContent).toBe('LARGE');
  });

  test('preview mode hides "Complete this stop" buttons', () => {
    render(<JourneyLegsDisplay legs={[baseLeg]} mode="preview" />);
    expect(screen.queryByTestId('complete-stop-0')).toBeNull();
  });

  test('driver-active mode shows "Complete this stop" and calls onCompleteStop with legId', () => {
    const onCompleteStop = vi.fn();
    render(
      <JourneyLegsDisplay
        legs={[baseLeg]}
        mode="driver-active"
        onCompleteStop={onCompleteStop}
      />,
    );
    const btn = screen.getByTestId('complete-stop-0');
    fireEvent.click(btn);
    expect(onCompleteStop).toHaveBeenCalledTimes(1);
    expect(onCompleteStop).toHaveBeenCalledWith('leg-1');
  });

  test('completed legs hide the button and show the "Completed" indicator', () => {
    const completedLeg: Leg = {
      ...baseLeg,
      status: 'COMPLETED',
      completedAt: '2026-05-08T12:30:00Z',
    };
    const onCompleteStop = vi.fn();
    render(
      <JourneyLegsDisplay
        legs={[completedLeg]}
        mode="driver-active"
        onCompleteStop={onCompleteStop}
      />,
    );
    expect(screen.queryByTestId('complete-stop-0')).toBeNull();
    expect(screen.getByTestId('leg-completed-0')).toBeInTheDocument();
  });

  test('non-goods legs render without a parcel-size badge', () => {
    const passengerLeg: Leg = {
      ...baseLeg,
      id: 'pass',
      type: 'PASSENGER_DROPOFF',
      parcelSize: null,
    };
    render(<JourneyLegsDisplay legs={[passengerLeg]} mode="preview" />);
    expect(screen.queryByTestId('parcel-size-badge-0')).toBeNull();
  });

  // R3-DELIVERY-V2 — parcel category badge.
  test('renders a parcel-category badge when leg has parcelCategory', () => {
    const fragileLeg: Leg = {
      ...baseLeg,
      id: 'frag',
      parcelCategory: 'FRAGILE',
    };
    render(<JourneyLegsDisplay legs={[fragileLeg]} mode="preview" />);
    const badge = screen.getByTestId('parcel-category-badge-0');
    expect(badge).toBeInTheDocument();
    expect(badge.dataset.category).toBe('FRAGILE');
    expect(badge.textContent).toBe('Fragile');
  });

  test('omits the parcel-category badge when none is set', () => {
    render(<JourneyLegsDisplay legs={[baseLeg]} mode="preview" />);
    expect(screen.queryByTestId('parcel-category-badge-0')).toBeNull();
  });

  test('hides the category badge on non-goods legs even when present (defensive)', () => {
    const passengerWithCategory: Leg = {
      ...baseLeg,
      id: 'pass',
      type: 'PASSENGER_DROPOFF',
      parcelSize: null,
      parcelCategory: 'FRAGILE',
    };
    render(<JourneyLegsDisplay legs={[passengerWithCategory]} mode="preview" />);
    expect(screen.queryByTestId('parcel-category-badge-0')).toBeNull();
  });

  // R3-DELIVERY-V2 — reorder controls.
  test('renders reorder buttons in preview mode when onReorder is provided', () => {
    const legs: Leg[] = [
      { ...baseLeg, id: 'a' },
      { ...baseLeg, id: 'b', sequence: 1, name: 'Office' },
    ];
    render(
      <JourneyLegsDisplay legs={legs} mode="preview" onReorder={() => {}} />,
    );
    expect(screen.getByTestId('stop-move-up-0')).toBeInTheDocument();
    expect(screen.getByTestId('stop-move-down-0')).toBeInTheDocument();
  });

  test('does NOT render reorder buttons in driver-active mode', () => {
    render(
      <JourneyLegsDisplay
        legs={[baseLeg]}
        mode="driver-active"
        onReorder={() => {}}
      />,
    );
    expect(screen.queryByTestId('stop-move-up-0')).toBeNull();
    expect(screen.queryByTestId('stop-move-down-0')).toBeNull();
  });

  test('does NOT render reorder buttons in preview mode when onReorder is omitted', () => {
    render(<JourneyLegsDisplay legs={[baseLeg]} mode="preview" />);
    expect(screen.queryByTestId('stop-move-up-0')).toBeNull();
    expect(screen.queryByTestId('stop-move-down-0')).toBeNull();
  });

  test('first stop has up disabled, last stop has down disabled', () => {
    const legs: Leg[] = [
      { ...baseLeg, id: 'a' },
      { ...baseLeg, id: 'b', sequence: 1, name: 'Office' },
      { ...baseLeg, id: 'c', sequence: 2, name: 'Bank' },
    ];
    render(
      <JourneyLegsDisplay legs={legs} mode="preview" onReorder={() => {}} />,
    );
    expect(
      (screen.getByTestId('stop-move-up-0') as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId('stop-move-down-0') as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(
      (screen.getByTestId('stop-move-down-2') as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId('stop-move-up-2') as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  test('clicking up on stop 1 calls onReorder(1, 0)', () => {
    const onReorder = vi.fn();
    const legs: Leg[] = [
      { ...baseLeg, id: 'a' },
      { ...baseLeg, id: 'b', sequence: 1, name: 'Office' },
    ];
    render(
      <JourneyLegsDisplay legs={legs} mode="preview" onReorder={onReorder} />,
    );
    fireEvent.click(screen.getByTestId('stop-move-up-1'));
    expect(onReorder).toHaveBeenCalledWith(1, 0);
  });

  test('clicking down on stop 0 calls onReorder(0, 1)', () => {
    const onReorder = vi.fn();
    const legs: Leg[] = [
      { ...baseLeg, id: 'a' },
      { ...baseLeg, id: 'b', sequence: 1, name: 'Office' },
    ];
    render(
      <JourneyLegsDisplay legs={legs} mode="preview" onReorder={onReorder} />,
    );
    fireEvent.click(screen.getByTestId('stop-move-down-0'));
    expect(onReorder).toHaveBeenCalledWith(0, 1);
  });

  // R3-RECIPIENT-CONFIRM — recipient acknowledged the parcel via SMS-reply.
  describe('recipientConfirmed badge (R3-RECIPIENT-CONFIRM)', () => {
    test('renders the badge when GOODS_DROPOFF leg has recipientConfirmedAt set', () => {
      const confirmedLeg: Leg = {
        ...baseLeg,
        status: 'COMPLETED',
        completedAt: '2026-05-08T12:30:00Z',
        recipientConfirmedAt: '2026-05-08T12:35:00Z',
      };
      render(<JourneyLegsDisplay legs={[confirmedLeg]} mode="preview" />);
      expect(screen.getByTestId('recipient-confirmed-0')).toBeInTheDocument();
      expect(screen.getByTestId('recipient-confirmed-0').textContent).toMatch(
        /Recipient confirmed receipt/,
      );
    });

    test('does NOT render the badge when recipientConfirmedAt is null', () => {
      const completedNotConfirmed: Leg = {
        ...baseLeg,
        status: 'COMPLETED',
        completedAt: '2026-05-08T12:30:00Z',
        recipientConfirmedAt: null,
      };
      render(<JourneyLegsDisplay legs={[completedNotConfirmed]} mode="preview" />);
      expect(screen.queryByTestId('recipient-confirmed-0')).toBeNull();
    });

    test('does NOT render the badge when recipientConfirmedAt is undefined', () => {
      render(<JourneyLegsDisplay legs={[baseLeg]} mode="preview" />);
      expect(screen.queryByTestId('recipient-confirmed-0')).toBeNull();
    });

    test('does NOT render the badge for non-GOODS_DROPOFF legs even with recipientConfirmedAt set (defensive)', () => {
      const passengerLeg: Leg = {
        ...baseLeg,
        type: 'PASSENGER_DROPOFF',
        parcelSize: null,
        status: 'COMPLETED',
        completedAt: '2026-05-08T12:30:00Z',
        recipientConfirmedAt: '2026-05-08T12:35:00Z',
      };
      render(<JourneyLegsDisplay legs={[passengerLeg]} mode="preview" />);
      expect(screen.queryByTestId('recipient-confirmed-0')).toBeNull();
    });

    test('also renders the badge in driver-active mode (the driver sees the loop close)', () => {
      const confirmedLeg: Leg = {
        ...baseLeg,
        status: 'COMPLETED',
        completedAt: '2026-05-08T12:30:00Z',
        recipientConfirmedAt: '2026-05-08T12:35:00Z',
      };
      render(
        <JourneyLegsDisplay
          legs={[confirmedLeg]}
          mode="driver-active"
          onCompleteStop={() => {}}
        />,
      );
      expect(screen.getByTestId('recipient-confirmed-0')).toBeInTheDocument();
    });
  });

  // R3-RECIPIENT-CONFIRM-2 — 3-state badge (EXPLICIT_REPLY / AUTO_TIMEOUT / DISPUTED).
  describe('3-state recipientConfirmed badge (R3-RECIPIENT-CONFIRM-2)', () => {
    test('renders green ✓ badge when recipientConfirmStatus is EXPLICIT_REPLY', () => {
      const leg: Leg = {
        ...baseLeg,
        status: 'COMPLETED',
        completedAt: '2026-05-08T12:30:00Z',
        recipientConfirmedAt: '2026-05-08T12:35:00Z',
        recipientConfirmStatus: 'EXPLICIT_REPLY',
      };
      render(<JourneyLegsDisplay legs={[leg]} mode="preview" />);
      const badge = screen.getByTestId('recipient-confirmed-0');
      expect(badge).toBeInTheDocument();
      expect(badge.dataset.status).toBe('EXPLICIT_REPLY');
      expect(badge.textContent).toMatch(/✓/);
      expect(badge.textContent).toMatch(/Recipient confirmed receipt/);
      expect(badge.className).toMatch(/emerald/);
    });

    test('renders green ✓ badge when recipientConfirmStatus is null but recipientConfirmedAt is set (legacy R3-RECIPIENT-CONFIRM row)', () => {
      const legacyLeg: Leg = {
        ...baseLeg,
        status: 'COMPLETED',
        completedAt: '2026-05-08T12:30:00Z',
        recipientConfirmedAt: '2026-05-08T12:35:00Z',
        recipientConfirmStatus: null,
      };
      render(<JourneyLegsDisplay legs={[legacyLeg]} mode="preview" />);
      const badge = screen.getByTestId('recipient-confirmed-0');
      expect(badge.dataset.status).toBe('EXPLICIT_REPLY');
      expect(badge.textContent).toMatch(/✓/);
      expect(badge.className).toMatch(/emerald/);
    });

    test('renders amber ⏰ badge when recipientConfirmStatus is AUTO_TIMEOUT', () => {
      const leg: Leg = {
        ...baseLeg,
        status: 'COMPLETED',
        completedAt: '2026-05-08T12:30:00Z',
        recipientConfirmedAt: '2026-05-09T12:35:00Z',
        recipientConfirmStatus: 'AUTO_TIMEOUT',
      };
      render(<JourneyLegsDisplay legs={[leg]} mode="preview" />);
      const badge = screen.getByTestId('recipient-confirmed-0');
      expect(badge.dataset.status).toBe('AUTO_TIMEOUT');
      expect(badge.textContent).toMatch(/⏰/);
      expect(badge.textContent).toMatch(/Auto-confirmed/);
      expect(badge.className).toMatch(/amber/);
    });

    test('renders red ⚠ badge with dispute reason when recipientConfirmStatus is DISPUTED', () => {
      const leg: Leg = {
        ...baseLeg,
        status: 'COMPLETED',
        completedAt: '2026-05-08T12:30:00Z',
        recipientConfirmedAt: '2026-05-08T12:40:00Z',
        recipientConfirmStatus: 'DISPUTED',
        recipientDisputeReason: 'WRONG ITEM',
      };
      render(<JourneyLegsDisplay legs={[leg]} mode="preview" />);
      const badge = screen.getByTestId('recipient-confirmed-0');
      expect(badge.dataset.status).toBe('DISPUTED');
      expect(badge.textContent).toMatch(/⚠/);
      expect(badge.textContent).toMatch(/Recipient disputed/);
      expect(badge.textContent).toMatch(/WRONG ITEM/);
      expect(badge.className).toMatch(/rose/);
    });

    test('truncates a long dispute reason to a single-line preview (… suffix)', () => {
      const longReason = 'WRONG ITEM '.repeat(20);
      const leg: Leg = {
        ...baseLeg,
        status: 'COMPLETED',
        completedAt: '2026-05-08T12:30:00Z',
        recipientConfirmedAt: '2026-05-08T12:40:00Z',
        recipientConfirmStatus: 'DISPUTED',
        recipientDisputeReason: longReason,
      };
      render(<JourneyLegsDisplay legs={[leg]} mode="preview" />);
      const badge = screen.getByTestId('recipient-confirmed-0');
      expect(badge.textContent).toMatch(/…/);
    });

    test('DISPUTED with null reason still renders (graceful fallback)', () => {
      const leg: Leg = {
        ...baseLeg,
        status: 'COMPLETED',
        completedAt: '2026-05-08T12:30:00Z',
        recipientConfirmedAt: '2026-05-08T12:40:00Z',
        recipientConfirmStatus: 'DISPUTED',
        recipientDisputeReason: null,
      };
      render(<JourneyLegsDisplay legs={[leg]} mode="preview" />);
      const badge = screen.getByTestId('recipient-confirmed-0');
      expect(badge.dataset.status).toBe('DISPUTED');
      expect(badge.textContent).toMatch(/⚠/);
    });
  });
});
