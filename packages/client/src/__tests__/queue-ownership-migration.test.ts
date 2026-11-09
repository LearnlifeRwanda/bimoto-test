// __TESTS__/QUEUE-OWNERSHIP-MIGRATION.TEST.TS
//
// QUEUE-UNITY G2 — the upgrade, proved from a real v4 database.
//
// A schema change on a rider's phone is not a diff, it is a thing that
// happens once, unattended, to data nobody can get back. So this suite
// does not test the v5 declaration; it builds an actual v4 IndexedDB
// with the exact index strings v4 shipped, writes rows into it the way
// v4's code wrote them, closes it, and then opens the real BimotoDB on
// top and looks at what survived.
//
// What must be true afterwards:
//
//   * every pre-existing row is still there. Not one deleted;
//   * every one of them is stamped `null` — quarantined. NOT stamped
//     with whoever happened to be signed in during the upgrade, which
//     would be the mis-attribution the whole dispatch exists to
//     prevent, dressed up as a fix;
//   * the v1-v4 tables are all still present with their data, because
//     an upgrade that dropped a rider's 6 MB of Kigali map to add a
//     column would be a far worse bug than the one being fixed.

// @vitest-environment node

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import Dexie from 'dexie';

const DB_NAME = 'bimoto';

/** The v1-v4 ladder, verbatim, as db/dexie.ts declared it before v5. */
function openV4(): Dexie {
  const legacy = new Dexie(DB_NAME);
  legacy.version(1).stores({
    journeys: 'id, customerId, driverId, status, createdAt',
    bids: 'id, journeyId, driverId, status',
    messages: 'id, journeyId, createdAt',
    syncEvents: '++id, clientEventId, synced, clientTimestamp',
    gpsBuffer: '++id, journeyId, synced, timestamp',
    syncMeta: 'key',
  });
  legacy.version(2).stores({ mapCache: 'key' });
  legacy.version(3).stores({ mapDownloads: 'key' });
  legacy.version(4).stores({
    outbox: '++id, userId, kind, status, clientId, createdAt',
  });
  return legacy;
}

/** A phone mid-life: two unsent events, two GPS points, a held booking,
 *  a downloaded map, and some cached reads. Nothing here knows about
 *  users except the outbox, which learned in v4. */
async function seedV4(): Promise<void> {
  const legacy = openV4();
  await legacy.open();
  await legacy.table('syncEvents').bulkAdd([
    {
      clientEventId: 'evt-old-1',
      journeyId: 'j1',
      eventType: 'JOURNEY_CREATED',
      payload: { pickupName: 'Sonatubes' },
      clientTimestamp: '2026-08-01T09:00:00.000Z',
      synced: false,
    },
    {
      clientEventId: 'evt-old-2',
      eventType: 'BID_PLACED',
      payload: {},
      clientTimestamp: '2026-08-01T09:05:00.000Z',
      synced: false,
      failReason: 'UNKNOWN: refused before the stamp existed',
    },
  ]);
  await legacy.table('gpsBuffer').bulkAdd([
    { journeyId: 'j1', lat: -1.95, lng: 30.06, timestamp: '2026-08-01T09:01:00.000Z', synced: false },
    { journeyId: 'j1', lat: -1.96, lng: 30.07, timestamp: '2026-08-01T09:02:00.000Z', synced: true },
  ]);
  await legacy.table('outbox').add({
    userId: 'user-alice',
    kind: 'journey-create',
    status: 'PENDING',
    clientId: 'client-1',
    createdAt: '2026-08-01T09:03:00.000Z',
    payload: { clientRequestId: 'client-1' },
  });
  await legacy.table('mapCache').put({
    key: 'kigali',
    blob: new Blob([new Uint8Array(4096).fill(3)]),
    sizeBytes: 4096,
    downloadedAt: '2026-07-20T09:00:00.000Z',
  });
  await legacy.table('journeys').add({
    id: 'j1',
    customerId: 'user-alice',
    type: 'RIDE',
    status: 'REQUESTED',
    pickupLat: -1.95,
    pickupLng: 30.06,
    pickupName: 'Sonatubes',
    destinationLat: -1.94,
    destinationLng: 30.1,
    destinationName: 'Giporoso',
    createdAt: '2026-08-01T09:00:00.000Z',
    updatedAt: '2026-08-01T09:00:00.000Z',
  });
  await legacy.table('syncMeta').put({ key: 'lastSyncTimestamp', value: '2026-08-01T09:00:00.000Z' });
  legacy.close();
}

/** Open the shipping schema — v5 — on whatever is on disk. */
async function openCurrent(): Promise<Dexie> {
  // Fresh module instance every time: db/dexie.ts constructs its
  // BimotoDB at import time, so a cached module would hand back a
  // handle bound to a previous test's IndexedDB.
  vi.resetModules();
  const { db } = await import('../db/dexie');
  await db.open();
  return db as unknown as Dexie;
}

beforeEach(() => {
  // A brand-new IndexedDB per test — otherwise the first upgrade
  // persists and every later test starts at v5.
  globalThis.indexedDB = new IDBFactory();
});

afterEach(async () => {
  await Dexie.delete(DB_NAME).catch(() => undefined);
});

describe('QUEUE-UNITY G2 — v5 upgrades a real v4 phone', () => {
  test('the version really is 4 before, and 5 after', async () => {
    await seedV4();
    const before = openV4();
    await before.open();
    expect(before.verno).toBe(4);
    before.close();

    const after = await openCurrent();
    expect(after.verno).toBe(5);
    after.close();
  });

  test('nothing is deleted — every legacy row is still on the phone', async () => {
    await seedV4();
    const database = await openCurrent();

    expect(await database.table('syncEvents').count()).toBe(2);
    expect(await database.table('gpsBuffer').count()).toBe(2);
    database.close();
  });

  test('every legacy row is stamped null — quarantined, not adopted', async () => {
    await seedV4();
    const database = await openCurrent();

    const events = await database.table('syncEvents').toArray();
    expect(events).toHaveLength(2);
    for (const row of events) {
      expect(row.userId).toBeNull();
      // Explicitly present, not merely absent: an absent key is not
      // indexed at all, and the point of the stamp is that the row can
      // be asked whose it is and answer "nobody".
      expect('userId' in row).toBe(true);
    }

    const points = await database.table('gpsBuffer').toArray();
    expect(points).toHaveLength(2);
    for (const row of points) expect(row.userId).toBeNull();
    database.close();
  });

  test('the rest of each legacy row is untouched', async () => {
    await seedV4();
    const database = await openCurrent();

    const rows = await database.table('syncEvents').orderBy('clientTimestamp').toArray();
    expect(rows[0]).toMatchObject({
      clientEventId: 'evt-old-1',
      journeyId: 'j1',
      eventType: 'JOURNEY_CREATED',
      payload: { pickupName: 'Sonatubes' },
      synced: false,
    });
    // Including a refusal from before the stamp: the reason survives,
    // even though nobody will ever be shown it again.
    expect(rows[1].failReason).toBe('UNKNOWN: refused before the stamp existed');

    const gps = await database.table('gpsBuffer').orderBy('timestamp').toArray();
    expect(gps.map((p: { synced: boolean }) => p.synced)).toEqual([false, true]);
    expect(gps[0]).toMatchObject({ journeyId: 'j1', lat: -1.95, lng: 30.06 });
    database.close();
  });

  test('the userId index exists and answers for the quarantined rows', async () => {
    await seedV4();
    const database = await openCurrent();

    const indexed = (name: string) =>
      database.table(name).schema.indexes.map((i) => i.name).sort();
    expect(indexed('syncEvents')).toEqual([
      'clientEventId',
      'clientTimestamp',
      'synced',
      'userId',
    ]);
    expect(indexed('gpsBuffer')).toEqual(['journeyId', 'synced', 'timestamp', 'userId']);

    // And no live user matches them.
    expect(await database.table('syncEvents').where('userId').equals('user-alice').count()).toBe(0);
    expect(await database.table('gpsBuffer').where('userId').equals('user-alice').count()).toBe(0);
    database.close();
  });

  test('the v4 outbox is not touched — its rows, its owner, its indexes', async () => {
    await seedV4();
    const database = await openCurrent();

    const entries = await database.table('outbox').toArray();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      userId: 'user-alice',
      kind: 'journey-create',
      status: 'PENDING',
      clientId: 'client-1',
    });
    expect(
      database.table('outbox').schema.indexes.map((i) => i.name).sort(),
    ).toEqual(['clientId', 'createdAt', 'kind', 'status', 'userId']);
    database.close();
  });

  test('#161 survivors survive the upgrade too — the map is not re-fetched', async () => {
    await seedV4();
    const database = await openCurrent();

    const kigali = await database.table('mapCache').get('kigali');
    expect(kigali).toBeDefined();
    expect(kigali.sizeBytes).toBe(4096);
    expect(kigali.downloadedAt).toBe('2026-07-20T09:00:00.000Z');
    expect(kigali.blob.size).toBe(4096);
    database.close();
  });

  test('the other v1 tables come through with their data', async () => {
    await seedV4();
    const database = await openCurrent();

    expect(await database.table('journeys').count()).toBe(1);
    expect((await database.table('syncMeta').get('lastSyncTimestamp')).value).toBe(
      '2026-08-01T09:00:00.000Z',
    );
    // The full table set, unchanged in membership: v5 adds columns, not
    // tables, and retires nothing.
    expect(database.tables.map((t) => t.name).sort()).toEqual([
      'bids',
      'gpsBuffer',
      'journeys',
      'mapCache',
      'mapDownloads',
      'messages',
      'outbox',
      'syncEvents',
      'syncMeta',
    ]);
    database.close();
  });

  test('idempotent: closing and reopening v5 changes nothing', async () => {
    await seedV4();
    const first = await openCurrent();
    const snapshot = await first.table('syncEvents').toArray();
    first.close();

    const second = await openCurrent();
    expect(await second.table('syncEvents').toArray()).toEqual(snapshot);
    expect(await second.table('syncEvents').count()).toBe(2);
    expect(second.verno).toBe(5);
    second.close();
  });

  test('a phone with nothing queued upgrades to an empty, working v5', async () => {
    // The common case: most phones have no legacy rows at all. The
    // upgrade must not invent any.
    const legacy = openV4();
    await legacy.open();
    legacy.close();

    const database = await openCurrent();
    expect(await database.table('syncEvents').count()).toBe(0);
    expect(await database.table('gpsBuffer').count()).toBe(0);

    await database.table('syncEvents').add({
      userId: 'user-alice',
      clientEventId: 'fresh',
      eventType: 'JOURNEY_CREATED',
      payload: {},
      clientTimestamp: '2026-08-16T10:00:00.000Z',
      synced: false,
    });
    expect(await database.table('syncEvents').where('userId').equals('user-alice').count()).toBe(1);
    database.close();
  });

  test('a fresh install goes straight to v5 with no upgrade to run', async () => {
    const database = await openCurrent();
    expect(database.verno).toBe(5);
    expect(await database.table('syncEvents').count()).toBe(0);
    database.close();
  });
});
