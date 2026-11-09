import { EventEmitter } from 'events';

jest.mock('../../prisma', () => ({
  __esModule: true,
  default: {
    journey: {
      findUnique: jest.fn(),
    },
    gpsPoint: {
      create: jest.fn(),
    },
  },
}));

jest.mock('@sentry/node', () => ({
  captureException: jest.fn(),
}));

import prisma from '../../prisma';
import * as Sentry from '@sentry/node';
import { registerSocketHandlers, type AuthSocket } from '../index';

type Listener = (...args: any[]) => void;

interface RoomEmit {
  room: string;
  event: string;
  payload: any;
}

interface MockSocket extends EventEmitter {
  user?: { userId: string };
  rooms: Set<string>;
  authorisedJourneys?: Map<string, { customerId: string; driverId: string | null }>;
  emitted: Array<{ event: string; payload: any }>;
  roomEmits: RoomEmit[];
  emit: (event: string, ...args: any[]) => boolean;
  join: (room: string) => void;
  leave: (room: string) => void;
  to: (room: string) => { emit: (event: string, payload: any) => void };
  trigger: (event: string, ...args: any[]) => Promise<void>;
}

function makeSocket(userId: string): MockSocket {
  const ee = new EventEmitter();
  const handlers = new Map<string, Listener[]>();
  const sock = ee as unknown as MockSocket;
  sock.user = { userId };
  sock.rooms = new Set();
  sock.emitted = [];
  sock.roomEmits = [];

  // Capture handler registration
  const origOn = ee.on.bind(ee);
  ee.on = (event: string, listener: Listener) => {
    if (!handlers.has(event)) handlers.set(event, []);
    handlers.get(event)!.push(listener);
    return origOn(event, listener);
  };

  sock.emit = ((event: string, ...args: any[]) => {
    sock.emitted.push({ event, payload: args[0] });
    return true;
  }) as any;
  sock.join = (room: string) => {
    sock.rooms.add(room);
  };
  sock.leave = (room: string) => {
    sock.rooms.delete(room);
  };
  sock.to = (room: string) => ({
    emit: (event: string, payload: any) => {
      sock.roomEmits.push({ room, event, payload });
    },
  });
  sock.trigger = async (event: string, ...args: any[]) => {
    const ls = handlers.get(event) ?? [];
    for (const l of ls) {
      await l(...args);
    }
  };

  return sock;
}

const findUnique = (prisma.journey.findUnique as jest.Mock);
const gpsCreate = (prisma.gpsPoint.create as jest.Mock);

beforeEach(() => {
  jest.clearAllMocks();
  gpsCreate.mockResolvedValue({});
});

describe('socket update-location', () => {
  test('rejects update-location when caller is not a party to the journey', async () => {
    const socket = makeSocket('outsider');
    findUnique.mockResolvedValue({ customerId: 'cust', driverId: 'drv' });
    registerSocketHandlers(socket as unknown as AuthSocket);

    await socket.trigger('join-journey', { journeyId: 'j1' });

    // join was rejected; no room joined, error emitted.
    expect(socket.rooms.has('journey:j1')).toBe(false);
    expect(socket.emitted).toContainEqual({
      event: 'error',
      payload: { code: 'unauthorised-journey', journeyId: 'j1' },
    });

    // Even if the socket somehow ended up in the room without authorisation,
    // update-location must still reject.
    socket.rooms.add('journey:j1');
    socket.emitted = [];
    await socket.trigger('update-location', { lat: 1, lng: 2 });

    expect(socket.emitted).toContainEqual({
      event: 'error',
      payload: { code: 'unauthorised-journey', journeyId: 'j1' },
    });
    expect(socket.roomEmits).toEqual([]);
    expect(gpsCreate).not.toHaveBeenCalled();
  });

  test('party broadcasts driver-location AND persists a GpsPoint', async () => {
    const socket = makeSocket('drv');
    findUnique.mockResolvedValue({ customerId: 'cust', driverId: 'drv' });
    registerSocketHandlers(socket as unknown as AuthSocket);

    await socket.trigger('join-journey', { journeyId: 'j1' });
    expect(socket.rooms.has('journey:j1')).toBe(true);

    await socket.trigger('update-location', { lat: -1.95, lng: 30.06, accuracy: 12 });

    expect(socket.roomEmits).toHaveLength(1);
    const broadcast = socket.roomEmits[0];
    expect(broadcast.room).toBe('journey:j1');
    expect(broadcast.event).toBe('driver-location');
    expect(broadcast.payload.lat).toBe(-1.95);
    expect(broadcast.payload.lng).toBe(30.06);
    expect(broadcast.payload.accuracy).toBe(12);
    expect(typeof broadcast.payload.timestamp).toBe('string');

    expect(gpsCreate).toHaveBeenCalledTimes(1);
    expect(gpsCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        journeyId: 'j1',
        lat: -1.95,
        lng: 30.06,
        accuracy: 12,
      }),
    });
  });

  test('a DB write failure does not prevent the broadcast', async () => {
    const socket = makeSocket('drv');
    findUnique.mockResolvedValue({ customerId: 'cust', driverId: 'drv' });
    gpsCreate.mockRejectedValueOnce(new Error('db down'));
    registerSocketHandlers(socket as unknown as AuthSocket);

    await socket.trigger('join-journey', { journeyId: 'j1' });
    await socket.trigger('update-location', { lat: 1, lng: 2 });

    expect(socket.roomEmits).toHaveLength(1);
    expect(socket.roomEmits[0].event).toBe('driver-location');

    // Sentry captured the failure; broadcast still went through.
    await new Promise((r) => setImmediate(r));
    expect(Sentry.captureException).toHaveBeenCalled();
  });

  test('ignores malformed payloads', async () => {
    const socket = makeSocket('drv');
    findUnique.mockResolvedValue({ customerId: 'cust', driverId: 'drv' });
    registerSocketHandlers(socket as unknown as AuthSocket);

    await socket.trigger('join-journey', { journeyId: 'j1' });
    await socket.trigger('update-location', { lat: 'bad', lng: 2 });
    await socket.trigger('update-location', null);

    expect(socket.roomEmits).toEqual([]);
    expect(gpsCreate).not.toHaveBeenCalled();
  });
});
