// PAYOUT-C — payout preference section on the driver Account page.
// Covers the radio list (current choice marked), the OTP flow
// (request → 6-digit input → confirm), and the post-change success
// panel with the ~30-minute cooldown note.
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { i18n } from './setup';
import type { PayoutSummary } from '../hooks/useDriverPayout';

const requestPreferenceOtp = vi.fn();
const changePreference = vi.fn();
const refresh = vi.fn();
const endShift = vi.fn();
let summary: PayoutSummary | null;

vi.mock('../hooks/useDriverPayout', () => ({
  useDriverPayout: () => ({
    summary,
    loading: false,
    refresh,
    endShift,
    requestPreferenceOtp,
    changePreference,
  }),
}));

// TEAM-SAID G4 — AccountPage now carries the entry point to the
// auto-bid rules screen, so it uses useNavigate and must render
// inside a router.
import { AccountPage } from '../pages/driver/AccountPage';
import { useAuthStore } from '../stores/auth.store';

const accountStatus = {
  status: 'ACTIVE',
  suspendedUntil: null,
  isFlagged: false,
  counters: {
    noShowCount: 0,
    cancellationCount: 0,
    lateMarkCount: 0,
    wrongVehicleCount: 0,
    driverInitiatedCancellationCount: 0,
    completedRides: 12,
  },
  thresholds: { noShowWarning: 3, noShowSuspension24h: 5, noShowFlag: 10 },
  recentDisputes: [],
};

beforeEach(async () => {
  requestPreferenceOtp.mockReset();
  changePreference.mockReset();
  summary = {
    pendingAmount: 4000,
    storedPreference: 'TWICE_DAILY',
    effectivePreference: 'TWICE_DAILY',
    trainingWheelsActive: false,
    completedShifts: 6,
    canEndShift: false,
    nextScheduledPayout: '2026-07-02T16:00:00.000Z',
    payoutsFrozen: false,
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, statusText: 'OK', json: async () => accountStatus })) as any,
  );
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      account: {
        title: 'Account status',
        statusActive: 'Active',
        recentDisputes: 'Recent disputes',
        noRecentDisputes: 'No disputes filed yet',
      },
      payout: {
        prefSectionTitle: 'When do you get paid?',
        prefTwiceDaily: 'Twice a day',
        prefTwiceDailyDesc: 'Morning and evening',
        prefDaily22h: 'Every night',
        prefDaily22hDesc: 'At 22:00',
        prefAtShiftEnd: 'When I end my shift',
        prefAtShiftEndDesc: 'You tap the button',
        currentChoice: 'Current',
        changeLimitNote: 'You can change this once every 24 hours.',
        cooldownNote: 'Pending money follows in about 30 minutes.',
        sendCode: 'Send me a code',
        codeSent: 'We sent a 6-digit code by SMS.',
        codePlaceholder: '______',
        codeInputLabel: 'SMS code',
        confirmChange: 'Confirm change',
        prefChangeSuccess: 'Your payout schedule is updated.',
        pendingFollows: 'Your pending money will follow at about {{time}}.',
        smsFallback: 'No smartphone? Text BALANCE to check your money.',
        trainingWheelsExplainer: 'First payouts arrive automatically ({{count}}/3).',
      },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');
  useAuthStore.setState({
    token: 'tok',
    user: { id: 'driver-1', role: 'DRIVER' } as any,
    isAuthenticated: true,
    isLoading: false,
  });
});

describe('AccountPage — payout preference section', () => {
  test('renders the three options with the stored preference marked current', async () => {
    render(
      <MemoryRouter>
        <AccountPage />
      </MemoryRouter>,
    );
    await screen.findByTestId('payout-preference-section');
    for (const pref of ['TWICE_DAILY', 'DAILY_22H', 'AT_SHIFT_END']) {
      expect(screen.getByTestId(`payout-pref-option-${pref}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId('payout-pref-option-TWICE_DAILY')).toHaveAttribute(
      'data-current',
    );
    expect(screen.queryByTestId('payout-pref-confirm-panel')).toBeNull();
  });

  test('selecting a different option shows limit + cooldown notes, then the OTP input', async () => {
    requestPreferenceOtp.mockResolvedValue({
      otpId: 'otp-1',
      expiresAt: '2026-07-02T13:10:00.000Z',
    });
    render(
      <MemoryRouter>
        <AccountPage />
      </MemoryRouter>,
    );
    await screen.findByTestId('payout-preference-section');

    fireEvent.click(screen.getByTestId('payout-pref-option-DAILY_22H'));
    const panel = screen.getByTestId('payout-pref-confirm-panel');
    expect(panel.textContent).toContain('once every 24 hours');
    expect(panel.textContent).toContain('about 30 minutes');

    fireEvent.click(screen.getByTestId('payout-pref-send-code'));
    await waitFor(() => expect(screen.getByTestId('payout-pref-otp-panel')).toBeInTheDocument());
    expect(requestPreferenceOtp).toHaveBeenCalledWith('DAILY_22H');
  });

  test('confirming with a 6-digit code calls changePreference and shows success + cooldown time', async () => {
    requestPreferenceOtp.mockResolvedValue({
      otpId: 'otp-1',
      expiresAt: '2026-07-02T13:10:00.000Z',
    });
    changePreference.mockResolvedValue({
      newPreference: 'DAILY_22H',
      immediatePayoutQueued: true,
      queuedFor: '2026-07-02T14:00:00.000Z',
    });
    render(
      <MemoryRouter>
        <AccountPage />
      </MemoryRouter>,
    );
    await screen.findByTestId('payout-preference-section');

    fireEvent.click(screen.getByTestId('payout-pref-option-DAILY_22H'));
    fireEvent.click(screen.getByTestId('payout-pref-send-code'));
    await waitFor(() => expect(screen.getByTestId('payout-pref-otp-panel')).toBeInTheDocument());

    const input = screen.getByTestId('payout-pref-code-input');
    const confirm = screen.getByTestId('payout-pref-confirm');
    expect(confirm).toBeDisabled();
    fireEvent.change(input, { target: { value: '123456' } });
    expect(confirm).not.toBeDisabled();

    fireEvent.click(confirm);
    await waitFor(() => expect(screen.getByTestId('payout-pref-success')).toBeInTheDocument());
    expect(changePreference).toHaveBeenCalledWith('DAILY_22H', 'otp-1', '123456');
    expect(screen.getByTestId('payout-pref-success').textContent).toContain(
      'pending money will follow',
    );
  });

  test('failed change (e.g. rate-limited, surfaced by the hook) shows no success panel', async () => {
    requestPreferenceOtp.mockResolvedValue({
      otpId: 'otp-1',
      expiresAt: '2026-07-02T13:10:00.000Z',
    });
    changePreference.mockResolvedValue(null);
    render(
      <MemoryRouter>
        <AccountPage />
      </MemoryRouter>,
    );
    await screen.findByTestId('payout-preference-section');

    fireEvent.click(screen.getByTestId('payout-pref-option-DAILY_22H'));
    fireEvent.click(screen.getByTestId('payout-pref-send-code'));
    await waitFor(() => expect(screen.getByTestId('payout-pref-otp-panel')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('payout-pref-code-input'), {
      target: { value: '999999' },
    });
    fireEvent.click(screen.getByTestId('payout-pref-confirm'));
    await waitFor(() => expect(changePreference).toHaveBeenCalled());
    expect(screen.queryByTestId('payout-pref-success')).toBeNull();
    // The OTP panel stays so the driver can retry with a fresh code.
    expect(screen.getByTestId('payout-pref-otp-panel')).toBeInTheDocument();
  });
});
