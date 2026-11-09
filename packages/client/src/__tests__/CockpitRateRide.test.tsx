// __TESTS__/COCKPIT-RATE-RIDE.TEST.TSX
//
// COCKPIT G4 — the passenger can finally rate a ride.
//
// POST /api/journeys/:id/rate has been in the server since R3 with no
// caller a passenger could reach. What is pinned here is the whole loop:
// the stars appear on a finished ride the viewer rode as the passenger
// (and nowhere else), the submitted body is the shape the SCHEMA
// requires, the stars go disabled once sent, and a server refusal comes
// back through the toast in the server's own words.

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import { i18n } from './setup';
// The SHIPPED English strings, not a stub: this suite asserts on the
// words a passenger actually sees, so a key that went missing from the
// locale would fail here rather than render as a raw dotted path.
import enTranslation from '../../public/locales/en/translation.json';

import RideReceiptPage from '../pages/shared/RideReceiptPage';
import { useAuthStore } from '../stores/auth.store';
import { useUIStore } from '../stores/ui.store';
import { _resetConnectivityForTests } from '../sync/connectivity';

const CUSTOMER_ID = 'cust-1';

const COMPLETED_RIDE = {
  id: 'j1',
  status: 'COMPLETED',
  pickupName: 'Kimironko',
  destinationName: 'Kigali Heights',
  agreedPrice: 900,
  createdAt: '2026-07-20T10:00:00Z',
  confirmedAt: '2026-07-20T10:30:00Z',
  customer: { id: CUSTOMER_ID, nickname: 'Alice' },
};

beforeEach(async () => {
  _resetConnectivityForTests();
  useAuthStore.setState({
    token: 'tok',
    user: { id: CUSTOMER_ID, nickname: 'Alice', role: 'CUSTOMER' },
    isAuthenticated: true,
  } as never);
  useUIStore.setState({ toasts: [], toastMessage: null, toastType: null } as never);
  i18n.addResourceBundle('en', 'translation', enTranslation, true, true);
  await i18n.changeLanguage('en');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  _resetConnectivityForTests();
});

/**
 * The journey GET answers with `journey`; the rate POST answers with
 * `rate`. Returns the mock so the submitted body can be inspected.
 */
function stubFetch(journey: unknown, rate: { status: number; body: unknown }) {
  const mock = vi.fn(async (url: unknown, _init?: unknown) => {
    if (typeof url === 'string' && url.includes('/rate')) {
      return new Response(JSON.stringify(rate.body), { status: rate.status });
    }
    return new Response(JSON.stringify(journey), { status: 200 });
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

const renderReceipt = () =>
  render(
    <MemoryRouter initialEntries={['/journey/j1/receipt']}>
      <Routes>
        <Route path="/journey/:id/receipt" element={<RideReceiptPage />} />
      </Routes>
    </MemoryRouter>,
  );

const created = { status: 201, body: { id: 'r1', stars: 4 } };

describe('COCKPIT G4 — stars on the receipt', () => {
  test('a completed ride the viewer rode offers the stars', async () => {
    stubFetch(COMPLETED_RIDE, created);
    renderReceipt();

    await waitFor(() => expect(screen.getByTestId('rate-ride')).toBeInTheDocument());
    // Five of them, and nothing sent until one is chosen.
    expect(screen.getAllByRole('radio')).toHaveLength(5);
    expect(screen.getByTestId('rate-ride-submit')).toBeDisabled();
  });

  test('submitting posts exactly what the schema requires and shows the stored rating, disabled', async () => {
    const fetchMock = stubFetch(COMPLETED_RIDE, created);
    renderReceipt();

    await waitFor(() => expect(screen.getByTestId('rate-ride')).toBeInTheDocument());

    fireEvent.click(screen.getAllByRole('radio')[3]); // four stars
    expect(screen.getByTestId('rate-ride-submit')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('rate-ride-submit'));

    await waitFor(() => expect(screen.getByTestId('rate-ride-done')).toBeInTheDocument());

    const rateCall = fetchMock.mock.calls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('/rate'),
    );
    expect(rateCall).toBeDefined();
    expect(rateCall![0]).toContain('/api/journeys/j1/rate');
    // journeyId AND stars: createRatingSchema — which is what validate()
    // actually runs — requires the uuid too, so `{ stars }` alone would be
    // a 400. The route's OpenAPI block used to disagree; TRUE-WORDS G5.2
    // corrected it, so doc and validator now say the same thing.
    const body = JSON.parse((rateCall![1] as { body: string }).body);
    expect(body).toEqual({ journeyId: 'j1', stars: 4 });

    // What was stored, shown back, and no longer collectable: the server
    // refuses a second rating (409 ALREADY_RATED), so the UI must not
    // offer one.
    expect(screen.getByTestId('rate-ride-thanks')).toBeInTheDocument();
    expect(screen.queryByTestId('rate-ride-submit')).toBeNull();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.getByRole('img', { name: /Rating: 4/ })).toBeInTheDocument();
  });

  test('a server refusal comes back in the server\'s own words', async () => {
    stubFetch(COMPLETED_RIDE, {
      status: 409,
      body: { error: { code: 'ALREADY_RATED', message: 'errors.alreadyRated' } },
    });
    renderReceipt();

    await waitFor(() => expect(screen.getByTestId('rate-ride')).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole('radio')[4]);
    fireEvent.click(screen.getByTestId('rate-ride-submit'));

    await waitFor(() =>
      expect(useUIStore.getState().toastMessage).toBe('You have already rated this ride.'),
    );
    expect(useUIStore.getState().toastType).toBe('error');
    // Refused means not stored: the stars stay collectable rather than
    // claiming a rating that does not exist.
    expect(screen.getByTestId('rate-ride')).toBeInTheDocument();
    expect(screen.queryByTestId('rate-ride-done')).toBeNull();
  });

  test('an unfinished ride offers no stars — the server would refuse them', async () => {
    stubFetch({ ...COMPLETED_RIDE, status: 'IN_PROGRESS' }, created);
    renderReceipt();

    await waitFor(() => expect(screen.getByTestId('ride-receipt')).toBeInTheDocument());
    expect(screen.queryByTestId('rate-ride')).toBeNull();
  });

  test('the driver reading the same receipt is offered nothing to rate', async () => {
    // The endpoint accepts either participant, but the counterpart
    // rating has no surface of its own; offering the passenger's card to
    // a driver would rate the wrong person's ride.
    useAuthStore.setState({
      token: 'tok',
      user: { id: 'driver-9', nickname: 'Bob', role: 'DRIVER' },
      isAuthenticated: true,
    } as never);
    stubFetch(COMPLETED_RIDE, created);
    renderReceipt();

    await waitFor(() => expect(screen.getByTestId('ride-receipt')).toBeInTheDocument());
    expect(screen.queryByTestId('rate-ride')).toBeNull();
  });
});
