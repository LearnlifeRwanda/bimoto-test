// __TESTS__/TRUE-WORDS-RATING-READBACK.TEST.TSX
//
// TRUE-WORDS G5.1 — the receipt remembers your stars.
//
// COCKPIT G4 could collect a rating but not read one back: reopening the
// receipt on a ride you had already rated offered the stars a second time,
// and the server answered 409 ALREADY_RATED. The journey GET now carries
// `myRating`, so what is pinned here is the seam that closed — a rated
// ride opens in the shown state on a FRESH load, with no submit path, and
// an unrated one is still fully interactive.

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import { i18n } from './setup';
// The SHIPPED English strings, not a stub — same reason as the COCKPIT
// suite: a key that went missing would fail here, not render as a path.
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

/** Answers the journey GET only — nothing here should ever POST /rate. */
function stubJourney(journey: unknown) {
  const mock = vi.fn(async (_url: unknown, _init?: unknown) =>
    new Response(JSON.stringify(journey), { status: 200 }),
  );
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

describe('TRUE-WORDS G5.1 — a reopened receipt shows the rating already given', () => {
  test('a rated ride shows the stored stars on a fresh load, not the star picker', async () => {
    const fetchMock = stubJourney({
      ...COMPLETED_RIDE,
      myRating: { stars: 5, comment: null, createdAt: '2026-07-20T11:00:00Z' },
    });
    renderReceipt();

    await waitFor(() => expect(screen.getByTestId('rate-ride-done')).toBeInTheDocument());

    // The stored value, read straight off the payload — no submit happened
    // in this session, so this can only have come from the GET.
    expect(screen.getByRole('img', { name: /Rating: 5/ })).toBeInTheDocument();
    expect(screen.getByText('Your rating')).toBeInTheDocument();

    // Nothing collectable: no picker, no submit, no second POST to be 409'd.
    expect(screen.queryByTestId('rate-ride')).toBeNull();
    expect(screen.queryByTestId('rate-ride-submit')).toBeNull();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(
      fetchMock.mock.calls.some((c) => typeof c[0] === 'string' && (c[0] as string).includes('/rate')),
    ).toBe(false);
  });

  test('an unrated ride is still fully interactive', async () => {
    stubJourney({ ...COMPLETED_RIDE, myRating: null });
    renderReceipt();

    await waitFor(() => expect(screen.getByTestId('rate-ride')).toBeInTheDocument());
    expect(screen.getAllByRole('radio')).toHaveLength(5);
    expect(screen.getByTestId('rate-ride-submit')).toBeDisabled();
    expect(screen.queryByTestId('rate-ride-done')).toBeNull();
  });

  test('a server that does not report myRating at all still offers the stars', async () => {
    // Backward compatibility: an APK talking to an older server, or any
    // response shaped before this field existed, must not lose the ability
    // to rate. Absent is treated as "not rated", never as "already rated".
    stubJourney(COMPLETED_RIDE);
    renderReceipt();

    await waitFor(() => expect(screen.getByTestId('rate-ride')).toBeInTheDocument());
    expect(screen.getAllByRole('radio')).toHaveLength(5);
  });
});
