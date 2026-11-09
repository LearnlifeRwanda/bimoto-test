// ACCOUNT-RIGHTS-SURFACE G6 — the phone of an account that has been erased.
//
// #195 killed every refresh token inside the erasure transaction, so the
// NEXT request from an erased account's live session is a 401. What that
// 401 must produce on the device is the ordinary logout path — the same
// one a frozen or expired session takes — which clears the per-user Dexie
// caches through lib/session-reset.
//
// Nothing new is built here and nothing new is cleared. This suite exists
// because AR-SURFACE is the dispatch that gives users the button, and the
// device-side half of what that button eventually does had no test naming
// the erasure case. It reuses live-wire-session-reset's idiom exactly:
// a fake Dexie whose tables record their own clears, so the DELIBERATE
// survivors are asserted as loudly as the casualties.
//
// The survivors are the point. gpsBuffer and syncEvents are user-stamped
// and inert to anyone else, and wiping them would destroy the evidence
// trail of the rides that had just happened — including any ride whose
// erasure is still deferred.

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
import { useChatStore } from '../stores/chat.store';
import { resetPerUserCaches } from '../lib/session-reset';
import { readSessionSnapshot } from '../lib/session-snapshot';

const ERASED_USER = { id: 'user-erased', nickname: 'Chantal', role: 'CUSTOMER' } as never;

beforeEach(() => {
  cleared.length = 0;
  vi.clearAllMocks();
  useAuthStore.setState({ user: null, isAuthenticated: false, token: null });
});

describe('an erased account boots into a 401', () => {
  test('the logout path leaves the app signed out with no identity to restore', () => {
    useAuthStore.getState().setUser(ERASED_USER);
    useJourneyStore.setState({
      journeys: [{ id: 'j-1', customerId: 'user-erased' }],
      activeJourney: { id: 'j-1', status: 'REQUESTED' },
    } as never);
    useChatStore.setState({ messages: [{ id: 'm-1', text: 'outside' }] } as never);

    // What App.tsx's boot does when the server rejects the session: the
    // normal logout path, not a special erased-account branch.
    useAuthStore.getState().logout();

    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().token).toBeNull();
    // Nothing to draw a stand-in home from on the next cold boot.
    expect(readSessionSnapshot()).toBeNull();
    // Synchronous stores are clean on the very next render.
    expect(useJourneyStore.getState().journeys).toEqual([]);
    expect(useJourneyStore.getState().activeJourney).toBeNull();
    expect(useChatStore.getState().messages).toEqual([]);
  });

  test('the per-user Dexie caches are cleared', async () => {
    await resetPerUserCaches();
    expect(cleared.sort()).toEqual(['bids', 'journeys', 'messages', 'syncMeta']);
  });

  test('gpsBuffer and syncEvents deliberately survive', async () => {
    await resetPerUserCaches();
    // Pinned as a DECISION, not an omission: a change that starts wiping
    // these fails here rather than quietly destroying the trail of rides
    // an erasure may still be deferred on.
    expect(cleared).not.toContain('gpsBuffer');
    expect(cleared).not.toContain('syncEvents');
    expect(fakeDb.gpsBuffer.clear).not.toHaveBeenCalled();
    expect(fakeDb.syncEvents.clear).not.toHaveBeenCalled();
  });

  test('device-level caches survive too — the map does not belong to a person', async () => {
    await resetPerUserCaches();
    expect(fakeDb.mapCache.clear).not.toHaveBeenCalled();
    expect(fakeDb.mapDownloads.clear).not.toHaveBeenCalled();
  });

  test('an erased user signing back in as somebody else leaves nothing behind', () => {
    useAuthStore.getState().setUser(ERASED_USER);
    useChatStore.setState({ messages: [{ id: 'm-1', text: 'outside' }] } as never);

    useAuthStore.getState().setUser({ id: 'user-next', nickname: 'Jean', role: 'DRIVER' } as never);

    expect(useChatStore.getState().messages).toEqual([]);
    expect(useAuthStore.getState().user?.id).toBe('user-next');
  });
});
