// SOCKET-FIX G2 — sockets must join `user:${userId}` on connect.
//
// Regression guard for the empty-room defect: journey:available (both
// discovery broadcasters), auto-bid:fired and suggest-up:available are
// all emitted with io.to(`user:${userId}`), but before G2 nothing ever
// joined those rooms, so every one of those emits reached no one.

import http from 'http';
import { AddressInfo } from 'net';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import { SOCKET_EVENTS } from '@bimoto/shared';

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    journey: { findUnique: jest.fn(async () => null) },
    gpsPoint: { create: jest.fn(async () => ({})) },
  },
}));
jest.mock('@sentry/node', () => ({ captureException: jest.fn() }));

import { initSocket, getIO } from '../socket';
import { generateAccessToken } from '../utils/jwt';

const driverId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const otherId = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

let httpServer: http.Server;
let serverUrl: string;

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

function connectAs(userId: string): Promise<ClientSocket> {
  const token = generateAccessToken({ userId, role: 'DRIVER' });
  return new Promise((resolve, reject) => {
    const sock = ioClient(serverUrl, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
    });
    sock.on('connect', () => resolve(sock));
    sock.on('connect_error', (err) => reject(err));
  });
}

describe('per-user socket rooms (SOCKET-FIX G2)', () => {
  test('an emit to user:<id> reaches that user and only that user', async () => {
    const driver = await connectAs(driverId);
    const other = await connectAs(otherId);

    try {
      const received: unknown[] = [];
      const othersReceived: unknown[] = [];
      driver.on(SOCKET_EVENTS.JOURNEY_AVAILABLE, (evt) => received.push(evt));
      other.on(SOCKET_EVENTS.JOURNEY_AVAILABLE, (evt) => othersReceived.push(evt));

      getIO()
        .to(`user:${driverId}`)
        .emit(SOCKET_EVENTS.JOURNEY_AVAILABLE, { journeyId: 'j1', urgent: true });

      await new Promise((r) => setTimeout(r, 150));

      expect(received).toEqual([{ journeyId: 'j1', urgent: true }]);
      expect(othersReceived).toEqual([]);
    } finally {
      driver.disconnect();
      other.disconnect();
    }
  });
});
