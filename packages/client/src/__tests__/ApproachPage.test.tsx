// R3-N-1 — driver-side honest withdrawal button on ApproachPage.
// Verifies the sticky-bottom button + confirmation modal POST a cancel
// request with reason=DRIVER_CAN_NOT_MAKE_IT.

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import { i18n } from './setup';

vi.mock('../hooks/useSocket', () => ({
  useSocket: () => ({
    socket: null,
    isConnected: false,
    joinJourneyRoom: vi.fn(),
    leaveJourneyRoom: vi.fn(),
  }),
}));

import { ApproachPage } from '../pages/driver/ApproachPage';
import { useAuthStore } from '../stores/auth.store';
import { useJourneyStore } from '../stores/journey.store';
import { useChatStore } from '../stores/chat.store';

beforeEach(async () => {
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      approach: {
        title: 'Approach',
        chat: 'Chat',
        pickingUp: 'Picking up {{name}}',
        mapPlaceholder: 'Map placeholder',
        pickupAt: 'Pickup at',
        etaAway: '{{min}} min away',
        cantMakeTrip: 'I cannot make this trip',
        cantMakeTripTitle: 'Cannot make this trip?',
        cantMakeTripConfirm: 'Confirm withdraw',
        withdrawSuccess: 'Trip released',
        withdrawFailed: 'Could not withdraw',
        fetchFailed: 'Fetch failed',
      },
      common: { yes: 'Yes', no: 'No' },
      chat: { noMessages: 'No messages yet' },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');

  useAuthStore.setState({
    token: 'tok',
    user: {
      id: 'driver-1',
      nickname: 'Driver Bob',
      role: 'DRIVER',
      language: 'en',
      idVerified: true,
      licenseVerified: true,
      completedRides: 5,
      cancellationCount: 0,
      totalRequests: 0,
    },
    isAuthenticated: true,
    isLoading: false,
  });
  useJourneyStore.setState({
    activeJourney: {
      id: 'j-1',
      status: 'MATCHED',
      pickupLat: -1.95,
      pickupLng: 30.06,
      customer: { nickname: 'Alice' },
    } as any,
  });
  useChatStore.setState({ messages: [], isLoading: false });
});

function stubFetch(journey: any) {
  const fetchMock = vi.fn(async (url: any, init?: any) => {
    if (typeof url === 'string' && url.includes('/messages')) {
      return { ok: true, json: async () => [] } as any;
    }
    if (typeof url === 'string' && url.includes('/cancel')) {
      return {
        ok: true,
        json: async () => ({ ...journey, status: 'CANCELLED' }),
      } as any;
    }
    return { ok: true, json: async () => journey } as any;
  });
  (globalThis as any).fetch = fetchMock;
  return fetchMock;
}

describe('ApproachPage driver honest-withdrawal (R3-N-1)', () => {
  test('renders the "I cannot make this trip" button on the sticky action bar', async () => {
    const journey = {
      id: 'j-1',
      status: 'MATCHED',
      pickupLat: -1.95,
      pickupLng: 30.06,
      customer: { nickname: 'Alice' },
    };
    stubFetch(journey);

    render(
      <MemoryRouter initialEntries={['/driver/approach/j-1']}>
        <Routes>
          <Route path="/driver/approach/:id" element={<ApproachPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => screen.getByText('I cannot make this trip'));
    expect(screen.getByText('I cannot make this trip')).toBeInTheDocument();
  });

  test('clicking the button opens the confirmation modal', async () => {
    const journey = {
      id: 'j-1',
      status: 'MATCHED',
      pickupLat: -1.95,
      pickupLng: 30.06,
      customer: { nickname: 'Alice' },
    };
    stubFetch(journey);

    render(
      <MemoryRouter initialEntries={['/driver/approach/j-1']}>
        <Routes>
          <Route path="/driver/approach/:id" element={<ApproachPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => screen.getByText('I cannot make this trip'));
    act(() => {
      fireEvent.click(screen.getByText('I cannot make this trip'));
    });

    expect(screen.getByText('Confirm withdraw')).toBeInTheDocument();
    expect(screen.getByText('Yes')).toBeInTheDocument();
    expect(screen.getByText('No')).toBeInTheDocument();
  });

  test('confirming the modal POSTs cancel with reason=DRIVER_CAN_NOT_MAKE_IT', async () => {
    const journey = {
      id: 'j-1',
      status: 'MATCHED',
      pickupLat: -1.95,
      pickupLng: 30.06,
      customer: { nickname: 'Alice' },
    };
    const fetchMock = stubFetch(journey);

    render(
      <MemoryRouter initialEntries={['/driver/approach/j-1']}>
        <Routes>
          <Route path="/driver/approach/:id" element={<ApproachPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => screen.getByText('I cannot make this trip'));
    act(() => {
      fireEvent.click(screen.getByText('I cannot make this trip'));
    });
    act(() => {
      fireEvent.click(screen.getByText('Yes'));
    });

    await waitFor(() => {
      const cancelCall = fetchMock.mock.calls.find(
        (c: any) => typeof c[0] === 'string' && c[0].includes('/cancel'),
      );
      expect(cancelCall).toBeTruthy();
      const init = cancelCall![1] as any;
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body);
      expect(body).toEqual({ reason: 'DRIVER_CAN_NOT_MAKE_IT' });
    });
  });
});
