// OUTBOX G2 — POST /api/journeys is idempotent for a replayed booking.
//
// The failure this exists to stop is not the request that never arrived.
// It is the request that ARRIVED, wrote its row, and whose 201 died on
// the way back to a phone in a dead zone. The phone cannot tell that
// apart from "never sent", so the outbox replays it — and before this,
// that was a second ride booked for a passenger who wanted one.
//
// Proved at the route, because the route is where the guarantee has to
// hold: the pre-check short-circuits the whole create pipeline (no
// second totalRequests increment, no second discovery cascade, no
// second JOURNEY_CREATED emit).

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    journey: { findFirst: jest.fn(), create: jest.fn() },
    user: { findUnique: jest.fn(), update: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock('../socket', () => ({
  emitToJourney: jest.fn(),
  emitToAdmins: jest.fn(),
  getIO: () => null,
}));

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import prisma from '../prisma';
import journeyRoutes from '../routes/journey.routes';
import { emitToJourney } from '../socket';
import { errorHandler } from '../middleware/error-handler';
import { generateAccessToken } from '../utils/jwt';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/journeys', journeyRoutes);
app.use(errorHandler);

const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BROTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CLIENT_REQUEST_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

const aliceCookie = `accessToken=${generateAccessToken({ userId: ALICE, role: 'CUSTOMER' })}`;
const brotherCookie = `accessToken=${generateAccessToken({ userId: BROTHER, role: 'CUSTOMER' })}`;

/** The body the offline outbox replays: the original create, unchanged. */
function heldBooking(overrides: Record<string, unknown> = {}) {
  return {
    clientRequestId: CLIENT_REQUEST_ID,
    type: 'PASSENGER',
    pickupLat: -1.9536,
    pickupLng: 30.0606,
    pickupName: 'Sonatubes',
    destinationLat: -1.9441,
    destinationLng: 30.0619,
    destinationName: 'Giporoso',
    vehiclePreference: 'MOTO',
    ...overrides,
  };
}

const EXISTING_JOURNEY = {
  id: 'j-already-created',
  customerId: ALICE,
  clientRequestId: CLIENT_REQUEST_ID,
  status: 'REQUESTED',
  pickupName: 'Sonatubes',
  destinationName: 'Giporoso',
};

beforeEach(() => {
  jest.clearAllMocks();
  (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: ALICE, isFlagged: false });
  (prisma.user.update as jest.Mock).mockResolvedValue({});
  (prisma.journey.findFirst as jest.Mock).mockResolvedValue(null);
});

describe('OUTBOX G2 — a replayed booking cannot become two rides', () => {
  test('the replay of an attempt that already landed returns the SAME journey and creates nothing', async () => {
    // The first attempt's row is already in the database — its 201 just
    // never reached the phone.
    (prisma.journey.findFirst as jest.Mock).mockResolvedValue(EXISTING_JOURNEY);

    const res = await request(app)
      .post('/api/journeys')
      .set('Cookie', aliceCookie)
      .send(heldBooking());

    expect(res.status).toBe(200); // 200, not 201: nothing was created here
    expect(res.body.id).toBe('j-already-created');

    // The whole create pipeline was skipped, not merely deduplicated at
    // the end: no insert, no totalRequests increment, no second
    // JOURNEY_CREATED for anyone listening.
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.journey.create).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(emitToJourney).not.toHaveBeenCalled();

    // And it looked the attempt up as THIS customer's, never globally.
    expect(prisma.journey.findFirst).toHaveBeenCalledWith({
      where: { customerId: ALICE, clientRequestId: CLIENT_REQUEST_ID },
    });
  });

  test('one passenger cannot resolve another passenger’s attempt id', async () => {
    // The brother borrows the phone, logs in, and (impossibly, but the
    // guarantee must not rest on that) sends Alice's attempt id. The
    // lookup is customer-scoped, so it cannot find her ride.
    (prisma.journey.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.$transaction as jest.Mock).mockResolvedValue({
      id: 'j-brothers-own',
      customerId: BROTHER,
      status: 'REQUESTED',
    });

    const res = await request(app)
      .post('/api/journeys')
      .set('Cookie', brotherCookie)
      .send(heldBooking());

    expect(res.status).toBe(201);
    expect(res.body.id).toBe('j-brothers-own');
    expect(prisma.journey.findFirst).toHaveBeenCalledWith({
      where: { customerId: BROTHER, clientRequestId: CLIENT_REQUEST_ID },
    });
  });

  test('a first-time booking is created exactly as before, and carries its attempt id', async () => {
    (prisma.$transaction as jest.Mock).mockImplementation(async (fn: any) => {
      const tx = {
        journey: {
          create: jest.fn().mockResolvedValue({
            id: 'j-new',
            customerId: ALICE,
            status: 'REQUESTED',
            pickupLat: -1.9536,
            pickupLng: 30.0606,
            createdAt: new Date(),
          }),
        },
        journeyLeg: { createMany: jest.fn() },
      };
      const created = await fn(tx);
      // The attempt id reached the insert, so the NEXT replay can find it.
      expect(tx.journey.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ clientRequestId: CLIENT_REQUEST_ID }),
        }),
      );
      return created;
    });

    const res = await request(app)
      .post('/api/journeys')
      .set('Cookie', aliceCookie)
      .send(heldBooking());

    expect(res.status).toBe(201);
    expect(emitToJourney).toHaveBeenCalled();
  });

  test('a create WITHOUT an attempt id behaves exactly as it did before this existed', async () => {
    (prisma.$transaction as jest.Mock).mockResolvedValue({
      id: 'j-plain',
      customerId: ALICE,
      status: 'REQUESTED',
    });

    const body = heldBooking();
    delete (body as { clientRequestId?: unknown }).clientRequestId;

    const res = await request(app).post('/api/journeys').set('Cookie', aliceCookie).send(body);

    expect(res.status).toBe(201);
    // No lookup at all — the pre-check is skipped entirely, so every
    // create from a client that predates the field is untouched.
    expect(prisma.journey.findFirst).not.toHaveBeenCalled();
    expect(emitToJourney).toHaveBeenCalled();
  });

  test('a malformed attempt id is a 400, not a silently-ignored field', async () => {
    const res = await request(app)
      .post('/api/journeys')
      .set('Cookie', aliceCookie)
      .send(heldBooking({ clientRequestId: 'not-a-uuid' }));

    expect(res.status).toBe(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
