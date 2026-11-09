jest.mock('../prisma', () => {
  const journeyRows = new Map<string, any>();
  const gpsPointRows: any[] = [];
  return {
    __esModule: true,
    default: {
      journey: {
        findUnique: jest.fn(async ({ where }: any) => journeyRows.get(where.id) ?? null),
      },
      gpsPoint: {
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
      __rows: { journeyRows, gpsPointRows },
    },
  };
});

jest.mock('../socket', () => ({
  emitToJourney: jest.fn(),
  getIO: () => null,
}));

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import prisma from '../prisma';
import journeyRoutes from '../routes/journey.routes';
import { errorHandler } from '../middleware/error-handler';
import { generateAccessToken } from '../utils/jwt';
import { _resetAuthStatusCacheForTests } from '../middleware/auth';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/journeys', journeyRoutes);
app.use(errorHandler);

const customerId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const driverId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const outsiderId = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const journeyId = 'aaaaaaaa-1111-2222-3333-444444444444';

const customerToken = generateAccessToken({ userId: customerId, role: 'CUSTOMER' });
const outsiderToken = generateAccessToken({ userId: outsiderId, role: 'CUSTOMER' });

const rows = (prisma as any).__rows as {
  journeyRows: Map<string, any>;
  gpsPointRows: any[];
};

beforeEach(() => {
  jest.clearAllMocks();
  _resetAuthStatusCacheForTests();
  rows.journeyRows.clear();
  rows.gpsPointRows.length = 0;

  rows.journeyRows.set(journeyId, {
    id: journeyId,
    customerId,
    driverId,
    pickupLat: -1.95,
    pickupLng: 30.06,
    driver: { driverProfile: { vehicleType: 'MOTO' } },
  });
});

describe('GET /api/journeys/:id/eta', () => {
  test('403 when caller is not a party to the journey', async () => {
    const res = await request(app)
      .get(`/api/journeys/${journeyId}/eta`)
      .set('Cookie', [`accessToken=${outsiderToken}`]);
    expect(res.status).toBe(403);
  });

  test('200 with minutes:null when no GpsPoint exists', async () => {
    const res = await request(app)
      .get(`/api/journeys/${journeyId}/eta`)
      .set('Cookie', [`accessToken=${customerToken}`]);
    expect(res.status).toBe(200);
    expect(res.body.minutes).toBeNull();
    expect(res.body.confidence).toBe('unknown');
    // R3-N-3 — no GPS at all → silent.
    expect(res.body.approachStatus).toBe('silent');
    expect(res.body.distanceMeters).toBeNull();
  });

  test('returns ~2-3 min when driver is ~1km from customer pickup', async () => {
    rows.gpsPointRows.push({
      journeyId,
      lat: -1.95,
      lng: 30.069, // ~1.0 km east of pickup at this latitude
      timestamp: new Date(),
    });

    const res = await request(app)
      .get(`/api/journeys/${journeyId}/eta`)
      .set('Cookie', [`accessToken=${customerToken}`]);

    expect(res.status).toBe(200);
    expect(res.body.minutes).toBeGreaterThanOrEqual(2);
    expect(res.body.minutes).toBeLessThanOrEqual(3);
    expect(['med', 'high']).toContain(res.body.confidence);
    expect(typeof res.body.asOf).toBe('string');
    // R3-N-3 — a single recent point ~1 km from pickup is past the
    // 800m "lost-far" threshold and has no vector to inspect, so the
    // helper returns 'lost'. Both states are fine signals to the
    // customer; the cancel modal still gates on elapsed time.
    expect(res.body.approachStatus).toBe('lost');
    expect(typeof res.body.distanceMeters).toBe('number');
  });

  test('404 when journey not found', async () => {
    const res = await request(app)
      .get(`/api/journeys/${'00000000-0000-0000-0000-000000000000'}/eta`)
      .set('Cookie', [`accessToken=${customerToken}`]);
    expect(res.status).toBe(404);
  });

  // R3-V — per-vehicle-type ETA: at ~1 km the route should pick the
  // speed for the driver's actual vehicleType, not collapse to MOTO.
  describe('per-vehicle-type ETA', () => {
    function setVehicle(vehicleType: string) {
      const j = rows.journeyRows.get(journeyId)!;
      j.driver = { driverProfile: { vehicleType } };
      rows.gpsPointRows.push({
        journeyId,
        lat: -1.95,
        lng: 30.069, // ~1 km east of pickup
        timestamp: new Date(),
      });
    }

    test('BIKE driver at ~1 km gets ~5 min (12 km/h)', async () => {
      setVehicle('BIKE');
      const res = await request(app)
        .get(`/api/journeys/${journeyId}/eta`)
        .set('Cookie', [`accessToken=${customerToken}`]);
      expect(res.status).toBe(200);
      expect(res.body.minutes).toBeGreaterThanOrEqual(4);
      expect(res.body.minutes).toBeLessThanOrEqual(6);
    });

    test('E_BIKE driver at ~1 km gets ~3 min (18 km/h)', async () => {
      setVehicle('E_BIKE');
      const res = await request(app)
        .get(`/api/journeys/${journeyId}/eta`)
        .set('Cookie', [`accessToken=${customerToken}`]);
      expect(res.status).toBe(200);
      expect(res.body.minutes).toBeGreaterThanOrEqual(3);
      expect(res.body.minutes).toBeLessThanOrEqual(4);
    });

    test('E_MOTO driver at ~1 km gets ~2 min (28 km/h)', async () => {
      setVehicle('E_MOTO');
      const res = await request(app)
        .get(`/api/journeys/${journeyId}/eta`)
        .set('Cookie', [`accessToken=${customerToken}`]);
      expect(res.status).toBe(200);
      expect(res.body.minutes).toBeGreaterThanOrEqual(2);
      expect(res.body.minutes).toBeLessThanOrEqual(3);
    });

    test('CAR driver at ~1 km gets ~3 min (20 km/h)', async () => {
      setVehicle('CAR');
      const res = await request(app)
        .get(`/api/journeys/${journeyId}/eta`)
        .set('Cookie', [`accessToken=${customerToken}`]);
      expect(res.status).toBe(200);
      expect(res.body.minutes).toBeGreaterThanOrEqual(3);
      expect(res.body.minutes).toBeLessThanOrEqual(4);
    });
  });
});
