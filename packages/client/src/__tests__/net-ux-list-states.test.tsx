// NET-UX G4 — empty vs error vs loaded, one representative list per role.
//
//   customer → HistoryPage ("My rides")
//   driver   → ScheduledRidesPage ("My scheduled rides")
//   admin    → AdminDisputes queue
//
// The invariant under test: a FAILED load renders the retryable
// ErrorState — never the empty state (a dead tunnel must not read as
// "no rides yet"), and Retry actually re-fetches.

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { i18n } from './setup';

import { HistoryPage } from '../pages/shared/HistoryPage';
import { ScheduledRidesPage } from '../pages/driver/ScheduledRidesPage';
import AdminDisputes from '../pages/admin/AdminDisputes';
import { useAuthStore } from '../stores/auth.store';
import { _resetConnectivityForTests } from '../sync/connectivity';

beforeEach(async () => {
  _resetConnectivityForTests();
  useAuthStore.setState({ token: 'tok' } as any);
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      common: { retry: 'Retry' },
      states: {
        loadFailed: "This couldn't load",
        loadFailedHint: "It may be a connection problem — it's not your fault. Try again.",
      },
      history: { title: 'My rides', empty: 'No rides yet', emptyHint: 'Request your first ride and it will appear here.' },
      scheduled: {
        driverListTitle: 'My scheduled rides',
        driverListEmpty: 'No scheduled rides yet',
        driverListEmptyHint: 'Rides you commit to in advance will appear here.',
        agreedPrice: 'Agreed price',
      },
      journey: { status: { matched: 'Matched' } },
      errors: { serverProblem: 'Bimoto has a problem, not your phone' },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  _resetConnectivityForTests();
});

function stubFetchOk(body: unknown) {
  const mock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
  vi.stubGlobal('fetch', mock);
  return mock;
}

function stubFetch500() {
  const mock = vi.fn(async () => new Response('{}', { status: 500 }));
  vi.stubGlobal('fetch', mock);
  return mock;
}

const JOURNEY = {
  id: 'j1',
  pickupName: 'Kimironko',
  destinationName: 'Kigali Heights',
  status: 'COMPLETED',
  createdAt: '2026-07-20T10:00:00Z',
};

describe('customer — HistoryPage', () => {
  const renderPage = () =>
    render(
      <MemoryRouter>
        <HistoryPage />
      </MemoryRouter>,
    );

  test('loaded: rides render', async () => {
    stubFetchOk([JOURNEY]);
    renderPage();
    expect(await screen.findByText(/Kimironko/)).toBeInTheDocument();
    expect(screen.queryByTestId('empty-state')).toBeNull();
    expect(screen.queryByTestId('error-state')).toBeNull();
  });

  test('empty: friendly no-rides copy, not a blank area', async () => {
    stubFetchOk([]);
    renderPage();
    expect(await screen.findByTestId('empty-state')).toBeInTheDocument();
    expect(screen.getByText('No rides yet')).toBeInTheDocument();
    expect(screen.queryByTestId('error-state')).toBeNull();
  });

  test('error: retryable error state — never the empty state — and Retry re-fetches', async () => {
    const failing = stubFetch500();
    renderPage();
    expect(await screen.findByTestId('error-state')).toBeInTheDocument();
    expect(screen.queryByTestId('empty-state')).toBeNull();
    expect(failing).toHaveBeenCalledTimes(1);

    stubFetchOk([JOURNEY]);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(/Kimironko/)).toBeInTheDocument();
    expect(screen.queryByTestId('error-state')).toBeNull();
  });
});

describe('driver — ScheduledRidesPage', () => {
  const renderPage = () =>
    render(
      <MemoryRouter>
        <ScheduledRidesPage />
      </MemoryRouter>,
    );

  test('error: retryable error state instead of a fake empty list', async () => {
    stubFetch500();
    renderPage();
    expect(await screen.findByTestId('error-state')).toBeInTheDocument();
    expect(screen.queryByTestId('driver-scheduled-empty')).toBeNull();

    stubFetchOk([
      {
        id: 'r1',
        scheduledFor: '2026-07-30T07:30:00.000Z',
        pickupName: 'Nyabugogo',
        destinationName: 'MTN Center',
        agreedPrice: 3000,
        status: 'MATCHED',
      },
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByTestId('driver-scheduled-list')).toBeInTheDocument();
  });

  test('empty: shared EmptyState renders the existing copy', async () => {
    stubFetchOk([]);
    renderPage();
    expect(await screen.findByTestId('driver-scheduled-empty')).toBeInTheDocument();
    expect(screen.getByText('No scheduled rides yet')).toBeInTheDocument();
  });
});

describe('admin — AdminDisputes queue', () => {
  test('a failed queue load shows the retryable error state, never a fake empty queue', async () => {
    stubFetch500();
    render(
      <MemoryRouter>
        <AdminDisputes />
      </MemoryRouter>,
    );
    expect(await screen.findByTestId('error-state')).toBeInTheDocument();
    expect(screen.queryByText('No active disputes')).toBeNull();

    stubFetchOk({ journeys: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(screen.getByText('No active disputes')).toBeInTheDocument(),
    );
  });
});
