import http from 'http';
import { AddressInfo } from 'net';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';

const customerId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const driverId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const journeyId = 'aaaaaaaa-1111-2222-3333-444444444444';

// Persisted GpsPoints for assertion. Latest point feeds the ETA route.
const gpsPointRows: Array<{ journeyId: string; lat: number; lng: number; timestamp: Date; accuracy?: number | null }> = [];

jest.mock('../prisma', () => {
  const prismaMock = {
    journey: {
      findUnique: jest.fn(async ({ where }: any) => {
        if (where.id !== journeyId) return null;
        return {
          id: journeyId,
          customerId,
          driverId,
          pickupLat: -1.95,
          pickupLng: 30.06,
          driver: { driverProfile: { vehicleType: 'MOTO' } },
        };
      }),
    },
    gpsPoint: {
      create: jest.fn(async ({ data }: any) => {
        gpsPointRows.push({ ...data });
        return { id: `gp-${gpsPointRows.length}`, ...data };
      }),
      findFirst: jest.fn(async ({ where, orderBy }: any) => {
        let rows = gpsPointRows.filter((r) => r.journeyId === where.journeyId);
        if (orderBy?.timestamp === 'desc') {
          rows = [...rows].sort(
            (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
          );
        }
        return rows[0] ?? null;
      }),
      findMany: jest.fn(async ({ where, orderBy, take }: any) => {
        let rows = gpsPointRows.filter((r) => r.journeyId === where.journeyId);
        if (orderBy?.timestamp === 'desc') {
          rows = [...rows].sort(
            (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
          );
        } else if (orderBy?.timestamp === 'asc') {
          rows = [...rows].sort(
            (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
          );
        }
        return typeof take === 'number' ? rows.slice(0, take) : rows;
      }),
    },
    user: {
      findUnique: jest.fn(async () => ({ id: 'any', frozenAt: null })),
    },
  };
  return { __esModule: true, default: prismaMock };
});

jest.mock('@sentry/node', () => ({ captureException: jest.fn() }));

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { initSocket } from '../socket';
import { generateAccessToken } from '../utils/jwt';
import journeyRoutes from '../routes/journey.routes';
import { errorHandler } from '../middleware/error-handler';
import { _resetAuthStatusCacheForTests } from '../middleware/auth';

let httpServer: http.Server;
let serverUrl: string;
let app: express.Express;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/journeys', journeyRoutes);
  app.use(errorHandler);

  httpServer = http.createServer(app);
  initSocket(httpServer);

  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const { port } = httpServer.address() as AddressInfo;
  serverUrl = `http://localhost:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

beforeEach(() => {
  _resetAuthStatusCacheForTests();
  gpsPointRows.length = 0;
});

function connectAs(role: 'driver' | 'customer'): Promise<ClientSocket> {
  const userId = role === 'driver' ? driverId : customerId;
  const token = generateAccessToken({ userId, role: role.toUpperCase() });
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

function joinJourney(sock: ClientSocket, id: string): Promise<void> {
  return new Promise((resolve) => {
    sock.emit('join-journey', { journeyId: id });
    // The handler runs an async DB lookup before joining; give it a tick.
    setTimeout(resolve, 50);
  });
}

describe('driver-approach end-to-end (R3-E)', () => {
  test('3 driver emits → 3 customer events + 3 GpsPoints + sensible ETA', async () => {
    const driver = await connectAs('driver');
    const customer = await connectAs('customer');

    try {
      await joinJourney(driver, journeyId);
      await joinJourney(customer, journeyId);

      const received: any[] = [];
      customer.on('driver-location', (evt) => received.push(evt));

      // Three positions, walking the driver from ~1km out to <1km out.
      const positions = [
        { lat: -1.95, lng: 30.069, accuracy: 8 }, // ~1.0 km east
        { lat: -1.95, lng: 30.064, accuracy: 8 }, // ~440 m east
        { lat: -1.95, lng: 30.061, accuracy: 8 }, // ~110 m east
      ];

      for (const p of positions) {
        driver.emit('update-location', p);
        await new Promise((r) => setTimeout(r, 30));
      }

      // Allow broadcast & DB writes to flush.
      await new Promise((r) => setTimeout(r, 100));

      expect(received).toHaveLength(3);
      expect(received[0]).toMatchObject({ journeyId, lat: -1.95, lng: 30.069 });
      expect(received[2]).toMatchObject({ journeyId, lat: -1.95, lng: 30.061 });

      expect(gpsPointRows).toHaveLength(3);
      expect(gpsPointRows[2]).toMatchObject({ journeyId, lat: -1.95, lng: 30.061 });

      // ETA endpoint with the latest (closest) point should report < 5 min
      // and high or med confidence.
      const customerToken = generateAccessToken({ userId: customerId, role: 'CUSTOMER' });
      const res = await request(app)
        .get(`/api/journeys/${journeyId}/eta`)
        .set('Cookie', [`accessToken=${customerToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.minutes).toBeGreaterThanOrEqual(1);
      expect(res.body.minutes).toBeLessThanOrEqual(5);
      expect(['high', 'med']).toContain(res.body.confidence);
    } finally {
      driver.disconnect();
      customer.disconnect();
    }
  }, 15000);

  test('outsider sockets cannot join the journey room — broadcast not delivered to them', async () => {
    const outsiderId = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
    const outsiderToken = generateAccessToken({ userId: outsiderId, role: 'CUSTOMER' });
    const outsider: ClientSocket = await new Promise((resolve, reject) => {
      const s = ioClient(serverUrl, {
        auth: { token: outsiderToken },
        transports: ['websocket'],
        reconnection: false,
      });
      s.on('connect', () => resolve(s));
      s.on('connect_error', (err) => reject(err));
    });

    const driver = await connectAs('driver');
    try {
      await joinJourney(driver, journeyId);

      const errors: any[] = [];
      outsider.on('error', (e) => errors.push(e));

      const received: any[] = [];
      outsider.on('driver-location', (evt) => received.push(evt));

      outsider.emit('join-journey', { journeyId });
      await new Promise((r) => setTimeout(r, 80));

      driver.emit('update-location', { lat: -1.95, lng: 30.061 });
      await new Promise((r) => setTimeout(r, 100));

      expect(received).toHaveLength(0);
      expect(errors.some((e) => e?.code === 'unauthorised-journey')).toBe(true);
    } finally {
      driver.disconnect();
      outsider.disconnect();
    }
  }, 15000);
});
