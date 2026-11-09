// FLIGHT-RECORDER G4 — the fingerprint, the grouping and the firehose.
//
// Verifies:
//   - the server computes each entry's fingerprint itself and stores the
//     bundle's own; a fingerprint the client sent is never persisted,
//     and an old APK that sends none still gets one
//   - the grouped read-out counts an exact key, splits by build and
//     role, and names reports that predate the column 'unfingerprinted'
//     rather than guessing
//   - export.jsonl is one JSON object per line, filterable, streamed in
//     pages, and says so when it truncates
//   - both new surfaces are admin-only

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
      groupBy: jest.fn(),
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
import { errorFingerprint } from '@bimoto/shared';
import prisma from '../prisma';
import diagnosticsRoutes from '../routes/diagnostics.routes';
import adminErrorReportsRoutes, {
  EXPORT_MAX_ROWS,
  UNFINGERPRINTED,
  parseFilters,
} from '../routes/admin-error-reports.routes';
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
const groupByMock = (prisma as any).errorReport.groupBy as jest.Mock;

function entry(over: Record<string, unknown> = {}): Record<string, unknown> {
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
  // mockClear leaves queued mockResolvedValueOnce implementations
  // behind, and the export route stops paging as soon as a short page
  // arrives — so an unconsumed queue would leak into the next test.
  findManyMock.mockReset();
  groupByMock.mockReset();
  createMock.mockReset();
  _resetAuthStatusCacheForTests();
  ((prisma as any).user.findUnique as jest.Mock).mockResolvedValue({
    frozenAt: null,
    role: 'CUSTOMER',
  });
  createMock.mockResolvedValue({ id: 'report-1', entryCount: 1 });
});

describe('the server computes the fingerprint, it does not accept one', () => {
  test('every stored entry gains the fingerprint this server computed', async () => {
    const e = entry({ stack: 'at doThing (https://app/assets/index-aaaaaaaa.js:10:5)' });
    await request(app)
      .post('/api/diagnostics/error-report')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ entries: [e] })
      .expect(201);

    const stored = createMock.mock.calls[0][0].data;
    expect(stored.entries[0].fp).toBe(
      errorFingerprint({
        kind: e.kind as string,
        message: e.message as string,
        stack: e.stack as string,
      }),
    );
  });

  test('a fingerprint the client sent is discarded, not trusted', async () => {
    await request(app)
      .post('/api/diagnostics/error-report')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ entries: [entry({ fp: 'deadbeef-a-lie' })] })
      .expect(201);

    const stored = createMock.mock.calls[0][0].data;
    expect(stored.entries[0].fp).not.toBe('deadbeef-a-lie');
    expect(stored.entries[0].fp).toBe(
      errorFingerprint({ kind: 'screen-render', message: 'the widget was undefined' }),
    );
  });

  test('an old APK that sends no fingerprint still gets one — same grouping', async () => {
    // Byte-for-byte the payload the pre-FLIGHT-RECORDER client sent.
    await request(app)
      .post('/api/diagnostics/error-report')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ entries: [entry()] })
      .expect(201);

    const stored = createMock.mock.calls[0][0].data;
    expect(stored.fingerprint).toBe(
      errorFingerprint({ kind: 'screen-render', message: 'the widget was undefined' }),
    );
  });

  test("the bundle's fingerprint is its newest entry's — the one the user noticed", async () => {
    await request(app)
      .post('/api/diagnostics/error-report')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ entries: [entry({ message: 'newest fault' }), entry({ message: 'older fault' })] })
      .expect(201);

    const stored = createMock.mock.calls[0][0].data;
    expect(stored.fingerprint).toBe(
      errorFingerprint({ kind: 'screen-render', message: 'newest fault' }),
    );
  });

  test('a collapsed-duplicate count survives, bounded', async () => {
    await request(app)
      .post('/api/diagnostics/error-report')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ entries: [entry({ dup: 40 }), entry({ message: 'other', dup: 10 ** 9 })] })
      .expect(201);

    const stored = createMock.mock.calls[0][0].data;
    expect(stored.entries[0].dup).toBe(40);
    expect(stored.entries[1].dup).toBe(10_000);
  });

  test('a dup of 1 is not stored at all — absent means one', async () => {
    await request(app)
      .post('/api/diagnostics/error-report')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ entries: [entry({ dup: 1 })] })
      .expect(201);
    expect(createMock.mock.calls[0][0].data.entries[0].dup).toBeUndefined();
  });
});

describe('GET /api/admin/error-reports/groups', () => {
  const FP = 'a1b2c3d4';

  beforeEach(() => {
    groupByMock
      .mockResolvedValueOnce([
        {
          fingerprint: FP,
          _count: { _all: 3 },
          _sum: { entryCount: 12 },
          _max: { createdAt: new Date('2026-08-16T10:00:00Z') },
        },
        {
          fingerprint: null,
          _count: { _all: 1 },
          _sum: { entryCount: 2 },
          _max: { createdAt: new Date('2026-08-01T10:00:00Z') },
        },
      ])
      .mockResolvedValueOnce([
        { fingerprint: FP, appBuild: 'abc1234', reporterRole: 'DRIVER', _count: { _all: 2 } },
        { fingerprint: FP, appBuild: 'def5678', reporterRole: 'CUSTOMER', _count: { _all: 1 } },
        { fingerprint: null, appBuild: 'old0001', reporterRole: 'CUSTOMER', _count: { _all: 1 } },
      ]);
    findManyMock.mockResolvedValue([
      { fingerprint: FP, entries: [{ message: 'the widget was undefined' }] },
    ]);
  });

  test('counts reports and entries per fingerprint, largest first', async () => {
    const res = await request(app)
      .get('/api/admin/error-reports/groups')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.groups).toHaveLength(2);
    expect(res.body.groups[0]).toMatchObject({
      fingerprint: FP,
      reports: 3,
      entries: 12,
      sample: 'the widget was undefined',
    });
  });

  test('splits each group by build and by role', async () => {
    const res = await request(app)
      .get('/api/admin/error-reports/groups')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.body.groups[0].builds).toEqual([
      { build: 'abc1234', count: 2 },
      { build: 'def5678', count: 1 },
    ]);
    expect(res.body.groups[0].roles).toEqual([
      { role: 'DRIVER', count: 2 },
      { role: 'CUSTOMER', count: 1 },
    ]);
  });

  test('reports that predate the column are named, not guessed at', async () => {
    const res = await request(app)
      .get('/api/admin/error-reports/groups')
      .set('Authorization', `Bearer ${adminToken}`);

    const old = res.body.groups.find((g: any) => g.fingerprint === UNFINGERPRINTED);
    expect(old).toBeDefined();
    expect(old.reports).toBe(1);
    expect(old.sample).toBeNull();
  });

  test('a customer is 403 and anonymous is 401', async () => {
    expect(
      (
        await request(app)
          .get('/api/admin/error-reports/groups')
          .set('Authorization', `Bearer ${customerToken}`)
      ).status,
    ).toBe(403);
    expect((await request(app).get('/api/admin/error-reports/groups')).status).toBe(401);
  });
});

describe('GET /api/admin/error-reports/export.jsonl', () => {
  function row(i: number) {
    return {
      id: `report-${i}`,
      createdAt: new Date('2026-08-16T10:00:00Z'),
      appBuild: 'abc1234',
      reporterRole: 'DRIVER',
      entryCount: 1,
      fingerprint: 'a1b2c3d4',
      entries: [entry()],
      user: { id: CUSTOMER_ID, nickname: 'TestDriver' },
    };
  }

  test('streams one JSON object per line, with the whole bundle on it', async () => {
    // One short page: the route stops as soon as a page is under the
    // page size, so there is no second call to queue for.
    findManyMock.mockResolvedValueOnce([row(1), row(2)]);

    const res = await request(app)
      .get('/api/admin/error-reports/export.jsonl')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/x-ndjson');
    expect(res.headers['content-disposition']).toContain('error-reports.jsonl');

    const lines = res.text.trim().split('\n');
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]);
    expect(first.id).toBe('report-1');
    expect(first.entries[0].message).toBe('the widget was undefined');
    expect(first.reporter.nickname).toBe('TestDriver');
  });

  test('a newline inside a message is escaped, so a line break is always a record break', async () => {
    findManyMock.mockResolvedValueOnce([
      { ...row(1), entries: [entry({ message: 'line one\nline two\nline three' })] },
    ]);

    const res = await request(app)
      .get('/api/admin/error-reports/export.jsonl')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.text.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(res.text.trim()).entries[0].message).toBe('line one\nline two\nline three');
  });

  test('a report with no fingerprint exports under the named bucket', async () => {
    findManyMock.mockResolvedValueOnce([{ ...row(1), fingerprint: null }]);

    const res = await request(app)
      .get('/api/admin/error-reports/export.jsonl')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(JSON.parse(res.text.trim()).fingerprint).toBe(UNFINGERPRINTED);
  });

  test('filters reach the query — since, build, role, fingerprint', async () => {
    findManyMock.mockResolvedValueOnce([]);

    await request(app)
      .get(
        '/api/admin/error-reports/export.jsonl?since=2026-08-01T00:00:00Z&build=abc1234&role=DRIVER&fingerprint=a1b2c3d4',
      )
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(findManyMock.mock.calls[0][0].where).toEqual({
      createdAt: { gte: new Date('2026-08-01T00:00:00Z') },
      appBuild: 'abc1234',
      reporterRole: 'DRIVER',
      fingerprint: 'a1b2c3d4',
    });
  });

  test("filtering on 'unfingerprinted' selects exactly the reports with none", async () => {
    findManyMock.mockResolvedValueOnce([]);
    await request(app)
      .get(`/api/admin/error-reports/export.jsonl?fingerprint=${UNFINGERPRINTED}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(findManyMock.mock.calls[0][0].where).toEqual({ fingerprint: null });
  });

  test('an unparseable since is ignored rather than answered with an empty file', async () => {
    findManyMock.mockResolvedValueOnce([]);
    await request(app)
      .get('/api/admin/error-reports/export.jsonl?since=last%20tuesday')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(findManyMock.mock.calls[0][0].where).toEqual({});
  });

  test('it pages rather than loading the table, and follows a cursor', async () => {
    findManyMock
      .mockResolvedValueOnce(Array.from({ length: 200 }, (_, i) => row(i)))
      .mockResolvedValueOnce([row(999)]);

    const res = await request(app)
      .get('/api/admin/error-reports/export.jsonl')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.text.trim().split('\n')).toHaveLength(201);
    expect(findManyMock).toHaveBeenCalledTimes(2);
    expect(findManyMock.mock.calls[1][0].cursor).toEqual({ id: 'report-199' });
    expect(findManyMock.mock.calls[1][0].skip).toBe(1);
  });

  test('a truncated export says so on its last line', async () => {
    const full = Array.from({ length: 200 }, (_, i) => row(i));
    findManyMock.mockResolvedValue(full);

    const res = await request(app)
      .get('/api/admin/error-reports/export.jsonl')
      .set('Authorization', `Bearer ${adminToken}`);

    const lines = res.text.trim().split('\n');
    expect(lines).toHaveLength(EXPORT_MAX_ROWS + 1);
    expect(JSON.parse(lines[lines.length - 1])).toEqual({
      truncated: true,
      rows: EXPORT_MAX_ROWS,
      limit: EXPORT_MAX_ROWS,
    });
  });

  test('a customer is 403 and anonymous is 401', async () => {
    expect(
      (
        await request(app)
          .get('/api/admin/error-reports/export.jsonl')
          .set('Authorization', `Bearer ${customerToken}`)
      ).status,
    ).toBe(403);
    expect((await request(app).get('/api/admin/error-reports/export.jsonl')).status).toBe(401);
  });
});

describe('parseFilters', () => {
  test('ignores a role that is not a real role', () => {
    expect(parseFilters({ role: 'SUPERUSER' })).toEqual({});
  });

  test('accepts the real ones', () => {
    expect(parseFilters({ role: 'DRIVER' })).toEqual({ role: 'DRIVER' });
  });

  test('caps a long build or fingerprint rather than passing it through', () => {
    const long = 'x'.repeat(500);
    const parsed = parseFilters({ build: long, fingerprint: long });
    expect(parsed.build).toHaveLength(64);
    expect(parsed.fingerprint).toHaveLength(64);
  });
});
