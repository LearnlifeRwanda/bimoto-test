// MONEY-UX G1/G5 — the ride receipt renders each money line exactly as
// the server reported it, shows the pilot fee-waiver line when the
// breakdown says so, hides lines it has no data for, and degrades to
// the retryable error state on a failed load.
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import { i18n } from './setup';

import RideReceiptPage from '../pages/shared/RideReceiptPage';
import { useAuthStore } from '../stores/auth.store';
import { _resetConnectivityForTests } from '../sync/connectivity';

beforeEach(async () => {
  _resetConnectivityForTests();
  useAuthStore.setState({ token: 'tok' } as any);
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      common: { goBack: 'Go back', retry: 'Retry' },
      states: {
        loadFailed: "This couldn't load",
        loadFailedHint: 'Try again.',
      },
      transparency: {
        rideReceipt: 'Ride Receipt',
        totalPaid: 'Total paid',
        platformFee: 'Platform fee',
        netReceived: 'Net received',
        feeWaivedAmount: '0 RWF — waived (normally {{amount}} RWF)',
        feeWaivedNote: 'Pilot fee waiver — the driver keeps 100% of this fare.',
      },
      receipt: {
        vehicle: 'Vehicle',
        paymentStatus: 'Payment status',
        missingMoneyData: 'Some payment details are not available for this ride.',
      },
      payments: {
        status: { RELEASED: 'Paid to the driver', HELD: 'Paid — held safely' },
      },
      errors: { serverProblem: 'Bimoto has a problem, not your phone' },
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

const FULL_JOURNEY = {
  id: 'j1',
  status: 'COMPLETED',
  pickupName: 'Kimironko',
  destinationName: 'Kigali Heights',
  vehiclePreference: 'MOTO',
  agreedPrice: 900,
  createdAt: '2026-07-20T10:00:00Z',
  confirmedAt: '2026-07-20T10:30:00Z',
  escrow: {
    id: 'e1',
    amount: 900,
    commission: 90,
    driverPayout: 810,
    status: 'RELEASED',
  },
  commissionBreakdown: {
    bidPrice: 900,
    driverTier: 'NEW',
    driverCommissionRate: 0.07,
    customerTier: 'NEW',
    customerCommissionRate: 0.03,
    totalCommissionRate: 0.1,
    totalCommissionAmount: 90,
    driverPayout: 810,
    customerSavings: 0,
    driverSavings: 0,
    feeWaiverApplied: false,
    chargedCommissionAmount: 90,
    waivedCommissionAmount: 0,
  },
};

function stubFetchOk(body: unknown) {
  const mock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
  vi.stubGlobal('fetch', mock);
  return mock;
}

const renderReceipt = () =>
  render(
    <MemoryRouter initialEntries={['/journey/j1/receipt']}>
      <Routes>
        <Route path="/journey/:id/receipt" element={<RideReceiptPage />} />
      </Routes>
    </MemoryRouter>,
  );

describe('MONEY-UX G1 — ride receipt', () => {
  test('renders every money line from a completed journey payload', async () => {
    stubFetchOk(FULL_JOURNEY);
    renderReceipt();

    await waitFor(() => expect(screen.getByTestId('ride-receipt')).toBeInTheDocument());

    expect(screen.getByText('Kimironko')).toBeInTheDocument();
    expect(screen.getByText('Kigali Heights')).toBeInTheDocument();
    expect(screen.getByTestId('receipt-vehicle')).toHaveTextContent('Motorcycle');
    expect(screen.getByTestId('receipt-total-paid')).toHaveTextContent('900 RWF');
    expect(screen.getByTestId('receipt-platform-fee')).toHaveTextContent('(10.0%)');
    expect(screen.getByTestId('receipt-platform-fee')).toHaveTextContent('-90 RWF');
    expect(screen.getByTestId('receipt-driver-received')).toHaveTextContent('810 RWF');
    expect(screen.getByTestId('receipt-payment-status')).toHaveTextContent('Paid to the driver');
    expect(screen.queryByTestId('receipt-no-money-data')).not.toBeInTheDocument();
  });

  test('shows the fee-waiver line when the breakdown says the fee was waived', async () => {
    stubFetchOk({
      ...FULL_JOURNEY,
      escrow: { ...FULL_JOURNEY.escrow, commission: 0, driverPayout: 900, waivedCommissionAmount: 90 },
      commissionBreakdown: {
        ...FULL_JOURNEY.commissionBreakdown,
        feeWaiverApplied: true,
        chargedCommissionAmount: 0,
        waivedCommissionAmount: 90,
        driverPayout: 900,
      },
    });
    renderReceipt();

    await waitFor(() => expect(screen.getByTestId('receipt-fee-waived')).toBeInTheDocument());
    expect(screen.getByTestId('receipt-fee-waived')).toHaveTextContent('waived (normally 90 RWF)');
    expect(screen.getByTestId('receipt-driver-received')).toHaveTextContent('900 RWF');
  });

  test('hides money lines it has no data for and says so', async () => {
    stubFetchOk({
      id: 'j2',
      status: 'COMPLETED',
      pickupName: 'Nyamirambo',
      destinationName: 'Remera',
      vehiclePreference: null,
      agreedPrice: null,
      createdAt: '2026-07-20T10:00:00Z',
      escrow: null,
    });
    renderReceipt();

    await waitFor(() => expect(screen.getByTestId('ride-receipt')).toBeInTheDocument());
    expect(screen.queryByTestId('receipt-total-paid')).not.toBeInTheDocument();
    expect(screen.queryByTestId('receipt-platform-fee')).not.toBeInTheDocument();
    expect(screen.queryByTestId('receipt-driver-received')).not.toBeInTheDocument();
    expect(screen.queryByTestId('receipt-vehicle')).not.toBeInTheDocument();
    expect(screen.queryByTestId('receipt-payment-status')).not.toBeInTheDocument();
    expect(screen.getByTestId('receipt-no-money-data')).toBeInTheDocument();
  });

  test('a failed load renders the retryable error state, never a fake receipt', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
    renderReceipt();

    await waitFor(() => expect(screen.getByTestId('error-state')).toBeInTheDocument());
    expect(screen.queryByTestId('ride-receipt')).not.toBeInTheDocument();
  });
});
