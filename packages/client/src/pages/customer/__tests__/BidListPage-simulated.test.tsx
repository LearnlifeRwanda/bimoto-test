// PREPROTO-SIM G4 — BidListPage under paymentsMode=simulated: the
// confirm action is relabelled "Pay (simulated)" and confirming drives
// the EXISTING MoMo /accept-bid path — the server fakes only the gateway.
//
// PAY-TRUTH G4 revised the card half of this. PREPROTO-SIM hid the card
// option in simulated mode because the Flutterwave Inline widget could
// not be simulated client-side; it now can
// (services/simulated-card-widget.ts), driven through the same
// chargeWithCard code path, so the rail is exercisable in Kigali before
// it ever meets a real card. What is hidden instead is the case that
// genuinely cannot work: a live build with no VITE_FLW_PUBLIC_KEY, which
// used to be offered and then fail with CARD_WIDGET_NO_PUBLIC_KEY.
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

const sampleBid = {
  id: 'b1',
  price: 2000,
  driverName: 'Driver Joe',
  etaMinutes: 8,
  driverRating: 4.8,
  driverTotalRides: 30,
  commissionBreakdown: undefined,
};

function resp(data: any, ok = true) {
  return { ok, statusText: 'err', json: async () => data };
}

function installFetch() {
  const fetchMock = vi.fn(async (url: string, _init?: any) => {
    if (url.endsWith(`/journeys/${JID}/bids`)) return resp([sampleBid]);
    if (url.endsWith(`/journeys/${JID}/accept-bid`)) return resp({ journey: { id: JID }, bid: {} });
    if (url.endsWith(`/journeys/${JID}`)) return resp({ id: JID, pickupName: 'A', destinationName: 'B' });
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
  useSimulationStore.setState({ paymentsMode: 'simulated', smsMode: 'simulated', bannerDismissed: false });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function openConfirmModal() {
  const acceptBtn = await screen.findByText('bids.accept');
  fireEvent.click(acceptBtn);
  await screen.findByText('simulation.payConfirm');
}

describe('BidListPage under simulated payments', () => {
  test('offers the card option, because simulated mode can now drive it', async () => {
    installFetch();
    renderPage();
    await openConfirmModal();

    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(screen.getByText('payment.method.card')).toBeInTheDocument();
    // The in-modal simulation notice still says what this is.
    expect(screen.getByText('simulation.banner')).toBeInTheDocument();
  });

  test('live build with no FLW public key hides the card option entirely', async () => {
    useSimulationStore.setState({ paymentsMode: 'live', smsMode: 'live' });
    installFetch();
    renderPage();
    const acceptBtn = await screen.findByText('bids.accept');
    fireEvent.click(acceptBtn);
    await screen.findByText('transparency.confirmAndPay');

    // import.meta.env.VITE_FLW_PUBLIC_KEY is unset under vitest, which is
    // exactly the build this guards: offering a customer with money in
    // hand a payment method that could never have worked is worse than
    // not offering it.
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.queryByText('payment.method.card')).toBeNull();
  });

  test('"Pay (simulated)" drives the existing MoMo accept-bid path', async () => {
    const fetchMock = installFetch();
    renderPage();
    await openConfirmModal();

    await act(async () => {
      fireEvent.click(screen.getByText('simulation.payConfirm'));
    });

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((c) => c[0] as string);
      expect(urls.some((u) => u.endsWith(`/journeys/${JID}/accept-bid`))).toBe(true);
      expect(urls.some((u) => u.endsWith('/accept-bid-card'))).toBe(false);
    });
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(`/journey/${JID}/matched`, { replace: true });
    });
  });

  test('live mode keeps the MoMo confirm label untouched (regression guard)', async () => {
    useSimulationStore.setState({ paymentsMode: 'live', smsMode: 'live' });
    installFetch();
    renderPage();
    const acceptBtn = await screen.findByText('bids.accept');
    fireEvent.click(acceptBtn);

    expect(await screen.findByText('transparency.confirmAndPay')).toBeInTheDocument();
    expect(screen.queryByText('simulation.payConfirm')).toBeNull();
  });
});
