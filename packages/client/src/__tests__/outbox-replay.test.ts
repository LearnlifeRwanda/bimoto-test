// __TESTS__/OUTBOX-REPLAY.TEST.TS
//
// OUTBOX G3 — the replay engine, against REAL Dexie over fake-indexeddb.
//
// The negative tests are the point of this file. Sending a held booking
// is easy; the guarantees are all about what must NOT happen:
//
//   * a booking never goes out as anyone but the person who made it —
//     tested in BOTH directions, because "my entries are not sent for
//     him" and "his entries are not sent for me" are different bugs;
//   * a refusal is never retried;
//   * a lost connection mid-drain loses nothing;
//   * an app restart does not lose the queue.

// @vitest-environment node

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';

import { db } from '../db/dexie';
import { enqueueJourneyCreate, newClientId, listOutbox } from '../lib/outbox';
import { useAuthStore } from '../stores/auth.store';
import { useOutboxStore } from '../stores/outbox.store';
import { OutboxReplay } from '../sync/OutboxReplay';
import { _resetConnectivityForTests, reportApiSuccess } from '../sync/connectivity';

const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BROTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function body(clientRequestId: string, pickupName = 'Sonatubes') {
  return {
    clientRequestId,
    type: 'PASSENGER',
    pickupLat: -1.9536,
    pickupLng: 30.0606,
    pickupName,
    destinationLat: -1.9441,
    destinationLng: 30.0619,
    destinationName: 'Giporoso',
  };
}

async function hold(userId: string, pickupName = 'Sonatubes', createdAt?: string) {
  const clientId = newClientId();
  return enqueueJourneyCreate({
    userId,
    clientId,
    payload: body(clientId, pickupName),
    createdAt,
  });
}

function signIn(userId: string) {
  useAuthStore.setState({
    user: { id: userId, role: 'CUSTOMER' } as any,
    isAuthenticated: true,
    token: 'tok',
  } as any);
}

function signOut() {
  useAuthStore.setState({ user: null, isAuthenticated: false, token: null } as any);
}

/** Journey POSTs answered by `outcome`; everything else is a plain 200. */
function stubFetch(outcome: (callIndex: number) => Response | Promise<Response>) {
  let n = 0;
  const mock = vi.fn(async (url: RequestInfo | URL) => {
    if (String(url).includes('/api/journeys')) return outcome(n++);
    return new Response('{}', { status: 200 });
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

function created(id: string) {
  return new Response(JSON.stringify({ id, status: 'REQUESTED' }), { status: 201 });
}

/** Only the journey-create POSTs, in the order they were sent. */
function createBodies(mock: ReturnType<typeof stubFetch>) {
  return mock.mock.calls
    .filter(([url, init]: any) => String(url).includes('/api/journeys') && init?.method === 'POST')
    .map(([, init]: any) => JSON.parse(init.body));
}

beforeEach(async () => {
  await db.outbox.clear();
  _resetConnectivityForTests();
  // The engine refuses to run while offline; in node, navigator.onLine
  // is undefined, so state it positively.
  reportApiSuccess();
  useOutboxStore.setState({ lastSent: null });
  signIn(ALICE);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  signOut();
});

describe('OUTBOX G3 — sending what was held', () => {
  test('a held booking goes out on reconnect, once, and is then gone', async () => {
    const entry = await hold(ALICE);
    const mock = stubFetch(() => created('j1'));

    const result = await new OutboxReplay().replayAll();

    expect(result).toEqual({ sent: 1, rejected: 0, deferred: 0 });
    expect(createBodies(mock)).toHaveLength(1);
    // Byte-for-byte the body the page built, idempotency key included.
    expect(createBodies(mock)[0]).toEqual(entry.payload);
    expect(await listOutbox(ALICE)).toEqual([]);
  });

  test('success offers the ride instead of navigating to it', async () => {
    await hold(ALICE);
    stubFetch(() => created('j-sent'));

    await new OutboxReplay().replayAll();

    // The engine records an OFFER. Nothing here navigates: the shell
    // renders a "View the ride" button and the passenger decides.
    expect(useOutboxStore.getState().lastSent).toEqual({
      journeyId: 'j-sent',
      pickupName: 'Sonatubes',
      destinationName: 'Giporoso',
    });
  });

  test('entries go out oldest first', async () => {
    await hold(ALICE, 'first', '2026-08-15T10:00:00.000Z');
    await hold(ALICE, 'second', '2026-08-15T10:01:00.000Z');
    await hold(ALICE, 'third', '2026-08-15T10:02:00.000Z');
    const mock = stubFetch((i) => created(`j${i}`));

    const result = await new OutboxReplay().replayAll();

    expect(result.sent).toBe(3);
    expect(createBodies(mock).map((b) => b.pickupName)).toEqual([
      'first',
      'second',
      'third',
    ]);
  });

  test('the queue survives an app restart — a fresh engine drains it', async () => {
    await hold(ALICE);
    // No replay yet: the "app" is closed. A brand-new engine instance
    // over the same durable table is what a relaunch actually is.
    const mock = stubFetch(() => created('j-after-restart'));

    const result = await new OutboxReplay().replayAll();

    expect(result.sent).toBe(1);
    expect(createBodies(mock)).toHaveLength(1);
    expect(await listOutbox(ALICE)).toEqual([]);
  });
});

describe('OUTBOX G3 — a booking is never sent as anyone else', () => {
  test('Alice’s held booking is inert while her brother is signed in', async () => {
    await hold(ALICE);
    const mock = stubFetch(() => created('j-should-not-happen'));

    signIn(BROTHER);
    const result = await new OutboxReplay().replayAll();

    expect(result).toEqual({ sent: 0, rejected: 0, deferred: 0 });
    expect(createBodies(mock)).toHaveLength(0);
    // Untouched, not deleted: it is still hers, and still sendable when
    // she signs back in on this phone.
    const hers = await listOutbox(ALICE);
    expect(hers).toHaveLength(1);
    expect(hers[0].status).toBe('PENDING');
  });

  test('and the other direction: her brother’s booking is inert while Alice is signed in', async () => {
    await hold(BROTHER);
    const mock = stubFetch(() => created('j-should-not-happen'));

    // Alice is signed in (beforeEach).
    const result = await new OutboxReplay().replayAll();

    expect(result).toEqual({ sent: 0, rejected: 0, deferred: 0 });
    expect(createBodies(mock)).toHaveLength(0);
    expect(await listOutbox(BROTHER)).toHaveLength(1);
  });

  test('a user switch sends each person only their own, when each signs in', async () => {
    await hold(ALICE, 'alice-ride');
    await hold(BROTHER, 'brother-ride');
    const mock = stubFetch((i) => created(`j${i}`));

    await new OutboxReplay().replayAll(); // Alice
    expect(createBodies(mock).map((b) => b.pickupName)).toEqual(['alice-ride']);
    expect(await listOutbox(ALICE)).toEqual([]);
    expect(await listOutbox(BROTHER)).toHaveLength(1);

    signIn(BROTHER);
    await new OutboxReplay().replayAll();
    expect(createBodies(mock).map((b) => b.pickupName)).toEqual([
      'alice-ride',
      'brother-ride',
    ]);
    expect(await listOutbox(BROTHER)).toEqual([]);
  });

  test('with nobody signed in, nothing is sent and nothing is touched', async () => {
    await hold(ALICE);
    const mock = stubFetch(() => created('j-should-not-happen'));

    signOut();
    const result = await new OutboxReplay().replayAll();

    expect(result).toEqual({ sent: 0, rejected: 0, deferred: 0 });
    expect(createBodies(mock)).toHaveLength(0);
    expect(await listOutbox(ALICE)).toHaveLength(1);
  });
});

describe('OUTBOX G3 — a refusal is an answer, not a hiccup', () => {
  test('a 4xx marks the booking REJECTED with the server’s reason, and stops', async () => {
    await hold(ALICE);
    const mock = stubFetch(
      () =>
        new Response(
          JSON.stringify({
            error: { code: 'ACCOUNT_FLAGGED', message: 'errors.accountFlagged' },
          }),
          { status: 422 },
        ),
    );

    const result = await new OutboxReplay().replayAll();
    expect(result).toEqual({ sent: 0, rejected: 1, deferred: 0 });

    const [entry] = await listOutbox(ALICE);
    expect(entry.status).toBe('REJECTED');
    expect(entry.failCode).toBe('ACCOUNT_FLAGGED');
    expect(entry.failMessage).toBe('errors.accountFlagged');

    // The whole point: a second reconnect does NOT send it again.
    await new OutboxReplay().replayAll();
    expect(createBodies(mock)).toHaveLength(1);
  });

  test('a 500 is not a refusal — the booking stays PENDING and is tried again', async () => {
    await hold(ALICE);
    let calls = 0;
    stubFetch(() => {
      calls += 1;
      return calls === 1
        ? new Response(JSON.stringify({ error: { code: 'BOOM' } }), { status: 500 })
        : created('j-second-try');
    });

    const first = await new OutboxReplay().replayAll();
    expect(first).toEqual({ sent: 0, rejected: 0, deferred: 1 });
    expect((await listOutbox(ALICE))[0].status).toBe('PENDING');

    const second = await new OutboxReplay().replayAll();
    expect(second.sent).toBe(1);
    expect(await listOutbox(ALICE)).toEqual([]);
  });

  test('the connection going again mid-drain loses nothing', async () => {
    await hold(ALICE, 'first', '2026-08-15T10:00:00.000Z');
    await hold(ALICE, 'second', '2026-08-15T10:01:00.000Z');
    const mock = stubFetch((i) => {
      if (i === 0) return created('j-first');
      throw new TypeError('Failed to fetch');
    });

    const result = await new OutboxReplay().replayAll();

    expect(result.sent).toBe(1);
    expect(result.deferred).toBe(1);
    // The second is still held, still PENDING, still whole.
    const left = await listOutbox(ALICE);
    expect(left).toHaveLength(1);
    expect(left[0].status).toBe('PENDING');
    expect((left[0].payload as any).pickupName).toBe('second');
    expect(createBodies(mock)).toHaveLength(2);
  });

  test('a drain already running is not started a second time', async () => {
    await hold(ALICE);
    // A POST that hangs until this test lets it finish, so the first
    // drain is provably still in flight when the second is attempted.
    let release!: (r: Response) => void;
    const hanging = new Promise<Response>((r) => {
      release = r;
    });
    const mock = stubFetch(() => hanging);

    const engine = new OutboxReplay();
    const first = engine.replayAll();
    // Let the drain get as far as the (hanging) request.
    await Promise.resolve();
    await Promise.resolve();

    const second = await engine.replayAll(); // while the first is in flight
    expect(second).toEqual({ sent: 0, rejected: 0, deferred: 0 });

    release(created('j1'));
    expect((await first).sent).toBe(1);
    // One request total: the second call did not duplicate the send.
    expect(createBodies(mock)).toHaveLength(1);
  });
});
