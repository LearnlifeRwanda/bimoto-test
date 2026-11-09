// LIVE-WIRE G5 — a borrowed phone shows nothing of its last user.
//
// The Kigali team's item 7: "logging in with a new number kept the
// previous profile." This suite walks that exact sequence — user A
// signs in, uses the app, signs out, user B signs in — and asserts on
// what is left behind, store by store.
//
// It also pins the DELIBERATE survivors, because "we cleared it" and
// "we decided not to" must be distinguishable a year from now. A future
// change that starts wiping the offline outbox, or stops wiping the bid
// cache, fails here rather than in Kigali.

import { describe, test, expect, beforeEach, vi } from 'vitest';

vi.mock('../hooks/usePushNotifications', () => ({
  deregisterPush: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../lib/secure-token-store', () => ({
  clearStoredRefreshToken: vi.fn().mockResolvedValue(undefined),
  getStoredRefreshToken: vi.fn().mockResolvedValue(null),
}));

const cleared: string[] = [];
const table = (name: string) => ({
  clear: vi.fn(async () => {
    cleared.push(name);
  }),
});
const fakeDb = {
  journeys: table('journeys'),
  bids: table('bids'),
  messages: table('messages'),
  syncMeta: table('syncMeta'),
  syncEvents: table('syncEvents'),
  gpsBuffer: table('gpsBuffer'),
  mapCache: table('mapCache'),
  mapDownloads: table('mapDownloads'),
};
vi.mock('../db/dexie', () => ({ db: fakeDb }));

import { useAuthStore } from '../stores/auth.store';
import { useJourneyStore } from '../stores/journey.store';
import { useBidStore } from '../stores/bid.store';
import { useChatStore } from '../stores/chat.store';
import { useUIStore } from '../stores/ui.store';
import { useEmergencyAlertStore } from '../stores/emergency-alert.store';
import { useDiagnosticsStore } from '../stores/diagnostics.store';
import { resetPerUserCaches } from '../lib/session-reset';

const USER_A = { id: 'user-a', nickname: 'Chantal', role: 'CUSTOMER' } as never;
const USER_B = { id: 'user-b', nickname: 'Jean', role: 'DRIVER' } as never;

/** Everything a signed-in user accumulates on this phone. */
function populateForUserA() {
  useJourneyStore.setState({
    journeys: [{ id: 'j-a', customerId: 'user-a' }],
    activeJourney: { id: 'j-a', customerId: 'user-a', status: 'REQUESTED' },
    nearbyRequests: [{ id: 'j-other' }],
    availableSignal: { seq: 3, journeyId: 'j-other' },
  });
  useBidStore.setState({
    bids: [{ id: 'b-a', price: 1200 }],
    myBids: [{ id: 'b-a2' }],
  });
  useChatStore.setState({ messages: [{ id: 'm-a', text: 'I am outside' }] as never });
  useEmergencyAlertStore.setState({ alerts: [{ journeyId: 'j-a' }] as never });
  useUIStore.setState({ accountFrozen: true });
  useDiagnosticsStore.setState({
    lastLocationLat: -1.9441,
    lastLocationLng: 30.0619,
    lastLocationAt: Date.now(),
    lastFeedViewAs: 'driver',
    lastFeedStatus: 200,
    lastFeedAt: Date.now(),
  });
}

function leftBehind() {
  return {
    journeys: useJourneyStore.getState().journeys,
    activeJourney: useJourneyStore.getState().activeJourney,
    nearbyRequests: useJourneyStore.getState().nearbyRequests,
    availableSignal: useJourneyStore.getState().availableSignal,
    bids: useBidStore.getState().bids,
    myBids: useBidStore.getState().myBids,
    messages: useChatStore.getState().messages,
    alerts: useEmergencyAlertStore.getState().alerts,
    accountFrozen: useUIStore.getState().accountFrozen,
    lastLocationLat: useDiagnosticsStore.getState().lastLocationLat,
    lastFeedViewAs: useDiagnosticsStore.getState().lastFeedViewAs,
  };
}

function expectNothingOfUserA() {
  const state = leftBehind();
  expect(state.journeys).toEqual([]);
  expect(state.activeJourney).toBeNull();
  expect(state.nearbyRequests).toEqual([]);
  expect(state.availableSignal).toBeNull();
  expect(state.bids).toEqual([]);
  expect(state.myBids).toEqual([]);
  expect(state.messages).toEqual([]);
  expect(state.alerts).toEqual([]);
  expect(state.accountFrozen).toBe(false);
  expect(state.lastLocationLat).toBeNull();
  expect(state.lastFeedViewAs).toBeNull();
}

beforeEach(() => {
  cleared.length = 0;
  vi.clearAllMocks();
  useAuthStore.setState({ user: null, isAuthenticated: false, token: null });
});

describe('a new number is a new person on this phone', () => {
  test('logout then login as somebody else leaves nothing of the first user', async () => {
    useAuthStore.getState().setUser(USER_A);
    populateForUserA();

    useAuthStore.getState().logout();
    useAuthStore.getState().setUser(USER_B);

    expectNothingOfUserA();
    expect(useAuthStore.getState().user?.id).toBe('user-b');
  });

  test('switching user WITHOUT an explicit logout is caught too', async () => {
    // The field phone does not always take the tidy path.
    useAuthStore.getState().setUser(USER_A);
    populateForUserA();

    useAuthStore.getState().setUser(USER_B);

    expectNothingOfUserA();
  });

  test('re-setting the SAME user keeps their live ride', () => {
    // A token refresh, a profile edit and a session restore all re-set
    // the same user. Wiping a live ride's state for those would be its
    // own defect, so identity — not the call — is what triggers a reset.
    useAuthStore.getState().setUser(USER_A);
    populateForUserA();

    useAuthStore.getState().setUser({ ...(USER_A as object), nickname: 'Chantal M.' } as never);

    expect(useJourneyStore.getState().activeJourney?.id).toBe('j-a');
    expect(useBidStore.getState().bids).toHaveLength(1);
  });
});

describe('the durable caches', () => {
  test('per-user read caches are cleared', async () => {
    await resetPerUserCaches();

    expect(cleared).toEqual(
      expect.arrayContaining(['journeys', 'bids', 'messages', 'syncMeta']),
    );
  });

  test('the offline outbox and GPS buffer are NOT cleared — a reported seam, not an oversight', async () => {
    // Neither table carries a user id (db/tables.ts), so on a device
    // that changed hands there is no way to tell whose rows they are.
    // Clearing destroys a previous user's unsynced work; keeping replays
    // it under the new user's credentials. Both are wrong, so today's
    // behaviour is preserved deliberately and the seam is reported
    // rather than guessed at. See lib/session-reset.ts.
    await resetPerUserCaches();

    expect(cleared).not.toContain('syncEvents');
    expect(cleared).not.toContain('gpsBuffer');
  });

  test('the offline map survives — it is a device asset, not a person', async () => {
    // 30–50 MB of Kigali tiles containing nothing about anyone.
    // Re-downloading it on a borrowed phone is a data-cost injury with
    // no privacy gain.
    await resetPerUserCaches();

    expect(cleared).not.toContain('mapCache');
    expect(cleared).not.toContain('mapDownloads');
  });

  test('a failed clear never strands the user', async () => {
    fakeDb.journeys.clear.mockRejectedValueOnce(new Error('IndexedDB unavailable'));

    await expect(resetPerUserCaches()).resolves.toBeUndefined();
  });
});
