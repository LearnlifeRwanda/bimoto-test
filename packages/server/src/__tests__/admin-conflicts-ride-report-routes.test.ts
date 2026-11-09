// TEAM-ANSWERS G3 — the report reaches the admin through the SAME
// machinery every other conflict type uses, and its decision joins the
// SAME hash chain (the #61 invariant).
//
// End to end: a driver's report appears under RIDE_REPORT, opens as a
// detail with its rider and the other open reports about that rider,
// decides through appendAdminActionTx, drops off the open list once
// decided, and refuses a second admin racing the first.
//
// The load-bearing assertion is verifyAdminActionChain() after the
// decide: decide() must go through admin-action-audit.service, never
// raw prisma.adminAction.create.

jest.mock('../prisma', () => {
  const adminActionRows: any[] = [];
  const rideReportRows = new Map<string, any>();
  const journeyRows = new Map<string, any>();

  const tx: any = {
    rideReport: {
      findMany: jest.fn(async ({ where = {}, take }: any = {}) => {
        let rows = Array.from(rideReportRows.values());
        if (where.id?.not) rows = rows.filter((r) => r.id !== where.id.not);
        if (where.journey?.customerId) {
          rows = rows.filter(
            (r) => journeyRows.get(r.journeyId)?.customerId === where.journey.customerId,
          );
        }
        return take ? rows.slice(0, take) : rows;
      }),
      findUnique: jest.fn(async ({ where, include }: any) => {
        const r = rideReportRows.get(where.id);
        if (!r) return null;
        if (!include) return r;
        const journey = journeyRows.get(r.journeyId) ?? null;
        return { ...r, journey };
      }),
    },
    adminAction: {
      findFirst: jest.fn(async ({ where }: any = {}) => {
        const matching = adminActionRows.filter((r) => {
          if (!where) return true;
          if (where.action && r.action !== where.action) return false;
          if (where.targetType && r.targetType !== where.targetType) return false;
          if (where.targetId && r.targetId !== where.targetId) return false;
          return true;
        });
        return matching.length === 0 ? null : matching[matching.length - 1];
      }),
      findMany: jest.fn(async ({ where = {} }: any = {}) =>
        adminActionRows.filter((r) => {
          if (where.action && r.action !== where.action) return false;
          if (where.targetType && r.targetType !== where.targetType) return false;
          if (where.targetId?.in && !where.targetId.in.includes(r.targetId)) return false;
          if (typeof where.targetId === 'string' && r.targetId !== where.targetId) return false;
          if (where.conflictType && r.conflictType !== where.conflictType) return false;
          return true;
        }),
      ),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `aa-${adminActionRows.length + 1}`, ...data };
        adminActionRows.push(row);
        return row;
      }),
    },
  };

  const client: any = {
    ...tx,
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  client.__rows = { adminActionRows, rideReportRows, journeyRows };
  return { __esModule: true, default: client };
});

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import prisma from '../prisma';
import adminConflictsRoutes from '../routes/admin-conflicts.routes';
import { errorHandler } from '../middleware/error-handler';
import { generateAccessToken } from '../utils/jwt';
import { _resetAuthStatusCacheForTests } from '../middleware/auth';
import { verifyAdminActionChain } from '../services/admin/admin-action-audit.service';
import {
  ALL_CONFLICT_TYPES,
  conflictModuleByType,
} from '../services/admin/conflict-resolver';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/admin/conflicts', adminConflictsRoutes);
app.use(errorHandler);

const adminId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const adminToken = generateAccessToken({ userId: adminId, role: 'ADMIN' });
const driverToken = generateAccessToken({ userId: 'drv-1', role: 'DRIVER' });

const rows = (prisma as any).__rows as {
  adminActionRows: any[];
  rideReportRows: Map<string, any>;
  journeyRows: Map<string, any>;
};

function seedReport(id: string, opts: { riderId?: string; reason?: string } = {}) {
  const journeyId = `journey-${id}`;
  rows.journeyRows.set(journeyId, {
    id: journeyId,
    type: 'PASSENGER',
    status: 'COMPLETED',
    agreedPrice: 2000,
    pickupName: 'Nyabugogo',
    destinationName: 'Kimironko',
    customerId: opts.riderId ?? 'rider-1',
    customer: { id: opts.riderId ?? 'rider-1', nickname: 'Eric' },
    driver: { id: 'drv-1', nickname: 'Bosco' },
    createdAt: new Date('2026-08-18T07:00:00Z'),
    endedAt: new Date('2026-08-18T07:30:00Z'),
  });
  rows.rideReportRows.set(id, {
    id,
    journeyId,
    reporterId: 'drv-1',
    reason: opts.reason ?? 'NO_SHOW_OR_LATE',
    details: 'waited twenty minutes at the stage',
    createdAt: new Date('2026-08-18T07:35:00Z'),
  });
  return { reportId: id, journeyId };
}

beforeEach(() => {
  jest.clearAllMocks();
  _resetAuthStatusCacheForTests();
  rows.adminActionRows.length = 0;
  rows.rideReportRows.clear();
  rows.journeyRows.clear();
});

describe('RIDE_REPORT is a first-class conflict type', () => {
  test('it is in the registry the dashboard iterates, as the tenth type', async () => {
    // The dashboard's own GET /api/admin/conflicts counts EVERY type, so
    // exercising it here would need all ten modules' tables mocked. What
    // matters for this type is that it is in the list that route walks,
    // and that its countOpen answers.
    expect(ALL_CONFLICT_TYPES).toContain('RIDE_REPORT');
    expect(ALL_CONFLICT_TYPES).toHaveLength(10);
    expect(conflictModuleByType.RIDE_REPORT.type).toBe('RIDE_REPORT');

    seedReport('rr-1');
    expect(await conflictModuleByType.RIDE_REPORT.countOpen(prisma as any)).toBe(1);
  });

  test('lists open reports and offers exactly the two valid decisions', async () => {
    seedReport('rr-1');
    seedReport('rr-2');

    const list = await request(app)
      .get('/api/admin/conflicts/RIDE_REPORT')
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(list.status).toBe(200);
    expect(list.body.items.map((i: any) => i.id).sort()).toEqual(['rr-1', 'rr-2']);
    expect(list.body.items[0].type).toBe('RIDE_REPORT');

    const detail = await request(app)
      .get('/api/admin/conflicts/RIDE_REPORT/rr-1')
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(detail.status).toBe(200);
    expect(detail.body.validDecisions).toEqual(['NO_ACTION', 'UPHOLD_FLAG']);
  });

  test('the detail shows who was reported, through the journey — and no score', async () => {
    seedReport('rr-1');

    const res = await request(app)
      .get('/api/admin/conflicts/RIDE_REPORT/rr-1')
      .set('Cookie', [`accessToken=${adminToken}`]);

    expect(res.body.detail.data.reportedRider).toEqual({ id: 'rider-1', nickname: 'Eric' });
    expect(res.body.detail.data.report.reason).toBe('NO_SHOW_OR_LATE');
    // Pattern visibility, not a number: nothing in the payload is a
    // count, an average or a score for that rider.
    const payload = JSON.stringify(res.body.detail.data);
    expect(payload).not.toMatch(/"(stars|score|avgRating|reportCount|rating)"/);
  });

  test('the pattern view is a list of other incidents, read live', async () => {
    seedReport('rr-1', { riderId: 'rider-1' });
    seedReport('rr-2', { riderId: 'rider-1', reason: 'RUDE_BEHAVIOUR' });
    seedReport('rr-3', { riderId: 'rider-9' });

    const res = await request(app)
      .get('/api/admin/conflicts/RIDE_REPORT/rr-1')
      .set('Cookie', [`accessToken=${adminToken}`]);

    expect(res.body.detail.data.otherReportsForRider.map((r: any) => r.id)).toEqual(['rr-2']);
  });

  test('404 for an unknown report id', async () => {
    const res = await request(app)
      .get('/api/admin/conflicts/RIDE_REPORT/nope')
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(res.status).toBe(404);
  });

  test('403 for a non-admin', async () => {
    const res = await request(app)
      .get('/api/admin/conflicts/RIDE_REPORT')
      .set('Cookie', [`accessToken=${driverToken}`]);
    expect(res.status).toBe(403);
  });
});

describe('POST /api/admin/conflicts/RIDE_REPORT/:id/decide', () => {
  test('UPHOLD_FLAG chains through appendAdminActionTx and leaves the report untouched', async () => {
    seedReport('rr-1');
    const before = { ...rows.rideReportRows.get('rr-1') };

    const res = await request(app)
      .post('/api/admin/conflicts/RIDE_REPORT/rr-1/decide')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({ decision: 'UPHOLD_FLAG', reason: 'pattern confirmed across three rides' });

    expect(res.status).toBe(200);
    expect(rows.adminActionRows).toHaveLength(1);
    expect(rows.adminActionRows[0]).toEqual(
      expect.objectContaining({
        action: 'RESOLVE_RIDE_REPORT',
        targetType: 'RIDE_REPORT',
        targetId: 'rr-1',
        conflictType: 'RIDE_REPORT',
        conflictDecision: 'UPHOLD_FLAG',
      }),
    );
    // The #61 invariant: the entry is a link in the hash chain.
    expect(rows.adminActionRows[0].entryHash).toBeTruthy();
    const verified = await verifyAdminActionChain();
    expect(verified.valid).toBe(true);

    // The report row is immutable historical state.
    expect(rows.rideReportRows.get('rr-1')).toEqual(before);
  });

  test('NO_ACTION also chains, and the report leaves the open list', async () => {
    seedReport('rr-1');

    const res = await request(app)
      .post('/api/admin/conflicts/RIDE_REPORT/rr-1/decide')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({ decision: 'NO_ACTION', reason: 'duplicate of rr-0' });
    expect(res.status).toBe(200);

    const list = await request(app)
      .get('/api/admin/conflicts/RIDE_REPORT')
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(list.body.items).toEqual([]);
  });

  test('a money decision is refused — a report is not a dispute', async () => {
    seedReport('rr-1');

    const res = await request(app)
      .post('/api/admin/conflicts/RIDE_REPORT/rr-1/decide')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({ decision: 'RESOLVED_REFUND', reason: 'money must not ride on this' });

    expect(res.status).toBe(400);
    expect(rows.adminActionRows).toHaveLength(0);
  });

  test('a second admin racing the first gets ALREADY_DECIDED', async () => {
    seedReport('rr-1');

    await request(app)
      .post('/api/admin/conflicts/RIDE_REPORT/rr-1/decide')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({ decision: 'NO_ACTION', reason: 'read it, nothing to act on' });

    const second = await request(app)
      .post('/api/admin/conflicts/RIDE_REPORT/rr-1/decide')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({ decision: 'UPHOLD_FLAG', reason: 'a second admin, moments later' });

    expect(second.status).toBe(409);
    expect(rows.adminActionRows).toHaveLength(1);
  });
});
