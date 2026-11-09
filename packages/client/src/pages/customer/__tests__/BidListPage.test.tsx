// R3-PAYMENT-CARD-CLIENT — BidListPage payment-method selector + card
// flow. Mocks window.FlutterwaveCheckout + fetch (routed per-URL) and
// asserts: selector renders (MoMo default), MoMo Confirm hits
// /accept-bid, Card Confirm runs the full /accept-bid-card → widget →
// /initiate-card chain and navigates to MatchedPage (the verify POST
// always firing before navigation is the smallest-wrongness gate),
// cancel/verify-error paths, and selector reset on modal close.
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import { i18n } from '../../../__tests__/setup';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<any>);
  return { ...actual, useNavigate: () => mockNavigate };
});

import { BidListPage } from '../BidListPage';
import { useAuthStore } from '../../../stores/auth.store';
import { useBidStore } from '../../../stores/bid.store';
import { useJourneyStore } from '../../../stores/journey.store';
import { useUIStore } from '../../../stores/ui.store';

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

const cardCheckout = { escrowId: 'esc1', txRef: 'bimoto-j1abc-123', amount: 2000 };

function resp(data: any, ok = true) {
  return { ok, statusText: 'err', json: async () => data };
}

// Per-URL fetch router. Tests override `verifyResponse` / `acceptCardResponse`.
let verifyResponse: any;
let acceptCardResponse: any;
function installFetch() {
  const fetchMock = vi.fn(async (url: string, _init?: any) => {
    if (url.endsWith(`/journeys/${JID}/bids`)) return resp([sampleBid]);
    if (url.endsWith(`/journeys/${JID}/accept-bid-card`)) return acceptCardResponse;
    if (url.endsWith(`/journeys/${JID}/accept-bid`)) return resp({ journey: { id: JID }, bid: {} });
    if (url.endsWith('/payments/initiate-card')) return verifyResponse;
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

async function openConfirmModal() {
  const acceptBtn = await screen.findByText('bids.accept');
  fireEvent.click(acceptBtn);
  await screen.findByText('payment.method.label');
}

beforeEach(() => {
  vi.stubEnv('VITE_FLW_PUBLIC_KEY', 'FLWPUBK_TEST-abc');
  mockNavigate.mockReset();
  verifyResponse = resp({ status: 'HELD' });
  acceptCardResponse = resp({
    matched: true,
    journey: { id: JID },
    cardCheckout,
  });
  useAuthStore.setState({ token: 'tok-1', user: { nickname: 'Aljo', phone: '+250788111111' } as any });
  useBidStore.setState({ bids: [sampleBid] });
  useJourneyStore.setState({ activeJourney: null });
  (window as any).FlutterwaveCheckout = vi.fn((config: any) => {
    config.callback({ transaction_id: 'fake-tx-99' });
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  delete (window as any).FlutterwaveCheckout;
  vi.restoreAllMocks();
});

describe('BidListPage — payment-method selector', () => {
  test('renders both options with Mobile Money default-selected', async () => {
    installFetch();
    renderPage();
    await openConfirmModal();

    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    expect(radios).toHaveLength(2);
    const momo = radios.find((r) => r.value === 'momo')!;
    const card = radios.find((r) => r.value === 'card')!;
    expect(momo.checked).toBe(true);
    expect(card.checked).toBe(false);
  });

  test('MoMo + Confirm posts to /accept-bid (not the card route)', async () => {
    const fetchMock = installFetch();
    renderPage();
    await openConfirmModal();

    await act(async () => {
      fireEvent.click(screen.getByText('transparency.confirmAndPay'));
    });

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((c) => c[0] as string);
      expect(urls.some((u) => u.endsWith(`/journeys/${JID}/accept-bid`))).toBe(true);
      expect(urls.some((u) => u.endsWith('/accept-bid-card'))).toBe(false);
    });
  });

  test('selecting Card switches the Confirm label and checked state', async () => {
    installFetch();
    renderPage();
    await openConfirmModal();

    const card = (screen.getAllByRole('radio') as HTMLInputElement[]).find((r) => r.value === 'card')!;
    fireEvent.click(card);

    expect(card.checked).toBe(true);
    expect(screen.getByText('payment.method.confirmCard')).toBeInTheDocument();
  });
});

describe('BidListPage — card flow', () => {
  async function chooseCardAndConfirm() {
    const card = (screen.getAllByRole('radio') as HTMLInputElement[]).find((r) => r.value === 'card')!;
    fireEvent.click(card);
    await act(async () => {
      fireEvent.click(screen.getByText('payment.method.confirmCard'));
    });
  }

  test('Card Confirm runs accept-bid-card → widget → initiate-card and navigates to MatchedPage', async () => {
    const fetchMock = installFetch();
    renderPage();
    await openConfirmModal();
    await chooseCardAndConfirm();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(`/journey/${JID}/matched`, { replace: true });
    });

    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(urls.some((u) => u.endsWith('/accept-bid-card'))).toBe(true);
    expect(urls.some((u) => u.endsWith('/payments/initiate-card'))).toBe(true);
    expect((window as any).FlutterwaveCheckout).toHaveBeenCalledTimes(1);
  });

  test('smallest-wrongness: the verify POST fires before navigation', async () => {
    const events: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/payments/initiate-card')) {
        events.push('verify');
        return resp({ status: 'HELD' });
      }
      if (url.endsWith(`/journeys/${JID}/bids`)) return resp([sampleBid]);
      if (url.endsWith(`/journeys/${JID}/accept-bid-card`)) return acceptCardResponse;
      if (url.endsWith(`/journeys/${JID}`)) return resp({ id: JID });
      return resp({});
    });
    vi.stubGlobal('fetch', fetchMock as any);
    mockNavigate.mockImplementation(() => { events.push('navigate'); });

    renderPage();
    await openConfirmModal();
    await chooseCardAndConfirm();

    await waitFor(() => expect(events).toContain('navigate'));
    expect(events).toEqual(['verify', 'navigate']);
  });

  test('happy path surfaces the verifying toast between widget success and completion', async () => {
    const toasts: string[] = [];
    const unsub = useUIStore.subscribe((s) => {
      if (s.toastMessage && toasts[toasts.length - 1] !== s.toastMessage) {
        toasts.push(s.toastMessage);
      }
    });
    installFetch();
    renderPage();
    await openConfirmModal();
    await chooseCardAndConfirm();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(`/journey/${JID}/matched`, { replace: true });
    });
    unsub();

    expect(toasts).toContain('payment.card.verifying');
    expect(toasts.indexOf('payment.card.verifying')).toBeGreaterThan(
      toasts.indexOf('payment.card.opening'),
    );
  });

  test('widget cancelled shows the cancelled toast and never verifies', async () => {
    (window as any).FlutterwaveCheckout = vi.fn((config: any) => config.onclose());
    const fetchMock = installFetch();
    renderPage();
    await openConfirmModal();
    await chooseCardAndConfirm();

    await waitFor(() => {
      expect(useUIStore.getState().toastMessage).toBe('payment.card.cancelled');
    });
    expect(useUIStore.getState().toastType).toBe('info');
    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(urls.some((u) => u.endsWith('/payments/initiate-card'))).toBe(false);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test('verify error shows the verify-failed toast and does not navigate', async () => {
    verifyResponse = resp({ error: { code: 'AMOUNT_MISMATCH' } }, false);
    installFetch();
    renderPage();
    await openConfirmModal();
    await chooseCardAndConfirm();

    await waitFor(() => {
      expect(useUIStore.getState().toastMessage).toBe('payment.card.verifyFailed');
    });
    expect(useUIStore.getState().toastType).toBe('error');
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe('BidListPage — selector reset', () => {
  test('closing the modal resets the method back to Mobile Money', async () => {
    installFetch();
    renderPage();
    await openConfirmModal();

    // Switch to Card, then cancel.
    const card = (screen.getAllByRole('radio') as HTMLInputElement[]).find((r) => r.value === 'card')!;
    fireEvent.click(card);
    expect(card.checked).toBe(true);
    fireEvent.click(screen.getByText('common.cancel'));

    // Re-open: MoMo must be selected again.
    await openConfirmModal();
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    expect(radios.find((r) => r.value === 'momo')!.checked).toBe(true);
    expect(radios.find((r) => r.value === 'card')!.checked).toBe(false);
  });
});
