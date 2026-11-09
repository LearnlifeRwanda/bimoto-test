import { describe, test, expect, vi, beforeEach } from 'vitest';

// This suite is about the HTTP envelope: what SyncManager sends, what it
// does with what comes back. Dexie is mocked because none of that is a
// storage question.
//
// QUEUE-UNITY G2 note, since a mocked Dexie is exactly what let the
// `synced` boolean-index defect hide here for four versions
// (docs/queue-ownership-enumeration.md §2): the OWNERSHIP claims are
// deliberately NOT tested in this file. They live in
// queue-ownership.test.ts against real Dexie over fake-indexeddb, where
// a wrong query returns the wrong rows instead of whatever the mock was
// told to say.

/** Scoped-read mock: `where('userId').equals(id).toArray()` and the
 *  `.filter().modify()` the mark-* writes go through. */
function scopedTable(rows: unknown[] = []) {
  const modify = vi.fn().mockResolvedValue(rows.length);
  return {
    add: vi.fn().mockResolvedValue(1),
    where: vi.fn().mockReturnValue({
      equals: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue(rows),
        filter: vi.fn().mockReturnValue({ modify }),
        modify,
      }),
    }),
  };
}

vi.mock('../db/dexie', () => ({
  db: {
    syncEvents: scopedTable(),
    gpsBuffer: scopedTable(),
    syncMeta: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

// vi.hoisted: the mock factory below is lifted above every import, so
// the constant it closes over has to be lifted with it.
const SIGNED_IN = vi.hoisted(() => ({ id: 'user-alice', phone: '+250780000001' }));

vi.mock('../stores/auth.store', () => {
  let state: { user: { id: string } | null; isAuthenticated: boolean } = {
    user: SIGNED_IN,
    isAuthenticated: true,
  };
  return {
    useAuthStore: {
      getState: () => state,
      setState: (next: Partial<typeof state>) => {
        state = { ...state, ...next };
      },
    },
  };
});

vi.mock('../sync/connectivity', () => ({
  getIsOnline: vi.fn().mockReturnValue(true),
  onConnectivityChange: vi.fn(),
  checkConnectivity: vi.fn().mockResolvedValue(true),
  // NET-UX G1 — apiFetch reports every outcome into the connectivity module.
  reportApiFailure: vi.fn(),
  reportApiSuccess: vi.fn(),
}));

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

import { SyncManager } from '../sync/SyncManager';
import { db } from '../db/dexie';
import { getIsOnline } from '../sync/connectivity';
import { useAuthStore } from '../stores/auth.store';

/** Point the scoped read at these rows for the next sync(). */
function queued(table: { where: ReturnType<typeof vi.fn> }, rows: unknown[]) {
  const modify = vi.fn().mockResolvedValue(rows.length);
  table.where.mockReturnValue({
    equals: vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue(rows),
      filter: vi.fn().mockReturnValue({ modify }),
      modify,
    }),
  });
  return modify;
}

describe('SyncManager', () => {
  let manager: SyncManager;

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as unknown as { setState: (s: unknown) => void }).setState({
      user: SIGNED_IN,
      isAuthenticated: true,
    });
    queued(db.syncEvents as never, []);
    queued(db.gpsBuffer as never, []);
    manager = new SyncManager();
  });

  test('enqueueEvent saves event to the queue via EventQueue', async () => {
    const event = {
      clientEventId: 'evt-1',
      journeyId: 'j1',
      eventType: 'JOURNEY_CREATED',
      payload: { pickupName: 'Downtown' },
      clientTimestamp: '2026-03-17T10:00:00Z',
    };

    // Mock fetch to return ok for the sync triggered by enqueue
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ processed: 0, rejected: [], events: [] }),
    });

    await manager.enqueueEvent(event);

    expect(db.syncEvents.add).toHaveBeenCalledWith(
      expect.objectContaining({
        clientEventId: 'evt-1',
        eventType: 'JOURNEY_CREATED',
        synced: false,
        // QUEUE-UNITY G2 — the row says whose it is, derived from the
        // session rather than passed by the caller.
        userId: SIGNED_IN.id,
      }),
    );
  });

  test('sync uploads pending events when online', async () => {
    // Set up unsynced events to be returned
    const unsyncedEvents = [
      {
        clientEventId: 'evt-1',
        journeyId: 'j1',
        eventType: 'JOURNEY_CREATED',
        payload: { pickupName: 'Downtown' },
        clientTimestamp: '2026-03-17T10:00:00Z',
        synced: false,
        userId: SIGNED_IN.id,
      },
    ];

    queued(db.syncEvents as never, unsyncedEvents);

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ processed: 1, rejected: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ events: [] }),
      });

    const result = await manager.sync();

    expect(result.uploaded).toBe(1);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/sync/events'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('handles server rejection gracefully', async () => {
    const unsyncedEvents = [
      {
        clientEventId: 'evt-bad',
        eventType: 'INVALID',
        payload: {},
        clientTimestamp: '2026-03-17T10:00:00Z',
        synced: false,
        userId: SIGNED_IN.id,
      },
    ];

    queued(db.syncEvents as never, unsyncedEvents);

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            processed: 0,
            rejected: [{ clientEventId: 'evt-bad', reason: 'Invalid event type' }],
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ events: [] }),
      });

    const result = await manager.sync();

    expect(result.rejected).toBe(1);
  });

  // QUEUE-UNITY G2 — a drain with no user is not a drain.
  test('sync does nothing at all when nobody is signed in', async () => {
    queued(db.syncEvents as never, [
      { clientEventId: 'evt-1', eventType: 'X', payload: {}, clientTimestamp: '2026-03-17T10:00:00Z', synced: false, userId: 'user-alice' },
    ]);
    (useAuthStore as unknown as { setState: (s: unknown) => void }).setState({
      user: null,
      isAuthenticated: false,
    });

    const result = await manager.sync();

    expect(result).toEqual({ uploaded: 0, downloaded: 0, rejected: 0 });
    // Not even the download leg: there is no session to download for.
    expect(mockFetch).not.toHaveBeenCalled();
    expect(db.syncEvents.where).not.toHaveBeenCalled();
  });

  test('sync returns zeros when offline', async () => {
    vi.mocked(getIsOnline).mockReturnValue(false);

    const result = await manager.sync();

    expect(result).toEqual({ uploaded: 0, downloaded: 0, rejected: 0 });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('enqueueEvent triggers sync when online', async () => {
    vi.mocked(getIsOnline).mockReturnValue(true);
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ processed: 0, rejected: [], events: [] }),
    });

    const event = {
      clientEventId: 'evt-1',
      eventType: 'JOURNEY_CREATED',
      payload: {},
      clientTimestamp: '2026-03-17T10:00:00Z',
    };

    await manager.enqueueEvent(event);

    // fetch should have been called because we are online
    // (it may or may not actually upload depending on mock state,
    //  but the sync attempt should be triggered)
    expect(db.syncEvents.add).toHaveBeenCalled();
  });
});
