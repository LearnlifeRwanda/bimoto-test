import { describe, test, expect, vi, beforeEach } from 'vitest';

// Mock dependencies.
//
// QUEUE-UNITY G2 — a queued event now needs an owner to be queued at
// all, so this suite signs somebody in. The offline claims themselves
// are unchanged: what goes into the queue while there is no signal, and
// what leaves it when the signal comes back.

/** Scoped-read mock: `where('userId').equals(id).toArray()`. */
function scopedTable() {
  const modify = vi.fn().mockResolvedValue(0);
  return {
    add: vi.fn().mockResolvedValue(1),
    where: vi.fn().mockReturnValue({
      equals: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
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

const RIDER = vi.hoisted(() => ({ id: 'user-rider' }));

vi.mock('../stores/auth.store', () => {
  let state: { user: { id: string } | null; isAuthenticated: boolean } = {
    user: RIDER,
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

let mockOnline = false;
const connectivityCallbacks: ((online: boolean) => void)[] = [];

vi.mock('../sync/connectivity', () => ({
  getIsOnline: vi.fn(() => mockOnline),
  onConnectivityChange: vi.fn((cb: (online: boolean) => void) => {
    connectivityCallbacks.push(cb);
  }),
  checkConnectivity: vi.fn(() => Promise.resolve(mockOnline)),
  // NET-UX G1 — apiFetch reports every outcome into the connectivity module.
  reportApiFailure: vi.fn(),
  reportApiSuccess: vi.fn(),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

import { SyncManager } from '../sync/SyncManager';
import { QueueOwnerRequiredError } from '../sync/EventQueue';
import { db } from '../db/dexie';
import { useAuthStore } from '../stores/auth.store';

const setAuth = (next: unknown) =>
  (useAuthStore as unknown as { setState: (s: unknown) => void }).setState(next);

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

describe('Offline Behavior', () => {
  let manager: SyncManager;

  beforeEach(() => {
    vi.clearAllMocks();
    connectivityCallbacks.length = 0;
    mockOnline = false;
    setAuth({ user: RIDER, isAuthenticated: true });
    queued(db.syncEvents as never, []);
    queued(db.gpsBuffer as never, []);
    manager = new SyncManager();
  });

  test('events are queued to IndexedDB when offline', async () => {
    mockOnline = false;

    const event = {
      clientEventId: 'offline-evt-1',
      journeyId: 'j1',
      eventType: 'JOURNEY_CREATED',
      payload: { pickupName: 'Nyabugogo' },
      clientTimestamp: '2026-03-17T10:00:00Z',
    };

    await manager.enqueueEvent(event);

    // Event should be saved to IndexedDB
    expect(db.syncEvents.add).toHaveBeenCalledWith(
      expect.objectContaining({
        clientEventId: 'offline-evt-1',
        synced: false,
        userId: RIDER.id,
      }),
    );

    // No fetch should be called while offline
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('multiple offline events are all queued without network calls', async () => {
    mockOnline = false;

    const events = [
      {
        clientEventId: 'off-1',
        eventType: 'JOURNEY_CREATED',
        payload: {},
        clientTimestamp: '2026-03-17T10:00:00Z',
      },
      {
        clientEventId: 'off-2',
        eventType: 'BID_PLACED',
        payload: { price: 1000 },
        clientTimestamp: '2026-03-17T10:01:00Z',
      },
      {
        clientEventId: 'off-3',
        eventType: 'JOURNEY_STARTED',
        payload: {},
        clientTimestamp: '2026-03-17T10:05:00Z',
      },
    ];

    for (const event of events) {
      await manager.enqueueEvent(event);
    }

    expect(db.syncEvents.add).toHaveBeenCalledTimes(3);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('sync uploads queued events when connectivity is restored', async () => {
    // Start offline
    mockOnline = false;

    await manager.enqueueEvent({
      clientEventId: 'queued-evt',
      eventType: 'JOURNEY_CREATED',
      payload: {},
      clientTimestamp: '2026-03-17T10:00:00Z',
    });

    expect(mockFetch).not.toHaveBeenCalled();

    // Go online and set up mocks for sync
    mockOnline = true;

    const queuedEvents = [
      {
        clientEventId: 'queued-evt',
        eventType: 'JOURNEY_CREATED',
        payload: {},
        clientTimestamp: '2026-03-17T10:00:00Z',
        synced: false,
        userId: RIDER.id,
      },
    ];

    queued(db.syncEvents as never, queuedEvents);

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ processed: 1, rejected: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ events: [] }),
      });

    // Manually trigger sync (simulating connectivity change callback)
    const result = await manager.sync();

    expect(result.uploaded).toBe(1);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/sync/events'),
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
      }),
    );
  });

  test('sync does not proceed when offline', async () => {
    mockOnline = false;

    const result = await manager.sync();

    expect(result).toEqual({ uploaded: 0, downloaded: 0, rejected: 0 });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // QUEUE-UNITY G2 — offline is a reason to hold a row, not a reason to
  // write one nobody can claim.
  test('enqueueing with nobody signed in is refused, not null-stamped', async () => {
    mockOnline = false;
    setAuth({ user: null, isAuthenticated: false });

    await expect(
      manager.enqueueEvent({
        clientEventId: 'ownerless',
        eventType: 'JOURNEY_CREATED',
        payload: {},
        clientTimestamp: '2026-03-17T10:00:00Z',
      }),
    ).rejects.toBeInstanceOf(QueueOwnerRequiredError);

    // Nothing was written. A row with no owner is a row that could only
    // ever be sent as the wrong person.
    expect(db.syncEvents.add).not.toHaveBeenCalled();
  });
});
