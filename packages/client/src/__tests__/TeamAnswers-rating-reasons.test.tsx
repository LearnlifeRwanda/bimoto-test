// TEAM-ANSWERS G2/G6 — the low-star reason, in the words a passenger sees.
//
// The team's ask (item 15) was "no dispute button; a 1-2 star rating
// offers a reason dropdown and an optional details box". What is pinned
// here is the whole of that promise: the fields appear only at 1-2
// stars, they are genuinely optional (the submit never depends on them),
// what is not filled in is not sent, and going back up above two stars
// takes the fields — and what was typed in them — away.
//
// Asserts on the SHIPPED English strings, so a key that went missing
// from the locale fails here rather than rendering as a dotted path.

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import { i18n } from './setup';
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
  createdAt: '2026-08-18T10:00:00Z',
  confirmedAt: '2026-08-18T10:30:00Z',
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

// The mock stands in for global fetch, so it carries fetch's own
// signature — both parameters. A one-parameter implementation makes
// `mock.calls` a one-tuple and every `calls[n][1]` a compile error that
// vitest never sees, because it strips types rather than checking them.
//
// `body` is narrowed to string because apiFetch serialises every body to
// JSON before it reaches here.
type JsonInit = RequestInit & { body?: string };
type FetchCall = [input: RequestInfo | URL, init?: JsonInit];

function stubFetch(journey: unknown) {
  const mock = vi.fn(async (input: RequestInfo | URL, _init?: JsonInit) => {
    if (String(input).includes('/rate')) {
      return new Response(JSON.stringify({ id: 'r1' }), { status: 201 });
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

/** The JSON body of the rate POST, asserted present before parsing. */
const rateBody = (mock: ReturnType<typeof stubFetch>) => {
  const call: FetchCall | undefined = mock.mock.calls.find(([input]) =>
    String(input).includes('/rate'),
  );
  const raw = call?.[1]?.body;
  expect(typeof raw).toBe('string');
  return JSON.parse(raw as string);
};

describe('TEAM-ANSWERS G2 — low stars carry a reason', () => {
  test('four stars asks nothing further', async () => {
    stubFetch(COMPLETED_RIDE);
    renderReceipt();
    await waitFor(() => expect(screen.getByTestId('rate-ride')).toBeInTheDocument());

    fireEvent.click(screen.getAllByRole('radio')[3]);
    expect(screen.queryByTestId('rate-ride-reasons')).not.toBeInTheDocument();
  });

  test('two stars reveals the reason dropdown and the details box', async () => {
    stubFetch(COMPLETED_RIDE);
    renderReceipt();
    await waitFor(() => expect(screen.getByTestId('rate-ride')).toBeInTheDocument());

    fireEvent.click(screen.getAllByRole('radio')[1]);
    expect(screen.getByTestId('rate-ride-reasons')).toBeInTheDocument();
    // The shipped labels, not keys.
    expect(screen.getByText('Unsafe driving')).toBeInTheDocument();
    expect(screen.getByText('Condition of the motorcycle')).toBeInTheDocument();
    expect(
      screen.getByText('Both are optional. Your stars are sent either way.'),
    ).toBeInTheDocument();
  });

  test('one star and nothing else still sends — neither field blocks', async () => {
    const fetchMock = stubFetch(COMPLETED_RIDE);
    renderReceipt();
    await waitFor(() => expect(screen.getByTestId('rate-ride')).toBeInTheDocument());

    fireEvent.click(screen.getAllByRole('radio')[0]);
    expect(screen.getByTestId('rate-ride-submit')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('rate-ride-submit'));

    await waitFor(() => expect(screen.getByTestId('rate-ride-done')).toBeInTheDocument());
    // Nothing chosen, nothing typed, nothing sent about either.
    expect(rateBody(fetchMock)).toEqual({ journeyId: 'j1', stars: 1 });
  });

  test('a chosen reason and typed details ride along with the stars', async () => {
    const fetchMock = stubFetch(COMPLETED_RIDE);
    renderReceipt();
    await waitFor(() => expect(screen.getByTestId('rate-ride')).toBeInTheDocument());

    fireEvent.click(screen.getAllByRole('radio')[1]);
    fireEvent.change(screen.getByTestId('rate-ride-reason'), {
      target: { value: 'PRICE_DISAGREEMENT' },
    });
    fireEvent.change(screen.getByTestId('rate-ride-details'), {
      target: { value: 'he asked for more at the end' },
    });
    fireEvent.click(screen.getByTestId('rate-ride-submit'));

    await waitFor(() => expect(screen.getByTestId('rate-ride-done')).toBeInTheDocument());
    expect(rateBody(fetchMock)).toEqual({
      journeyId: 'j1',
      stars: 2,
      reason: 'PRICE_DISAGREEMENT',
      comment: 'he asked for more at the end',
    });
  });

  test('raising the stars again takes the fields, and what was typed in them, away', async () => {
    const fetchMock = stubFetch(COMPLETED_RIDE);
    renderReceipt();
    await waitFor(() => expect(screen.getByTestId('rate-ride')).toBeInTheDocument());

    fireEvent.click(screen.getAllByRole('radio')[0]);
    fireEvent.change(screen.getByTestId('rate-ride-reason'), {
      target: { value: 'UNSAFE_DRIVING' },
    });
    fireEvent.click(screen.getAllByRole('radio')[4]); // five stars
    expect(screen.queryByTestId('rate-ride-reasons')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('rate-ride-submit'));
    await waitFor(() => expect(screen.getByTestId('rate-ride-done')).toBeInTheDocument());
    // A reason for a bad ride is not a reason for a good one.
    expect(rateBody(fetchMock)).toEqual({ journeyId: 'j1', stars: 5 });
  });

  test('a reopened receipt reads back the whole of what was sent', async () => {
    stubFetch({
      ...COMPLETED_RIDE,
      myRating: {
        stars: 1,
        reason: 'WRONG_ROUTE',
        comment: 'went round by the stadium',
        createdAt: '2026-08-18T10:31:00Z',
      },
    });
    renderReceipt();

    await waitFor(() => expect(screen.getByTestId('rate-ride-done')).toBeInTheDocument());
    expect(screen.getByTestId('rate-ride-reason-readback')).toHaveTextContent(
      'Took the wrong route',
    );
    expect(screen.getByTestId('rate-ride-details-readback')).toHaveTextContent(
      'went round by the stadium',
    );
    // …and does not offer the stars a second time.
    expect(screen.queryByTestId('rate-ride')).not.toBeInTheDocument();
  });
});
