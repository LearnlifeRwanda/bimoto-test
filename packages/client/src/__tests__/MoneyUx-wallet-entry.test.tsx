// MONEY-UX G4/G5 — the driver's Profile gains a "Wallet" entry that
// navigates to the EXISTING money screen (/driver/account, which now
// leads with the "Your money today" card); customers see the Payments
// entry instead and never a wallet.
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import { i18n } from './setup';

import ProfilePage from '../pages/shared/ProfilePage';
import AccountPage from '../pages/driver/AccountPage';
import { useAuthStore } from '../stores/auth.store';
import { _resetConnectivityForTests } from '../sync/connectivity';

const ACCOUNT_STATUS = {
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

const PAYOUT_SUMMARY = {
  pendingAmount: 500,
  storedPreference: 'DAILY_22H',
  effectivePreference: 'DAILY_22H',
  trainingWheelsActive: false,
  completedShifts: 5,
  canEndShift: false,
  nextScheduledPayout: null,
  payoutsFrozen: false,
};

function stubFetch() {
  const mock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/payout/summary')) {
      return new Response(JSON.stringify(PAYOUT_SUMMARY), { status: 200 });
    }
    if (url.includes('/api/users/me/account-status')) {
      return new Response(JSON.stringify(ACCOUNT_STATUS), { status: 200 });
    }
    return new Response('[]', { status: 200 });
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

function setUser(role: 'DRIVER' | 'CUSTOMER') {
  useAuthStore.setState({
    user: {
      id: 'user-1',
      nickname: 'Test',
      role,
      language: 'en',
      idVerified: false,
      licenseVerified: false,
      completedRides: 3,
      cancellationCount: 0,
      totalRequests: 3,
    },
    isAuthenticated: true,
    isLoading: false,
    token: 'tok',
  } as any);
}

beforeEach(async () => {
  _resetConnectivityForTests();
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      wallet: { title: 'Wallet' },
      payments: { title: 'Payments' },
      profile: {
        title: 'Profile',
        ridesCompleted: 'Rides completed',
        idNotVerified: 'ID not verified',
        licenseNotVerified: 'License not verified',
        editProfile: 'Edit profile',
        emergencyContacts: 'Emergency contacts',
        noContacts: 'No contacts yet',
        addContact: 'Add contact',
      },
      settings: { title: 'Settings', language: 'Language', logout: 'Log Out' },
      guide: { title: 'User guide' },
      account: { title: 'Account status', statusActive: 'Active', noShowCount: 'No-shows', warningThreshold: 'Warning', suspensionThreshold: 'Suspension', flagThreshold: 'Flag', cancellationCount: 'Cancellations', lateMarkCount: 'Late marks', wrongVehicleCount: 'Wrong vehicle', driverInitiatedCancellationCount: 'Driver cancellations', recentDisputes: 'Recent disputes', noRecentDisputes: 'None' },
      payout: {
        title: 'Your money today',
        balanceLabel: 'earned, waiting to be paid',
        scheduleDaily22h: 'You get paid every night at 22:00.',
        prefSectionTitle: 'When do you get paid?',
        prefTwiceDaily: 'Twice a day',
        prefTwiceDailyDesc: 'Morning and evening.',
        prefDaily22h: 'Once a day',
        prefDaily22hDesc: 'Every night at 22:00.',
        prefAtShiftEnd: 'When I end my shift',
        prefAtShiftEndDesc: 'You tap Pay me now.',
        currentChoice: 'Current',
        smsFallback: 'No smartphone? Send BALANCE by SMS.',
      },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  _resetConnectivityForTests();
});

const renderProfile = () =>
  render(
    <MemoryRouter initialEntries={['/profile']}>
      <Routes>
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/driver/account" element={<AccountPage />} />
      </Routes>
    </MemoryRouter>,
  );

describe('MONEY-UX G4 — driver wallet entry', () => {
  test('driver Profile shows Wallet and it opens the existing money screen', async () => {
    stubFetch();
    setUser('DRIVER');
    renderProfile();

    const link = screen.getByTestId('profile-wallet-link');
    expect(link).toHaveTextContent('Wallet');
    fireEvent.click(link);

    // The destination is the existing screen: "Your money today" card
    // plus the payout-schedule chooser, unchanged.
    await waitFor(() => expect(screen.getByTestId('driver-earnings-card')).toBeInTheDocument());
    expect(screen.getByText('Your money today')).toBeInTheDocument();
    expect(screen.getByTestId('driver-earnings-balance')).toHaveTextContent('500 RWF');
    expect(screen.getByTestId('payout-preference-section')).toBeInTheDocument();
  });

  test('customer Profile shows Payments, not a wallet', () => {
    stubFetch();
    setUser('CUSTOMER');
    renderProfile();

    expect(screen.queryByTestId('profile-wallet-link')).not.toBeInTheDocument();
    expect(screen.getByTestId('profile-payments-link')).toHaveTextContent('Payments');
  });
});
