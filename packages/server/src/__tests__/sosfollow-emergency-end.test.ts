// SOS-FOLLOW G3 — it always ends.
//
// The follow this dispatch builds is defensible only because of what is
// tested here. Both participants' phones stream position while an alert
// is ACTIVE, and ops watches; every one of those permissions hangs off a
// single row's status. So the ending has to be total: the row closes,
// the admins room hears, the JOURNEY room hears (which is what actually
// stops two phones spending battery), and the retention hold releases.
//
// Two things can close an alert — an administrator with a written note,
// and the 60-minute valve — and they come through one function on
// purpose. If they were two implementations, one of them would sooner or
// later forget one of the four consequences, and the one it would forget
// is the journey-room emit, because nothing visibly breaks when it is
// missing. So the emit assertions are repeated for both paths rather
// than tested once against the shared helper.
//
// The ended event's SHAPE is the never-broadcast invariant's load-bearing
// half and is asserted here as well as in sosfollow-never-broadcast.

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    $transaction: jest.fn(),
    emergencyAlert: { findMany: jest.fn(), updateMany: jest.fn(), findUnique: jest.fn() },
  },
}));

jest.mock('../socket', () => ({
  emitToJourney: jest.fn(),
  emitToAdmins: jest.fn(),
  getIO: () => null,
}));

jest.mock('../services/admin/admin-action-audit.service', () => ({
  appendAdminActionTx: jest.fn(),
}));

jest.mock('../services/job-lock', () => ({
  withJobLock: jest.fn(async (_name: string, fn: () => Promise<unknown>) => fn()),
}));

jest.mock('@sentry/node', () => ({
  addBreadcrumb: jest.fn(),
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { SOCKET_EVENTS } from '@bimoto/shared';
import prisma from '../prisma';
import adminEmergencyRoutes from '../routes/admin-emergency.routes';
import { emitToJourney, emitToAdmins } from '../socket';
import { appendAdminActionTx } from '../services/admin/admin-action-audit.service';
import { errorHandler } from '../middleware/error-handler';
import { generateAccessToken } from '../utils/jwt';
import {
  EMERGENCY_AUTO_EXPIRE_MIN,
  EMERGENCY_EXPIRY_NOTE,
  processEmergencyExpiry,
} from '../jobs/emergency-expiry.job';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/admin/emergency', adminEmergencyRoutes);
app.use(errorHandler);

const ADMIN_ID = 'admin-1';
const ALERT_ID = 'alert-1';
const JOURNEY_ID = 'journey-1';

const adminCookie = `accessToken=${generateAccessToken({ userId: ADMIN_ID, role: 'ADMIN' })}`;
const analystCookie = `accessToken=${generateAccessToken({ userId: 'an-1', role: 'ANALYST' })}`;
const customerCookie = `accessToken=${generateAccessToken({ userId: 'c1', role: 'CUSTOMER' })}`;
const driverCookie = `accessToken=${generateAccessToken({ userId: 'd1', role: 'DRIVER' })}`;

/** The tx handle the service is handed inside $transaction. */
let tx: {
  emergencyAlert: { updateMany: jest.Mock; findUnique: jest.Mock };
};

function alertIsActive(status: 'RESOLVED' | 'EXPIRED' = 'RESOLVED') {
  tx.emergencyAlert.updateMany.mockResolvedValue({ count: 1 });
  tx.emergencyAlert.findUnique.mockResolvedValue({
    id: ALERT_ID,
    journeyId: JOURNEY_ID,
    status,
    raisedByRole: 'DRIVER',
  });
}

function alertIsAlreadyClosed() {
  tx.emergencyAlert.updateMany.mockResolvedValue({ count: 0 });
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.EMERGENCY_EXPIRY_ADMIN_ID;
  tx = {
    emergencyAlert: { updateMany: jest.fn(), findUnique: jest.fn() },
  };
  (prisma.$transaction as jest.Mock).mockImplementation((fn: (t: unknown) => unknown) => fn(tx));
  (prisma.emergencyAlert.findMany as jest.Mock).mockResolvedValue([]);
});

describe('POST /api/admin/emergency/:id/resolve — a person ends it', () => {
  test('closes the row, writes the note, and answers with the terminal status', async () => {
    alertIsActive();

    const res = await request(app)
      .post(`/api/admin/emergency/${ALERT_ID}/resolve`)
      .set('Cookie', adminCookie)
      .send({ note: 'Spoke to the motari, he is safe and the ride ended normally.' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      alertId: ALERT_ID,
      journeyId: JOURNEY_ID,
      status: 'RESOLVED',
    });
    expect(tx.emergencyAlert.updateMany).toHaveBeenCalledWith({
      where: { id: ALERT_ID, status: 'ACTIVE' },
      data: expect.objectContaining({
        status: 'RESOLVED',
        resolvedById: ADMIN_ID,
        resolveNote: 'Spoke to the motari, he is safe and the ride ended normally.',
      }),
    });
  });

  test('the decision is a link in the admin hash chain (#61)', async () => {
    alertIsActive();

    await request(app)
      .post(`/api/admin/emergency/${ALERT_ID}/resolve`)
      .set('Cookie', adminCookie)
      .send({ note: 'False alarm, confirmed by phone with the passenger.' });

    expect(appendAdminActionTx).toHaveBeenCalledTimes(1);
    const [handedTx, args] = (appendAdminActionTx as jest.Mock).mock.calls[0];
    expect(handedTx).toBe(tx);
    expect(args).toMatchObject({
      adminId: ADMIN_ID,
      action: 'RESOLVE_EMERGENCY_ALERT',
      targetType: 'EmergencyAlert',
      targetId: ALERT_ID,
      reason: 'False alarm, confirmed by phone with the passenger.',
    });
  });

  test('BOTH rooms are told, and the journey room is what stops the phones', async () => {
    alertIsActive();

    await request(app)
      .post(`/api/admin/emergency/${ALERT_ID}/resolve`)
      .set('Cookie', adminCookie)
      .send({ note: 'Police attended, alert closed at the scene.' });

    expect(emitToJourney).toHaveBeenCalledWith(JOURNEY_ID, SOCKET_EVENTS.EMERGENCY_ENDED, {
      alertId: ALERT_ID,
      journeyId: JOURNEY_ID,
      status: 'RESOLVED',
    });
    expect(emitToAdmins).toHaveBeenCalledWith(SOCKET_EVENTS.EMERGENCY_ENDED, {
      alertId: ALERT_ID,
      journeyId: JOURNEY_ID,
      status: 'RESOLVED',
    });
  });

  test('the ended event carries the note to NOBODY — it is ops-only', async () => {
    alertIsActive();

    await request(app)
      .post(`/api/admin/emergency/${ALERT_ID}/resolve`)
      .set('Cookie', adminCookie)
      .send({ note: 'Details a participant must not read from a socket frame.' });

    for (const [, , payload] of (emitToJourney as jest.Mock).mock.calls) {
      expect(payload).not.toHaveProperty('resolveNote');
      expect(payload).not.toHaveProperty('note');
    }
  });

  test('a note shorter than the floor is refused and nothing closes', async () => {
    const res = await request(app)
      .post(`/api/admin/emergency/${ALERT_ID}/resolve`)
      .set('Cookie', adminCookie)
      .send({ note: 'ok' });

    expect(res.status).toBe(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(emitToJourney).not.toHaveBeenCalled();
  });

  test('a missing note is refused too', async () => {
    const res = await request(app)
      .post(`/api/admin/emergency/${ALERT_ID}/resolve`)
      .set('Cookie', adminCookie)
      .send({});

    expect(res.status).toBe(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('the second admin in a race gets 404 and emits nothing', async () => {
    alertIsAlreadyClosed();

    const res = await request(app)
      .post(`/api/admin/emergency/${ALERT_ID}/resolve`)
      .set('Cookie', adminCookie)
      .send({ note: 'Closing this one, colleague already handled it.' });

    expect(res.status).toBe(404);
    expect(emitToJourney).not.toHaveBeenCalled();
    expect(emitToAdmins).not.toHaveBeenCalled();
    expect(appendAdminActionTx).not.toHaveBeenCalled();
  });
});

describe('who may end it', () => {
  test.each([
    ['ANALYST', analystCookie],
    ['CUSTOMER', customerCookie],
    ['DRIVER', driverCookie],
  ])('%s is refused', async (_role, cookie) => {
    const res = await request(app)
      .post(`/api/admin/emergency/${ALERT_ID}/resolve`)
      .set('Cookie', cookie)
      .send({ note: 'This should never reach the handler at all.' });

    expect(res.status).toBe(403);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('unauthenticated is refused', async () => {
    const res = await request(app)
      .post(`/api/admin/emergency/${ALERT_ID}/resolve`)
      .send({ note: 'This should never reach the handler at all.' });

    expect(res.status).toBe(401);
  });
});

describe('the valve — nobody ends it, so the clock does', () => {
  test('an alert older than the valve is EXPIRED, with the system note', async () => {
    (prisma.emergencyAlert.findMany as jest.Mock).mockResolvedValue([{ id: ALERT_ID }]);
    alertIsActive('EXPIRED');

    const result = await processEmergencyExpiry();

    expect(result.expired).toBe(1);
    expect(tx.emergencyAlert.updateMany).toHaveBeenCalledWith({
      where: { id: ALERT_ID, status: 'ACTIVE' },
      data: expect.objectContaining({
        status: 'EXPIRED',
        resolveNote: EMERGENCY_EXPIRY_NOTE,
        // NULL is the durable record of WHICH KIND of ending this was.
        resolvedById: null,
      }),
    });
  });

  test('the valve sweeps by age, at the founder-decided 60 minutes', async () => {
    expect(EMERGENCY_AUTO_EXPIRE_MIN).toBe(60);

    // COUNTER-READY G5 — the bracket was one-sided and could only ever
    // pass by luck. The job's cutoff is `Date.now() - 60min` computed
    // INSIDE the call, so `before - cutoff` is `60min - (elapsed since
    // before)` — greater-than-or-equal to 60 minutes only in the case
    // where the two clock reads land in the SAME MILLISECOND. One
    // millisecond of scheduling between them turned this red, which is
    // what a loaded worker produces. Nothing about the job changed; the
    // assertion now brackets the cutoff between the two reads that
    // actually surround it, which is what it was always trying to say.
    const before = Date.now();
    await processEmergencyExpiry();
    const after = Date.now();
    const where = (prisma.emergencyAlert.findMany as jest.Mock).mock.calls[0][0].where;

    expect(where.status).toBe('ACTIVE');
    const cutoff = (where.createdAt.lt as Date).getTime();
    expect(after - cutoff).toBeGreaterThanOrEqual(60 * 60 * 1000);
    expect(before - cutoff).toBeLessThanOrEqual(60 * 60 * 1000);
    expect(after - cutoff).toBeLessThan(61 * 60 * 1000);
  });

  test('the valve fires the SAME two events — the phones stop even with nobody watching', async () => {
    (prisma.emergencyAlert.findMany as jest.Mock).mockResolvedValue([{ id: ALERT_ID }]);
    alertIsActive('EXPIRED');

    await processEmergencyExpiry();

    expect(emitToJourney).toHaveBeenCalledWith(JOURNEY_ID, SOCKET_EVENTS.EMERGENCY_ENDED, {
      alertId: ALERT_ID,
      journeyId: JOURNEY_ID,
      status: 'EXPIRED',
    });
    expect(emitToAdmins).toHaveBeenCalledWith(SOCKET_EVENTS.EMERGENCY_ENDED, {
      alertId: ALERT_ID,
      journeyId: JOURNEY_ID,
      status: 'EXPIRED',
    });
  });

  test('a machine closure invents no author for the hash chain', async () => {
    (prisma.emergencyAlert.findMany as jest.Mock).mockResolvedValue([{ id: ALERT_ID }]);
    alertIsActive('EXPIRED');

    await processEmergencyExpiry();

    expect(appendAdminActionTx).not.toHaveBeenCalled();
  });

  test('an operator who names an ops service account gets the chain entry too', async () => {
    process.env.EMERGENCY_EXPIRY_ADMIN_ID = 'ops-service-account';
    (prisma.emergencyAlert.findMany as jest.Mock).mockResolvedValue([{ id: ALERT_ID }]);
    alertIsActive('EXPIRED');

    await processEmergencyExpiry();

    expect(appendAdminActionTx).toHaveBeenCalledTimes(1);
    expect((appendAdminActionTx as jest.Mock).mock.calls[0][1]).toMatchObject({
      adminId: 'ops-service-account',
      action: 'RESOLVE_EMERGENCY_ALERT',
    });
  });

  test('one alert that will not close does not strand the rest of the sweep', async () => {
    (prisma.emergencyAlert.findMany as jest.Mock).mockResolvedValue([
      { id: 'bad' },
      { id: ALERT_ID },
    ]);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation();
    let call = 0;
    (prisma.$transaction as jest.Mock).mockImplementation((fn: (t: unknown) => unknown) => {
      call += 1;
      if (call === 1) throw new Error('deadlock');
      return fn(tx);
    });
    alertIsActive('EXPIRED');

    const result = await processEmergencyExpiry();

    expect(result.expired).toBe(1);
    expect(emitToJourney).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  test('nothing stale means no transaction and no events', async () => {
    const result = await processEmergencyExpiry();

    expect(result.expired).toBe(0);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(emitToJourney).not.toHaveBeenCalled();
  });
});

describe('the ops lists', () => {
  test('the ACTIVE list is OLDEST first — the one nobody has dealt with is on top', async () => {
    (prisma.emergencyAlert.findMany as jest.Mock).mockResolvedValue([]);

    const res = await request(app)
      .get('/api/admin/emergency/active')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    const args = (prisma.emergencyAlert.findMany as jest.Mock).mock.calls[0][0];
    expect(args.where).toEqual({ status: 'ACTIVE' });
    expect(args.orderBy).toEqual({ createdAt: 'asc' });
  });

  test('the history carries BOTH terminal states, newest first, with the notes', async () => {
    (prisma.emergencyAlert.findMany as jest.Mock).mockResolvedValue([]);

    const res = await request(app)
      .get('/api/admin/emergency/history')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    const args = (prisma.emergencyAlert.findMany as jest.Mock).mock.calls[0][0];
    expect(args.where).toEqual({ status: { in: ['RESOLVED', 'EXPIRED'] } });
    expect(args.orderBy).toEqual({ createdAt: 'desc' });
    // The note is the point of a history; an emergency nobody can learn
    // from is an emergency that taught nobody anything.
    expect(args.select.resolveNote).toBe(true);
    expect(args.select.status).toBe(true);
  });

  test('a nonsense limit is refused rather than silently clamped', async () => {
    const res = await request(app)
      .get('/api/admin/emergency/history?limit=99999')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(400);
    expect(prisma.emergencyAlert.findMany).not.toHaveBeenCalled();
  });

  test.each([
    ['ANALYST', analystCookie],
    ['CUSTOMER', customerCookie],
    ['DRIVER', driverCookie],
  ])('%s reads neither list', async (_role, cookie) => {
    for (const path of ['/api/admin/emergency/active', '/api/admin/emergency/history']) {
      const res = await request(app).get(path).set('Cookie', cookie);
      expect(res.status).toBe(403);
    }
    expect(prisma.emergencyAlert.findMany).not.toHaveBeenCalled();
  });

  test('neither list is shadowed by the /:id/resolve route', async () => {
    // 'active' and 'history' are valid-looking :id values, so route
    // ORDER is the only thing keeping them from being read as alert ids.
    (prisma.emergencyAlert.findMany as jest.Mock).mockResolvedValue([]);

    await request(app).get('/api/admin/emergency/active').set('Cookie', adminCookie);
    await request(app).get('/api/admin/emergency/history').set('Cookie', adminCookie);

    expect(prisma.emergencyAlert.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
