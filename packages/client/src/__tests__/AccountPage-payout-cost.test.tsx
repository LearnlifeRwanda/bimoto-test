// TEAM-SAID G2 — what each payout choice costs, on the screen that
// offers it.
//
// The team settled item 11 on Option A (5 of 7): Bimoto pays the
// transfer fee on the scheduled payout, and the driver pays 500 RWF
// only for an immediate, off-schedule withdrawal. The screen already
// listed the three choices; what it never said was the price of any
// of them.
//
// So what is worth proving is that a driver opening this page reads
// the whole truth — the three choices cost him nothing, AND the one
// case where he does pay — and that the number he reads comes from the
// shared constant rather than from copy someone typed three times.

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { i18n } from './setup';
import type { PayoutSummary } from '../hooks/useDriverPayout';
import { PAYOUT_TRANSFER_FEE_RWF } from '@bimoto/shared';

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

const PREFERENCES = ['TWICE_DAILY', 'DAILY_22H', 'AT_SHIFT_END'] as const;

beforeEach(async () => {
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
        // The two strings under test, with the interpolation the page
        // feeds from the shared constant.
        costScheduled: 'Costs you nothing — Bimoto pays the {{fee}} RWF transfer fee.',
        costImmediateWithdrawal:
          'If you ask to be paid immediately, outside your schedule, the {{fee}} RWF transfer fee comes out of your money.',
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

describe('AccountPage — what each payout choice costs', () => {
  test('every one of the three choices states its cost', async () => {
    render(
      <MemoryRouter>
        <AccountPage />
      </MemoryRouter>,
    );
    await screen.findByTestId('payout-preference-section');

    for (const pref of PREFERENCES) {
      const cost = screen.getByTestId(`payout-pref-cost-${pref}`);
      // All three ARE the scheduled payout, so all three are free.
      expect(cost).toHaveTextContent('Costs you nothing');
      expect(cost).toHaveTextContent('Bimoto pays');
    }
  });

  test('the cost line sits inside the row for its own choice', async () => {
    render(
      <MemoryRouter>
        <AccountPage />
      </MemoryRouter>,
    );
    await screen.findByTestId('payout-preference-section');

    // "Beside each of the three payout preferences" — a note floating
    // at the bottom of the section would not tell a driver which
    // choice it describes.
    for (const pref of PREFERENCES) {
      const row = screen.getByTestId(`payout-pref-option-${pref}`);
      expect(row).toContainElement(screen.getByTestId(`payout-pref-cost-${pref}`));
    }
  });

  test('the one case where the driver does pay is stated too', async () => {
    render(
      <MemoryRouter>
        <AccountPage />
      </MemoryRouter>,
    );
    await screen.findByTestId('payout-preference-section');

    const note = screen.getByTestId('payout-immediate-fee-note');
    expect(note).toHaveTextContent('immediately');
    expect(note).toHaveTextContent(`${PAYOUT_TRANSFER_FEE_RWF} RWF`);
    expect(note).toHaveTextContent('comes out of your money');
  });

  test('the number comes from the shared constant, not from typed copy', async () => {
    render(
      <MemoryRouter>
        <AccountPage />
      </MemoryRouter>,
    );
    await screen.findByTestId('payout-preference-section');

    // If someone hardcodes a different number into the page, or the
    // team changes the fee, these two must move together.
    expect(screen.getByTestId('payout-pref-cost-TWICE_DAILY')).toHaveTextContent(
      `${PAYOUT_TRANSFER_FEE_RWF} RWF`,
    );
    expect(PAYOUT_TRANSFER_FEE_RWF).toBe(500);
  });

  test('the existing pilot fee waiver is untouched by the cost copy', async () => {
    // The waiver concerns platform commission, not the transfer fee.
    // A driver holding one still reads the same payout costs.
    summary = { ...summary!, feeWaiver: { type: 'LIFETIME', expiresAt: null } };
    render(
      <MemoryRouter>
        <AccountPage />
      </MemoryRouter>,
    );
    await screen.findByTestId('payout-preference-section');

    for (const pref of PREFERENCES) {
      expect(screen.getByTestId(`payout-pref-cost-${pref}`)).toHaveTextContent(
        'Costs you nothing',
      );
    }
    expect(screen.getByTestId('payout-immediate-fee-note')).toBeInTheDocument();
  });
});
