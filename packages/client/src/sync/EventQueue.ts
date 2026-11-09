// SYNC/EVENT-QUEUE.TS
//
// QUEUE-UNITY G2 — the queue that finally knows whose rows it holds.
//
// This module used to be six one-line methods over two tables that could
// not say who anything belonged to. Everything it does now is the same
// six things plus one rule, and the rule is the module:
//
//   A row belongs to the user id that was signed in when it was
//   written. It is only ever read as that user, only ever drained as
//   that user, and only ever shown to that user. There is no unscoped
//   read here, on purpose — the same shape lib/outbox.ts settled on for
//   held bookings (#167), now applied to the queues that predate it.
//
// Two consequences worth stating plainly, because both are refusals:
//
//   * writing with no session is an ERROR, not a null-stamped row. A
//     row nobody can claim is a row nobody can send, so producing one
//     silently would just be deferring the same problem to the drain.
//     Callers get QueueOwnerRequiredError and can decide;
//   * rows stamped `null` — everything written before the v5 upgrade —
//     are matched by no scoped read, so they are never drained and
//     never rendered. Quarantine, not adoption. See db/dexie.ts v5.
//
// WHY THE READS FILTER `synced` IN MEMORY. The obvious query is
// `where('synced').equals(0)`, which is what this file did before, and
// it never matched anything: `enqueue` writes `synced: false`, and
// IndexedDB has no boolean key type, so Dexie leaves such a record out
// of the `synced` index altogether. The drain has therefore been inert
// against every real write since v1 (docs/queue-ownership-enumeration.md
// §2 has the probe). The scoped read below indexes on `userId` — always
// a string, always a valid key — and evaluates `synced` on the rows it
// gets back. That repairs the drain as a side effect of scoping it.
// `synced` stays in the index list because dropping an index is not
// additive, and a later change may want it as a compound.

import { db } from '../db/dexie';
import type { PendingSyncEvent, GpsBuffer } from '../db/tables';
import { useAuthStore } from '../stores/auth.store';

/**
 * Thrown by `enqueue` when there is no authenticated session to stamp
 * the row with. Named so a caller can catch it specifically and tell
 * "the phone is signed out" apart from "the database is broken".
 */
export class QueueOwnerRequiredError extends Error {
  constructor() {
    super('cannot enqueue a sync event with no authenticated session');
    this.name = 'QueueOwnerRequiredError';
  }
}

/** The signed-in user id, or null. The one source OutboxReplay trusts. */
export function currentQueueOwner(): string | null {
  const auth = useAuthStore.getState();
  return auth.isAuthenticated && auth.user?.id ? auth.user.id : null;
}

export class EventQueue {
  /**
   * Hold an event for the signed-in user.
   *
   * Source-compatible with the old signature: `userId` is derived here,
   * never passed, so no caller has to know the rule to obey it. Passing
   * one is a type error rather than an override — an event's owner is
   * whoever is signed in, and a caller that thinks otherwise is wrong.
   *
   * @throws QueueOwnerRequiredError when nobody is signed in.
   */
  async enqueue(
    event: Omit<PendingSyncEvent, 'id' | 'synced' | 'userId'>,
  ): Promise<void> {
    const userId = currentQueueOwner();
    if (!userId) throw new QueueOwnerRequiredError();
    await db.syncEvents.add({ ...event, userId, synced: false });
  }

  /** This user's unsent events, oldest first. Never anyone else's. */
  async getUnsyncedEvents(userId: string): Promise<PendingSyncEvent[]> {
    const rows = await db.syncEvents.where('userId').equals(userId).toArray();
    return rows
      .filter((e) => !e.synced)
      .sort((a, b) => a.clientTimestamp.localeCompare(b.clientTimestamp));
  }

  /**
   * Mark this user's events sent. Scoped even though the ids come from
   * a scoped read: a clientEventId is minted client-side and two users
   * on one phone could in principle collide, and the cost of the guard
   * is one predicate.
   */
  async markSynced(userId: string, clientEventIds: string[]): Promise<void> {
    if (clientEventIds.length === 0) return;
    const ids = new Set(clientEventIds);
    await db.syncEvents
      .where('userId')
      .equals(userId)
      .filter((e) => ids.has(e.clientEventId))
      .modify({ synced: true });
  }

  async markFailed(userId: string, clientEventId: string, reason: string): Promise<void> {
    await db.syncEvents
      .where('userId')
      .equals(userId)
      .filter((e) => e.clientEventId === clientEventId)
      .modify({ failReason: reason });
  }

  /** This user's unsent GPS points, oldest first. Never anyone else's. */
  async getUnsyncedGps(userId: string): Promise<GpsBuffer[]> {
    const rows = await db.gpsBuffer.where('userId').equals(userId).toArray();
    return rows
      .filter((p) => !p.synced)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  async markGpsSynced(userId: string, ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    const wanted = new Set(ids);
    await db.gpsBuffer
      .where('userId')
      .equals(userId)
      .filter((p) => p.id != null && wanted.has(p.id))
      .modify({ synced: true });
  }
}

export const eventQueue = new EventQueue();
