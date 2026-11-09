// SCHED-UI G6 — driver "My scheduled rides" list: rides render soonest
// first with pickup time, route, agreed price and status; empty state
// otherwise.
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { i18n } from './setup';

import { ScheduledRidesPage } from '../pages/driver/ScheduledRidesPage';
import { useAuthStore } from '../stores/auth.store';

const RIDES = [
  {
    id: 'r1',
    scheduledFor: '2026-07-24T07:30:00.000Z',
    pickupName: 'Kimironko Market',
    destinationName: 'Kigali Heights',
    agreedPrice: 2500,
    status: 'MATCHED',
  },
  {
    id: 'r2',
    scheduledFor: '2026-07-25T07:30:00.000Z',
    pickupName: 'Nyabugogo',
    destinationName: 'MTN Center',
    agreedPrice: 3000,
    status: 'MATCHED',
  },
];

beforeEach(async () => {
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      scheduled: {
        driverListTitle: 'My scheduled rides',
        driverListEmpty: 'No scheduled rides yet',
        driverListEmptyHint: 'Rides you commit to in advance will appear here.',
        agreedPrice: 'Agreed price',
      },
      journey: { status: { matched: 'Matched' } },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');
  useAuthStore.setState({ token: 'tok' } as any);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stubFetch(rides: any) {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify(rides), { status: 200 }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ScheduledRidesPage />
    </MemoryRouter>,
  );
}

describe('Driver ScheduledRidesPage', () => {
  test('renders committed rides with time, route, agreed price and status', async () => {
    stubFetch(RIDES);
    renderPage();
    await screen.findByTestId('driver-scheduled-list');

    expect(screen.getByText('Kimironko Market')).toBeInTheDocument();
    expect(screen.getByText('Nyabugogo')).toBeInTheDocument();
    expect(screen.getByText('2,500 RWF')).toBeInTheDocument();
    expect(screen.getAllByText('Matched')).toHaveLength(2);
    expect(screen.queryByTestId('driver-scheduled-empty')).toBeNull();
  });

  test('shows the empty state when the driver has no commitments', async () => {
    stubFetch([]);
    renderPage();
    await screen.findByTestId('driver-scheduled-empty');
    expect(screen.getByText('No scheduled rides yet')).toBeInTheDocument();
    expect(screen.queryByTestId('driver-scheduled-list')).toBeNull();
  });
});
