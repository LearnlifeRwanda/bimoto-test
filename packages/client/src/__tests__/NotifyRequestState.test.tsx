// NOTIFY G2 — "request sent — waiting for offers", both halves.
//
// Gakiza's field finding (20 Aug): a passenger posts a ride, is
// navigated straight to the bid list, and sees a spinner and a sort bar.
// Nothing on that screen confirms the request WAS SENT, so "we have it,
// drivers are being asked" and "this is broken" look identical.
//
// The customer half is a header that names which of the two moments she
// is in, and a ✓-sent toast fired from the CREATE RESPONSE. The driver
// half is JOURNEY_AVAILABLE keeping its existing store signal and
// gaining the intense sound — a request he cannot see is a fare he does
// not get.

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, renderHook } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { SOCKET_EVENTS } from '@bimoto/shared';
import { i18n } from './setup';

const { handlers, mockSocket, ioMock } = vi.hoisted(() => {
  const handlers = new Map<string, (...args: any[]) => void>();
  const mockSocket = {
    on: (evt: string, cb: (...args: any[]) => void) => {
      handlers.set(evt, cb);
      return mockSocket;
    },
    emit: () => mockSocket,
    disconnect: () => {},
    connected: true,
  };
  return { handlers, mockSocket, ioMock: { io: () => mockSocket } };
});
vi.mock('socket.io-client', () => ioMock);

const { playNotificationSound } = vi.hoisted(() => ({ playNotificationSound: vi.fn() }));
vi.mock('../lib/notification-sound', () => ({
  playNotificationSound,
  installSoundUnlock: vi.fn(),
}));

import { BidListPage } from '../pages/customer/BidListPage';
import { useSocket } from '../hooks/useSocket';
import { useAuthStore } from '../stores/auth.store';
import { useUIStore } from '../stores/ui.store';

const JOURNEY = 'jrn-1';

const resp = (data: unknown, ok = true) => ({ ok, statusText: 'err', json: async () => data });

// Per-URL router, the shape the existing BidListPage tests use — the
// bids call and the journey call answer different bodies and the page
// reads both.
function mockApi(bids: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.endsWith(`/journeys/${JOURNEY}/bids`)) return resp(bids);
      if (u.endsWith(`/journeys/${JOURNEY}`)) {
        return resp({ id: JOURNEY, pickupName: 'A', destinationName: 'B' });
      }
      return resp({});
    }) as never,
  );
}

beforeEach(async () => {
  handlers.clear();
  playNotificationSound.mockClear();
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      bidList: {
        request: {
          sentTitle: 'Request sent — waiting for offers',
          sentBody: 'Drivers nearby are being asked now.',
          sentToast: 'Request sent — we are asking drivers now',
          offersTitle: 'Offers have arrived',
          offersBody: '{{count}} so far. Take one, or wait for more.',
          offersBody_one: '{{count}} so far. Take one, or wait for more.',
          offersBody_other: '{{count}} so far. Take one, or wait for more.',
        },
      },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');
  useAuthStore.setState({
    token: 'tok',
    isAuthenticated: true,
    isLoading: false,
    user: { id: 'usr-1', role: 'CUSTOMER' } as never,
  } as never);
  useUIStore.setState({ toasts: [], toastMessage: null, toastType: null } as never);
});

function renderBidList() {
  return render(
    <MemoryRouter initialEntries={[`/journey/${JOURNEY}/bids`]}>
      <Routes>
        <Route path="/journey/:id/bids" element={<BidListPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('the customer half — the waiting state is said out loud', () => {
  test('a live request with no offers names itself "request sent — waiting for offers"', async () => {
    mockApi([]);
    renderBidList();
    const header = await screen.findByTestId('bid-list-request-state');
    expect(header.getAttribute('data-request-state')).toBe('waiting');
    expect(header.textContent).toContain('Request sent');
  });

  test('a journey WITH offers never shows the waiting state — it has flipped', async () => {
    mockApi([{ id: 'bid-1', price: 1800, driverName: 'Driver Joe', etaMinutes: 8 }]);
    renderBidList();
    await waitFor(() => {
      const header = screen.getByTestId('bid-list-request-state');
      expect(header.getAttribute('data-request-state')).toBe('offers-arrived');
    });
    expect(screen.getByTestId('bid-list-request-state').textContent).toContain(
      'Offers have arrived',
    );
    expect(screen.getByTestId('bid-list-request-state').textContent).not.toContain(
      'Request sent',
    );
  });
});

describe('the ✓-sent toast', () => {
  test('is notification-class, so it survives the navigation that follows it', () => {
    // The create path fires it directly; what matters to the field is
    // that it is not a 3-second transient a route change eats.
    useUIStore
      .getState()
      .showToast('Request sent — we are asking drivers now', 'success', 'notification');
    const toast = useUIStore.getState().toasts[0];
    expect(toast.toastClass).toBe('notification');
    expect(toast.type).toBe('success');
  });
});

describe('the driver half — JOURNEY_AVAILABLE', () => {
  test('keeps its store signal AND gains the intense sound', () => {
    renderHook(() => useSocket());
    const handler = handlers.get(SOCKET_EVENTS.JOURNEY_AVAILABLE);
    expect(handler).toBeDefined();
    handler!({ journeyId: JOURNEY });
    // A request a motari cannot see is a fare he does not get.
    expect(playNotificationSound).toHaveBeenCalledWith('critical');
  });
});
