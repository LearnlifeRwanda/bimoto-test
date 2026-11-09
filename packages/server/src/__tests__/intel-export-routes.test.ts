jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    mobilityAggregate: { findMany: jest.fn() },
    user: { findUnique: jest.fn(async () => ({ frozenAt: null })) },
  },
}));

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import prisma from '../prisma';
import intelRoutes, { csvCell, csvLine, CSV_HEADER } from '../routes/intel.routes';
import { errorHandler } from '../middleware/error-handler';
import { generateAccessToken } from '../utils/jwt';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/intel', intelRoutes);
app.use(errorHandler);

const analystToken = generateAccessToken({ userId: 'analyst-1', role: 'ANALYST' });
const adminToken = generateAccessToken({ userId: 'admin-1', role: 'ADMIN' });
const customerToken = generateAccessToken({ userId: 'cust-1', role: 'CUSTOMER' });
const repo = (prisma as any).mobilityAggregate;

const RANGE = { tier: 'DENSE', dateFrom: '2026-05-01', dateTo: '2026-05-02' };

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'row-1',
    tier: 'DENSE',
    aggregateType: 'POINT_DENSITY',
    cellId: 'cell-abc',
    cellCenterLat: -1.9441,
    cellCenterLng: 30.0619,
    bucketStart: new Date('2026-05-01T08:00:00Z'),
    bucketEnd: new Date('2026-05-01T08:30:00Z'),
    count: 24,
    attributesJson: { vehicleTypes: { MOTO: 23, E_BIKE: 1 }, hourBuckets: { 8: 24 } },
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  repo.findMany.mockResolvedValue([]);
});

describe('GET /api/intel/aggregates/export — who may ask', () => {
  test('an ANALYST may export', async () => {
    repo.findMany.mockResolvedValueOnce([row()]).mockResolvedValue([]);
    const res = await request(app)
      .get('/api/intel/aggregates/export')
      .set('Cookie', [`accessToken=${analystToken}`])
      .query(RANGE);
    expect(res.status).toBe(200);
  });

  test('an ADMIN may export', async () => {
    const res = await request(app)
      .get('/api/intel/aggregates/export')
      .set('Cookie', [`accessToken=${adminToken}`])
      .query(RANGE);
    expect(res.status).toBe(200);
  });

  test('a CUSTOMER is refused', async () => {
    const res = await request(app)
      .get('/api/intel/aggregates/export')
      .set('Cookie', [`accessToken=${customerToken}`])
      .query(RANGE);
    expect(res.status).toBe(403);
  });

  test('an anonymous caller is refused', async () => {
    const res = await request(app).get('/api/intel/aggregates/export').query(RANGE);
    expect(res.status).toBe(401);
  });
});

describe('GET /api/intel/aggregates/export — the grain gate runs here too', () => {
  test('CSV: a legacy singleton marginal never reaches the file', async () => {
    repo.findMany.mockResolvedValueOnce([row()]).mockResolvedValue([]);
    const res = await request(app)
      .get('/api/intel/aggregates/export')
      .set('Cookie', [`accessToken=${analystToken}`])
      .query(RANGE);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).not.toContain('E_BIKE');
    expect(res.text).toContain('"{""vehicleTypes"":{""other"":24}');
    const lines = res.text.trim().split('\n');
    expect(lines[0]).toBe(CSV_HEADER);
    expect(lines).toHaveLength(2);
  });

  test('JSONL: the same row, the same suppression, one object per line', async () => {
    repo.findMany.mockResolvedValueOnce([row(), row({ id: 'row-2', count: 31 })]).mockResolvedValue([]);
    const res = await request(app)
      .get('/api/intel/aggregates/export')
      .set('Cookie', [`accessToken=${analystToken}`])
      .query({ ...RANGE, format: 'jsonl' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/x-ndjson');
    const lines = res.text.trim().split('\n');
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]);
    expect(first.attributes.vehicleTypes).toEqual({ other: 24 });
    expect(first.count).toBe(24);
    expect(JSON.stringify(first)).not.toContain('E_BIKE');
  });

  test('a row with no attributes exports as empty / null, not as {}', async () => {
    repo.findMany.mockResolvedValueOnce([row({ attributesJson: null })]).mockResolvedValue([]);
    const csv = await request(app)
      .get('/api/intel/aggregates/export')
      .set('Cookie', [`accessToken=${analystToken}`])
      .query(RANGE);
    expect(csv.text.trim().split('\n')[1].endsWith(',')).toBe(true);

    repo.findMany.mockReset();
    repo.findMany.mockResolvedValueOnce([row({ attributesJson: null })]).mockResolvedValue([]);
    const jsonl = await request(app)
      .get('/api/intel/aggregates/export')
      .set('Cookie', [`accessToken=${analystToken}`])
      .query({ ...RANGE, format: 'jsonl' });
    expect(JSON.parse(jsonl.text.trim()).attributes).toBeNull();
  });
});

describe('GET /api/intel/aggregates/export — filters and refusals', () => {
  test('it exports the view it was asked for, not an adjacent one', async () => {
    repo.findMany.mockResolvedValue([]);
    await request(app)
      .get('/api/intel/aggregates/export')
      .set('Cookie', [`accessToken=${analystToken}`])
      .query({ tier: 'MEDIUM', aggregateType: 'OD_MATRIX', dateFrom: '2026-05-01', dateTo: '2026-05-08' });
    expect(repo.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tier: 'MEDIUM', aggregateType: 'OD_MATRIX' }),
      }),
    );
  });

  test('an unknown tier, aggregate type or format is a 400', async () => {
    const cases = [
      { ...RANGE, tier: 'BOGUS' },
      { ...RANGE, aggregateType: 'BOGUS' },
      { ...RANGE, format: 'xlsx' },
    ];
    for (const query of cases) {
      const res = await request(app)
        .get('/api/intel/aggregates/export')
        .set('Cookie', [`accessToken=${analystToken}`])
        .query(query);
      expect(res.status).toBe(400);
    }
  });

  test('the 90-day cap applies to the export as it does to the reads', async () => {
    const res = await request(app)
      .get('/api/intel/aggregates/export')
      .set('Cookie', [`accessToken=${analystToken}`])
      .query({ tier: 'DENSE', dateFrom: '2026-01-01', dateTo: '2026-05-01' });
    expect(res.status).toBe(400);
    expect(repo.findMany).not.toHaveBeenCalled();
  });

  test('an inverted range is a 400', async () => {
    const res = await request(app)
      .get('/api/intel/aggregates/export')
      .set('Cookie', [`accessToken=${analystToken}`])
      .query({ tier: 'DENSE', dateFrom: '2026-05-02', dateTo: '2026-05-01' });
    expect(res.status).toBe(400);
  });

  test('it pages rather than loading the month into one array', async () => {
    const page = Array.from({ length: 500 }, (_, i) => row({ id: `row-${i}` }));
    repo.findMany.mockResolvedValueOnce(page).mockResolvedValueOnce([row({ id: 'row-500' })]);
    const res = await request(app)
      .get('/api/intel/aggregates/export')
      .set('Cookie', [`accessToken=${analystToken}`])
      .query({ ...RANGE, format: 'jsonl' });
    expect(res.text.trim().split('\n')).toHaveLength(501);
    expect(repo.findMany).toHaveBeenCalledTimes(2);
    expect(repo.findMany.mock.calls[1][0]).toEqual(
      expect.objectContaining({ cursor: { id: 'row-499' }, skip: 1 }),
    );
  });

  test('an empty view is a header and nothing else', async () => {
    const res = await request(app)
      .get('/api/intel/aggregates/export')
      .set('Cookie', [`accessToken=${analystToken}`])
      .query(RANGE);
    expect(res.text).toBe(`${CSV_HEADER}\n`);
  });
});

describe('CSV quoting', () => {
  test('values containing a comma, a quote or a newline are quoted', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(new Date('2026-05-01T08:00:00Z'))).toBe('2026-05-01T08:00:00.000Z');
  });

  test('a line has exactly as many columns as the header', () => {
    const line = csvLine(row() as any, { vehicleTypes: { other: 24 } });
    // Count top-level commas — the attributes column is quoted, so its
    // internal commas do not split the row.
    let depth = 0;
    let columns = 1;
    for (const ch of line) {
      if (ch === '"') depth = depth === 0 ? 1 : 0;
      else if (ch === ',' && depth === 0) columns += 1;
    }
    expect(columns).toBe(CSV_HEADER.split(',').length);
  });
});
