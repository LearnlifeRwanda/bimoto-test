// __TESTS__/QUEUE-OWNERSHIP.TEST.TS
//
// QUEUE-UNITY G2 — the phone that passes from brother to brother.
//
// One device, two people, two half-sent histories. Everything below is
// a claim about what CANNOT happen: not "the scoped read returns the
// right rows" but "there is no sequence of signing in and out that
// makes one person's queued work leave under the other's name".
//
// Against REAL Dexie over fake-indexeddb, deliberately. The suites that
// mock the database (SyncManager.test.ts, offline.test.ts) are useful
// for the HTTP envelope and useless here: a mock returns what it was
// told to, so a query that asks for the wrong rows still passes. That
// is exactly how the `synced` boolean-index defect survived four schema
// versions unnoticed (docs/queue-ownership-enumeration.md §2).

// @vitest-environment node

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';

const apiFetchMock = vi.fn();
vi.mock('../lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
  apiErrorFromResponse: vi.fn(),
  isConnectivityError: () => false,
}));

let online = true;
vi.mock('../sync/connectivity', () => ({
  getIsOnline: () => online,
  onConnectivityChange: vi.fn(),
  checkConnectivity: async () => online,
  reportApiFailure: vi.fn(),
  reportApiSuccess: vi.fn(),
}));

import { db } from '../db/dexie';
import { eventQueue, EventQueue, QueueOwnerRequiredError } from '../sync/EventQueue';
import { SyncManager } from '../sync/SyncManager';
import { useAuthStore } from '../stores/auth.store';

const ALICE = 'user-alice';
const BROTHER = 'user-brother';

function signIn(userId: string): void {
  useAuthStore.setState({
    user: { id: userId } as never,
    isAuthenticated: true,
  } as never);
}

function signOut(): void {
  useAuthStore.setState({ user: null, isAuthenticated: false } as never);
}

function anEvent(clientEventId: string, clientTimestamp = '2026-08-16T10:00:00.000Z') {
  return {
    clientEventId,
    journeyId: 'journey-1',
    eventType: 'JOURNEY_CREATED',
    payload: { pickupName: 'Sonatubes' },
    clientTimestamp,
  };
}

/** A gps row as the drain expects to find it. Producers exist now
 *  (the offline broadcast buffer, #175; the ride-trace recorder,
 *  RIDE-TRACE G2) — this file is about the drain, so it seeds directly. */
async function seedGps(userId: string | null, journeyId: string, timestamp: string) {
  await db.gpsBuffer.add({
    userId,
    journeyId,
    lat: -1.95,
    lng: 30.06,
    accuracy: 8,
    timestamp,
    synced: false,
  } as never);
}

/** An ok answer for the upload leg, then an ok empty download. */
function serverAccepts(processed: number) {
  apiFetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ processed, rejected: [], events: [] }),
  });
}

beforeEach(async () => {
  online = true;
  apiFetchMock.mockReset();
  await db.syncEvents.clear();
  await db.gpsBuffer.clear();
  await db.syncMeta.clear();
  signIn(ALICE);
});

afterEach(() => {
  signOut();
});

// ---------------------------------------------------------------- write

describe('the stamp: a row cannot be written without an owner', () => {
  test('enqueue stamps the signed-in user, and the caller never passes one', async () => {
    await eventQueue.enqueue(anEvent('e1'));

    const rows = await db.syncEvents.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(ALICE);
    expect(rows[0].synced).toBe(false);
  });

  test('signed out, enqueue refuses with a named error and writes nothing', async () => {
    signOut();

    await expect(eventQueue.enqueue(anEvent('e1'))).rejects.toBeInstanceOf(
      QueueOwnerRequiredError,
    );
    expect(await db.syncEvents.count()).toBe(0);
  });

  test('a stale session flag with no user is still no owner', async () => {
    // isAuthenticated true but user null: the shape a half-torn-down
    // session can take. It must not produce a row stamped `undefined`.
    useAuthStore.setState({ user: null, isAuthenticated: true } as never);

    await expect(eventQueue.enqueue(anEvent('e1'))).rejects.toBeInstanceOf(
      QueueOwnerRequiredError,
    );
    expect(await db.syncEvents.count()).toBe(0);
  });

  test('two people on one phone write two separately-owned rows', async () => {
    await eventQueue.enqueue(anEvent('alice-1'));
    signIn(BROTHER);
    await eventQueue.enqueue(anEvent('brother-1'));

    const byOwner = Object.fromEntries(
      (await db.syncEvents.toArray()).map((r) => [r.clientEventId, r.userId]),
    );
    expect(byOwner).toEqual({ 'alice-1': ALICE, 'brother-1': BROTHER });
  });
});

// ----------------------------------------------------------------- read

describe('the scoped read: A never sees B, in either direction', () => {
  beforeEach(async () => {
    await eventQueue.enqueue(anEvent('alice-1', '2026-08-16T10:00:00.000Z'));
    signIn(BROTHER);
    await eventQueue.enqueue(anEvent('brother-1', '2026-08-16T09:00:00.000Z'));
    signIn(ALICE);
    await seedGps(ALICE, 'journey-a', '2026-08-16T10:00:00.000Z');
    await seedGps(BROTHER, 'journey-b', '2026-08-16T09:00:00.000Z');
  });

  test("Alice's read returns Alice's event and only Alice's", async () => {
    const rows = await eventQueue.getUnsyncedEvents(ALICE);
    expect(rows.map((r) => r.clientEventId)).toEqual(['alice-1']);
  });

  test("the brother's read returns the brother's event and only theirs", async () => {
    const rows = await eventQueue.getUnsyncedEvents(BROTHER);
    expect(rows.map((r) => r.clientEventId)).toEqual(['brother-1']);
  });

  test('the same holds for the GPS buffer, both directions', async () => {
    expect((await eventQueue.getUnsyncedGps(ALICE)).map((p) => p.journeyId)).toEqual([
      'journey-a',
    ]);
    expect((await eventQueue.getUnsyncedGps(BROTHER)).map((p) => p.journeyId)).toEqual([
      'journey-b',
    ]);
  });

  test('a third person who has queued nothing reads nothing', async () => {
    expect(await eventQueue.getUnsyncedEvents('user-stranger')).toEqual([]);
    expect(await eventQueue.getUnsyncedGps('user-stranger')).toEqual([]);
  });

  test('marking synced touches only the marking user’s row', async () => {
    // The same clientEventId under two owners — a client-minted id can
    // collide across users, and the guard is what makes that harmless.
    await db.syncEvents.clear();
    await db.syncEvents.bulkAdd([
      { ...anEvent('shared-id'), userId: ALICE, synced: false },
      { ...anEvent('shared-id'), userId: BROTHER, synced: false },
    ] as never);

    await eventQueue.markSynced(ALICE, ['shared-id']);

    const rows = await db.syncEvents.toArray();
    expect(rows.find((r) => r.userId === ALICE)!.synced).toBe(true);
    expect(rows.find((r) => r.userId === BROTHER)!.synced).toBe(false);
  });

  test('marking failed touches only the marking user’s row', async () => {
    await db.syncEvents.clear();
    await db.syncEvents.bulkAdd([
      { ...anEvent('shared-id'), userId: ALICE, synced: false },
      { ...anEvent('shared-id'), userId: BROTHER, synced: false },
    ] as never);

    await eventQueue.markFailed(ALICE, 'shared-id', 'UNKNOWN: boom');

    const rows = await db.syncEvents.toArray();
    expect(rows.find((r) => r.userId === ALICE)!.failReason).toBe('UNKNOWN: boom');
    expect(rows.find((r) => r.userId === BROTHER)!.failReason).toBeUndefined();
  });
});

// ----------------------------------------------------------- quarantine

describe('quarantine: a row stamped null belongs to nobody', () => {
  beforeEach(async () => {
    await db.syncEvents.add({
      userId: null,
      ...anEvent('legacy-1'),
      synced: false,
    } as never);
    await seedGps(null, 'journey-legacy', '2026-08-16T08:00:00.000Z');
  });

  test('no user reads it — not the signed-in one, not any other', async () => {
    expect(await eventQueue.getUnsyncedEvents(ALICE)).toEqual([]);
    expect(await eventQueue.getUnsyncedEvents(BROTHER)).toEqual([]);
    expect(await eventQueue.getUnsyncedGps(ALICE)).toEqual([]);
    expect(await eventQueue.getUnsyncedGps(BROTHER)).toEqual([]);
  });

  test('the drain does not send it', async () => {
    serverAccepts(0);
    const result = await new SyncManager().sync();

    expect(result.uploaded).toBe(0);
    // The only call is the download leg. Nothing was uploaded.
    const posted = apiFetchMock.mock.calls.filter(
      ([, init]) => (init as { method?: string } | undefined)?.method === 'POST',
    );
    expect(posted).toHaveLength(0);
  });

  test('it survives — quarantine hides rows, it does not delete them', async () => {
    serverAccepts(0);
    await new SyncManager().sync();

    expect(await db.syncEvents.count()).toBe(1);
    expect(await db.gpsBuffer.count()).toBe(1);
    expect((await db.syncEvents.toArray())[0].userId).toBeNull();
  });
});

// ---------------------------------------------------------------- drain

describe('the drain runs as exactly one person', () => {
  test("Alice's drain uploads Alice's events and leaves the brother's alone", async () => {
    await eventQueue.enqueue(anEvent('alice-1'));
    signIn(BROTHER);
    await eventQueue.enqueue(anEvent('brother-1'));
    signIn(ALICE);
    serverAccepts(1);

    const result = await new SyncManager().sync();

    expect(result.uploaded).toBe(1);
    const body = JSON.parse(
      apiFetchMock.mock.calls.find(
        ([, init]) => (init as { method?: string } | undefined)?.method === 'POST',
      )![1].body,
    );
    expect(body.events.map((e: { clientEventId: string }) => e.clientEventId)).toEqual([
      'alice-1',
    ]);

    // The brother's row is exactly as it was: not sent, not marked.
    const theirs = (await db.syncEvents.toArray()).find(
      (r) => r.userId === BROTHER,
    )!;
    expect(theirs.synced).toBe(false);
    expect(theirs.failReason).toBeUndefined();
  });

  test('GPS batches go per journey, and only this user’s journeys', async () => {
    await seedGps(ALICE, 'journey-a', '2026-08-16T10:00:00.000Z');
    await seedGps(BROTHER, 'journey-b', '2026-08-16T09:00:00.000Z');
    serverAccepts(0);

    await new SyncManager().sync();

    const gpsPosts = apiFetchMock.mock.calls.filter(([url]) =>
      String(url).includes('/api/sync/gps'),
    );
    expect(gpsPosts).toHaveLength(1);
    expect(JSON.parse(gpsPosts[0][1].body).journeyId).toBe('journey-a');

    // The brother's point is untouched.
    const theirs = (await db.gpsBuffer.toArray()).find((p) => p.userId === BROTHER)!;
    expect(theirs.synced).toBe(false);
  });

  test('with nobody signed in, the drain does not even read', async () => {
    await eventQueue.enqueue(anEvent('alice-1'));
    signOut();
    serverAccepts(1);

    const result = await new SyncManager().sync();

    expect(result).toEqual({ uploaded: 0, downloaded: 0, rejected: 0 });
    expect(apiFetchMock).not.toHaveBeenCalled();
    expect((await db.syncEvents.toArray())[0].synced).toBe(false);
  });

  test('a logout mid-drain stops it, silently, before the next batch', async () => {
    await seedGps(ALICE, 'journey-a', '2026-08-16T10:00:00.000Z');
    await seedGps(ALICE, 'journey-b', '2026-08-16T10:01:00.000Z');

    // The session ends while the first journey's batch is in flight —
    // the shape a 401-driven logout takes during a real drain.
    let gpsPosts = 0;
    apiFetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/api/sync/gps')) {
        gpsPosts += 1;
        if (gpsPosts === 1) signOut();
        return { ok: true, status: 200, json: async () => ({ inserted: 1 }) };
      }
      return { ok: true, status: 200, json: async () => ({ processed: 0, rejected: [], events: [] }) };
    });

    await new SyncManager().sync();

    // Exactly one batch left the phone. The second journey stayed.
    expect(gpsPosts).toBe(1);
    const remaining = (await db.gpsBuffer.toArray())
      .filter((p) => !p.synced)
      .map((p) => p.journeyId);
    expect(remaining).toEqual(['journey-b']);
  });

  test('a user switch mid-drain does not continue as the new person', async () => {
    await seedGps(ALICE, 'journey-a', '2026-08-16T10:00:00.000Z');
    await seedGps(ALICE, 'journey-b', '2026-08-16T10:01:00.000Z');

    let gpsPosts = 0;
    apiFetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/api/sync/gps')) {
        gpsPosts += 1;
        if (gpsPosts === 1) signIn(BROTHER);
        return { ok: true, status: 200, json: async () => ({ inserted: 1 }) };
      }
      return { ok: true, status: 200, json: async () => ({ processed: 0, rejected: [], events: [] }) };
    });

    await new SyncManager().sync();

    // The brother signed in; Alice's second journey did NOT go out under
    // their cookie. This is the whole dispatch in one assertion.
    expect(gpsPosts).toBe(1);
  });

  test('the download leg is skipped when the session ended during upload', async () => {
    await eventQueue.enqueue(anEvent('alice-1'));

    apiFetchMock.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (init?.method === 'POST') {
        signOut();
        return { ok: true, status: 200, json: async () => ({ processed: 1, rejected: [] }) };
      }
      return { ok: true, status: 200, json: async () => ({ events: [] }) };
    });

    await new SyncManager().sync();

    // Applying a download after a user switch would poison exactly the
    // Dexie caches #161 clears on that switch.
    const gets = apiFetchMock.mock.calls.filter(
      ([, init]) => (init as { method?: string } | undefined)?.method !== 'POST',
    );
    expect(gets).toHaveLength(0);
    expect(await db.syncMeta.get('lastSyncTimestamp')).toBeUndefined();
  });
});

// ------------------------------------------------------ the repaired read

describe('the drain can actually see its own rows now', () => {
  test('a real enqueue is visible to a real read', async () => {
    // Before v5 this returned [] forever: `synced: false` is a boolean,
    // IndexedDB has no boolean key type, and the row was therefore
    // absent from the `synced` index the read queried. The scoped read
    // indexes on userId — always a string — and filters synced in
    // memory. Regression-guards the repair described in G1 §2.
    await eventQueue.enqueue(anEvent('e1'));

    expect(await eventQueue.getUnsyncedEvents(ALICE)).toHaveLength(1);
    expect(await db.syncEvents.where('synced').equals(0).count()).toBe(0);
  });

  test('a synced row drops out of the read', async () => {
    await eventQueue.enqueue(anEvent('e1'));
    await eventQueue.markSynced(ALICE, ['e1']);

    expect(await eventQueue.getUnsyncedEvents(ALICE)).toEqual([]);
    expect(await db.syncEvents.count()).toBe(1);
  });

  test('events come back oldest-first, which is the order they will be sent', async () => {
    await eventQueue.enqueue(anEvent('third', '2026-08-16T12:00:00.000Z'));
    await eventQueue.enqueue(anEvent('first', '2026-08-16T10:00:00.000Z'));
    await eventQueue.enqueue(anEvent('second', '2026-08-16T11:00:00.000Z'));

    expect((await eventQueue.getUnsyncedEvents(ALICE)).map((r) => r.clientEventId)).toEqual([
      'first',
      'second',
      'third',
    ]);
  });

  test('GPS points come back oldest-first too', async () => {
    await seedGps(ALICE, 'j', '2026-08-16T12:00:00.000Z');
    await seedGps(ALICE, 'j', '2026-08-16T10:00:00.000Z');

    expect((await eventQueue.getUnsyncedGps(ALICE)).map((p) => p.timestamp)).toEqual([
      '2026-08-16T10:00:00.000Z',
      '2026-08-16T12:00:00.000Z',
    ]);
  });

  test('the exported singleton is the same class the manager drains through', () => {
    expect(eventQueue).toBeInstanceOf(EventQueue);
  });
});
