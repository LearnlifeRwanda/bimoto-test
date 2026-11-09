// LOCATION-LIFE A G4 — a driver broadcasting mid-ride stays alive for
// discovery, and does not pay for it on every frame.
//
// The UPDATE_LOCATION handler wrote `gpsPoint` and never touched
// `driverProfile.lastLocationAt` — the single column seven discovery
// consumers gate on. So a motari streaming his position every ~8 s
// during a MATCHED approach still went stale after 300 s, and stayed
// invisible AFTER the drop-off until something else happened to write
// the column. The ride was the thing that hid him.
//
// Two things are pinned here: the refresh happens, and it is throttled
// to the heartbeat cadence rather than firing on every frame.

import { SOCKET_EVENTS, DRIVER_LIVENESS_PING_MS } from '@bimoto/shared';

type UpdateManyArg = {
  where: { userId: string };
  data: { lastLocationAt: Date; lastLat: number; lastLng: number };
};

const updateMany = jest.fn(async (_arg: UpdateManyArg) => ({ count: 1 }));
const gpsCreate = jest.fn(async (_arg: unknown) => ({}));

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    journey: { findUnique: jest.fn(async () => null) },
    gpsPoint: { create: (arg: unknown) => gpsCreate(arg) },
    driverProfile: { updateMany: (arg: unknown) => updateMany(arg as UpdateManyArg) },
  },
}));
jest.mock('@sentry/node', () => ({ captureException: jest.fn() }));

import { registerSocketHandlers, type AuthSocket } from '../socket';

const DRIVER = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const CUSTOMER = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const JOURNEY = 'j-1';

type Handlers = Record<string, (payload: unknown) => void>;

/**
 * A connection stood up far enough to drive the handler directly:
 * already in the journey room, with the parties the room guard would
 * have loaded. `as` decides whether the sender is the driver or the
 * customer of that journey.
 */
function makeSocket(as: 'driver' | 'customer') {
  const handlers: Handlers = {};
  const emitted: Array<[string, unknown]> = [];
  const socket = {
    user: { userId: as === 'driver' ? DRIVER : CUSTOMER, role: 'DRIVER' },
    rooms: new Set<string>([`journey:${JOURNEY}`]),
    join: () => {},
    on: (event: string, handler: (payload: unknown) => void) => {
      handlers[event] = handler;
    },
    emit: (event: string, payload: unknown) => {
      emitted.push([event, payload]);
    },
    to: () => ({ emit: (event: string, payload: unknown) => emitted.push([event, payload]) }),
  } as unknown as AuthSocket;

  registerSocketHandlers(socket);
  socket.authorisedJourneys!.set(JOURNEY, { customerId: CUSTOMER, driverId: DRIVER });

  const frame = (lat: number, lng: number) =>
    handlers[SOCKET_EVENTS.UPDATE_LOCATION]({ lat, lng, accuracy: 12 });

  return { socket, frame, emitted };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('LOCATION-LIFE A G4 — socket liveness refresh', () => {
  test('an UPDATE_LOCATION frame refreshes the sending driver liveness', () => {
    const { frame } = makeSocket('driver');

    frame(-1.95, 30.06);

    expect(updateMany).toHaveBeenCalledTimes(1);
    const arg = updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ userId: DRIVER });
    expect(arg.data.lastLat).toBe(-1.95);
    expect(arg.data.lastLng).toBe(30.06);
    expect(arg.data.lastLocationAt).toBeInstanceOf(Date);

    // The existing gpsPoint path is untouched and still fires.
    expect(gpsCreate).toHaveBeenCalledTimes(1);
  });

  test('a second frame inside the throttle window does not write again', () => {
    const { frame } = makeSocket('driver');

    frame(-1.95, 30.06);
    expect(updateMany).toHaveBeenCalledTimes(1);

    // Frames arrive every ~8 s; the next one is well inside the window.
    jest.advanceTimersByTime(8_000);
    frame(-1.96, 30.07);
    expect(updateMany).toHaveBeenCalledTimes(1);

    // ...and every frame still records its trace point. The throttle is
    // a cost guard on liveness only, never on the ride's own history.
    expect(gpsCreate).toHaveBeenCalledTimes(2);
  });

  test('a frame past the throttle window writes again', () => {
    const { frame } = makeSocket('driver');

    frame(-1.95, 30.06);
    jest.advanceTimersByTime(DRIVER_LIVENESS_PING_MS + 1);
    frame(-1.96, 30.07);

    expect(updateMany).toHaveBeenCalledTimes(2);
    const second = updateMany.mock.calls[1][0];
    expect(second.data.lastLat).toBe(-1.96);
  });

  test('a customer sharing position never writes to a driver profile', () => {
    const { frame } = makeSocket('customer');

    frame(-1.95, 30.06);

    // The customer is a party to the journey, so the frame is accepted
    // and traced — but liveness belongs to the driver alone.
    expect(gpsCreate).toHaveBeenCalledTimes(1);
    expect(updateMany).not.toHaveBeenCalled();
  });
});
