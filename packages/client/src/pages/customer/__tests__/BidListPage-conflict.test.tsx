// SCHED-UI G6 — scheduled-ride conflict dialog on bid accept:
//  - { matched: false, conflictWarning } opens the dialog instead of a
//    generic failure
//  - "Choose another driver" dismisses without another accept POST
//  - "Accept anyway" re-POSTs the same endpoint once with
//    acknowledgeConflict: true and completes on success
//  - a second soft-block after acknowledgement fails outright — the
//    dialog never reopens (retry-once rule)
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
};

const CONFLICT_RESPONSE = {
  matched: false,
  conflictWarning: {
    conflictingRides: [
      {
        id: 'other-1',
        scheduledFor: '2026-07-24T07:35:00.000Z',
        pickupName: 'Nyabugogo',
        destinationName: 'Kigali Heights',
      },
    ],
  },
  retryUrl: `/api/scheduled-rides/${JID}/conflict-acknowledge`,
};

function resp(data: any, ok = true) {
  return { ok, statusText: 'err', json: async () => data };
}

// Queue of responses for successive /accept-bid POSTs.
let acceptResponses: any[] = [];
let acceptBodies: any[] = [];
function installFetch() {
  const fetchMock = vi.fn(async (url: string, init?: any) => {
    if (url.endsWith(`/journeys/${JID}/bids`)) return resp([sampleBid]);
    if (url.endsWith(`/journeys/${JID}/accept-bid`)) {
      acceptBodies.push(JSON.parse(init.body));
      return acceptResponses.shift() ?? resp({ journey: { id: JID }, bid: {} });
    }
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

async function acceptTheBid() {
  fireEvent.click(await screen.findByText('bids.accept'));
  fireEvent.click(await screen.findByText('transparency.confirmAndPay'));
}

beforeEach(async () => {
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      scheduled: {
        conflictRide: '{{time}} · {{pickup}} → {{destination}}',
      },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');
  mockNavigate.mockReset();
  acceptResponses = [];
  acceptBodies = [];
  useAuthStore.setState({ token: 'tok-1', user: { nickname: 'A', phone: '+250788111111' } as any });
  useBidStore.setState({ bids: [sampleBid] });
  useJourneyStore.setState({ activeJourney: null });
  useUIStore.setState({ toast: null } as any);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('BidListPage — scheduled-ride conflict dialog', () => {
  test('soft-block opens the dialog with the conflicting ride listed', async () => {
    installFetch();
    acceptResponses = [resp(CONFLICT_RESPONSE)];
    renderPage();
    await acceptTheBid();

    await screen.findByTestId('conflict-dialog');
    expect(screen.getByText(/Nyabugogo/).textContent).toContain('Kigali Heights');
  });

  test('"Choose another driver" dismisses without a second accept POST', async () => {
    installFetch();
    acceptResponses = [resp(CONFLICT_RESPONSE)];
    renderPage();
    await acceptTheBid();

    fireEvent.click(await screen.findByTestId('conflict-choose-another'));
    await waitFor(() =>
      expect(screen.queryByTestId('conflict-dialog')).toBeNull(),
    );
    expect(acceptBodies).toHaveLength(1);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test('"Accept anyway" retries once with acknowledgeConflict and completes', async () => {
    installFetch();
    acceptResponses = [resp(CONFLICT_RESPONSE), resp({ journey: { id: JID }, bid: {} })];
    renderPage();
    await acceptTheBid();

    fireEvent.click(await screen.findByTestId('conflict-accept-anyway'));

    await waitFor(() => expect(acceptBodies).toHaveLength(2));
    expect(acceptBodies[0]).toEqual({ bidId: 'b1' });
    expect(acceptBodies[1]).toEqual({ bidId: 'b1', acknowledgeConflict: true });
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith(`/journey/${JID}/matched`, { replace: true }),
    );
  });

  test('retry-once: a second soft-block fails outright, dialog never reopens', async () => {
    installFetch();
    acceptResponses = [resp(CONFLICT_RESPONSE), resp(CONFLICT_RESPONSE)];
    renderPage();
    await acceptTheBid();

    fireEvent.click(await screen.findByTestId('conflict-accept-anyway'));

    await waitFor(() => expect(acceptBodies).toHaveLength(2));
    // No third POST, no reopened dialog, no navigation.
    await waitFor(() =>
      expect(screen.queryByTestId('conflict-dialog')).toBeNull(),
    );
    expect(acceptBodies).toHaveLength(2);
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
