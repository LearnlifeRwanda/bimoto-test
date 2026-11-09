// __TESTS__/SYNC-DOWNLOAD-LEG.TEST.TS
//
// LOOSE-ENDS G5 — the download leg reads what the server sends.
//
// `GET /api/sync/events` answers with a BARE ARRAY (`res.json(events)`,
// sync.routes.ts). SyncManager read `data.events` off it, which is
// `undefined` against an array, so `downloaded` was always 0 and
// `applyServerEvents` had never run once — the whole leg was dead while
// reporting success, and no test noticed because none of them looked
// past the number.
//
// Against REAL Dexie over fake-indexeddb, deliberately. The claim here
// is that server events reach LOCAL ROWS, and a mocked database is
// exactly what let this hide: a mock returns what it was told to, so a
// resolver that never runs still leaves the assertions green. Same
// argument, and the same fake-indexeddb setup, as
// queue-ownership.test.ts (docs/queue-ownership-enumeration.md §2).

// @vitest-environment node

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';

const apiFetchMock = vi.fn();
vi.mock('../lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
  apiErrorFromResponse: vi.fn(),
  isConnectivityError: () => false,
}));

vi.mock('../sync/connectivity', () => ({
  getIsOnline: () => true,
  onConnectivityChange: vi.fn(),
  checkConnectivity: async () => true,
  reportApiFailure: vi.fn(),
  reportApiSuccess: vi.fn(),
}));

import { db } from '../db/dexie';
import { SyncManager } from '../sync/SyncManager';
import { useAuthStore } from '../stores/auth.store';

const ALICE = 'user-alice';
const JOURNEY = 'journey-1';

function signIn(userId: string): void {
  useAuthStore.setState({ user: { id: userId } as never, isAuthenticated: true } as never);
}

/** A JOURNEY_ENDED event exactly as the server row serialises. */
function statusEvent(status: string) {
  return {
    id: 'srv-1',
    clientEventId: 'ce-1',
    journeyId: JOURNEY,
    eventType: 'JOURNEY_ENDED',
    payload: { status },
    serverTimestamp: '2026-08-17T09:00:00.000Z',
  };
}

/**
 * Answer the drain: nothing queued to upload, and `body` as the
 * download response. The upload legs find empty tables, so the only
 * call that matters is the GET.
 */
function serverAnswers(body: unknown) {
  apiFetchMock.mockImplementation(async (url: string) => {
    if (typeof url === 'string' && url.includes('/api/sync/events?since=')) {
      return { ok: true, json: async () => body };
    }
    return { ok: true, json: async () => ({ processed: [], rejected: [] }) };
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  await db.open();
  await Promise.all([
    db.journeys.clear(),
    db.syncEvents.clear(),
    db.gpsBuffer.clear(),
    db.syncMeta.clear(),
  ]);
  signIn(ALICE);
  // A local row the server is about to correct.
  await db.journeys.put({
    id: JOURNEY,
    customerId: ALICE,
    status: 'IN_PROGRESS',
    createdAt: '2026-08-17T08:00:00.000Z',
  } as never);
});

afterEach(() => {
  useAuthStore.setState({ user: null, isAuthenticated: false } as never);
});

describe('the download leg, against the shape the server actually sends', () => {
  test('a bare array is counted and applied', async () => {
    serverAnswers([statusEvent('COMPLETED')]);

    const result = await new SyncManager().sync();

    expect(result.downloaded).toBe(1);
    // The claim that matters: the event reached the local row.
    expect((await db.journeys.get(JOURNEY))?.status).toBe('COMPLETED');
    expect((await db.syncMeta.get('lastSyncTimestamp'))?.value).toBeTruthy();
  });

  test('an empty array downloads nothing and stamps nothing', async () => {
    serverAnswers([]);

    const result = await new SyncManager().sync();

    expect(result.downloaded).toBe(0);
    expect((await db.journeys.get(JOURNEY))?.status).toBe('IN_PROGRESS');
    expect(await db.syncMeta.get('lastSyncTimestamp')).toBeUndefined();
  });

  test('a wrapped { events: [...] } envelope still works', async () => {
    // Not what the server sends today. Tolerated so that a future
    // server which wraps the payload cannot silently re-break this.
    serverAnswers({ events: [statusEvent('CANCELLED')] });

    const result = await new SyncManager().sync();

    expect(result.downloaded).toBe(1);
    expect((await db.journeys.get(JOURNEY))?.status).toBe('CANCELLED');
  });

  test('a shape that is neither is treated as empty, not as a crash', async () => {
    serverAnswers({ unexpected: true });

    const result = await new SyncManager().sync();

    expect(result.downloaded).toBe(0);
    expect((await db.journeys.get(JOURNEY))?.status).toBe('IN_PROGRESS');
  });

  test('several events all land', async () => {
    serverAnswers([
      { ...statusEvent('COMPLETED'), id: 'srv-1' },
      {
        id: 'srv-2',
        journeyId: JOURNEY,
        eventType: 'MESSAGE_SENT',
        payload: { id: 'msg-1', journeyId: JOURNEY, content: 'On my way' },
        serverTimestamp: '2026-08-17T09:00:01.000Z',
      },
    ]);

    const result = await new SyncManager().sync();

    expect(result.downloaded).toBe(2);
    expect((await db.journeys.get(JOURNEY))?.status).toBe('COMPLETED');
    expect(await db.messages.get('msg-1')).toMatchObject({ content: 'On my way' });
  });

  test('the since cursor is sent, and advances after a download', async () => {
    serverAnswers([statusEvent('COMPLETED')]);
    await new SyncManager().sync();

    const stamped = (await db.syncMeta.get('lastSyncTimestamp'))?.value as string;
    expect(stamped).toBeTruthy();

    serverAnswers([]);
    await new SyncManager().sync();

    const urls = apiFetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes(`since=${encodeURIComponent(stamped)}`))).toBe(true);
  });
});
