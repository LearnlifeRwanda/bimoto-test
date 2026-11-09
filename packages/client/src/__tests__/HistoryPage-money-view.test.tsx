// MONEY-VIEW v2 G3 — the rides list stops being dead about money.
//
// HistoryPage has carried two guarded money blocks since D7/C6: a chip on
// the collapsed row and a full breakdown in the expanded panel. Both read
// `journey.commissionBreakdown`, and NOTHING HAS EVER ATTACHED ONE. There
// is no such column on `Journey` and the list route computed nothing, so
// the blocks rendered for nobody — CLEAN-SWEEP G1 guarded them anyway
// (the guard's job is to make the shape safe, not to bet on which shapes
// arrive) and recorded them as dead.
//
// `getJourneys` now attaches a per-row view DERIVED FROM THE ESCROW ROW.
// That derivation matters as much as the attachment: recomputing from
// today's tier counts would answer for the rider a passenger IS, not the
// one she WAS when the ride settled, and a customer crossing the 20-ride
// line would watch her own history rewrite itself.
//
// And it is not one view. The customer gets the customer-safe FOUR, the
// motari his settlement — so this screen, which BOTH roles reach at
// /rides, discriminates BY SHAPE and needs no role context at all. That
// is why the fixtures below are the two payloads and not two users.
//
// PAGE-mounted, per #203.
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';
import { i18n } from './setup';

import { HistoryPage } from '../pages/shared/HistoryPage';
import { useAuthStore } from '../stores/auth.store';
import { _resetConnectivityForTests } from '../sync/connectivity';

/** What the server now sends a PASSENGER: the customer-safe four. */
const CUSTOMER_ROW = {
  id: 'j-cust',
  pickupName: 'Kimironko Market',
  destinationName: 'Kigali Heights',
  status: 'COMPLETED',
  agreedPrice: 2000,
  createdAt: '2026-07-20T10:00:00Z',
  commissionBreakdown: {
    bidPrice: 2000,
    customerTier: 'FREQUENT',
    customerSavings: 30,
    feeWaiverApplied: false,
  },
};

/** What it sends the MOTARI on a ride he drove: the full settlement. */
const DRIVER_ROW = {
  id: 'j-drv',
  pickupName: 'Nyabugogo',
  destinationName: 'Remera',
  status: 'COMPLETED',
  agreedPrice: 2000,
  createdAt: '2026-07-21T10:00:00Z',
  commissionBreakdown: {
    bidPrice: 2000,
    driverTier: 'REGULAR',
    driverCommissionRate: 0.035,
    customerTier: 'FREQUENT',
    customerCommissionRate: 0.035,
    totalCommissionRate: 0.07,
    totalCommissionAmount: 140,
    driverPayout: 1860,
    customerSavings: 30,
    driverSavings: 30,
    feeWaiverApplied: false,
    chargedCommissionAmount: 140,
    waivedCommissionAmount: 0,
  },
};

/** The third shape: no breakdown at all — an older server, a cached list. */
const BARE_ROW = {
  id: 'j-bare',
  pickupName: 'Kacyiru',
  destinationName: 'Gikondo',
  status: 'COMPLETED',
  agreedPrice: 2000,
  createdAt: '2026-07-22T10:00:00Z',
};

beforeEach(async () => {
  _resetConnectivityForTests();
  useAuthStore.setState({ token: 'tok' } as any);
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      common: { retry: 'Retry' },
      states: { loadFailed: "This couldn't load", loadFailedHint: 'Try again.' },
      history: { title: 'My rides', empty: 'No rides yet', emptyHint: 'Request one.' },
      scheduled: { upcomingTitle: 'Upcoming rides' },
      status: { COMPLETED: 'Completed' },
      receipt: { viewReceipt: 'View receipt' },
      transparency: {
        totalPaid: 'Total paid',
        platformFee: 'Platform fee',
        feeWaivedChip: 'fee waived',
        feeWaivedAmount: '0 RWF — waived (normally {{amount}} RWF)',
        customerTierLine: 'Your tier: {{tier}}',
        tierSavings: 'Your {{tier}} tier saves you {{amount}} RWF',
        customerFeeWaived: 'Platform fee waived during the pilot.',
        driverCommission: 'Driver fee ({{tier}} {{rate}}%)',
        customerCommission: 'Rider fee ({{tier}} {{rate}}%)',
        netReceived: 'You received',
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

function stubFetchOk(body: unknown) {
  const mock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
  vi.stubGlobal('fetch', mock);
  return mock;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/rides']}>
      <Routes>
        <Route path="/rides" element={<HistoryPage />} />
        <Route path="/journey/:id/receipt" element={<div data-testid="receipt-stub" />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function expand(id: string) {
  renderPage();
  await waitFor(() => expect(screen.getByText('Completed')).toBeInTheDocument());
  fireEvent.click(screen.getByTestId(`history-row-${id}`));
}

describe("the passenger's row shows her savings and nothing of his", () => {
  test('her tier and saving render in the expanded panel', async () => {
    stubFetchOk([CUSTOMER_ROW]);
    await expand('j-cust');

    await waitFor(() =>
      expect(
        screen.getByTestId('history-transparency-customer-j-cust'),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText('Your tier: FREQUENT')).toBeInTheDocument();
    expect(screen.getByText('Your FREQUENT tier saves you 30 RWF')).toBeInTheDocument();
  });

  test('and NOT one line of the motari’s settlement', async () => {
    stubFetchOk([CUSTOMER_ROW]);
    await expand('j-cust');

    await waitFor(() =>
      expect(
        screen.getByTestId('history-transparency-customer-j-cust'),
      ).toBeInTheDocument(),
    );
    // The full block reads driverPayout, the rates and the commission
    // total. A customer-safe payload carries none of them, so rendering
    // it would be `undefined.toLocaleString()` — the CLEAN-SWEEP crash.
    expect(screen.queryByText('You received')).not.toBeInTheDocument();
    expect(screen.queryByText(/Driver fee/)).not.toBeInTheDocument();
    expect(screen.queryByText(/1,860/)).not.toBeInTheDocument();
    // And no fabricated zero standing in for what she may not see.
    expect(screen.queryByText(/^0 RWF$/)).not.toBeInTheDocument();
  });

  test('a waived fee is a chip and a sentence, never an amount', async () => {
    stubFetchOk([
      {
        ...CUSTOMER_ROW,
        commissionBreakdown: { ...CUSTOMER_ROW.commissionBreakdown, feeWaiverApplied: true },
      },
    ]);
    await expand('j-cust');

    expect(screen.getByTestId('fee-waived-chip')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('history-fee-waived-j-cust')).toBeInTheDocument(),
    );
    // `feeWaivedAmount` quotes totalCommissionAmount — the field the
    // redaction exists to withhold — so her line must never use it.
    expect(screen.queryByText(/normally/)).not.toBeInTheDocument();
  });

  test('a zero saving prints no savings line', async () => {
    stubFetchOk([
      {
        ...CUSTOMER_ROW,
        commissionBreakdown: {
          ...CUSTOMER_ROW.commissionBreakdown,
          customerTier: 'REGULAR',
          customerSavings: 0,
        },
      },
    ]);
    await expand('j-cust');

    await waitFor(() =>
      expect(screen.getByText('Your tier: REGULAR')).toBeInTheDocument(),
    );
    expect(screen.queryByText(/saves you/)).not.toBeInTheDocument();
  });

  test('she never sees a platform-fee RATE chip on the collapsed row', async () => {
    stubFetchOk([CUSTOMER_ROW]);
    renderPage();
    await waitFor(() => expect(screen.getByText('Completed')).toBeInTheDocument());
    // rate x price IS the commission, and price − commission IS his net.
    expect(screen.queryByText(/Platform fee 7\.0%/)).not.toBeInTheDocument();
  });
});

describe("the motari's row shows the settlement he is owed", () => {
  test('the full block renders, with his net', async () => {
    stubFetchOk([DRIVER_ROW]);
    await expand('j-drv');

    await waitFor(() => expect(screen.getByText('You received')).toBeInTheDocument());
    expect(screen.getByText(/1,860/)).toBeInTheDocument();
    expect(screen.getByText(/Driver fee \(REGULAR 3\.5%\)/)).toBeInTheDocument();
  });

  test('and the customer variant does NOT also render beside it', async () => {
    // The full shape satisfies `hasCustomerSafeCommission` too — it is a
    // superset — so the variant must be ordered after it and mutually
    // exclusive, or every driver row would render both blocks.
    stubFetchOk([DRIVER_ROW]);
    await expand('j-drv');

    await waitFor(() => expect(screen.getByText('You received')).toBeInTheDocument());
    expect(
      screen.queryByTestId('history-transparency-customer-j-drv'),
    ).not.toBeInTheDocument();
  });

  test('his collapsed row still carries the platform-fee rate chip', async () => {
    stubFetchOk([DRIVER_ROW]);
    renderPage();
    await waitFor(() => expect(screen.getByText('Completed')).toBeInTheDocument());
    expect(screen.getByText(/Platform fee 7\.0%/)).toBeInTheDocument();
  });
});

describe('a row with no breakdown at all is unchanged', () => {
  test('it still expands and still offers the receipt', async () => {
    // MONEY-UX G1's behaviour, pinned unchanged: the panel opens for a
    // COMPLETED row whether or not money came with it, so the receipt
    // link stays reachable.
    stubFetchOk([BARE_ROW]);
    await expand('j-bare');

    await waitFor(() =>
      expect(screen.getByTestId('history-receipt-link-j-bare')).toBeInTheDocument(),
    );
    expect(
      screen.queryByTestId('history-transparency-customer-j-bare'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('You received')).not.toBeInTheDocument();
  });

  test('the page still issues exactly ONE request', async () => {
    const mock = stubFetchOk([CUSTOMER_ROW, DRIVER_ROW, BARE_ROW]);
    renderPage();
    await waitFor(() => expect(screen.getAllByText('Completed').length).toBe(3));
    expect(mock).toHaveBeenCalledTimes(1);
  });
});
