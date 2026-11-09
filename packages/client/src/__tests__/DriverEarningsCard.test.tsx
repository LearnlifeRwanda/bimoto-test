import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { i18n } from './setup';
import type { PayoutSummary } from '../hooks/useDriverPayout';

const refresh = vi.fn();
const endShift = vi.fn();
let hookState: {
  summary: PayoutSummary | null;
  loading: boolean;
  refresh: typeof refresh;
  endShift: typeof endShift;
};

vi.mock('../hooks/useDriverPayout', () => ({
  useDriverPayout: () => hookState,
}));

import { DriverEarningsCard } from '../components/driver/DriverEarningsCard';

const BASE_SUMMARY: PayoutSummary = {
  pendingAmount: 12500,
  storedPreference: 'AT_SHIFT_END',
  effectivePreference: 'AT_SHIFT_END',
  trainingWheelsActive: false,
  completedShifts: 5,
  canEndShift: true,
  nextScheduledPayout: null,
  payoutsFrozen: false,
};

beforeEach(() => {
  refresh.mockReset().mockResolvedValue(undefined);
  endShift.mockReset();
  hookState = { summary: BASE_SUMMARY, loading: false, refresh, endShift };
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      payout: {
        title: 'Your money today',
        balanceLabel: 'earned today',
        emptyBalance: 'Nothing yet — completed rides land here.',
        scheduleAtShiftEnd: 'Tap the button when you finish for the day.',
        scheduleTwiceDaily: 'Paid twice a day, morning and evening.',
        scheduleDaily22h: 'Paid every night at 22:00.',
        trainingWheelsExplainer:
          'Your first payouts arrive automatically ({{count}}/3 shifts done).',
        landsAt: 'Lands in your MoMo wallet at {{time}}',
        payMeNow: 'Pay me now',
        endShiftSuccess: '{{amount}} RWF on its way — expect it by {{time}}',
        frozenNotice:
          'Your payouts are paused while we review your account. Your balance is safe. Questions? Contact support.',
        waiverLifetime:
          'No Bimoto commission on your rides — you keep 100% of every fare.',
        waiverTemporary:
          'No Bimoto commission until {{date}} — you keep 100% of every fare until then.',
      },
    },
    true,
    true,
  );
});

describe('DriverEarningsCard', () => {
  test('renders RWF-formatted balance and shift-end schedule line', () => {
    render(<DriverEarningsCard />);
    expect(screen.getByTestId('driver-earnings-balance').textContent).toContain('12,500 RWF');
    expect(screen.getByTestId('driver-earnings-schedule').textContent).toBe(
      'Tap the button when you finish for the day.',
    );
    expect(screen.getByTestId('driver-earnings-pay-now')).toBeInTheDocument();
  });

  // LAUNCH-TRUTH G5 — training wheels set the automatic schedule; the
  // manual right stays: a stored-AT_SHIFT_END driver keeps the button.
  test('training-wheels driver sees explainer, lands-at time AND the pay-now button', () => {
    hookState.summary = {
      ...BASE_SUMMARY,
      effectivePreference: 'TWICE_DAILY',
      trainingWheelsActive: true,
      completedShifts: 2,
      canEndShift: true,
      nextScheduledPayout: '2026-07-02T16:00:00.000Z',
    };
    render(<DriverEarningsCard />);
    expect(screen.getByTestId('driver-earnings-training-wheels').textContent).toContain('2/3');
    expect(screen.getByTestId('driver-earnings-pay-now')).toBeInTheDocument();
    expect(screen.getByTestId('driver-earnings-lands-at')).toBeInTheDocument();
  });

  test('driver who chose an automatic schedule has no pay-now button', () => {
    hookState.summary = {
      ...BASE_SUMMARY,
      storedPreference: 'TWICE_DAILY',
      effectivePreference: 'TWICE_DAILY',
      trainingWheelsActive: false,
      canEndShift: false,
      nextScheduledPayout: '2026-07-02T16:00:00.000Z',
    };
    render(<DriverEarningsCard />);
    expect(screen.queryByTestId('driver-earnings-pay-now')).toBeNull();
  });

  test('zero balance is a designed empty state and disables pay-now', () => {
    hookState.summary = { ...BASE_SUMMARY, pendingAmount: 0 };
    render(<DriverEarningsCard />);
    expect(screen.getByTestId('driver-earnings-empty')).toBeInTheDocument();
    expect(screen.getByTestId('driver-earnings-pay-now')).toBeDisabled();
  });

  test('pay-me-now shows confirmation with amount and refreshes', async () => {
    endShift.mockResolvedValue({
      batchId: 'batch-1',
      amount: 12500,
      expectedDeliveryAt: '2026-07-02T14:30:00.000Z',
    });
    render(<DriverEarningsCard />);
    fireEvent.click(screen.getByTestId('driver-earnings-pay-now'));
    await waitFor(() =>
      expect(screen.getByTestId('driver-earnings-confirmation')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('driver-earnings-confirmation').textContent).toContain('12,500');
    expect(refresh).toHaveBeenCalled();
  });

  test('failed end-shift shows no confirmation but still refreshes', async () => {
    endShift.mockResolvedValue(null);
    render(<DriverEarningsCard />);
    fireEvent.click(screen.getByTestId('driver-earnings-pay-now'));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.queryByTestId('driver-earnings-confirmation')).toBeNull();
  });

  test('frozen payouts: balance stays, paused notice replaces pay-now and schedule', () => {
    hookState.summary = { ...BASE_SUMMARY, payoutsFrozen: true };
    render(<DriverEarningsCard />);
    expect(screen.getByTestId('driver-earnings-balance').textContent).toContain('12,500 RWF');
    expect(screen.getByTestId('driver-earnings-frozen-notice').textContent).toBe(
      'Your payouts are paused while we review your account. Your balance is safe. Questions? Contact support.',
    );
    expect(screen.queryByTestId('driver-earnings-pay-now')).toBeNull();
    expect(screen.queryByTestId('driver-earnings-schedule')).toBeNull();
    expect(screen.queryByTestId('driver-earnings-lands-at')).toBeNull();
  });

  test('renders nothing when summary failed to load', () => {
    hookState.summary = null;
    const { container } = render(<DriverEarningsCard />);
    expect(container.firstChild).toBeNull();
  });

  // LAUNCH-TRUTH G4 — the waiver and its cliff are visible in advance.
  test('lifetime waiver: permanent no-commission line', () => {
    hookState.summary = {
      ...BASE_SUMMARY,
      feeWaiver: { type: 'LIFETIME', expiresAt: null },
    };
    render(<DriverEarningsCard />);
    expect(screen.getByTestId('driver-earnings-fee-waiver').textContent).toBe(
      'No Bimoto commission on your rides — you keep 100% of every fare.',
    );
  });

  test('temporary waiver: the cliff date is shown in advance', () => {
    hookState.summary = {
      ...BASE_SUMMARY,
      feeWaiver: { type: 'TEMPORARY', expiresAt: '2027-01-13T00:00:00.000Z' },
    };
    render(<DriverEarningsCard />);
    const text = screen.getByTestId('driver-earnings-fee-waiver').textContent!;
    expect(text).toContain('No Bimoto commission until');
    expect(text).toContain(new Date('2027-01-13T00:00:00.000Z').toLocaleDateString());
  });

  test('no waiver: no waiver line renders', () => {
    hookState.summary = { ...BASE_SUMMARY, feeWaiver: null };
    render(<DriverEarningsCard />);
    expect(screen.queryByTestId('driver-earnings-fee-waiver')).toBeNull();
  });
});
