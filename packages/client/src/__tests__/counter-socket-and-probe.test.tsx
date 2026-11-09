// COUNTER-READY G5 — the two rails the dormant design rides on.
//
// (1) THE BOOT PROBE. The client learns the switch from /api/health, on
//     the same fetch that already carries the run modes, with the
//     fail-safe rule INVERTED: the modes default to 'live' so an
//     unreachable endpoint never paints real money as fake; this
//     defaults to false so an unreachable endpoint never ENABLES a
//     dormant feature. Every not-exactly-true answer is pinned here,
//     because "the server said something odd" is the case that decides
//     whether a pilot phone wakes a feature nobody asked it to.
//
// (2) THE THREE EVENTS. Their listeners are registered unconditionally —
//     a dormant server refuses both counter endpoints, so nothing can
//     ever reach them — and the emit↔listen orphan guard requires the
//     constant, the emit and the listener to move together. What is
//     pinned is the toast each one says and the sound it spends.
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { SOCKET_EVENTS } from '@bimoto/shared';
import { i18n } from './setup';
import enTranslation from '../../public/locales/en/translation.json';

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

const playNotificationSound = vi.fn();
vi.mock('../lib/notification-sound', () => ({
  playNotificationSound: (v: string) => playNotificationSound(v),
}));

import { useSocket } from '../hooks/useSocket';
import { useAuthStore } from '../stores/auth.store';
import { useJourneyStore } from '../stores/journey.store';
import { useBidStore } from '../stores/bid.store';
import { useUIStore } from '../stores/ui.store';
import { useSimulationStore } from '../stores/simulation.store';

beforeEach(async () => {
  handlers.clear();
  playNotificationSound.mockClear();
  i18n.addResourceBundle('en', 'translation', enTranslation, true, true);
  await i18n.changeLanguage('en');
  useAuthStore.setState({ token: 'tok', isAuthenticated: true, isLoading: false });
  useJourneyStore.setState({
    journeys: [], activeJourney: null, nearbyRequests: [], availableSignal: null,
  });
  useBidStore.setState({ bids: [], myBids: [] });
  useUIStore.setState({ accountFrozen: false, toasts: [], toastMessage: null, toastType: null });
  useSimulationStore.setState({
    paymentsMode: 'live', smsMode: 'live', counterBidEnabled: false, bannerDismissed: false,
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('the dormant switch defaults OFF, and only a plain true moves it', () => {
  const store = () => useSimulationStore.getState();

  test('the store starts false, with no server having said anything', () => {
    expect(store().counterBidEnabled).toBe(false);
  });

  test.each([
    ['a server too old to know the field', undefined],
    ['a null', null],
    ['the string "true"', 'true'],
    ['the number 1', 1],
    ['an explicit false', false],
  ])('%s leaves it asleep', (_label, value) => {
    // This is the shape of the check in App.tsx's fetchModes:
    // `data.counterBidEnabled === true`, and nothing looser.
    store().setCounterBidEnabled((value as unknown) === true);
    expect(store().counterBidEnabled).toBe(false);
  });

  test('only a real boolean true wakes it', () => {
    store().setCounterBidEnabled((true as unknown) === true);
    expect(store().counterBidEnabled).toBe(true);
  });

  test('and the simulation modes are untouched by any of it', () => {
    // One probe, two independent answers: a counter flip must not move
    // the "SIMULATION — no real money" banner in either direction.
    store().setCounterBidEnabled(true);
    expect(store().paymentsMode).toBe('live');
    expect(store().smsMode).toBe('live');
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('the three counter events reach the person they are addressed to', () => {
  test('all three listeners are registered, under the canonical constants', () => {
    renderHook(() => useSocket());
    for (const evt of [
      SOCKET_EVENTS.BID_COUNTERED,
      SOCKET_EVENTS.COUNTER_ACCEPTED,
      SOCKET_EVENTS.COUNTER_DECLINED,
    ]) {
      expect(handlers.has(evt)).toBe(true);
    }
  });

  test('BID_COUNTERED tells the motari the number under discussion', async () => {
    renderHook(() => useSocket());
    handlers.get(SOCKET_EVENTS.BID_COUNTERED)!({
      journeyId: 'j1', bidId: 'b1', counterAmountRwf: 1500, originalPrice: 2000,
    });

    await waitFor(() =>
      expect(useUIStore.getState().toastMessage).toBe(
        'A passenger suggested 1,500 RWF for your offer',
      ),
    );
    // STANDARD, not critical: a price suggestion is a conversation, not
    // a lost fare. 'critical' is spent on the four things that cost him
    // money if he misses them.
    expect(playNotificationSound).toHaveBeenCalledWith('standard');
  });

  test('COUNTER_ACCEPTED tells her at the number she will be charged', async () => {
    renderHook(() => useSocket());
    handlers.get(SOCKET_EVENTS.COUNTER_ACCEPTED)!({
      journeyId: 'j1', bidId: 'b1', agreedPrice: 1500,
    });

    await waitFor(() =>
      expect(useUIStore.getState().toastMessage).toBe('Your price of 1,500 RWF was accepted'),
    );
    expect(useUIStore.getState().toastType).toBe('success');
    expect(playNotificationSound).toHaveBeenCalledWith('standard');
  });

  test('COUNTER_DECLINED says his offer STILL STANDS, at HIS price', async () => {
    // The number in this toast is his, not hers — "you can still take
    // his offer" is the whole message, and a decline that read as "the
    // offer is gone" would be false.
    renderHook(() => useSocket());
    handlers.get(SOCKET_EVENTS.COUNTER_DECLINED)!({
      journeyId: 'j1', bidId: 'b1', originalPrice: 2000,
    });

    await waitFor(() =>
      expect(useUIStore.getState().toastMessage).toBe(
        'Your price was not accepted — the offer of 2,000 RWF still stands',
      ),
    );
  });

  test.each([
    [SOCKET_EVENTS.BID_COUNTERED, undefined],
    [SOCKET_EVENTS.BID_COUNTERED, {}],
    [SOCKET_EVENTS.COUNTER_ACCEPTED, { journeyId: 'j1' }],
    [SOCKET_EVENTS.COUNTER_DECLINED, { originalPrice: 'lots' }],
  ])('%s with a malformed payload says nothing at all', (evt, payload) => {
    renderHook(() => useSocket());
    handlers.get(evt as string)!(payload);
    expect(useUIStore.getState().toastMessage).toBeNull();
    expect(playNotificationSound).not.toHaveBeenCalled();
  });
});
