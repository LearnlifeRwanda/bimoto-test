jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    syncEvent: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    user: { findUnique: jest.fn().mockResolvedValue({ frozenAt: null }) },
  },
}));

jest.mock('@sentry/node', () => ({
  captureException: jest.fn(),
}));

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import prisma from '../prisma';
import syncRoutes from '../routes/sync.routes';
import { errorHandler } from '../middleware/error-handler';
import { generateAccessToken } from '../utils/jwt';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api', syncRoutes);
app.use(errorHandler);

const userId = '11111111-1111-1111-1111-111111111111';
const journeyId = 'aaaaaaaa-1111-2222-3333-444444444444';
const token = generateAccessToken({ userId, role: 'CUSTOMER' });

const findUnique = (prisma as any).syncEvent.findUnique as jest.Mock;
const create = (prisma as any).syncEvent.create as jest.Mock;

const baseEvent = (clientEventId: string) => ({
  clientEventId,
  journeyId,
  eventType: 'JOURNEY_CREATED',
  payload: { pickupName: 'Nyabugogo' },
  clientTimestamp: '2026-03-17T10:00:00Z',
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST /api/sync/events — rejection roundtrip (R3-F)', () => {
  test('FK violation surfaces as code: FK_VIOLATION', async () => {
    findUnique.mockResolvedValue(null);
    create.mockRejectedValue(
      Object.assign(new Error('Foreign key constraint failed on the field: `journeyId`'), {
        code: 'P2003',
        meta: { field_name: 'journeyId' },
      }),
    );

    const res = await request(app)
      .post('/api/sync/events')
      .set('Cookie', [`accessToken=${token}`])
      .send({ events: [baseEvent('evt-fk')] });

    expect(res.status).toBe(200);
    expect(res.body.processed).toEqual([]);
    expect(res.body.rejected).toHaveLength(1);
    expect(res.body.rejected[0]).toMatchObject({
      clientEventId: 'evt-fk',
      code: 'FK_VIOLATION',
    });
  });

  test('repeat clientEventId already in DB lands in processed[] (idempotency)', async () => {
    findUnique.mockResolvedValue({ id: 'existing-row', clientEventId: 'evt-dup' });

    const res = await request(app)
      .post('/api/sync/events')
      .set('Cookie', [`accessToken=${token}`])
      .send({ events: [baseEvent('evt-dup')] });

    expect(res.status).toBe(200);
    expect(res.body.processed).toEqual(['evt-dup']);
    expect(res.body.rejected).toEqual([]);
    expect(create).not.toHaveBeenCalled();
  });

  test('race-condition P2002 on create surfaces as DUPLICATE_EVENT_ID', async () => {
    // findUnique returns null (not yet committed in our snapshot), but the
    // subsequent create races against another worker and hits the unique
    // index. We expect the rejection taxonomy to capture this cleanly.
    findUnique.mockResolvedValue(null);
    create.mockRejectedValue(
      Object.assign(new Error('Unique constraint failed on the fields: (`clientEventId`)'), {
        code: 'P2002',
        meta: { target: ['clientEventId'] },
      }),
    );

    const res = await request(app)
      .post('/api/sync/events')
      .set('Cookie', [`accessToken=${token}`])
      .send({ events: [baseEvent('evt-race')] });

    expect(res.status).toBe(200);
    expect(res.body.rejected).toHaveLength(1);
    expect(res.body.rejected[0].code).toBe('DUPLICATE_EVENT_ID');
  });

  test('well-formed event lands in processed[]', async () => {
    findUnique.mockResolvedValue(null);
    create.mockResolvedValue({ id: 'new-row' });

    const res = await request(app)
      .post('/api/sync/events')
      .set('Cookie', [`accessToken=${token}`])
      .send({ events: [baseEvent('evt-ok')] });

    expect(res.status).toBe(200);
    expect(res.body.processed).toEqual(['evt-ok']);
    expect(res.body.rejected).toEqual([]);
  });

  test('mixed batch: one accepted, one FK_VIOLATION', async () => {
    findUnique.mockResolvedValue(null);
    create
      .mockResolvedValueOnce({ id: 'new-row' })
      .mockRejectedValueOnce(
        Object.assign(new Error('FK'), { code: 'P2003', meta: { field_name: 'journeyId' } }),
      );

    const res = await request(app)
      .post('/api/sync/events')
      .set('Cookie', [`accessToken=${token}`])
      .send({
        events: [
          { ...baseEvent('evt-ok'), clientTimestamp: '2026-03-17T10:00:00Z' },
          { ...baseEvent('evt-fk'), clientTimestamp: '2026-03-17T10:01:00Z' },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.processed).toEqual(['evt-ok']);
    expect(res.body.rejected).toHaveLength(1);
    expect(res.body.rejected[0]).toMatchObject({
      clientEventId: 'evt-fk',
      code: 'FK_VIOLATION',
    });
  });
});
