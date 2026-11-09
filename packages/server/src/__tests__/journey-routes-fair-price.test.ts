// __TESTS__/JOURNEY-ROUTES-FAIR-PRICE.TEST.TS
//
// R3-CHILD smallest-wrongness gate: ensures the route layer wires
// req.query.hasChildPassenger through to fair-price.service so the
// 1.1x premium is applied. Also verifies compositional behaviour
// across child × vehicle × urgency to catch the "incidentally
// missing R3-V/R3-T composition" case.

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    journey: { findMany: jest.fn() },
  },
}));

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import journeyRoutes from '../routes/journey.routes';
import { errorHandler } from '../middleware/error-handler';
import { generateAccessToken } from '../utils/jwt';
import prisma from '../prisma';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/journeys', journeyRoutes);
app.use(errorHandler);

const customerCookie = `accessToken=${generateAccessToken({ userId: 'c1', role: 'CUSTOMER' })}`;

const journeys = [
  { agreedPrice: 800 },
  { agreedPrice: 1000 },
  { agreedPrice: 1100 },
  { agreedPrice: 1200 },
  { agreedPrice: 1300 },
  { agreedPrice: 1400 },
  { agreedPrice: 1500 },
  { agreedPrice: 1600 },
  { agreedPrice: 1800 },
  { agreedPrice: 2500 },
];

beforeEach(() => {
  jest.clearAllMocks();
  (prisma.journey.findMany as jest.Mock).mockResolvedValue(journeys);
});

describe('GET /api/journeys/fair-price — R3-CHILD wiring', () => {
  it('R3-CHILD: applies 1.1x child-passenger premium when hasChildPassenger=true', async () => {
    const baseRes = await request(app)
      .get('/api/journeys/fair-price?distance=3.5')
      .set('Cookie', customerCookie);
    const childRes = await request(app)
      .get('/api/journeys/fair-price?distance=3.5&hasChildPassenger=true')
      .set('Cookie', customerCookie);

    expect(baseRes.status).toBe(200);
    expect(childRes.status).toBe(200);

    const base = baseRes.body.range;
    const child = childRes.body.range;
    expect(base).not.toBeNull();
    expect(child).not.toBeNull();

    // ±1 RWF tolerance for rounding.
    expect(child.min).toBeGreaterThanOrEqual(Math.round(base.min * 1.1) - 1);
    expect(child.min).toBeLessThanOrEqual(Math.round(base.min * 1.1) + 1);
    expect(child.max).toBeGreaterThanOrEqual(Math.round(base.max * 1.1) - 1);
    expect(child.max).toBeLessThanOrEqual(Math.round(base.max * 1.1) + 1);
  });

  it('R3-CHILD: composes child × vehicle × urgency multipliers (BIKE × URGENT × CHILD)', async () => {
    const baseRes = await request(app)
      .get('/api/journeys/fair-price?distance=3.5')
      .set('Cookie', customerCookie);
    const allRes = await request(app)
      .get('/api/journeys/fair-price?distance=3.5&vehicleType=BIKE&isUrgent=true&hasChildPassenger=true')
      .set('Cookie', customerCookie);

    const base = baseRes.body.range;
    const all = allRes.body.range;

    // Expected combined multiplier: 0.7 (BIKE) × 1.3 (URGENT) × 1.1 (CHILD).
    const expectedMin = Math.round(base.min * 0.7 * 1.3 * 1.1);
    const expectedMax = Math.round(base.max * 0.7 * 1.3 * 1.1);
    expect(all.min).toBeGreaterThanOrEqual(expectedMin - 1);
    expect(all.min).toBeLessThanOrEqual(expectedMin + 1);
    expect(all.max).toBeGreaterThanOrEqual(expectedMax - 1);
    expect(all.max).toBeLessThanOrEqual(expectedMax + 1);
  });

  it('hasChildPassenger=false leaves the band identical to the no-flag path', async () => {
    const noFlagRes = await request(app)
      .get('/api/journeys/fair-price?distance=3.5')
      .set('Cookie', customerCookie);
    const falseRes = await request(app)
      .get('/api/journeys/fair-price?distance=3.5&hasChildPassenger=false')
      .set('Cookie', customerCookie);

    expect(falseRes.body.range.min).toBe(noFlagRes.body.range.min);
    expect(falseRes.body.range.max).toBe(noFlagRes.body.range.max);
  });
});

// R3-DELIVERY smallest-wrongness gate (§8): asserts the route layer
// passes req.query.parcelSize through to fair-price.service so the
// parcel-size premium actually applies. Without this wiring the
// multiplier would be a dead constant and customers would see the
// same fare regardless of parcel size.
describe('GET /api/journeys/fair-price — R3-DELIVERY parcel wiring', () => {
  it('R3-DELIVERY: applies 1.25× LARGE-parcel multiplier when parcelSize=LARGE', async () => {
    const baseRes = await request(app)
      .get('/api/journeys/fair-price?distance=3.5')
      .set('Cookie', customerCookie);
    const largeRes = await request(app)
      .get('/api/journeys/fair-price?distance=3.5&parcelSize=LARGE')
      .set('Cookie', customerCookie);

    expect(baseRes.status).toBe(200);
    expect(largeRes.status).toBe(200);

    const base = baseRes.body.range;
    const large = largeRes.body.range;
    expect(base).not.toBeNull();
    expect(large).not.toBeNull();

    // ±2 RWF tolerance for rounding.
    expect(large.min).toBeGreaterThanOrEqual(Math.round(base.min * 1.25) - 2);
    expect(large.min).toBeLessThanOrEqual(Math.round(base.min * 1.25) + 2);
    expect(large.max).toBeGreaterThanOrEqual(Math.round(base.max * 1.25) - 2);
    expect(large.max).toBeLessThanOrEqual(Math.round(base.max * 1.25) + 2);
  });

  it('R3-DELIVERY: composes 4 axes (vehicle × urgency × child × parcel)', async () => {
    const baseRes = await request(app)
      .get('/api/journeys/fair-price?distance=3.5')
      .set('Cookie', customerCookie);
    const allRes = await request(app)
      .get(
        '/api/journeys/fair-price?distance=3.5&vehicleType=BIKE&isUrgent=true&hasChildPassenger=true&parcelSize=LARGE',
      )
      .set('Cookie', customerCookie);

    const base = baseRes.body.range;
    const all = allRes.body.range;

    // Expected combined multiplier: 0.7 × 1.3 × 1.1 × 1.25 ≈ 1.25.
    const expectedFactor = 0.7 * 1.3 * 1.1 * 1.25;
    const expectedMin = Math.round(base.min * expectedFactor);
    const expectedMax = Math.round(base.max * expectedFactor);
    expect(all.min).toBeGreaterThanOrEqual(expectedMin - 2);
    expect(all.min).toBeLessThanOrEqual(expectedMin + 2);
    expect(all.max).toBeGreaterThanOrEqual(expectedMax - 2);
    expect(all.max).toBeLessThanOrEqual(expectedMax + 2);
  });

  it('R3-DELIVERY: SMALL parcel does not change the band (multiplier=1.0)', async () => {
    const baseRes = await request(app)
      .get('/api/journeys/fair-price?distance=3.5')
      .set('Cookie', customerCookie);
    const smallRes = await request(app)
      .get('/api/journeys/fair-price?distance=3.5&parcelSize=SMALL')
      .set('Cookie', customerCookie);

    expect(smallRes.body.range.min).toBe(baseRes.body.range.min);
    expect(smallRes.body.range.max).toBe(baseRes.body.range.max);
  });

  it('R3-DELIVERY: invalid parcelSize value falls through as no premium', async () => {
    const baseRes = await request(app)
      .get('/api/journeys/fair-price?distance=3.5')
      .set('Cookie', customerCookie);
    const garbageRes = await request(app)
      .get('/api/journeys/fair-price?distance=3.5&parcelSize=HUGE')
      .set('Cookie', customerCookie);

    expect(garbageRes.status).toBe(200);
    expect(garbageRes.body.range.min).toBe(baseRes.body.range.min);
    expect(garbageRes.body.range.max).toBe(baseRes.body.range.max);
  });
});

// R3-PRIORITY — verify the route accepts the new `journeyType` query
// param AND keeps the legacy `isUrgent=true` boolean working as a
// backcompat shim mapping to URGENT_MESSENGER. The shim lets R3-T
// clients keep working until they migrate to the new param.
describe('GET /api/journeys/fair-price — R3-PRIORITY wiring', () => {
  it('journeyType=PRIORITY_MESSENGER applies the 1.15x multiplier', async () => {
    const baseRes = await request(app)
      .get('/api/journeys/fair-price?distance=3.5')
      .set('Cookie', customerCookie);
    const priorityRes = await request(app)
      .get('/api/journeys/fair-price?distance=3.5&journeyType=PRIORITY_MESSENGER')
      .set('Cookie', customerCookie);

    expect(priorityRes.status).toBe(200);
    const base = baseRes.body.range;
    const priority = priorityRes.body.range;
    expect(priority.min).toBeGreaterThanOrEqual(Math.round(base.min * 1.15) - 1);
    expect(priority.min).toBeLessThanOrEqual(Math.round(base.min * 1.15) + 1);
    expect(priority.max).toBeGreaterThanOrEqual(Math.round(base.max * 1.15) - 1);
    expect(priority.max).toBeLessThanOrEqual(Math.round(base.max * 1.15) + 1);
  });

  it('journeyType=URGENT_MESSENGER and isUrgent=true produce the same band (backcompat shim)', async () => {
    const newRes = await request(app)
      .get('/api/journeys/fair-price?distance=3.5&journeyType=URGENT_MESSENGER')
      .set('Cookie', customerCookie);
    const legacyRes = await request(app)
      .get('/api/journeys/fair-price?distance=3.5&isUrgent=true')
      .set('Cookie', customerCookie);

    expect(newRes.body.range.min).toBe(legacyRes.body.range.min);
    expect(newRes.body.range.max).toBe(legacyRes.body.range.max);
    expect(newRes.body.range.median).toBe(legacyRes.body.range.median);
  });

  it('invalid journeyType value falls through as no premium', async () => {
    const baseRes = await request(app)
      .get('/api/journeys/fair-price?distance=3.5')
      .set('Cookie', customerCookie);
    const garbageRes = await request(app)
      .get('/api/journeys/fair-price?distance=3.5&journeyType=SUPER_URGENT')
      .set('Cookie', customerCookie);

    expect(garbageRes.status).toBe(200);
    expect(garbageRes.body.range.min).toBe(baseRes.body.range.min);
    expect(garbageRes.body.range.max).toBe(baseRes.body.range.max);
  });

  it('journeyType param wins over isUrgent legacy when both are present', async () => {
    const baseRes = await request(app)
      .get('/api/journeys/fair-price?distance=3.5')
      .set('Cookie', customerCookie);
    const mixedRes = await request(app)
      .get('/api/journeys/fair-price?distance=3.5&journeyType=PRIORITY_MESSENGER&isUrgent=true')
      .set('Cookie', customerCookie);

    const base = baseRes.body.range;
    const mixed = mixedRes.body.range;
    // Should reflect PRIORITY's 1.15x, not URGENT's 1.3x.
    expect(mixed.min).toBeGreaterThanOrEqual(Math.round(base.min * 1.15) - 1);
    expect(mixed.min).toBeLessThanOrEqual(Math.round(base.min * 1.15) + 1);
  });
});
