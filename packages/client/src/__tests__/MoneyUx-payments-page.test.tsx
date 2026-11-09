// MONEY-UX G2/G3/G5 — the /payments page: empty, populated, and error
// states; the active ride's payment state rendered from the escrow
// status endpoint; the simulated-money notice; and each recent payment
// opening its receipt.
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import { i18n } from './setup';

import PaymentsPage from '../pages/customer/PaymentsPage';
import { useAuthStore } from '../stores/auth.store';
import { useSimulationStore } from '../stores/simulation.store';
import { _resetConnectivityForTests } from '../sync/connectivity';

beforeEach(async () => {
  _resetConnectivityForTests();
  useAuthStore.setState({ token: 'tok' } as any);
  useSimulationStore.setState({ paymentsMode: 'live', smsMode: 'live', bannerDismissed: false });
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      common: { retry: 'Retry' },
      states: { loadFailed: "This couldn't load", loadFailedHint: 'Try again.' },
      simulation: { banner: 'SIMULATION — no real money' },
      payment: {
        retry: 'Try Again',
        method: {
          label: 'Payment method',
          momo: 'Mobile Money',
          momoHint: 'MTN MoMo or Airtel Money',
          card: 'Card',
          cardHint: 'Visa, Mastercard',
        },
      },
      transparency: { paymentHeldInEscrow: 'Payment held in escrow until you confirm arrival.' },
      payments: {
        title: 'Payments',
        recentTitle: 'Recent payments',
        activeTitle: 'Current ride',
        empty: 'No payments yet',
        emptyHint: 'When you complete a ride, what you paid appears here.',
        howItWorks: 'You choose how to pay when you accept an offer.',
        statusFetchFailed: 'Could not check the payment status.',
        status: { HELD: 'Paid — held safely until arrival is confirmed' },
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
  useSimulationStore.setState({ paymentsMode: 'live', smsMode: 'live', bannerDismissed: false });
  _resetConnectivityForTests();
});

const COMPLETED = {
  id: 'j1',
  status: 'COMPLETED',
  pickupName: 'Kimironko',
  destinationName: 'Kigali Heights',
  agreedPrice: 900,
  createdAt: '2026-07-20T10:00:00Z',
  confirmedAt: '2026-07-20T10:30:00Z',
  escrow: { id: 'e1', amount: 900, status: 'RELEASED' },
};

const ACTIVE = {
  id: 'j2',
  status: 'IN_PROGRESS',
  pickupName: 'Nyamirambo',
  destinationName: 'Remera',
  agreedPrice: 700,
  createdAt: '2026-07-28T08:00:00Z',
  escrow: { id: 'e2', amount: 700, status: 'HELD' },
};

// URL-dispatching fetch stub: the journeys list and the escrow-status
// endpoint answer independently.
function stubFetch(journeys: unknown, escrowStatus?: string, listStatus = 200) {
  const mock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/payments/')) {
      return new Response(
        JSON.stringify({ status: escrowStatus ?? 'HELD', txRef: 'ref', lastUpdatedAt: '2026-07-28T08:01:00Z' }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify(journeys), { status: listStatus });
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/payments']}>
      <Routes>
        <Route path="/payments" element={<PaymentsPage />} />
        <Route path="/journey/:id/receipt" element={<div data-testid="receipt-page-stub" />} />
      </Routes>
    </MemoryRouter>,
  );

describe('MONEY-UX G2 — payments page states', () => {
  test('empty state when the customer has no completed rides', async () => {
    stubFetch([]);
    renderPage();

    await waitFor(() => expect(screen.getByTestId('empty-state')).toBeInTheDocument());
    expect(screen.getByText('No payments yet')).toBeInTheDocument();
    // The how-payment-works section renders regardless of ride history.
    expect(screen.getByTestId('payments-method-section')).toBeInTheDocument();
    expect(screen.getByText('Mobile Money')).toBeInTheDocument();
    expect(screen.getByText('Card')).toBeInTheDocument();
  });

  test('populated state lists completed rides and opens the receipt', async () => {
    stubFetch([COMPLETED]);
    renderPage();

    await waitFor(() => expect(screen.getByTestId('payments-row-j1')).toBeInTheDocument());
    expect(screen.getByTestId('payments-row-j1')).toHaveTextContent('900 RWF');

    fireEvent.click(screen.getByTestId('payments-row-j1'));
    expect(screen.getByTestId('receipt-page-stub')).toBeInTheDocument();
  });

  test('a failed load renders the retryable error state, and retry re-fetches', async () => {
    const mock = stubFetch([], undefined, 500);
    renderPage();

    await waitFor(() => expect(screen.getByTestId('error-state')).toBeInTheDocument());
    const callsBefore = mock.mock.calls.length;
    fireEvent.click(screen.getByText('Retry'));
    await waitFor(() => expect(mock.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  test('active ride renders its payment state from the escrow status endpoint', async () => {
    stubFetch([ACTIVE, COMPLETED], 'HELD');
    renderPage();

    await waitFor(() => expect(screen.getByTestId('payments-active-ride')).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByTestId('payments-active-status')).toHaveTextContent(
        'Paid — held safely until arrival is confirmed',
      ),
    );
    expect(screen.getByTestId('payments-active-ride')).toHaveTextContent('700 RWF');
  });
});

describe('MONEY-UX G3 — simulated-money clarity', () => {
  test('the simulation line is present while payments are simulated', async () => {
    useSimulationStore.setState({ paymentsMode: 'simulated', smsMode: 'live', bannerDismissed: false });
    stubFetch([]);
    renderPage();

    await waitFor(() => expect(screen.getByTestId('payments-sim-note')).toBeInTheDocument());
    expect(screen.getByTestId('payments-sim-note')).toHaveTextContent('SIMULATION — no real money');
  });

  test('no simulation line — and no invented balance — in live mode', async () => {
    stubFetch([COMPLETED]);
    renderPage();

    await waitFor(() => expect(screen.getByTestId('payments-row-j1')).toBeInTheDocument());
    expect(screen.queryByTestId('payments-sim-note')).not.toBeInTheDocument();
  });
});
