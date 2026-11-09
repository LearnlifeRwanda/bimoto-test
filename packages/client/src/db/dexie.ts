import Dexie, { type Table } from 'dexie';
import type {
  LocalJourney,
  LocalBid,
  LocalMessage,
  PendingSyncEvent,
  GpsBuffer,
  SyncMeta,
  MapCacheEntry,
  MapDownloadPartial,
  OutboxEntry,
} from './tables';

export class BimotoDB extends Dexie {
  journeys!: Table<LocalJourney, string>;
  bids!: Table<LocalBid, string>;
  messages!: Table<LocalMessage, string>;
  syncEvents!: Table<PendingSyncEvent, number>;
  gpsBuffer!: Table<GpsBuffer, number>;
  syncMeta!: Table<SyncMeta, string>;
  mapCache!: Table<MapCacheEntry, string>;
  mapDownloads!: Table<MapDownloadPartial, string>;
  outbox!: Table<OutboxEntry, number>;

  constructor() {
    super('bimoto');

    this.version(1).stores({
      journeys: 'id, customerId, driverId, status, createdAt',
      bids: 'id, journeyId, driverId, status',
      messages: 'id, journeyId, createdAt',
      syncEvents: '++id, clientEventId, synced, clientTimestamp',
      gpsBuffer: '++id, journeyId, synced, timestamp',
      syncMeta: 'key',
    });

    // MAP-CACHE G2 — offline map extracts (the ~30–50 MB Kigali PMTiles
    // blob). Only `key` is indexed; the blob itself is unindexed payload.
    this.version(2).stores({
      mapCache: 'key',
    });

    // MAP-TRUTH G4 — interrupted downloads, kept so they can be resumed.
    // Same shape as mapCache: only `key` is indexed, the blob is
    // unindexed payload. A partial is deleted the moment its download
    // completes or is deliberately cancelled.
    this.version(3).stores({
      mapDownloads: 'key',
    });

    // OUTBOX G2 — the passenger's held bookings, stamped with an owner.
    //
    // ADDITIVE ONLY. syncEvents and gpsBuffer stay exactly as they are:
    // the survey (docs/outbox-terrain-survey.md) found their drain loop
    // mounted at App.tsx:225 and their rejections rendered in the shell,
    // so the "retire the dead tables" half of this migration would have
    // dropped live machinery. mapCache/mapDownloads keep their
    // device-level survivor semantics untouched (#161).
    //
    // Indexed: userId (every read is "this user's entries" and no other
    // user's row may ever be read), status and createdAt (FIFO drain),
    // clientId (the idempotency identity), kind. `payload` is unindexed
    // body — it is a request, not a query surface.
    this.version(4).stores({
      outbox: '++id, userId, kind, status, clientId, createdAt',
    });

    // QUEUE-UNITY G2 — the legacy queues learn their owner's name.
    //
    // v4's comment above says syncEvents and gpsBuffer "stay exactly as
    // they are". That was right then and is wrong now: it preserved a
    // seam lib/session-reset.ts had already written down, which the
    // outbox had by then shown how to close. A row in either table
    // could not say whose it was, so a drain could only send it as
    // whoever happened to be signed in — and on a phone that changes
    // hands in a Kigali co-op, that is the normal case.
    //
    // Both tables gain `userId`, indexed first for the same reason the
    // outbox indexes it first: every read is "this user's rows" and no
    // other user's row may ever be read. Every other index is carried
    // over unchanged; Dexie replaces a table's index set wholesale, so
    // they have to be restated, not appended.
    //
    // THE UPGRADE QUARANTINES, IT DOES NOT ADOPT. Rows written before
    // this version get `userId: null` — not the current user's id, and
    // not deleted. Stamping them with whoever is signed in during the
    // upgrade would be the exact mis-attribution this migration exists
    // to prevent, and it would be worse than today's bug because it
    // would look deliberate. Deleting them would destroy a previous
    // user's unsynced work on their behalf. So they stay: never
    // drained, never rendered, never sent. Inert.
    //
    // They are inert FOREVER as far as this dispatch is concerned.
    // Whether a later sweep removes them is a retention question
    // (Trello item 10) and belongs with the rest of that decision, not
    // in a migration — see docs/adr/ADR-001-two-queue-architecture.md.
    this.version(5)
      .stores({
        syncEvents: '++id, userId, clientEventId, synced, clientTimestamp',
        gpsBuffer: '++id, userId, journeyId, synced, timestamp',
      })
      .upgrade(async (tx) => {
        // `modify` over the whole table: idempotent by construction —
        // a row that already has a userId key keeps it, and re-running
        // the upgrade (Dexie will not, but a re-created database on a
        // seeded fixture will) writes the same null again.
        let quarantined = 0;
        await tx.table('syncEvents').toCollection().modify((row) => {
          if (row.userId === undefined) {
            row.userId = null;
            quarantined += 1;
          }
        });
        await tx.table('gpsBuffer').toCollection().modify((row) => {
          if (row.userId === undefined) {
            row.userId = null;
            quarantined += 1;
          }
        });
        // Logged because this number is the size of a user-visible
        // change — any pre-v5 REJECTED event stops appearing in the
        // refusals panel the moment this runs — and it is knowable only
        // on the handset it happens to. Nothing depends on it.
        if (quarantined > 0) {
          console.debug(`[dexie] v5 quarantined ${quarantined} unowned queue row(s)`);
        }
      });
  }
}

export const db = new BimotoDB();
