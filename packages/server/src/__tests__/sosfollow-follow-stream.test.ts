// SOS-FOLLOW G4 — the live follow, driven over a real socket server.
//
// Written as an integration test rather than a handler unit test on
// purpose. The claim this work makes is about WHERE BYTES GO, and a
// mocked emitter can only tell you which function was called. Here a
// real journey-room member and a real 'admins'-room member are both
// listening on real sockets, and the assertion is what each of them
// actually received.
//
// THE NEVER-BROADCAST INVARIANT lives in this file (see the describe
// block of that name). It is the one that would matter if it broke:
// nobody can watch a ride, ops can follow an emergency, and the only
// new thing a journey room ever hears from this dispatch is the
// positions-free ended-event.

import http from 'http';
import { AddressInfo } from 'net';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import { SOCKET_EVENTS } from '@bimoto/shared';

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    journey: { findUnique: jest.fn() },
    emergencyAlert: { findFirst: jest.fn() },
    gpsPoint: { create: jest.fn(async () => ({})) },
  },
}));
jest.mock('@sentry/node', () => ({
  captureException: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

import * as Sentry from '@sentry/node';
import prisma from '../prisma';
import { initSocket } from '../socket';
import { generateAccessToken } from '../utils/jwt';

const CUSTOMER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const DRIVER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const OUTSIDER = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const ADMIN = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const JOURNEY = 'jjjjjjjj-jjjj-jjjj-jjjj-jjjjjjjjjjjj';
const ALERT = 'alert-1';

let httpServer: http.Server;
let serverUrl: string;
const open: ClientSocket[] = [];

beforeAll(async () => {
  httpServer = http.createServer();
  initSocket(httpServer);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const { port } = httpServer.address() as AddressInfo;
  serverUrl = `http://localhost:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

afterEach(() => {
  while (open.length) open.pop()!.disconnect();
});

function connectAs(userId: string, role = 'CUSTOMER'): Promise<ClientSocket> {
  const token = generateAccessToken({ userId, role });
  return new Promise((resolve, reject) => {
    const sock = ioClient(serverUrl, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
    });
    open.push(sock);
    sock.on('connect', () => resolve(sock));
    sock.on('connect_error', reject);
  });
}

/** Join the journey room and wait until the server has processed it. */
async function joinJourney(sock: ClientSocket): Promise<void> {
  sock.emit(SOCKET_EVENTS.JOIN_JOURNEY, { journeyId: JOURNEY });
  await settle();
}

/** Let the server's async handlers drain. */
function settle(ms = 60): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Record every event a socket receives, by name. */
function recordAll(sock: ClientSocket): Array<{ event: string; payload: unknown }> {
  const seen: Array<{ event: string; payload: unknown }> = [];
  sock.onAny((event: string, payload: unknown) => seen.push({ event, payload }));
  return seen;
}

const FRAME = { journeyId: JOURNEY, lat: -1.9501, lng: 30.0588, accuracy: 12 };

beforeEach(() => {
  jest.clearAllMocks();
  (prisma.journey.findUnique as jest.Mock).mockResolvedValue({
    customerId: CUSTOMER,
    driverId: DRIVER,
  });
  (prisma.emergencyAlert.findFirst as jest.Mock).mockResolvedValue({ id: ALERT });
});

describe('an ACTIVE alert lets a participant stream, and ops receives it', () => {
  test("the passenger's frame reaches the admins room, named and timestamped", async () => {
    const admin = await connectAs(ADMIN, 'ADMIN');
    const received: unknown[] = [];
    admin.on(SOCKET_EVENTS.EMERGENCY_LOCATION_UPDATE, (p: unknown) => received.push(p));

    const customer = await connectAs(CUSTOMER);
    customer.emit(SOCKET_EVENTS.EMERGENCY_LOCATION, FRAME);
    await settle();

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      alertId: ALERT,
      journeyId: JOURNEY,
      userId: CUSTOMER,
      role: 'CUSTOMER',
      lat: -1.9501,
      lng: 30.0588,
      accuracy: 12,
    });
    expect(typeof (received[0] as { at: string }).at).toBe('string');
  });

  test('the frame is persisted as a GpsPoint, fire-and-forget', async () => {
    const customer = await connectAs(CUSTOMER);
    customer.emit(SOCKET_EVENTS.EMERGENCY_LOCATION, FRAME);
    await settle();

    expect(prisma.gpsPoint.create).toHaveBeenCalledTimes(1);
    expect((prisma.gpsPoint.create as jest.Mock).mock.calls[0][0].data).toMatchObject({
      journeyId: JOURNEY,
      lat: -1.9501,
      lng: 30.0588,
      accuracy: 12,
    });
  });

  test('BOTH participants stream — two devices, two userIds, both relayed and both persisted', async () => {
    const admin = await connectAs(ADMIN, 'ADMIN');
    const received: Array<{ userId: string; role: string }> = [];
    admin.on(SOCKET_EVENTS.EMERGENCY_LOCATION_UPDATE, (p: { userId: string; role: string }) =>
      received.push(p),
    );

    const customer = await connectAs(CUSTOMER);
    const driver = await connectAs(DRIVER, 'DRIVER');
    customer.emit(SOCKET_EVENTS.EMERGENCY_LOCATION, FRAME);
    driver.emit(SOCKET_EVENTS.EMERGENCY_LOCATION, { ...FRAME, lat: -1.96 });
    await settle(120);

    expect(received).toHaveLength(2);
    expect(received.map((r) => r.userId).sort()).toEqual([CUSTOMER, DRIVER].sort());
    expect(received.find((r) => r.userId === CUSTOMER)!.role).toBe('CUSTOMER');
    expect(received.find((r) => r.userId === DRIVER)!.role).toBe('DRIVER');
    expect(prisma.gpsPoint.create).toHaveBeenCalledTimes(2);
  });

  test('accuracy is optional — a frame without it is still accepted', async () => {
    const admin = await connectAs(ADMIN, 'ADMIN');
    const received: Array<{ accuracy: unknown }> = [];
    admin.on(SOCKET_EVENTS.EMERGENCY_LOCATION_UPDATE, (p: { accuracy: unknown }) => received.push(p));

    const customer = await connectAs(CUSTOMER);
    customer.emit(SOCKET_EVENTS.EMERGENCY_LOCATION, { journeyId: JOURNEY, lat: -1.95, lng: 30.05 });
    await settle();

    expect(received).toHaveLength(1);
    expect(received[0].accuracy).toBeNull();
  });
});

describe('the two guards, and the silence they answer with', () => {
  test('a non-participant is dropped: nothing relayed, nothing written, no error back', async () => {
    const admin = await connectAs(ADMIN, 'ADMIN');
    const relayed: unknown[] = [];
    admin.on(SOCKET_EVENTS.EMERGENCY_LOCATION_UPDATE, (p: unknown) => relayed.push(p));

    const outsider = await connectAs(OUTSIDER);
    const backToSender = recordAll(outsider);
    outsider.emit(SOCKET_EVENTS.EMERGENCY_LOCATION, FRAME);
    await settle();

    expect(relayed).toHaveLength(0);
    expect(prisma.gpsPoint.create).not.toHaveBeenCalled();
    // A phone in distress never gets an error loop.
    expect(backToSender).toHaveLength(0);
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'emergency-follow' }),
    );
  });

  test('a participant with NO ACTIVE alert is dropped just as silently', async () => {
    (prisma.emergencyAlert.findFirst as jest.Mock).mockResolvedValue(null);
    const admin = await connectAs(ADMIN, 'ADMIN');
    const relayed: unknown[] = [];
    admin.on(SOCKET_EVENTS.EMERGENCY_LOCATION_UPDATE, (p: unknown) => relayed.push(p));

    const customer = await connectAs(CUSTOMER);
    const backToSender = recordAll(customer);
    customer.emit(SOCKET_EVENTS.EMERGENCY_LOCATION, FRAME);
    await settle();

    expect(relayed).toHaveLength(0);
    expect(prisma.gpsPoint.create).not.toHaveBeenCalled();
    expect(backToSender).toHaveLength(0);
  });

  test('the ACTIVE check is re-read per frame — a resolve stops the very next one', async () => {
    const admin = await connectAs(ADMIN, 'ADMIN');
    const relayed: unknown[] = [];
    admin.on(SOCKET_EVENTS.EMERGENCY_LOCATION_UPDATE, (p: unknown) => relayed.push(p));

    const customer = await connectAs(CUSTOMER);
    customer.emit(SOCKET_EVENTS.EMERGENCY_LOCATION, FRAME);
    await settle();
    expect(relayed).toHaveLength(1);

    // Ops resolves. Nothing about the socket changed — only the row.
    (prisma.emergencyAlert.findFirst as jest.Mock).mockResolvedValue(null);
    customer.emit(SOCKET_EVENTS.EMERGENCY_LOCATION, FRAME);
    await settle();

    expect(relayed).toHaveLength(1);
  });

  test('a malformed frame is ignored without touching the database', async () => {
    const customer = await connectAs(CUSTOMER);
    customer.emit(SOCKET_EVENTS.EMERGENCY_LOCATION, { journeyId: JOURNEY, lat: 'north' });
    customer.emit(SOCKET_EVENTS.EMERGENCY_LOCATION, { lat: -1.95, lng: 30.05 });
    customer.emit(SOCKET_EVENTS.EMERGENCY_LOCATION, undefined);
    await settle();

    expect(prisma.journey.findUnique).not.toHaveBeenCalled();
    expect(prisma.gpsPoint.create).not.toHaveBeenCalled();
  });
});

describe('NEVER-BROADCAST — the invariant', () => {
  test('a journey-room member receives NOTHING when the other party streams', async () => {
    // The passenger is in the journey room, exactly as the app puts him
    // there. The motari — who in the case that matters most is the
    // reason the button was pressed — streams his position.
    const customer = await connectAs(CUSTOMER);
    await joinJourney(customer);
    const heardByCustomer = recordAll(customer);

    const driver = await connectAs(DRIVER, 'DRIVER');
    driver.emit(SOCKET_EVENTS.EMERGENCY_LOCATION, FRAME);
    driver.emit(SOCKET_EVENTS.EMERGENCY_LOCATION, { ...FRAME, lat: -1.97 });
    await settle(150);

    expect(heardByCustomer).toEqual([]);
  });

  test('the follow relay reaches the admins room and no journey room', async () => {
    const inRoom = await connectAs(CUSTOMER);
    await joinJourney(inRoom);
    const heardInRoom = recordAll(inRoom);

    const admin = await connectAs(ADMIN, 'ADMIN');
    const heardByAdmin = recordAll(admin);

    const driver = await connectAs(DRIVER, 'DRIVER');
    driver.emit(SOCKET_EVENTS.EMERGENCY_LOCATION, FRAME);
    await settle(120);

    expect(heardByAdmin.map((e) => e.event)).toEqual([
      SOCKET_EVENTS.EMERGENCY_LOCATION_UPDATE,
    ]);
    expect(heardInRoom).toEqual([]);
  });

  test('a streamer is not even in the journey room by virtue of streaming', async () => {
    // The follow does not join anything. If it did, a later journey-room
    // broadcast would reach a device the app never put in that room.
    const admin = await connectAs(ADMIN, 'ADMIN');
    const heardByAdmin = recordAll(admin);

    const driver = await connectAs(DRIVER, 'DRIVER');
    const heardByDriver = recordAll(driver);
    driver.emit(SOCKET_EVENTS.EMERGENCY_LOCATION, FRAME);
    await settle();

    expect(heardByDriver).toEqual([]);
    expect(heardByAdmin).toHaveLength(1);
  });

  test('an ADMIN who is not in the journey room still gets the follow — that IS the design', async () => {
    const admin = await connectAs(ADMIN, 'ADMIN');
    const heard = recordAll(admin);

    const customer = await connectAs(CUSTOMER);
    customer.emit(SOCKET_EVENTS.EMERGENCY_LOCATION, FRAME);
    await settle();

    expect(heard).toHaveLength(1);
    expect(heard[0].event).toBe(SOCKET_EVENTS.EMERGENCY_LOCATION_UPDATE);
  });

  test('an ANALYST is not in the admins room, so no position reaches one', async () => {
    // Excluded by construction: the join is `role === 'ADMIN'`. This
    // asserts the construction rather than trusting the string.
    const analyst = await connectAs('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'ANALYST');
    const heard = recordAll(analyst);

    const customer = await connectAs(CUSTOMER);
    customer.emit(SOCKET_EVENTS.EMERGENCY_LOCATION, FRAME);
    await settle();

    expect(heard).toEqual([]);
  });

  test('the ordinary ride broadcast is untouched by any of this', async () => {
    // UPDATE_LOCATION still goes to the journey room and only there.
    const customer = await connectAs(CUSTOMER);
    await joinJourney(customer);
    const heardByCustomer: string[] = [];
    customer.onAny((event: string) => heardByCustomer.push(event));

    const driver = await connectAs(DRIVER, 'DRIVER');
    await joinJourney(driver);
    driver.emit(SOCKET_EVENTS.UPDATE_LOCATION, { lat: -1.95, lng: 30.05, accuracy: 5 });
    await settle();

    expect(heardByCustomer).toEqual([SOCKET_EVENTS.DRIVER_LOCATION]);
  });
});
