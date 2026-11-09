// LIB/OUTBOX.TS
//
// OUTBOX G2 — the passenger's held bookings.
//
// A booking made in a dead zone is not a failure and must not be shown
// as one. It is a request that has not left yet. This module is the only
// thing that writes db.outbox, and every read it offers is scoped to one
// user id — there is no "list everything" here, on purpose.
//
// THE OWNERSHIP RULE, in one sentence: an entry belongs to the user id
// that was signed in when it was made, and it can only ever be shown to,
// cancelled by, or sent as that user. A co-op brother who borrows the
// phone and logs in sees nothing of it and cannot send it; it simply
// waits (db.outbox is not cleared on a user switch — same device-level
// rationale #161 applied to mapCache/mapDownloads, and now sound because
// the rows finally say whose they are).

import { db } from '../db/dexie';
import type { OutboxEntry } from '../db/tables';

/**
 * A v4 uuid from the platform CSPRNG.
 *
 * Not `crypto.randomUUID()`: that needs Chrome 92 and the pinned WebView
 * floor is 63 (docs/webview-floor.md). `getRandomValues` is available
 * everywhere in that range. The server validates this as a uuid, so the
 * variant/version nibbles matter.
 */
export function newClientId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex: string[] = [];
  for (let i = 0; i < 16; i++) hex.push(bytes[i].toString(16).padStart(2, '0'));
  return (
    hex.slice(0, 4).join('') +
    '-' +
    hex.slice(4, 6).join('') +
    '-' +
    hex.slice(6, 8).join('') +
    '-' +
    hex.slice(8, 10).join('') +
    '-' +
    hex.slice(10, 16).join('')
  );
}

/**
 * Hold a journey-create request on this phone.
 *
 * `clientId` is minted by the CALLER, before the first attempt, and
 * passed in — because it must already be inside `payload` as
 * `clientRequestId`. That is the whole idempotency story: the request
 * that failed and the request that eventually lands carry one identity,
 * so a create whose 201 was lost on the way back cannot become two
 * rides.
 */
export async function enqueueJourneyCreate(args: {
  userId: string;
  clientId: string;
  payload: Record<string, unknown>;
  createdAt?: string;
}): Promise<OutboxEntry> {
  const entry: OutboxEntry = {
    userId: args.userId,
    kind: 'journey-create',
    status: 'PENDING',
    clientId: args.clientId,
    createdAt: args.createdAt ?? new Date().toISOString(),
    payload: args.payload,
  };
  const id = await db.outbox.add(entry);
  return { ...entry, id: id as number };
}

/** This user's held bookings, oldest first — the order they will be sent in. */
export async function listOutbox(userId: string): Promise<OutboxEntry[]> {
  const rows = await db.outbox.where('userId').equals(userId).toArray();
  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** This user's entries still waiting to be sent. */
export async function listPending(userId: string): Promise<OutboxEntry[]> {
  return (await listOutbox(userId)).filter((e) => e.status === 'PENDING');
}

/** This user's entries the server refused. Never re-sent on their own. */
export async function listRejected(userId: string): Promise<OutboxEntry[]> {
  return (await listOutbox(userId)).filter((e) => e.status === 'REJECTED');
}

/**
 * The cancel affordance: the passenger changed their mind before the
 * booking ever left. Owner-checked — a delete is a write, and the rule
 * that no user may touch another's entry has no exception for deletes.
 */
export async function cancelOutboxEntry(id: number, userId: string): Promise<boolean> {
  const entry = await db.outbox.get(id);
  if (!entry || entry.userId !== userId) return false;
  await db.outbox.delete(id);
  return true;
}

/** What the passenger sees on the card: where they were going. */
export function outboxSummary(entry: OutboxEntry): {
  pickupName: string;
  destinationName: string;
} {
  const p = entry.payload as { pickupName?: unknown; destinationName?: unknown };
  return {
    pickupName: typeof p.pickupName === 'string' ? p.pickupName : '',
    destinationName: typeof p.destinationName === 'string' ? p.destinationName : '',
  };
}
