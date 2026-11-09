// PAY-TRUTH G5 — the retry surface, from the passenger's side.
//
// G1's R1 is the row this file exists for: /accept-bid answers 200 with a
// journey object that reads MATCHED even though the charge was declined,
// and the page used to navigate to the live-tracking MatchedPage on that
// alone — a customer whose money was never taken watching a map for a ride
// that did not exist. These tests pin the opposite behaviour, and the one
// tap that rescues it.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import '../../../__tests__/setup';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<any>);
  return { ...actual, useNavigate: () => mockNavigate };
});

import { BidListPage } from '../BidListPage';
import { useAuthStore } from '../../../stores/auth.store';
import { useBidStore } from '../../../stores/bid.store';
import { useJourneyStore } from '../../../stores/journey.store';
import { useSimulationStore } from '../../../stores/simulation.store';

const JID = 'j1';
const ESCROW = 'e1';

const sampleBid = {
  id: 'b1',
  price: 2000,
  driverName: 'Driver Joe',
  etaMinutes: 8,
  commissionBreakdown: undefined,
};

function resp(data: any, ok = true, status = 200) {
  return { ok, status, statusText: 'err', json: async () => data };
}

type FetchOpts = {
  /** What /accept-bid answers. */
  accept?: any;
  /** What the journey GET answers. */
  journey?: any;
  /** Queue of answers for POST /api/payments/initiate. */
  initiate?: Array<{ ok: boolean; status: number; body: any }>;
  /** What GET /api/payments/:id/status answers. */
  status?: any;
};

function installFetch(opts: FetchOpts = {}) {
  const initiateQueue = [...(opts.initiate ?? [])];
  const fetchMock = vi.fn(async (url: string, _init?: any) => {
    if (url.endsWith(`/journeys/${JID}/bids`)) return resp([sampleBid]);
    if (url.endsWith(`/journeys/${JID}/accept-bid`)) {
      return resp(
        opts.accept ?? {
          journey: { id: JID },
          bid: {},
          escrowStatus: 'FAILED',
          escrowId: ESCROW,
          escrowTxRef: 'bimoto-j1-1',
          escrowAmount: 2000,
          paymentFailureCode: 'INSUFFICIENT_FUNDS',
        },
      );
    }
    if (url.endsWith('/api/payments/initiate')) {
      const next = initiateQueue.shift() ?? { ok: true, status: 200, body: { status: 'HELD', txRef: 'bimoto-j1-2' } };
      return resp(next.body, next.ok, next.status);
    }
    if (url.includes(`/api/payments/${ESCROW}/status`)) {
      return resp(opts.status ?? { status: 'FAILED', txRef: 'bimoto-j1-1', lastUpdatedAt: '' });
    }
    if (url.endsWith(`/journeys/${JID}`)) {
      return resp(opts.journey ?? { id: JID, pickupName: 'A', destinationName: 'B' });
    }
    return resp({});
  });
  vi.stubGlobal('fetch', fetchMock as any);
  return fetchMock;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/journey/${JID}/bids`]}>
      <Routes>
        <Route path="/journey/:id/bids" element={<BidListPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockNavigate.mockReset();
  useAuthStore.setState({ token: 'tok-1', user: { nickname: 'Aljo', phone: '+250788111111' } as any });
  useBidStore.setState({ bids: [sampleBid] });
  useJourneyStore.setState({ activeJourney: null });
  useSimulationStore.setState({ paymentsMode: 'live', smsMode: 'live', bannerDismissed: false });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function acceptAndFail(confirmLabel = 'transparency.confirmAndPay') {
  fireEvent.click(await screen.findByText('bids.accept'));
  await act(async () => {
    fireEvent.click(await screen.findByText(confirmLabel));
  });
  return screen.findByTestId('payment-failure-panel');
}

describe('a declined charge on the bid screen', () => {
  test('does NOT navigate to the matched screen', async () => {
    installFetch();
    renderPage();
    await acceptAndFail();

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test('names WHICH failure happened, in passenger words', async () => {
    installFetch();
    renderPage();
    await acceptAndFail();

    expect(screen.getByTestId('payment-failure-reason')).toHaveTextContent(
      'payment.reason.insufficientFunds',
    );
    // And says the motari is still theirs — the reason a retry is worth it.
    expect(screen.getByText('payment.recover.driverHeld')).toBeInTheDocument();
  });

  test('an unknown or absent gateway code still gets honest copy', async () => {
    installFetch({
      accept: {
        journey: { id: JID }, bid: {}, escrowStatus: 'FAILED',
        escrowId: ESCROW, escrowTxRef: 'r', escrowAmount: 2000, paymentFailureCode: null,
      },
    });
    renderPage();
    await acceptAndFail();

    expect(screen.getByTestId('payment-failure-reason')).toHaveTextContent('payment.reason.unknown');
  });

  test('one tap on Try again charges the same escrow and lands the ride', async () => {
    const fetchMock = installFetch();
    renderPage();
    await acceptAndFail();

    await act(async () => {
      fireEvent.click(screen.getByTestId('payment-retry-momo'));
    });

    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => (c[0] as string).endsWith('/api/payments/initiate'));
      expect(call).toBeTruthy();
      expect(JSON.parse((call![1] as any).body)).toEqual({ escrowId: ESCROW });
    });
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(`/journey/${JID}/matched`, { replace: true });
    });
  });

  test('a retry that answers PENDING keeps the customer here and points at their handset', async () => {
    installFetch({
      initiate: [{ ok: true, status: 200, body: { status: 'PENDING', txRef: 'bimoto-j1-2' } }],
    });
    renderPage();
    await acceptAndFail();

    await act(async () => {
      fireEvent.click(screen.getByTestId('payment-retry-momo'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('payment-failure-reason')).toHaveTextContent(
        'payment.recover.checkPhone',
      );
    });
    expect(mockNavigate).not.toHaveBeenCalled();
    // The action becomes "I approved it" — a re-read of the escrow, not a
    // second charge.
    expect(screen.getByText('payment.recover.iApproved')).toBeInTheDocument();
  });

  test('a retry declined again keeps the panel open with the NEW reason', async () => {
    installFetch({
      initiate: [{
        ok: false, status: 502,
        body: { error: { code: 'CHARGE_FAILED', message: 'errors.chargeFailed', detail: 'INVALID_WALLET' } },
      }],
    });
    renderPage();
    await acceptAndFail();

    await act(async () => {
      fireEvent.click(screen.getByTestId('payment-retry-momo'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('payment-failure-reason')).toHaveTextContent(
        'payment.reason.invalidWallet',
      );
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test('a 409 re-reads the escrow before speaking, and honours a charge that already landed', async () => {
    // The webhook confirming a charge that raced our retry is the common
    // cause of this. Telling a customer who has paid that they have not
    // would be the worst lie on this screen.
    installFetch({
      initiate: [{
        ok: false, status: 409,
        body: { error: { code: 'ESCROW_NOT_RETRIABLE', message: 'errors.escrowNotRetriable' } },
      }],
      status: { status: 'HELD', txRef: 'bimoto-j1-1', lastUpdatedAt: '' },
    });
    renderPage();
    await acceptAndFail();

    await act(async () => {
      fireEvent.click(screen.getByTestId('payment-retry-momo'));
    });

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(`/journey/${JID}/matched`, { replace: true });
    });
  });
});

describe('the way forward survives the customer leaving', () => {
  test('re-opening the bid screen on a MATCHED journey with a FAILED escrow re-offers the retry', async () => {
    installFetch({
      journey: {
        id: JID, pickupName: 'A', destinationName: 'B', status: 'MATCHED',
        escrow: { id: ESCROW, status: 'FAILED', txRef: 'bimoto-j1-1', amount: 2000 },
      },
    });
    renderPage();

    expect(await screen.findByTestId('payment-failure-panel')).toBeInTheDocument();
    expect(screen.getByTestId('payment-retry-momo')).toBeInTheDocument();
  });

  test('a healthy MATCHED journey shows no retry panel', async () => {
    installFetch({
      journey: {
        id: JID, pickupName: 'A', destinationName: 'B', status: 'MATCHED',
        escrow: { id: ESCROW, status: 'HELD', txRef: 'bimoto-j1-1', amount: 2000 },
      },
    });
    renderPage();

    // The bid list renders as usual; nothing claims a payment problem.
    expect(await screen.findByText('bids.accept')).toBeInTheDocument();
    expect(screen.queryByTestId('payment-failure-panel')).toBeNull();
  });
});

describe('switching method after a MoMo failure', () => {
  // The card button only exists where the widget can actually run. Under
  // vitest VITE_FLW_PUBLIC_KEY is unset, so 'live' would (correctly) hide
  // it; simulated mode is where the card rail is exercisable — which is
  // the point of G4.
  beforeEach(() => {
    useSimulationStore.setState({ paymentsMode: 'simulated', smsMode: 'simulated' });
  });

  test('re-reads the CURRENT txRef before opening the card widget', async () => {
    // Every MoMo retry mints a fresh reference; the widget must charge
    // against whatever the escrow holds now, or /initiate-card has nothing
    // to verify. Page state is not allowed to be the source of truth here.
    const fetchMock = installFetch({
      status: { status: 'FAILED', txRef: 'bimoto-j1-AFTER-RETRY', lastUpdatedAt: '' },
    });
    renderPage();
    await acceptAndFail('simulation.payConfirm');

    await act(async () => {
      fireEvent.click(screen.getByTestId('payment-retry-card'));
    });

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((c) => c[0] as string);
      expect(urls.some((u) => u.includes(`/api/payments/${ESCROW}/status`))).toBe(true);
    });
  });

  test('switching when the escrow is already HELD goes to the ride instead of charging twice', async () => {
    installFetch({ status: { status: 'HELD', txRef: 'bimoto-j1-1', lastUpdatedAt: '' } });
    renderPage();
    await acceptAndFail('simulation.payConfirm');

    await act(async () => {
      fireEvent.click(screen.getByTestId('payment-retry-card'));
    });

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(`/journey/${JID}/matched`, { replace: true });
    });
  });
});
