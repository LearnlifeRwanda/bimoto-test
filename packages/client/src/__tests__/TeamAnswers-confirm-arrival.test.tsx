// TEAM-ANSWERS G5/G6 — the passenger says done, in the words she reads.
//
// POST /api/journeys/:id/confirm has had no reachable caller since
// DEADWOOD #163. Pinned here: the affordance appears only once the
// driver has ended the ride, one tap posts to the endpoint that already
// existed, the screen then says so, and the two-hour fallback is stated
// out loud rather than left for her to discover.

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import { i18n } from './setup';
import enTranslation from '../../public/locales/en/translation.json';

import InProgressPage from '../pages/customer/InProgressPage';
import { useAuthStore } from '../stores/auth.store';
import { useUIStore } from '../stores/ui.store';
import { useJourneyStore } from '../stores/journey.store';
import { _resetConnectivityForTests } from '../sync/connectivity';

vi.mock('../hooks/useSocket', () => ({ useSocket: () => ({ isConnected: false }) }));

const CUSTOMER_ID = 'cust-1';

const RIDE = {
  id: 'j1',
  status: 'IN_PROGRESS',
  pickupName: 'Kimironko',
  destinationName: 'Kigali Heights',
  startedAt: '2026-08-18T10:00:00Z',
  customerId: CUSTOMER_ID,
};

beforeEach(async () => {
  _resetConnectivityForTests();
  useAuthStore.setState({
    token: 'tok',
    user: { id: CUSTOMER_ID, nickname: 'Alice', role: 'CUSTOMER' },
    isAuthenticated: true,
  } as never);
  useUIStore.setState({ toasts: [], toastMessage: null, toastType: null } as never);
  useJourneyStore.setState({ activeJourney: null } as never);
  i18n.addResourceBundle('en', 'translation', enTranslation, true, true);
  await i18n.changeLanguage('en');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  _resetConnectivityForTests();
});

function stubFetch(journey: unknown, confirmed: unknown = { ...RIDE, status: 'COMPLETED' }) {
  const mock = vi.fn(async (url: unknown, init?: unknown) => {
    if (typeof url === 'string' && url.includes('/confirm')) {
      return new Response(JSON.stringify(confirmed), { status: 200 });
    }
    return new Response(JSON.stringify(journey), { status: 200 });
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

const renderProgress = () =>
  render(
    <MemoryRouter initialEntries={['/journey/j1/progress']}>
      <Routes>
        <Route path="/journey/:id/progress" element={<InProgressPage />} />
      </Routes>
    </MemoryRouter>,
  );

describe('TEAM-ANSWERS G5 — confirm arrival', () => {
  test('a ride still running offers nothing to confirm', async () => {
    stubFetch(RIDE);
    renderProgress();

    await waitFor(() =>
      expect(screen.getByText('Kigali Heights')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('confirm-arrival')).not.toBeInTheDocument();
  });

  test('once the driver has ended it, the passenger is asked — and told the fallback', async () => {
    stubFetch({ ...RIDE, status: 'AWAITING_CONFIRMATION' });
    renderProgress();

    await waitFor(() =>
      expect(screen.getByTestId('confirm-arrival')).toBeInTheDocument(),
    );
    expect(
      screen.getByText('Your motari says the ride is done. Confirm you have arrived.'),
    ).toBeInTheDocument();
    // The honest sentence about the clock, and about the motari's money.
    expect(
      screen.getByText(
        'If you do not, it confirms itself after 2 hours and your motari is paid either way.',
      ),
    ).toBeInTheDocument();
  });

  test('one tap posts to the endpoint that already existed, and the screen says done', async () => {
    const fetchMock = stubFetch({ ...RIDE, status: 'AWAITING_CONFIRMATION' });
    renderProgress();

    await waitFor(() =>
      expect(screen.getByTestId('confirm-arrival')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('confirm-arrival-submit'));

    await waitFor(() =>
      expect(screen.getByTestId('confirm-arrival-done')).toBeInTheDocument(),
    );
    const call = fetchMock.mock.calls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('/confirm'),
    );
    expect(call).toBeDefined();
    expect(call![0]).toContain('/api/journeys/j1/confirm');
    expect((call![1] as { method: string }).method).toBe('POST');
    // No body: the endpoint takes none, and nothing about the money is
    // recomputed on the client.
    expect((call![1] as { body?: unknown }).body).toBeUndefined();
    // The ask is gone — a confirmed ride is not confirmed twice.
    expect(screen.queryByTestId('confirm-arrival')).not.toBeInTheDocument();
  });

  test('an already-confirmed ride opens with the ask already gone', async () => {
    stubFetch({ ...RIDE, status: 'COMPLETED' });
    renderProgress();

    await waitFor(() =>
      expect(screen.getByTestId('confirm-arrival-done')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('confirm-arrival-submit')).not.toBeInTheDocument();
  });
});
