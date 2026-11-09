// SCHED-UI G6 — customer home "Upcoming rides" section: hidden while
// empty, lists the server-ordered rides, navigates to the scheduled
// state screen on tap.
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { i18n } from './setup';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<any>);
  return { ...actual, useNavigate: () => mockNavigate };
});

import { UpcomingRidesSection } from '../components/journey/UpcomingRidesSection';
import { useAuthStore } from '../stores/auth.store';
import { useUIStore } from '../stores/ui.store';

const RIDES = [
  {
    id: 's1',
    scheduledFor: '2026-07-24T07:30:00.000Z',
    pickupName: 'Kimironko Market',
    destinationName: 'Kigali Heights',
  },
  {
    id: 's2',
    scheduledFor: '2026-07-25T07:30:00.000Z',
    pickupName: 'Nyabugogo',
    destinationName: 'Kigali Heights',
  },
];

beforeEach(async () => {
  await i18n.changeLanguage('en');
  mockNavigate.mockReset();
  useAuthStore.setState({ token: 'tok' } as any);
  useUIStore.setState({ isOnline: true } as any);
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

function renderSection() {
  return render(
    <MemoryRouter>
      <UpcomingRidesSection />
    </MemoryRouter>,
  );
}

describe('UpcomingRidesSection', () => {
  test('renders nothing while the customer has no upcoming rides', async () => {
    const fetchMock = stubFetch([]);
    renderSection();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByTestId('upcoming-rides-section')).toBeNull();
  });

  test('lists upcoming rides in server order (soonest first)', async () => {
    stubFetch(RIDES);
    renderSection();
    await screen.findByTestId('upcoming-rides-section');
    const items = screen.getAllByTestId(/upcoming-ride-/);
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveAttribute('data-testid', 'upcoming-ride-s1');
    expect(items[0].textContent).toContain('Kimironko Market');
  });

  test('tapping a ride opens its scheduled state screen', async () => {
    stubFetch(RIDES);
    renderSection();
    fireEvent.click(await screen.findByTestId('upcoming-ride-s1'));
    expect(mockNavigate).toHaveBeenCalledWith('/journey/s1/scheduled');
  });

  test('fires no fetch while offline', async () => {
    useUIStore.setState({ isOnline: false } as any);
    const fetchMock = stubFetch(RIDES);
    renderSection();
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('upcoming-rides-section')).toBeNull();
  });
});
