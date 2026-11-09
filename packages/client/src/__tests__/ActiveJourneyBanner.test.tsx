// WIRE-FIX G3/G5 — component tests for the active-journey resume
// banner: it shows while a journey is in an active state and targets
// the correct declared route per role and state; with no active
// journey it is absent. Route paths in the test router are mirrored
// from App.tsx (the contract), with a 404 catch-all so a wrong target
// fails loudly.

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Routes, Route, useParams } from 'react-router-dom';
import { i18n } from './setup';

import { ActiveJourneyBanner } from '../components/journey/ActiveJourneyBanner';
import { useAuthStore } from '../stores/auth.store';
import { useJourneyStore } from '../stores/journey.store';

function RouteEcho({ label }: { label: string }) {
  const params = useParams();
  return <div data-testid="route-echo">{`${label}:${params.id}`}</div>;
}

const renderBanner = (role: 'customer' | 'driver') =>
  render(
    <MemoryRouter initialEntries={['/home']}>
      <Routes>
        <Route path="/home" element={<ActiveJourneyBanner role={role} />} />
        <Route path="/journey/:id/matched" element={<RouteEcho label="matched" />} />
        <Route path="/journey/:id/progress" element={<RouteEcho label="progress" />} />
        <Route path="/driver/approach/:id" element={<RouteEcho label="approach" />} />
        <Route path="/driver/ride/:id" element={<RouteEcho label="ride" />} />
        <Route path="/driver/goods/:id" element={<RouteEcho label="goods" />} />
        <Route path="*" element={<div data-testid="not-found">404</div>} />
      </Routes>
    </MemoryRouter>,
  );

const emptyFetch = () =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => [] })) as any,
  );

beforeEach(async () => {
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      activeJourney: {
        titleRide: 'Active ride',
        titleDelivery: 'Active delivery',
        matchedCustomer: 'Driver on the way',
        matchedDriver: 'Matched — head to the pickup',
        inProgressRide: 'Ride in progress',
        inProgressDelivery: 'Delivery in progress',
        resume: 'Tap to return',
      },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');

  useAuthStore.setState({
    token: 'tok',
    user: { id: 'u-1', role: 'BOTH' } as any,
    isAuthenticated: true,
    isLoading: false,
  });
  useJourneyStore.setState({ activeJourney: null });
  emptyFetch();
});

describe('ActiveJourneyBanner — customer targets', () => {
  test('MATCHED journey shows the banner and taps through to /journey/:id/matched', async () => {
    useJourneyStore.setState({
      activeJourney: { id: 'j-1', customerId: 'u-1', status: 'MATCHED', type: 'PASSENGER' } as any,
    });
    renderBanner('customer');

    const banner = screen.getByTestId('active-journey-banner');
    expect(banner).toHaveTextContent('Driver on the way');
    fireEvent.click(banner);

    await waitFor(() =>
      expect(screen.getByTestId('route-echo')).toHaveTextContent('matched:j-1'),
    );
    expect(screen.queryByTestId('not-found')).toBeNull();
  });

  test('IN_PROGRESS journey taps through to /journey/:id/progress', async () => {
    useJourneyStore.setState({
      activeJourney: { id: 'j-2', customerId: 'u-1', status: 'IN_PROGRESS', type: 'PASSENGER' } as any,
    });
    renderBanner('customer');

    fireEvent.click(screen.getByTestId('active-journey-banner'));
    await waitFor(() =>
      expect(screen.getByTestId('route-echo')).toHaveTextContent('progress:j-2'),
    );
    expect(screen.queryByTestId('not-found')).toBeNull();
  });

  test('restores an active journey from GET /api/journeys after a fresh boot', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo) => {
        const url = typeof input === 'string' ? input : (input as Request).url;
        if (url.includes('/api/journeys')) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              { id: 'j-done', customerId: 'u-1', status: 'COMPLETED', type: 'PASSENGER' },
              { id: 'j-live', customerId: 'u-1', status: 'IN_PROGRESS', type: 'PASSENGER' },
            ],
          };
        }
        return { ok: false, status: 404, json: async () => ({}) };
      }) as any,
    );

    renderBanner('customer');
    await waitFor(() =>
      expect(screen.getByTestId('active-journey-banner')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('active-journey-banner'));
    await waitFor(() =>
      expect(screen.getByTestId('route-echo')).toHaveTextContent('progress:j-live'),
    );
  });
});

describe('ActiveJourneyBanner — driver targets', () => {
  test('MATCHED journey taps through to /driver/approach/:id', async () => {
    useJourneyStore.setState({
      activeJourney: { id: 'j-3', driverId: 'u-1', status: 'MATCHED', type: 'PASSENGER' } as any,
    });
    renderBanner('driver');

    const banner = screen.getByTestId('active-journey-banner');
    expect(banner).toHaveTextContent('Matched — head to the pickup');
    fireEvent.click(banner);
    await waitFor(() =>
      expect(screen.getByTestId('route-echo')).toHaveTextContent('approach:j-3'),
    );
    expect(screen.queryByTestId('not-found')).toBeNull();
  });

  test('IN_PROGRESS passenger journey taps through to /driver/ride/:id', async () => {
    useJourneyStore.setState({
      activeJourney: { id: 'j-4', driverId: 'u-1', status: 'IN_PROGRESS', type: 'PASSENGER' } as any,
    });
    renderBanner('driver');

    fireEvent.click(screen.getByTestId('active-journey-banner'));
    await waitFor(() =>
      expect(screen.getByTestId('route-echo')).toHaveTextContent('ride:j-4'),
    );
  });

  test('IN_PROGRESS goods journey taps through to /driver/goods/:id', async () => {
    useJourneyStore.setState({
      activeJourney: { id: 'j-5', driverId: 'u-1', status: 'IN_PROGRESS', type: 'GOODS' } as any,
    });
    renderBanner('driver');

    const banner = screen.getByTestId('active-journey-banner');
    expect(banner).toHaveTextContent('Active delivery');
    fireEvent.click(banner);
    await waitFor(() =>
      expect(screen.getByTestId('route-echo')).toHaveTextContent('goods:j-5'),
    );
  });

  test('restores via my-history accepted bid + journey fetch after a fresh boot', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo) => {
        const url = typeof input === 'string' ? input : (input as Request).url;
        if (url.includes('/api/bids/my-history')) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              { id: 'b-2', journeyId: 'j-lost', status: 'DECLINED' },
              { id: 'b-1', journeyId: 'j-won', status: 'ACCEPTED' },
            ],
          };
        }
        if (url.includes('/api/journeys/j-won')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: 'j-won', driverId: 'u-1', status: 'MATCHED', type: 'PASSENGER' }),
          };
        }
        return { ok: false, status: 404, json: async () => ({}) };
      }) as any,
    );

    renderBanner('driver');
    await waitFor(() =>
      expect(screen.getByTestId('active-journey-banner')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('active-journey-banner'));
    await waitFor(() =>
      expect(screen.getByTestId('route-echo')).toHaveTextContent('approach:j-won'),
    );
  });
});

describe('ActiveJourneyBanner — absence', () => {
  test('renders nothing with no active journey anywhere', async () => {
    renderBanner('customer');
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByTestId('active-journey-banner')).toBeNull();
  });

  test('renders nothing for terminal statuses in the store', async () => {
    useJourneyStore.setState({
      activeJourney: { id: 'j-6', customerId: 'u-1', status: 'COMPLETED', type: 'PASSENGER' } as any,
    });
    renderBanner('customer');
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByTestId('active-journey-banner')).toBeNull();
  });

  test("a customer-side journey never surfaces on the driver home's banner", async () => {
    useJourneyStore.setState({
      // u-1 is the CUSTOMER of this journey, driven by someone else.
      activeJourney: { id: 'j-7', customerId: 'u-1', driverId: 'other', status: 'IN_PROGRESS', type: 'PASSENGER' } as any,
    });
    renderBanner('driver');
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByTestId('active-journey-banner')).toBeNull();
  });
});
