// SYNC/OUTBOX-REPLAY.TS
//
// OUTBOX G3 — sending what the phone held, once, as the right person.
//
// The engine is small on purpose. Everything hard about it is a rule
// about when NOT to send:
//
//   * never as anyone but the person who made the booking. The entry
//     carries a userId and the session carries a userId, and if they
//     disagree the entry is not touched, not read into a screen, not
//     deleted. A phone that changes hands in a co-op is the normal case
//     in Kigali, not an edge case;
//   * never twice. Each entry travels with the clientRequestId it was
//     first sent with, so the create that arrived and lost its 201 is
//     recognised by the server instead of booking a second ride;
//   * never a silent retry of a refusal. A 4xx is a real answer: the
//     entry is marked REJECTED with the server's own reason, shown, and
//     left alone until a human decides;
//   * never a forced navigation. Success is announced, not obeyed.
//
// One request in flight at a time, oldest first. A queue of held
// bookings is a queue of things a person is waiting for, and firing
// them in parallel just means the server decides the order instead of
// the passenger.

import { db } from '../db/dexie';
import type { OutboxEntry } from '../db/tables';
import { apiFetch, apiErrorFromResponse, isConnectivityError } from '../lib/api';
import { getIsOnline, onConnectivityChange } from './connectivity';
import { useAuthStore } from '../stores/auth.store';
import { useOutboxStore } from '../stores/outbox.store';
import { outboxSummary, listPending } from '../lib/outbox';

export interface ReplayResult {
  sent: number;
  rejected: number;
  /** Entries left PENDING because the connection went again mid-drain. */
  deferred: number;
}

const EMPTY: ReplayResult = { sent: 0, rejected: 0, deferred: 0 };

export class OutboxReplay {
  private inFlight = false;
  private unsubscribe: (() => void) | null = null;

  /**
   * Drain this user's held bookings, oldest first.
   *
   * Resolves EMPTY — without touching anything — when there is no
   * authenticated session, when the device is offline, or when a drain
   * is already running. Never rejects: a replay failure must never take
   * down whatever called it.
   */
  async replayAll(): Promise<ReplayResult> {
    const auth = useAuthStore.getState();
    const userId = auth.user?.id;
    if (!auth.isAuthenticated || !userId) return EMPTY;
    if (this.inFlight || !getIsOnline()) return EMPTY;

    this.inFlight = true;
    const result: ReplayResult = { sent: 0, rejected: 0, deferred: 0 };
    try {
      // Scoped read: entries belonging to anyone else are not fetched,
      // so there is no code path here that could send one by mistake.
      const pending = await listPending(userId);
      for (const entry of pending) {
        // Re-check identity every iteration: a session can end (or an
        // apiFetch 401 can end it) part-way through a drain, and the
        // remaining entries must not go out under whoever comes next.
        const current = useAuthStore.getState();
        if (!current.isAuthenticated || current.user?.id !== userId) {
          result.deferred += pending.length - (result.sent + result.rejected);
          break;
        }
        const outcome = await this.replayOne(entry);
        if (outcome === 'sent') result.sent += 1;
        else if (outcome === 'rejected') result.rejected += 1;
        else {
          // The connection went again. Everything from here stays
          // PENDING and waits for the next reconnect — including this
          // one, which was not consumed.
          result.deferred += 1;
          break;
        }
      }
    } catch (err) {
      console.debug('[outbox-replay] drain failed:', err);
    } finally {
      this.inFlight = false;
    }
    return result;
  }

  private async replayOne(entry: OutboxEntry): Promise<'sent' | 'rejected' | 'deferred'> {
    try {
      const res = await apiFetch('/api/journeys', {
        method: 'POST',
        credentials: 'include',
        // Byte-for-byte the body the page built when there was no
        // signal, clientRequestId included. Nothing is re-derived here:
        // re-deriving is how a replay stops being the same request.
        body: JSON.stringify(entry.payload),
      });

      if (res.ok) {
        const journey = await res.json().catch(() => null);
        if (entry.id != null) await db.outbox.delete(entry.id);
        if (journey?.id) {
          const { pickupName, destinationName } = outboxSummary(entry);
          useOutboxStore.getState().noteSent({
            journeyId: journey.id,
            pickupName,
            destinationName,
          });
        }
        return 'sent';
      }

      // 5xx is Bimoto's problem, not the passenger's, and not an answer
      // about this booking: hold it and try again on the next reconnect.
      if (res.status >= 500) return 'deferred';

      // A 401 has already been through apiFetch's refresh-and-retry and
      // taken the logout path. The booking is not refused — the session
      // is — so it stays PENDING for whenever this person signs back in.
      if (res.status === 401) return 'deferred';

      const apiErr = await apiErrorFromResponse(res);
      if (entry.id != null) {
        await db.outbox.update(entry.id, {
          status: 'REJECTED',
          failCode: apiErr.code ?? `HTTP_${res.status}`,
          failMessage: apiErr.messageKey ?? undefined,
        });
      }
      return 'rejected';
    } catch (err) {
      // The request never got an answer. Nothing has been refused, so
      // nothing changes: the entry is exactly as sendable as it was.
      if (isConnectivityError(err)) return 'deferred';
      console.debug('[outbox-replay] send failed:', err);
      return 'deferred';
    }
  }

  /**
   * Subscribe to the connectivity source of truth — the same signal
   * SyncManager.startMonitoring uses — and drain on every recovery.
   * Drains once immediately too: the app may have been reopened with a
   * connection and a queue already waiting.
   */
  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = onConnectivityChange((online) => {
      if (online) void this.replayAll();
    });
    void this.replayAll();
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }
}

export const outboxReplay = new OutboxReplay();
