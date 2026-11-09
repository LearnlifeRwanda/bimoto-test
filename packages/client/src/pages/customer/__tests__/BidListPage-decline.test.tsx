// TEAM-ANSWERS G4/G6 — the passenger says no to one offer (item 16a).
//
// Pinned here: every offer carries a decline beside its accept, the tap
// asks first, a refusal at the confirm posts nothing, and a decline
// removes that one offer from the list and leaves the others alone.
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

const bidA = { id: 'b1', price: 2000, driverName: 'Bosco', etaMinutes: 8 };
const bidB = { id: 'b2', price: 2400, driverName: 'Eric', etaMinutes: 5 };

function resp(data: any, ok = true, status = 200) {
  return { ok, status, statusText: 'err', json: async () => data };
}

// The mock stands in for global fetch, so it carries fetch's own
// signature — both parameters. A one-parameter implementation makes
// `mock.calls` a one-tuple and every `calls[n][1]` a compile error that
// vitest never sees, because it strips types rather than checking them.
type JsonInit = RequestInit & { body?: string };

function installFetch(declineResponse: any = resp({ id: 'b1', status: 'DECLINED' })) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: JsonInit) => {
    const url = String(input);
    if (url.includes('/decline')) return declineResponse;
    if (url.endsWith(`/journeys/${JID}/bids`)) return resp([bidA, bidB]);
    if (url.endsWith(`/journeys/${JID}`)) {
      return resp({ id: JID, pickupName: 'A', destinationName: 'B' });
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
  useUIStore.setState({ toast: null } as any);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('TEAM-ANSWERS G4 — declining one offer', () => {
  test('every offer carries a decline beside its accept', async () => {
    installFetch();
    renderPage();

    await waitFor(() => expect(screen.getByTestId('bid-b1-decline')).toBeInTheDocument());
    expect(screen.getByTestId('bid-b2-decline')).toBeInTheDocument();
    expect(screen.getAllByText('Decline')).toHaveLength(2);
  });

  test('the tap asks first, in the words that say what it does and does not do', async () => {
    const fetchMock = installFetch();
    const confirmSpy = vi.fn(() => false);
    vi.stubGlobal('confirm', confirmSpy);
    renderPage();

    await waitFor(() => expect(screen.getByTestId('bid-b1-decline')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('bid-b1-decline'));

    expect(confirmSpy).toHaveBeenCalledWith(
      'Decline this offer? Your request stays open and the other offers stay live.',
    );
    // Said no at the confirm: nothing was posted.
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/decline'))).toBe(false);
    expect(screen.getByTestId('bid-b1-decline')).toBeInTheDocument();
  });

  test('confirming posts to the decline endpoint and that offer leaves the list', async () => {
    const fetchMock = installFetch();
    vi.stubGlobal('confirm', vi.fn(() => true));
    renderPage();

    await waitFor(() => expect(screen.getByTestId('bid-b1-decline')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('bid-b1-decline'));

    await waitFor(() =>
      expect(screen.queryByTestId('bid-b1-decline')).not.toBeInTheDocument(),
    );
    const call = fetchMock.mock.calls.find(([input]) => String(input).includes('/decline'));
    expect(call).toBeDefined();
    expect(String(call?.[0])).toContain(`/api/journeys/${JID}/bids/b1/decline`);
    expect(call?.[1]?.method).toBe('POST');

    // The other motari's offer is untouched — the request stays open.
    expect(screen.getByTestId('bid-b2-decline')).toBeInTheDocument();
    expect(useBidStore.getState().bids.map((b: any) => b.id)).toEqual(['b2']);
  });

  test('a server refusal leaves the offer where it was', async () => {
    installFetch(resp({ error: { code: 'ALREADY_DECLINED', message: 'errors.alreadyDeclined' } }, false, 409));
    vi.stubGlobal('confirm', vi.fn(() => true));
    renderPage();

    await waitFor(() => expect(screen.getByTestId('bid-b1-decline')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('bid-b1-decline'));

    await waitFor(() =>
      expect(screen.getByTestId('bid-b1-decline')).not.toBeDisabled(),
    );
    expect(useBidStore.getState().bids.map((b: any) => b.id)).toEqual(['b1', 'b2']);
  });
});
