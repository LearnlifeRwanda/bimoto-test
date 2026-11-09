// SYNC/SYNC-MANAGER.TS
//
// The envelope pipeline: telemetry the phone captured offline, uploaded
// as eventType/payload envelopes and drained back down again. Its
// charter — and why it is not the outbox — is
// docs/adr/ADR-001-two-queue-architecture.md.
//
// QUEUE-UNITY G2 — the drain now runs AS somebody.
//
// It used to run as whoever happened to be authenticated when the
// heartbeat fired, uploading every unsynced row on the device under
// their cookie. On a phone shared between brothers in a co-op that is
// not an edge case, it is Tuesday. So the drain now opens by naming its
// user, reads only that user's rows, and re-checks the identity between
// batches exactly the way OutboxReplay does (OutboxReplay.ts:71) —
// because a session can end mid-drain, and the rows that have not gone
// yet must not go out under whoever comes next.
//
// Stopping mid-drain is silent. A user switch is not an error and the
// person who caused it is not waiting to hear about it; the rows are
// still there, still stamped, and still drainable by their owner.

import { eventQueue, type EventQueue } from './EventQueue';
import { ConflictResolver } from './ConflictResolver';
import { getIsOnline, onConnectivityChange, checkConnectivity } from './connectivity';
import { db } from '../db/dexie';
import { useAuthStore } from '../stores/auth.store';
import { GPS_BATCH_MAX_POINTS, SYNC_HEARTBEAT_MS, SYNC_RETRY_BACKOFF_MS } from '@bimoto/shared';
import { apiFetch } from '../lib/api';

export interface SyncResult {
  uploaded: number;
  downloaded: number;
  rejected: number;
}

/** The signed-in user id, or null. Read fresh — never cached. */
function currentSessionUserId(): string | null {
  const auth = useAuthStore.getState();
  return auth.isAuthenticated && auth.user?.id ? auth.user.id : null;
}

/** Still the same person as when this drain started? */
function stillSignedInAs(userId: string): boolean {
  return currentSessionUserId() === userId;
}

export class SyncManager {
  private queue: EventQueue;
  private resolver: ConflictResolver;
  private isSyncing = false;
  private retryCount = 0;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.queue = eventQueue;
    this.resolver = new ConflictResolver();
  }

  async enqueueEvent(event: { clientEventId: string; journeyId?: string; eventType: string; payload: Record<string, unknown>; clientTimestamp: string; }): Promise<void> {
    await this.queue.enqueue(event);
    if (getIsOnline()) {
      this.sync().catch(console.error);
    }
  }

  async sync(): Promise<SyncResult> {
    if (this.isSyncing || !getIsOnline()) return { uploaded: 0, downloaded: 0, rejected: 0 };

    // Whose drain this is. Everything below reads, sends and marks as
    // this id and nothing else; with no session there is nothing this
    // drain could legitimately be doing, so it does nothing.
    const userId = currentSessionUserId();
    if (!userId) return { uploaded: 0, downloaded: 0, rejected: 0 };

    this.isSyncing = true;
    const result: SyncResult = { uploaded: 0, downloaded: 0, rejected: 0 };

    try {
      // 1. Upload pending events
      const unsyncedEvents = await this.queue.getUnsyncedEvents(userId);
      if (unsyncedEvents.length > 0 && stillSignedInAs(userId)) {
        const res = await apiFetch(`/api/sync/events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ events: unsyncedEvents.map(e => ({ clientEventId: e.clientEventId, journeyId: e.journeyId, eventType: e.eventType, payload: e.payload, clientTimestamp: e.clientTimestamp })) }),
          credentials: 'include',
        });
        if (res.ok) {
          const data = await res.json();
          result.uploaded = data.processed;
          result.rejected = data.rejected?.length || 0;
          const syncedIds = unsyncedEvents.filter(e => !data.rejected?.find((r: any) => r.clientEventId === e.clientEventId)).map(e => e.clientEventId);
          await this.queue.markSynced(userId, syncedIds);
          for (const rej of (data.rejected || [])) {
            await this.queue.markFailed(userId, rej.clientEventId, rej.reason);
          }
        }
      }

      // 2. Upload GPS buffer
      const unsyncedGps = await this.queue.getUnsyncedGps(userId);
      if (unsyncedGps.length > 0) {
        const grouped = new Map<string, typeof unsyncedGps>();
        for (const pt of unsyncedGps) {
          const arr = grouped.get(pt.journeyId) || [];
          arr.push(pt);
          grouped.set(pt.journeyId, arr);
        }
        for (const [journeyId, points] of grouped) {
          // Between batches, not merely before the loop: a journey's
          // worth of somebody's movements must not leave under a name
          // that arrived while the previous batch was in flight.
          if (!stillSignedInAs(userId)) break;
          const batch = points.slice(0, GPS_BATCH_MAX_POINTS);
          const res = await apiFetch(`/api/sync/gps`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ journeyId, points: batch.map(p => ({ lat: p.lat, lng: p.lng, accuracy: p.accuracy, timestamp: p.timestamp })) }),
            credentials: 'include',
          });
          if (res.ok) {
            await this.queue.markGpsSynced(userId, batch.filter(p => p.id != null).map(p => p.id!));
          }
        }
      }

      // 3. Download new events. Also identity-checked: the response is
      // written into shared Dexie caches and syncMeta, and applying one
      // user's server events after another has signed in would poison
      // exactly the caches #161 clears on a user switch.
      if (!stillSignedInAs(userId)) return result;
      const lastSync = await db.syncMeta.get('lastSyncTimestamp');
      const since = lastSync?.value || new Date(0).toISOString();
      const res = await apiFetch(`/api/sync/events?since=${encodeURIComponent(since)}`, {
        credentials: 'include',
      });
      if (res.ok) {
        // LOOSE-ENDS G5 — read the shape the server actually sends.
        //
        // `GET /sync/events` returns a BARE ARRAY (`res.json(events)` in
        // sync.routes.ts). This read `data.events`, which is undefined
        // against an array, so `downloaded` has always been 0 and
        // `applyServerEvents` has never once run — the entire download
        // leg was dead while reporting success. Deployed APKs are
        // equally broken today, so nothing regresses by fixing it here
        // and the server keeps its shape.
        //
        // Both shapes are tolerated: an array is used as-is, and a
        // `{ events: [...] }` envelope still works, so a future server
        // that wraps the payload does not silently re-break this.
        const data = await res.json();
        const events = Array.isArray(data) ? data : Array.isArray(data?.events) ? data.events : [];
        result.downloaded = events.length;
        if (events.length > 0) {
          await this.resolver.applyServerEvents(events);
          await db.syncMeta.put({ key: 'lastSyncTimestamp', value: new Date().toISOString() });
        }
      }

      this.retryCount = 0;
    } catch (err) {
      console.error('Sync error:', err);
      this.retryCount = Math.min(this.retryCount + 1, SYNC_RETRY_BACKOFF_MS.length - 1);
    } finally {
      this.isSyncing = false;
    }
    return result;
  }

  startMonitoring(): void {
    onConnectivityChange((online) => {
      if (online) this.sync().catch(console.error);
    });
    this.heartbeatInterval = setInterval(() => {
      checkConnectivity().then(online => {
        if (online) this.sync().catch(console.error);
      });
    }, SYNC_HEARTBEAT_MS);

    // Register for Background Sync API where supported
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      navigator.serviceWorker.ready.then((registration) => {
        return (registration as any).sync.register('bimoto-sync');
      }).catch((err: Error) => {
        console.warn('Background Sync registration failed:', err);
      });
    }
  }

  stopMonitoring(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }
}

export const syncManager = new SyncManager();
