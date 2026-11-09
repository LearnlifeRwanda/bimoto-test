// __TESTS__/OUTBOX-WRITE-PATH.TEST.TS
//
// OUTBOX G2 — the write path, against REAL Dexie over fake-indexeddb.
//
// The four things that have to be true before anything is allowed to
// replay a held booking:
//
//   1. a create that never got an answer is HELD, with its owner on it;
//   2. a create the server REFUSED is not held — not once, not ever;
//   3. the passenger can take a held booking back;
//   4. the body that comes out is the body that went in, byte for byte,
//      idempotency key included.
//
// (2) is the one with teeth. A queue that cannot tell "no answer" from
// "no" spends the rest of its life re-sending a request the server has
// already refused.

// @vitest-environment node

import { describe, test, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

import { db } from '../db/dexie';
import { ApiError, isConnectivityError } from '../lib/api';
import {
  enqueueJourneyCreate,
  listOutbox,
  listPending,
  cancelOutboxEntry,
  newClientId,
  outboxSummary,
} from '../lib/outbox';

const ALICE = '11111111-1111-4111-8111-111111111111';
const BROTHER = '22222222-2222-4222-8222-222222222222';

function journeyBody(clientRequestId: string) {
  return {
    clientRequestId,
    type: 'PASSENGER',
    pickupLat: -1.9536,
    pickupLng: 30.0606,
    pickupName: 'Sonatubes',
    destinationLat: -1.9441,
    destinationLng: 30.0619,
    destinationName: 'Giporoso',
    vehiclePreference: 'MOTO',
    wishPrice: 1200,
  };
}

beforeEach(async () => {
  await db.outbox.clear();
});

describe('OUTBOX G2 — what gets held, and what never does', () => {
  test('a create that never got an answer is held, stamped with its owner', async () => {
    const clientId = newClientId();
    const entry = await enqueueJourneyCreate({
      userId: ALICE,
      clientId,
      payload: journeyBody(clientId),
    });

    expect(entry.id).toBeTypeOf('number');
    expect(entry.userId).toBe(ALICE);
    expect(entry.kind).toBe('journey-create');
    expect(entry.status).toBe('PENDING');

    const rows = await listPending(ALICE);
    expect(rows).toHaveLength(1);
    expect(rows[0].clientId).toBe(clientId);
  });

  test('a 4xx is NEVER queueable — isConnectivityError is the gate the pages use', () => {
    // The exact predicate both create pages branch on. If this ever
    // widened to include REJECTED, a validation error would be re-sent
    // forever, which is the failure mode this test exists to prevent.
    expect(isConnectivityError(new ApiError('OFFLINE'))).toBe(true);
    expect(isConnectivityError(new ApiError('UNREACHABLE'))).toBe(true);

    expect(isConnectivityError(new ApiError('REJECTED', { status: 422 }))).toBe(false);
    expect(isConnectivityError(new ApiError('REJECTED', { status: 400 }))).toBe(false);
    expect(isConnectivityError(new ApiError('REJECTED', { status: 403 }))).toBe(false);
    expect(isConnectivityError(new ApiError('AUTH', { status: 401 }))).toBe(false);
    // A 5xx is the server's problem, not a lost request: it answered.
    expect(isConnectivityError(new ApiError('SERVER', { status: 500 }))).toBe(false);
    // And a plain thrown Error is not a connectivity signal either.
    expect(isConnectivityError(new Error('boom'))).toBe(false);
  });

  test('cancel deletes the entry', async () => {
    const clientId = newClientId();
    const entry = await enqueueJourneyCreate({
      userId: ALICE,
      clientId,
      payload: journeyBody(clientId),
    });

    const ok = await cancelOutboxEntry(entry.id!, ALICE);
    expect(ok).toBe(true);
    expect(await listOutbox(ALICE)).toEqual([]);
    expect(await db.outbox.count()).toBe(0);
  });

  test('cancel is owner-checked — a borrowed phone cannot delete your booking', async () => {
    const clientId = newClientId();
    const entry = await enqueueJourneyCreate({
      userId: ALICE,
      clientId,
      payload: journeyBody(clientId),
    });

    const ok = await cancelOutboxEntry(entry.id!, BROTHER);
    expect(ok).toBe(false);
    expect(await db.outbox.count()).toBe(1);
  });

  test('the payload round-trips through IndexedDB unchanged', async () => {
    const clientId = newClientId();
    const body = journeyBody(clientId);
    await enqueueJourneyCreate({ userId: ALICE, clientId, payload: body });

    const [stored] = await listOutbox(ALICE);
    expect(stored.payload).toEqual(body);
    // The idempotency identity is in BOTH places and they agree — the
    // row's clientId is what the replay reads, the payload's
    // clientRequestId is what the server reads.
    expect(stored.clientId).toBe(clientId);
    expect((stored.payload as { clientRequestId: string }).clientRequestId).toBe(clientId);
  });

  test('newClientId produces a real v4 uuid (the server validates it as one)', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const id = newClientId();
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      ids.add(id);
    }
    expect(ids.size).toBe(200);
  });

  test('the summary shown to the passenger is their own route', async () => {
    const clientId = newClientId();
    const entry = await enqueueJourneyCreate({
      userId: ALICE,
      clientId,
      payload: journeyBody(clientId),
    });
    expect(outboxSummary(entry)).toEqual({
      pickupName: 'Sonatubes',
      destinationName: 'Giporoso',
    });
  });

  test('FIFO: entries come back oldest-first, which is the order they will be sent', async () => {
    for (const [i, name] of ['first', 'second', 'third'].entries()) {
      const clientId = newClientId();
      await enqueueJourneyCreate({
        userId: ALICE,
        clientId,
        payload: { ...journeyBody(clientId), pickupName: name },
        createdAt: new Date(Date.UTC(2026, 7, 15, 10, i)).toISOString(),
      });
    }
    const names = (await listOutbox(ALICE)).map((e) => outboxSummary(e).pickupName);
    expect(names).toEqual(['first', 'second', 'third']);
  });
});

describe('OUTBOX G2 — the migration is additive', () => {
  test('v4 adds outbox and retires nothing', async () => {
    // The survey found syncEvents/gpsBuffer ALIVE (drain loop mounted at
    // App.tsx:225, rejections rendered in the shell), so the "retire the
    // dead tables" half of this migration was refused. If a later change
    // drops one of these, this fails and the reason gets re-argued.
    const names = db.tables.map((t) => t.name).sort();
    expect(names).toContain('outbox');
    expect(names).toContain('syncEvents');
    expect(names).toContain('gpsBuffer');
    expect(names).toContain('syncMeta');
    // #161's device-level survivors, untouched.
    expect(names).toContain('mapCache');
    expect(names).toContain('mapDownloads');
  });

  test('outbox is indexed by the columns the replay reads', async () => {
    const schema = db.table('outbox').schema;
    const indexed = schema.indexes.map((i) => i.name).sort();
    expect(indexed).toEqual(['clientId', 'createdAt', 'kind', 'status', 'userId']);
    // payload is body, not a query surface.
    expect(indexed).not.toContain('payload');
  });
});
