// SOCKET-FIX G6 — unit tests for the four event handlers this wave
// wired in useSocket: journey:available (G2), journey:wish-price-updated
// (G3), account-frozen (G4), auto-bid:fired (G5). The socket.io client
// is mocked; each test drives the registered handler directly and
// asserts the store-level effect the UI consumes.

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
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

import { useSocket } from '../hooks/useSocket';
import { useAuthStore } from '../stores/auth.store';
import { useJourneyStore } from '../stores/journey.store';
import { useBidStore } from '../stores/bid.store';
import { useUIStore } from '../stores/ui.store';

beforeEach(async () => {
  handlers.clear();
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      bids: {
        autoBidPlaced: 'Auto-bid placed on a nearby request',
        newBidReceived: 'New offer received!',
      },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');
  useAuthStore.setState({ token: 'tok', isAuthenticated: true, isLoading: false });
  useJourneyStore.setState({
    journeys: [],
    activeJourney: null,
    nearbyRequests: [],
    availableSignal: null,
  });
  useBidStore.setState({ bids: [], myBids: [] });
  useUIStore.setState({ accountFrozen: false, toasts: [], toastMessage: null, toastType: null });
});

function mountSocket() {
  return renderHook(() => useSocket());
}

describe('useSocket wave-W1 handlers (SOCKET-FIX)', () => {
  test('registers listeners under the canonical constant names', () => {
    mountSocket();
    for (const evt of [
      SOCKET_EVENTS.JOURNEY_AVAILABLE,
      SOCKET_EVENTS.JOURNEY_WISH_PRICE_UPDATED,
      SOCKET_EVENTS.ACCOUNT_FROZEN,
      SOCKET_EVENTS.AUTO_BID_FIRED,
    ]) {
      expect(handlers.has(evt)).toBe(true);
    }
    // The dead 'journey:nearby' name must be gone.
    expect(handlers.has('journey:nearby')).toBe(false);
  });

  // SOCKET-HYGIENE G3 — the bid-placed listener is registered under the
  // unified server spelling, so the journey-room emit from
  // POST /journeys/:id/bids actually reaches it.
  test('bid-placed (unified name) adds the bid to the store and toasts', () => {
    mountSocket();
    expect(SOCKET_EVENTS.BID_PLACED).toBe('bid-placed');
    // The pre-unification client-only spelling must be gone.
    expect(handlers.has('bid:placed')).toBe(false);

    const bid = { id: 'b-9', journeyId: 'j-1', price: 1800, etaMinutes: 6 };
    handlers.get(SOCKET_EVENTS.BID_PLACED)!(bid);

    expect(useBidStore.getState().bids).toEqual([bid]);
    expect(useUIStore.getState().toastMessage).toBe('New offer received!');
    expect(useUIStore.getState().toastType).toBe('info');
  });

  test('journey:available raises a monotonic store signal carrying the payload', () => {
    mountSocket();
    const handler = handlers.get(SOCKET_EVENTS.JOURNEY_AVAILABLE)!;

    handler({ journeyId: 'j-1', urgent: true });
    expect(useJourneyStore.getState().availableSignal).toEqual({
      seq: 1,
      journeyId: 'j-1',
      urgent: true,
    });

    handler({ journeyId: 'j-2' });
    expect(useJourneyStore.getState().availableSignal).toEqual({
      seq: 2,
      journeyId: 'j-2',
      urgent: undefined,
    });
  });

  test('journey:wish-price-updated updates activeJourney AND the nearby list', () => {
    useJourneyStore.setState({
      journeys: [{ id: 'j-1', wishPrice: 1000 }],
      activeJourney: { id: 'j-1', wishPrice: 1000 },
      nearbyRequests: [
        { id: 'j-1', wishPrice: 1000 },
        { id: 'j-other', wishPrice: 700 },
      ],
    });
    mountSocket();

    handlers.get(SOCKET_EVENTS.JOURNEY_WISH_PRICE_UPDATED)!({
      journeyId: 'j-1',
      wishPrice: 1500,
      suggestUpCount: 1,
      addRwf: 500,
    });

    const state = useJourneyStore.getState();
    expect(state.activeJourney).toMatchObject({ wishPrice: 1500, suggestUpCount: 1 });
    expect(state.journeys[0]).toMatchObject({ wishPrice: 1500 });
    expect(state.nearbyRequests[0]).toMatchObject({ wishPrice: 1500, suggestUpCount: 1 });
    expect(state.nearbyRequests[1]).toMatchObject({ wishPrice: 700 });
  });

  test('account-frozen raises the blocking-notice flag (logout deferred to acknowledge)', () => {
    mountSocket();
    handlers.get(SOCKET_EVENTS.ACCOUNT_FROZEN)!({ reason: 'aml-review' });
    expect(useUIStore.getState().accountFrozen).toBe(true);
    // The handler itself must NOT log out — that happens on acknowledge.
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  // WIRE-FIX G2 — the refetch targets the real GET /api/bids/my-history
  // (the old /api/bids/mine never existed; wiring-report §1.4).
  test('auto-bid:fired shows the toast and refetches /api/bids/my-history into the store', async () => {
    const myBids = [{ id: 'b-1', journeyId: 'j-1', price: 1200 }];
    const fetchMock = vi.fn(async (_input: RequestInfo) => ({ ok: true, json: async () => myBids }));
    vi.stubGlobal('fetch', fetchMock as any);

    mountSocket();
    handlers.get(SOCKET_EVENTS.AUTO_BID_FIRED)!({
      journeyId: 'j-1',
      bidId: 'b-1',
      ruleId: 'r-1',
      bidAmount: 1200,
    });

    expect(useUIStore.getState().toastMessage).toBe('Auto-bid placed on a nearby request');
    expect(useUIStore.getState().toastType).toBe('info');
    await waitFor(() => {
      expect(useBidStore.getState().myBids).toEqual(myBids);
    });
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/bids/my-history');
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('/api/bids/mine');
  });

  // WIRE-FIX G2 — the silent-failure pattern goes: a failed refresh
  // debug-logs instead of vanishing.
  test('auto-bid:fired refetch failure is debug-logged, not swallowed', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const fetchMock = vi.fn(async (_input: RequestInfo) => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    }));
    vi.stubGlobal('fetch', fetchMock as any);

    mountSocket();
    handlers.get(SOCKET_EVENTS.AUTO_BID_FIRED)!({
      journeyId: 'j-1',
      bidId: 'b-1',
      ruleId: 'r-1',
      bidAmount: 1200,
    });

    await waitFor(() => {
      expect(debugSpy).toHaveBeenCalledWith('auto-bid refetch failed:', 500);
    });
    expect(useBidStore.getState().myBids).toEqual([]);
    debugSpy.mockRestore();
  });
});
