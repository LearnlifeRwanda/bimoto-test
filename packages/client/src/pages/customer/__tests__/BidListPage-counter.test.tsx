// COUNTER-READY G5 — the passenger's side of the counter, on her screen.
//
// THE FLAG MATRIX IS THE FIRST HALF, and it is what makes the dormant
// ship safe: with counterBidEnabled false NOTHING renders — no button,
// no dialog, no state line, no hint the feature exists. Both arms are
// asserted, because a test that only exercised the enabled one would let
// a future edit make the disabled arm half-render, and half-rendered is
// exactly what must not reach a pilot phone during the baseline weeks.
//
// The counter ENTRY is a dialog this wave adds, so it is mounted BESIDE
// the screen it appears on (#203's standing rule) — every case here
// renders BidListPage and drives the real button.
//
// Asserts on the SHIPPED English strings.
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import { i18n } from '../../../__tests__/setup';
import enTranslation from '../../../../public/locales/en/translation.json';
import { MIN_PRICE_RWF, MAX_PRICE_RWF } from '@bimoto/shared';

import { BidListPage } from '../BidListPage';
import { useAuthStore } from '../../../stores/auth.store';
import { useBidStore } from '../../../stores/bid.store';
import { useJourneyStore } from '../../../stores/journey.store';
import { useUIStore } from '../../../stores/ui.store';
import { useSimulationStore } from '../../../stores/simulation.store';

const JID = 'j1';
const bidA = {
  id: 'b1', price: 2000, driverName: 'Bosco', etaMinutes: 8, status: 'PENDING',
  counterAmountRwf: null, counterAt: null, counterOutcome: null,
};
const bidB = {
  id: 'b2', price: 2400, driverName: 'Eric', etaMinutes: 5, status: 'PENDING',
  counterAmountRwf: null, counterAt: null, counterOutcome: null,
};

function resp(data: any, ok = true, status = 200) {
  return { ok, status, statusText: 'err', json: async () => data };
}
type JsonInit = RequestInit & { body?: string };

function installFetch(bids: any[] = [bidA, bidB], counterResponse?: any) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: JsonInit) => {
    const url = String(input);
    if (url.includes('/counter')) {
      return counterResponse ?? resp({ ...bids[0], counterAmountRwf: 1500, counterAt: 'now' });
    }
    if (url.endsWith(`/journeys/${JID}/bids`)) return resp(bids);
    if (url.endsWith(`/journeys/${JID}`)) {
      return resp({ id: JID, status: 'REQUESTED', pickupName: 'A', destinationName: 'B' });
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

beforeEach(async () => {
  i18n.addResourceBundle('en', 'translation', enTranslation, true, true);
  await i18n.changeLanguage('en');
  useAuthStore.setState({ token: 'tok-1', user: { nickname: 'A', phone: '+250788111111' } as any });
  useBidStore.setState({ bids: [bidA, bidB] });
  useJourneyStore.setState({ activeJourney: null });
  useUIStore.setState({ toasts: [], toastMessage: null, toastType: null } as any);
  useSimulationStore.setState({ counterBidEnabled: false });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useSimulationStore.setState({ counterBidEnabled: false });
});

describe('flag OFF — the counter does not exist on this screen', () => {
  test('no offer carries a suggest-a-price control', async () => {
    installFetch();
    renderPage();

    await waitFor(() => expect(screen.getByTestId('bid-b1-accept')).toBeInTheDocument());
    expect(screen.queryByTestId('bid-b1-counter')).not.toBeInTheDocument();
    expect(screen.queryByTestId('bid-b2-counter')).not.toBeInTheDocument();
    expect(screen.queryByText('Suggest another price')).not.toBeInTheDocument();
  });

  test('the entry dialog is not mounted', async () => {
    installFetch();
    renderPage();

    await waitFor(() => expect(screen.getByTestId('bid-b1-accept')).toBeInTheDocument());
    expect(screen.queryByTestId('counter-dialog')).not.toBeInTheDocument();
  });

  test('not even a bid that ALREADY carries a counter says anything', async () => {
    // The switch being flipped back off must not leave a stray state
    // line on a row whose columns are already written.
    installFetch([{ ...bidA, counterAmountRwf: 1500 }]);
    renderPage();

    await waitFor(() => expect(screen.getByTestId('bid-b1-accept')).toBeInTheDocument());
    expect(screen.queryByTestId('bid-b1-counter-state')).not.toBeInTheDocument();
  });

  test('the rest of the screen is exactly as it was — accept and decline untouched', async () => {
    installFetch();
    renderPage();

    await waitFor(() => expect(screen.getByTestId('bid-b1-accept')).toBeInTheDocument());
    expect(screen.getByTestId('bid-b1-decline')).toBeInTheDocument();
    expect(screen.getByTestId('bid-b2-accept')).toBeInTheDocument();
  });
});

describe('flag ON — she can suggest one number, once', () => {
  beforeEach(() => {
    useSimulationStore.setState({ counterBidEnabled: true });
  });

  test('every PENDING offer carries the control', async () => {
    installFetch();
    renderPage();

    await waitFor(() => expect(screen.getByTestId('bid-b1-counter')).toBeInTheDocument());
    expect(screen.getByTestId('bid-b2-counter')).toBeInTheDocument();
    expect(screen.getAllByText('Suggest another price')).toHaveLength(2);
  });

  test('the tap opens the entry, beside the list, naming his price and the one-shot rule', async () => {
    installFetch();
    renderPage();

    await waitFor(() => expect(screen.getByTestId('bid-b1-counter')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('bid-b1-counter'));

    expect(screen.getByTestId('counter-dialog')).toBeInTheDocument();
    expect(
      screen.getByText('Bosco offered 2,000 RWF. What would you like to pay?'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('You can suggest a price once per offer.'),
    ).toBeInTheDocument();
  });

  test('sending posts the counter endpoint with the number', async () => {
    const fetchMock = installFetch();
    renderPage();

    await waitFor(() => expect(screen.getByTestId('bid-b1-counter')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('bid-b1-counter'));
    fireEvent.change(screen.getByTestId('counter-amount-input'), { target: { value: '1500' } });
    fireEvent.click(screen.getByTestId('counter-submit'));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('/counter'));
      expect(call).toBeDefined();
      expect(String(call![0])).toContain(`/api/journeys/${JID}/bids/b1/counter`);
      expect(call![1]?.method).toBe('POST');
      expect(JSON.parse(call![1]!.body as string)).toEqual({ counterAmountRwf: 1500 });
    });
  });

  test('once spent, the control is REPLACED by the state of the conversation', async () => {
    installFetch();
    renderPage();

    await waitFor(() => expect(screen.getByTestId('bid-b1-counter')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('bid-b1-counter'));
    fireEvent.change(screen.getByTestId('counter-amount-input'), { target: { value: '1500' } });
    fireEvent.click(screen.getByTestId('counter-submit'));

    // No second entry point — the button is gone, not disabled.
    await waitFor(() =>
      expect(screen.queryByTestId('bid-b1-counter')).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId('bid-b1-counter-state')).toHaveTextContent(
      'You suggested 1,500 RWF — waiting for an answer',
    );
    // …and the OTHER offer still has its own, untouched.
    expect(screen.getByTestId('bid-b2-counter')).toBeInTheDocument();
  });

  test('a declined counter says his offer STILL STANDS, at his price', async () => {
    // The one sentence that must not read as "this offer is gone".
    installFetch([{ ...bidA, counterAmountRwf: 1500, counterOutcome: 'DECLINED' }]);
    renderPage();

    await waitFor(() => expect(screen.getByTestId('bid-b1-counter-state')).toBeInTheDocument());
    expect(screen.getByTestId('bid-b1-counter-state')).toHaveTextContent(
      'Your price was not accepted. This offer still stands at 2,000 RWF.',
    );
    // And she can still take it.
    expect(screen.getByTestId('bid-b1-accept')).toBeInTheDocument();
  });

  test('a lapsed counter says the offer ran out of time', async () => {
    installFetch([{ ...bidA, counterAmountRwf: 1500, counterOutcome: 'LAPSED' }]);
    renderPage();

    await waitFor(() => expect(screen.getByTestId('bid-b1-counter-state')).toBeInTheDocument());
    expect(screen.getByTestId('bid-b1-counter-state')).toHaveTextContent(
      'This offer expired before your price was answered.',
    );
  });

  test('bounded on this side too: a price below the floor never leaves the phone', async () => {
    const fetchMock = installFetch();
    renderPage();

    await waitFor(() => expect(screen.getByTestId('bid-b1-counter')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('bid-b1-counter'));
    fireEvent.change(screen.getByTestId('counter-amount-input'), {
      target: { value: String(MIN_PRICE_RWF - 1) },
    });
    fireEvent.click(screen.getByTestId('counter-submit'));

    await waitFor(() =>
      expect(useUIStore.getState().toastMessage).toBe(
        `Enter a price between ${MIN_PRICE_RWF.toLocaleString()} and ${MAX_PRICE_RWF.toLocaleString()} RWF.`,
      ),
    );
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/counter'))).toBe(false);
  });

  test('and the same number he already offered is refused before the round trip', async () => {
    const fetchMock = installFetch();
    renderPage();

    await waitFor(() => expect(screen.getByTestId('bid-b1-counter')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('bid-b1-counter'));
    fireEvent.change(screen.getByTestId('counter-amount-input'), { target: { value: '2000' } });
    fireEvent.click(screen.getByTestId('counter-submit'));

    await waitFor(() =>
      expect(useUIStore.getState().toastMessage).toBe('That is the price already offered.'),
    );
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/counter'))).toBe(false);
  });

  test('a non-PENDING offer carries no counter control', async () => {
    installFetch([{ ...bidA, status: 'DECLINED' }]);
    renderPage();

    await waitFor(() => expect(screen.getByTestId('bid-b1-accept')).toBeInTheDocument());
    expect(screen.queryByTestId('bid-b1-counter')).not.toBeInTheDocument();
  });
});
