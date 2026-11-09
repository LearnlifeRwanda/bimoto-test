// REQUEST-WITHDRAW G5 — the clean walk-away, mounted on the screen it
// lives on.
//
// The standing rule born in #203: any dialog this wave adds gets at
// least one test mounting it BESIDE the screen it appears on. A
// component test of a confirm dialog is structurally blind to placement
// — it cannot tell you the dialog is reachable, that it is reachable
// from the RIGHT screen, or that it disappears when it should. So every
// case here renders BidListPage and drives the real button.
//
// Pinned: the control exists pre-match and is GONE post-match; one tap
// opens a confirm rather than cancelling; a refusal at the confirm posts
// nothing; confirming posts the EXISTING cancel endpoint with
// CUSTOMER_CHANGED_MIND and goes home.
//
// Asserts on the SHIPPED English strings, so a missing locale key fails
// here rather than rendering as a dotted path.
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import { i18n } from '../../../__tests__/setup';
import enTranslation from '../../../../public/locales/en/translation.json';

import { BidListPage } from '../BidListPage';
import { useAuthStore } from '../../../stores/auth.store';
import { useBidStore } from '../../../stores/bid.store';
import { useJourneyStore } from '../../../stores/journey.store';
import { useUIStore } from '../../../stores/ui.store';

const JID = 'j1';
const bidA = { id: 'b1', price: 2000, driverName: 'Bosco', etaMinutes: 8, status: 'PENDING' };

const navigateSpy = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<any>('react-router-dom');
  return { ...actual, useNavigate: () => navigateSpy };
});

function resp(data: any, ok = true, status = 200) {
  return { ok, status, statusText: 'err', json: async () => data };
}

type JsonInit = RequestInit & { body?: string };

function installFetch(journeyStatus = 'REQUESTED', cancelResponse: any = resp({ id: JID, status: 'CANCELLED' })) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: JsonInit) => {
    const url = String(input);
    if (url.includes('/cancel')) return cancelResponse;
    if (url.endsWith(`/journeys/${JID}/bids`)) return resp([bidA]);
    if (url.endsWith(`/journeys/${JID}`)) {
      return resp({ id: JID, status: journeyStatus, pickupName: 'A', destinationName: 'B' });
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
  navigateSpy.mockClear();
  useAuthStore.setState({ token: 'tok-1', user: { nickname: 'A', phone: '+250788111111' } as any });
  useBidStore.setState({ bids: [bidA] });
  useJourneyStore.setState({ activeJourney: null });
  useUIStore.setState({ toasts: [], toastMessage: null, toastType: null } as any);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('REQUEST-WITHDRAW — the control, on the offers screen', () => {
  test('a pre-match request offers a way out, in words that name it', async () => {
    installFetch('REQUESTED');
    renderPage();

    await waitFor(() => expect(screen.getByTestId('withdraw-request')).toBeInTheDocument());
    expect(screen.getByText('Withdraw my request')).toBeInTheDocument();
  });

  test('it is GONE once the journey is MATCHED — MatchedPage owns that world', async () => {
    // Two cancel surfaces on one journey is how a passenger ends up
    // accusing a motari of something by tapping the wrong one.
    installFetch('MATCHED');
    renderPage();

    await waitFor(() => expect(screen.getByTestId('bid-b1-accept')).toBeInTheDocument());
    expect(screen.queryByTestId('withdraw-request')).not.toBeInTheDocument();
  });

  test('and it does not appear before the screen knows what it is looking at', async () => {
    // The status arrives with the journey fetch. A withdraw button
    // rendered on an unloaded status would be a button offered about
    // nothing.
    const fetchMock = vi.fn(async () => new Promise(() => { /* never resolves */ }));
    vi.stubGlobal('fetch', fetchMock as any);
    renderPage();

    expect(screen.queryByTestId('withdraw-request')).not.toBeInTheDocument();
  });
});

describe('REQUEST-WITHDRAW — one tap is a booking, two taps is a walk-away', () => {
  test('the tap opens the confirm and cancels NOTHING', async () => {
    const fetchMock = installFetch('REQUESTED');
    renderPage();

    await waitFor(() => expect(screen.getByTestId('withdraw-request')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('withdraw-request'));

    // The dialog is HERE, on this screen, beside the list it acts on.
    expect(screen.getByTestId('withdraw-dialog')).toBeInTheDocument();
    expect(screen.getByText('Withdraw this request?')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Your request will be closed and any offers on it will end. You can book again at any time.',
      ),
    ).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/cancel'))).toBe(false);
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  test('backing out of the confirm posts nothing and leaves the request open', async () => {
    const fetchMock = installFetch('REQUESTED');
    renderPage();

    await waitFor(() => expect(screen.getByTestId('withdraw-request')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('withdraw-request'));
    fireEvent.click(screen.getByText('Keep waiting'));

    await waitFor(() =>
      expect(screen.queryByTestId('withdraw-dialog')).not.toBeInTheDocument(),
    );
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/cancel'))).toBe(false);
    // Still on the screen, still offering the way out.
    expect(screen.getByTestId('withdraw-request')).toBeInTheDocument();
  });

  test('confirming posts the EXISTING cancel endpoint with CUSTOMER_CHANGED_MIND', async () => {
    const fetchMock = installFetch('REQUESTED');
    renderPage();

    await waitFor(() => expect(screen.getByTestId('withdraw-request')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('withdraw-request'));
    fireEvent.click(screen.getByTestId('withdraw-confirm'));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('/cancel'));
      expect(call).toBeDefined();
      expect(String(call![0])).toContain(`/api/journeys/${JID}/cancel`);
      expect(call![1]?.method).toBe('POST');
      // Byte-identical to what the existing cancel semantics expect —
      // same reason, so the same attribution and the same refund-if-any.
      expect(JSON.parse(call![1]!.body as string)).toEqual({
        reason: 'CUSTOMER_CHANGED_MIND',
      });
    });
  });

  test('and she goes home, told what happened', async () => {
    installFetch('REQUESTED');
    renderPage();

    await waitFor(() => expect(screen.getByTestId('withdraw-request')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('withdraw-request'));
    fireEvent.click(screen.getByTestId('withdraw-confirm'));

    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith('/', { replace: true }));
    expect(useUIStore.getState().toastMessage).toBe('Your request was withdrawn');
  });

  test('a server refusal keeps her where she is, with the request intact', async () => {
    installFetch('REQUESTED', resp({ error: { code: 'JOURNEY_NOT_FOUND' } }, false, 404));
    renderPage();

    await waitFor(() => expect(screen.getByTestId('withdraw-request')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('withdraw-request'));
    fireEvent.click(screen.getByTestId('withdraw-confirm'));

    await waitFor(() =>
      expect(screen.queryByTestId('withdraw-dialog')).not.toBeInTheDocument(),
    );
    expect(navigateSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId('withdraw-request')).toBeInTheDocument();
  });
});
