// BLACKBOX G4 — the receive endpoint and the team's read-out.
//
// Verifies:
//   - a bundle from a signed-in user is stored with the reporter's role
//     and the app build the entries carry
//   - the entry-count and payload-size caps answer 413, not 500
//   - an entry is rebuilt from the KNOWN fields only: a body a hostile
//     client smuggled in is never written to the database
//   - anonymous is 401 on both surfaces; a customer is 403 on the admin
//     surface
//   - the admin list carries who/when/build/count and NOT the payload;
//     the export carries the whole bundle

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    user: {
      findUnique: jest.fn(async () => ({ frozenAt: null, role: 'CUSTOMER' })),
    },
    errorReport: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
  },
}));

jest.mock('../config', () => ({
  config: {
    DATABASE_URL: 'test',
    JWT_SECRET: 'test-jwt-secret-at-least-16-chars',
    JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-16-chars',
    ENCRYPTION_KEY: 'a'.repeat(64),
    PORT: 3000,
    CLIENT_URL: 'http://localhost:5173',
    NODE_ENV: 'test',
  },
}));

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import prisma from '../prisma';
import diagnosticsRoutes, { MAX_REPORT_ENTRIES } from '../routes/diagnostics.routes';
import adminErrorReportsRoutes from '../routes/admin-error-reports.routes';
import { errorHandler } from '../middleware/error-handler';
import { generateAccessToken } from '../utils/jwt';
import { _resetAuthStatusCacheForTests } from '../middleware/auth';

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use('/api/diagnostics', diagnosticsRoutes);
app.use('/api/admin/error-reports', adminErrorReportsRoutes);
app.use(errorHandler);

const CUSTOMER_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const customerToken = generateAccessToken({ userId: CUSTOMER_ID, role: 'CUSTOMER' });
const adminToken = generateAccessToken({
  userId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  role: 'ADMIN',
});

const createMock = (prisma as any).errorReport.create as jest.Mock;
const findManyMock = (prisma as any).errorReport.findMany as jest.Mock;
const findUniqueMock = (prisma as any).errorReport.findUnique as jest.Mock;

function entry(over: Record<string, unknown> = {}) {
  return {
    t: 1786400000000,
    build: 'abc1234',
    route: '/journey/new',
    kind: 'screen-render',
    message: 'the widget was undefined',
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  _resetAuthStatusCacheForTests();
  ((prisma as any).user.findUnique as jest.Mock).mockResolvedValue({
    frozenAt: null,
    role: 'CUSTOMER',
  });
  createMock.mockResolvedValue({ id: 'report-1', entryCount: 1 });
});

describe('POST /api/diagnostics/error-report', () => {
  test('stores the bundle with the reporter role and the reported build', async () => {
    const res = await request(app)
      .post('/api/diagnostics/error-report')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ entries: [entry(), entry({ kind: 'api-server', status: 503, message: 'HTTP 503' })] });

    expect(res.status).toBe(201);
    expect(createMock).toHaveBeenCalledTimes(1);
    const data = createMock.mock.calls[0][0].data;
    expect(data.userId).toBe(CUSTOMER_ID);
    expect(data.reporterRole).toBe('CUSTOMER');
    expect(data.appBuild).toBe('abc1234');
    expect(data.entryCount).toBe(2);
    expect(data.entries).toHaveLength(2);
  });

  test('an entry is rebuilt from known fields only — a smuggled body is never stored', async () => {
    await request(app)
      .post('/api/diagnostics/error-report')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        entries: [
          entry({
            body: { recipientPhone: '+250781234567', pickupName: 'Kimironko market' },
            headers: { authorization: 'Bearer sk-live-abcdefghijklmnopqrstuvwxyz012345' },
            responseBody: 'wishPrice=3000',
          }),
        ],
      });

    const stored = JSON.stringify(createMock.mock.calls[0][0].data.entries);
    expect(stored).not.toContain('Kimironko');
    expect(stored).not.toContain('sk-live');
    expect(stored).not.toContain('wishPrice');
    expect(stored).not.toContain('recipientPhone');
    // FLIGHT-RECORDER G4 added 'fp' to this set — the grouping key the
    // SERVER computes from the fields above. It is the only key the
    // route adds that the client did not send, and the point of this
    // assertion is unchanged: nothing a client invented gets through.
    expect(Object.keys(createMock.mock.calls[0][0].data.entries[0]).sort()).toEqual(
      ['build', 'fp', 'kind', 'message', 'route', 't'].sort(),
    );
  });

  test('over-long strings are re-truncated server-side', async () => {
    await request(app)
      .post('/api/diagnostics/error-report')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ entries: [entry({ message: 'm'.repeat(5000), stack: 's'.repeat(9000) })] });

    const [stored] = createMock.mock.calls[0][0].data.entries;
    expect(stored.message).toHaveLength(300);
    expect(stored.stack).toHaveLength(1000);
  });

  test('too many entries answers 413', async () => {
    const res = await request(app)
      .post('/api/diagnostics/error-report')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ entries: Array.from({ length: MAX_REPORT_ENTRIES + 1 }, () => entry()) });

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('REPORT_TOO_LARGE');
    expect(createMock).not.toHaveBeenCalled();
  });

  test('an oversized payload answers 413', async () => {
    const fat = entry({ stack: 'x'.repeat(60_000) });
    const res = await request(app)
      .post('/api/diagnostics/error-report')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ entries: [fat, fat] });

    expect(res.status).toBe(413);
    expect(createMock).not.toHaveBeenCalled();
  });

  test('an empty or missing entries array answers 400', async () => {
    for (const body of [{}, { entries: [] }, { entries: 'nope' }, { entries: [{ nonsense: 1 }] }]) {
      const res = await request(app)
        .post('/api/diagnostics/error-report')
        .set('Authorization', `Bearer ${customerToken}`)
        .send(body);
      expect(res.status).toBe(400);
    }
    expect(createMock).not.toHaveBeenCalled();
  });

  test('anonymous is refused', async () => {
    const res = await request(app)
      .post('/api/diagnostics/error-report')
      .send({ entries: [entry()] });
    expect(res.status).toBe(401);
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/error-reports', () => {
  test('lists who, when, which build and how many entries — without the payload', async () => {
    findManyMock.mockResolvedValue([
      {
        id: 'report-1',
        createdAt: new Date('2026-08-10T10:00:00Z'),
        appBuild: 'abc1234',
        reporterRole: 'DRIVER',
        entryCount: 3,
        user: { id: CUSTOMER_ID, nickname: 'TestDriver' },
      },
    ]);

    const res = await request(app)
      .get('/api/admin/error-reports')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.reports).toHaveLength(1);
    expect(res.body.reports[0]).toMatchObject({
      id: 'report-1',
      appBuild: 'abc1234',
      reporterRole: 'DRIVER',
      entryCount: 3,
      reporter: { nickname: 'TestDriver' },
    });
    expect(res.body.reports[0].entries).toBeUndefined();
    // The list must not carry phone numbers.
    expect(findManyMock.mock.calls[0][0].select.user.select.phone).toBeUndefined();
  });

  test('a customer cannot read the list; anonymous cannot either', async () => {
    expect(
      (await request(app).get('/api/admin/error-reports').set('Authorization', `Bearer ${customerToken}`)).status,
    ).toBe(403);
    expect((await request(app).get('/api/admin/error-reports')).status).toBe(401);
  });
});

describe('GET /api/admin/error-reports/:id/export.json', () => {
  test('exports the whole bundle as an attachment', async () => {
    findUniqueMock.mockResolvedValue({
      id: 'report-1',
      createdAt: new Date('2026-08-10T10:00:00Z'),
      appBuild: 'abc1234',
      reporterRole: 'CUSTOMER',
      entryCount: 1,
      entries: [entry()],
      user: { id: CUSTOMER_ID, nickname: 'TestCustomer' },
    });

    const res = await request(app)
      .get('/api/admin/error-reports/report-1/export.json')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('error-report-report-1.json');
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.entries[0].message).toBe('the widget was undefined');
    expect(res.body.reporter.nickname).toBe('TestCustomer');
  });

  test('an unknown bundle is a 404', async () => {
    findUniqueMock.mockResolvedValue(null);
    const res = await request(app)
      .get('/api/admin/error-reports/00000000-0000-0000-0000-000000000000/export.json')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  test('a malformed id is a 404, not a 500', async () => {
    findUniqueMock.mockRejectedValue(Object.assign(new Error('bad uuid'), { code: 'P2023' }));
    const res = await request(app)
      .get('/api/admin/error-reports/not-a-uuid/export.json')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });
});
