// R3-CONFLICTS-RECIPIENT-DISPUTE — integration tests for the parameterized
// admin-conflicts routes against the new RECIPIENT_DISPUTE type. Verifies:
//   1. GET /api/admin/conflicts/RECIPIENT_DISPUTE lists DISPUTED legs
//   2. GET /api/admin/conflicts/RECIPIENT_DISPUTE/:id returns detail / 404
//   3. POST /api/admin/conflicts/RECIPIENT_DISPUTE/:id/decide creates an
//      AdminAction WITHOUT mutating Leg.recipientConfirmStatus
//   4. Hash-chain integrity is preserved across the new admin action (the
//      load-bearing constraint — decide() must go through
//      admin-action-audit.service, not raw prisma.adminAction.create).

jest.mock('../prisma', () => {
  const adminActionRows: any[] = [];
  const legRows = new Map<string, any>();
  const journeyRows = new Map<string, any>();
  const escrowRows = new Map<string, any>(); // keyed by journeyId
  const escrowAuditRows: any[] = [];

  const tx: any = {
    leg: {
      findMany: jest.fn(async ({ where = {}, take }: any = {}) => {
        const rows = Array.from(legRows.values()).filter((l: any) => {
          if (
            where.recipientConfirmStatus &&
            l.recipientConfirmStatus !== where.recipientConfirmStatus
          )
            return false;
          return true;
        });
        return take ? rows.slice(0, take) : rows;
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        const l = legRows.get(where.id);
        if (!l) return null;
        const journey = l.journeyId ? journeyRows.get(l.journeyId) : null;
        return {
          ...l,
          journey: journey
            ? {
                ...journey,
                customer: journey.customer ?? null,
                driver: journey.driver ?? null,
              }
            : null,
        };
      }),
    },
    adminAction: {
      findFirst: jest.fn(async ({ where }: any = {}) => {
        // BID-ATOMICITY G4 — honor the where filter: the single-winner
        // claim looks up (action, targetType, targetId); the hash-chain
        // append passes no where and still gets the latest row.
        const matching = adminActionRows.filter((r) => {
          if (!where) return true;
          if (where.action && r.action !== where.action) return false;
          if (where.targetType && r.targetType !== where.targetType) return false;
          if (where.targetId && r.targetId !== where.targetId) return false;
          return true;
        });
        return matching.length === 0 ? null : matching[matching.length - 1];
      }),
      findMany: jest.fn(async ({ where = {}, orderBy: _ob }: any = {}) => {
        const rows = adminActionRows.filter((r) => {
          if (where.action && r.action !== where.action) return false;
          if (where.targetType && r.targetType !== where.targetType)
            return false;
          if (where.targetId?.in && !where.targetId.in.includes(r.targetId))
            return false;
          if (
            typeof where.targetId === 'string' &&
            r.targetId !== where.targetId
          )
            return false;
          if (where.conflictType && r.conflictType !== where.conflictType)
            return false;
          return true;
        });
        return rows;
      }),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `aa-${adminActionRows.length + 1}`, ...data };
        adminActionRows.push(row);
        return row;
      }),
    },
    escrow: {
      findUnique: jest.fn(async ({ where }: any) => escrowRows.get(where.journeyId) ?? null),
      update: jest.fn(async ({ where, data }: any) => {
        const updated = { ...escrowRows.get(where.journeyId), ...data };
        escrowRows.set(where.journeyId, updated);
        return updated;
      }),
      // G2 single-winner claim: honors the status predicate like Postgres.
      updateMany: jest.fn(async ({ where, data }: any) => {
        const row = escrowRows.get(where.journeyId);
        if (!row || (where.status !== undefined && row.status !== where.status)) {
          return { count: 0 };
        }
        escrowRows.set(where.journeyId, { ...row, ...data });
        return { count: 1 };
      }),
    },
    escrowAuditLog: {
      findFirst: jest.fn(async () =>
        escrowAuditRows.length === 0 ? null : escrowAuditRows[escrowAuditRows.length - 1],
      ),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `ea-${escrowAuditRows.length + 1}`, ...data };
        escrowAuditRows.push(row);
        return row;
      }),
    },
    driverProfile: { update: jest.fn(async () => ({})) },
    user: { update: jest.fn(async () => ({})) },
    driverBalance: { upsert: jest.fn(async () => ({})) },
  };

  return {
    __esModule: true,
    default: {
      ...tx,
      $transaction: jest.fn(async (fn: any) => fn(tx)),
      __rows: { adminActionRows, legRows, journeyRows, escrowRows },
    },
  };
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

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/admin/conflicts', adminConflictsRoutes);
app.use(errorHandler);

const adminId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const adminToken = generateAccessToken({ userId: adminId, role: 'ADMIN' });

const customerId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const customerToken = generateAccessToken({
  userId: customerId,
  role: 'CUSTOMER',
});

const rows = (prisma as any).__rows as {
  adminActionRows: any[];
  legRows: Map<string, any>;
  journeyRows: Map<string, any>;
  escrowRows: Map<string, any>;
};

function seedDisputedLeg(
  id: string,
  overrides: Partial<any> = {},
): { legId: string; journeyId: string } {
  const journeyId = overrides.journeyId ?? `journey-${id}`;
  rows.journeyRows.set(journeyId, {
    id: journeyId,
    type: 'GOODS_DELIVERY',
    agreedPrice: 5000,
    status: 'COMPLETED',
    createdAt: new Date('2026-05-11T07:00:00Z'),
    customer: { id: customerId, nickname: 'Eric' },
    driver: { id: 'drv-1', nickname: 'Bosco' },
  });
  // PR #94 freezes the escrow on dispute-SMS arrival; the conflict is
  // surfaced to admins with a FROZEN escrow (the state decide() now settles).
  rows.escrowRows.set(journeyId, {
    id: `esc-${id}`,
    journeyId,
    status: 'FROZEN',
    amount: 5000,
    driverId: 'drv-1',
    driverPayout: 4000,
    customerId,
  });
  rows.legRows.set(id, {
    id,
    journeyId,
    sequence: 2,
    type: 'GOODS_DROPOFF',
    contactName: 'Aline',
    contactPhone: '+250788111222',
    parcelSize: 'SMALL',
    parcelCategory: 'OTHER',
    recipientConfirmStatus: 'DISPUTED',
    recipientConfirmedAt: new Date('2026-05-11T10:00:00Z'),
    recipientDisputeReason: 'WRONG ITEM',
    completedAt: new Date('2026-05-11T09:30:00Z'),
    createdAt: new Date('2026-05-11T08:00:00Z'),
    updatedAt: new Date('2026-05-11T10:00:00Z'),
    ...overrides,
  });
  return { legId: id, journeyId };
}

beforeEach(() => {
  jest.clearAllMocks();
  _resetAuthStatusCacheForTests();
  rows.adminActionRows.length = 0;
  rows.legRows.clear();
  rows.journeyRows.clear();
  rows.escrowRows.clear();
});

describe('GET /api/admin/conflicts/RECIPIENT_DISPUTE', () => {
  test('lists DISPUTED legs', async () => {
    seedDisputedLeg('leg-1');
    seedDisputedLeg('leg-2');
    rows.legRows.set('leg-3', {
      id: 'leg-3',
      journeyId: 'journey-leg-3',
      sequence: 2,
      recipientConfirmStatus: 'EXPLICIT_REPLY',
      recipientConfirmedAt: new Date(),
      recipientDisputeReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await request(app)
      .get('/api/admin/conflicts/RECIPIENT_DISPUTE')
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items.map((i: any) => i.id).sort()).toEqual([
      'leg-1',
      'leg-2',
    ]);
    expect(res.body.items[0].type).toBe('RECIPIENT_DISPUTE');
  });

  test('returns empty list when no disputed legs', async () => {
    const res = await request(app)
      .get('/api/admin/conflicts/RECIPIENT_DISPUTE')
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });

  test('403 for non-admin user', async () => {
    const res = await request(app)
      .get('/api/admin/conflicts/RECIPIENT_DISPUTE')
      .set('Cookie', [`accessToken=${customerToken}`]);
    expect(res.status).toBe(403);
  });
});

describe('GET /api/admin/conflicts/RECIPIENT_DISPUTE/:id', () => {
  test('returns detail + validDecisions for a disputed leg', async () => {
    seedDisputedLeg('leg-1');

    const res = await request(app)
      .get('/api/admin/conflicts/RECIPIENT_DISPUTE/leg-1')
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(res.status).toBe(200);
    expect(res.body.detail.id).toBe('leg-1');
    expect(res.body.detail.type).toBe('RECIPIENT_DISPUTE');
    expect(res.body.detail.data.leg.recipientDisputeReason).toBe('WRONG ITEM');
    expect(res.body.detail.data.customer.nickname).toBe('Eric');
    expect(res.body.detail.data.driver.nickname).toBe('Bosco');
    expect(res.body.validDecisions).toEqual([
      'RESOLVED_REFUND',
      'RESOLVED_PAY',
      'RESOLVED_SPLIT',
      'NO_ACTION',
    ]);
  });

  test('404 for non-existent leg', async () => {
    const res = await request(app)
      .get('/api/admin/conflicts/RECIPIENT_DISPUTE/does-not-exist')
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(res.status).toBe(404);
  });

  test('404 for a non-disputed leg', async () => {
    rows.legRows.set('leg-confirmed', {
      id: 'leg-confirmed',
      journeyId: 'j-x',
      sequence: 1,
      recipientConfirmStatus: 'EXPLICIT_REPLY',
      recipientConfirmedAt: new Date(),
      recipientDisputeReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    rows.journeyRows.set('j-x', {
      id: 'j-x',
      customer: null,
      driver: null,
    });

    const res = await request(app)
      .get('/api/admin/conflicts/RECIPIENT_DISPUTE/leg-confirmed')
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/admin/conflicts/RECIPIENT_DISPUTE/:id/decide', () => {
  test('records AdminAction with conflictType + decision + reason', async () => {
    seedDisputedLeg('leg-1');

    const res = await request(app)
      .post('/api/admin/conflicts/RECIPIENT_DISPUTE/leg-1/decide')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({
        decision: 'RESOLVED_REFUND',
        reason: 'Wrong parcel verified by sender; customer refunded.',
      });
    expect(res.status).toBe(200);
    expect(res.body.adminAction.action).toBe('RESOLVE_RECIPIENT_DISPUTE');
    expect(res.body.adminAction.conflictType).toBe('RECIPIENT_DISPUTE');
    expect(res.body.adminAction.conflictDecision).toBe('RESOLVED_REFUND');
    expect(res.body.adminAction.targetType).toBe('LEG');
    expect(res.body.adminAction.targetId).toBe('leg-1');
    expect(rows.adminActionRows).toHaveLength(1);
  });

  test('does NOT mutate Leg.recipientConfirmStatus (dispute preserved)', async () => {
    seedDisputedLeg('leg-1');

    await request(app)
      .post('/api/admin/conflicts/RECIPIENT_DISPUTE/leg-1/decide')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({
        decision: 'RESOLVED_PAY',
        reason: 'Driver delivered correctly; recipient complaint dismissed.',
      });

    expect(rows.legRows.get('leg-1').recipientConfirmStatus).toBe('DISPUTED');
  });

  test('preserves hash-chain integrity across the new admin action', async () => {
    seedDisputedLeg('leg-1');
    seedDisputedLeg('leg-2');

    // Land two RECIPIENT_DISPUTE decisions sequentially.
    await request(app)
      .post('/api/admin/conflicts/RECIPIENT_DISPUTE/leg-1/decide')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({
        decision: 'RESOLVED_REFUND',
        reason: 'first dispute resolved with refund',
      });
    await request(app)
      .post('/api/admin/conflicts/RECIPIENT_DISPUTE/leg-2/decide')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({
        decision: 'RESOLVED_PAY',
        reason: 'second dispute dismissed; driver paid in full',
      });

    expect(rows.adminActionRows).toHaveLength(2);
    expect(rows.adminActionRows[0].prevHash).toBe('');
    expect(rows.adminActionRows[1].prevHash).toBe(
      rows.adminActionRows[0].entryHash,
    );

    // The audit-chain verifier scans every AdminAction row and re-computes
    // each entry's hash. If decide() bypassed appendAdminActionTx with a
    // raw prisma.adminAction.create, valid would be false here.
    const verifyResult = await verifyAdminActionChain();
    expect(verifyResult.valid).toBe(true);
    expect(verifyResult.brokenAt).toBeNull();
    expect(verifyResult.entries).toBe(2);
  });

  test('400 for invalid ConflictDecision value', async () => {
    seedDisputedLeg('leg-1');
    const res = await request(app)
      .post('/api/admin/conflicts/RECIPIENT_DISPUTE/leg-1/decide')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({ decision: 'NOT_A_DECISION', reason: 'long enough reason here' });
    expect(res.status).toBe(400);
  });

  test('400 for decision not valid for RECIPIENT_DISPUTE', async () => {
    seedDisputedLeg('leg-1');
    // OVERTURN_FLAG is a valid ConflictDecision but not in the recipient
    // dispute module's validDecisions allowlist.
    const res = await request(app)
      .post('/api/admin/conflicts/RECIPIENT_DISPUTE/leg-1/decide')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({
        decision: 'OVERTURN_FLAG',
        reason: 'wrong decision type for recipient dispute',
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('DECISION_NOT_VALID_FOR_TYPE');
  });

  test('400 when reason is too short', async () => {
    seedDisputedLeg('leg-1');
    const res = await request(app)
      .post('/api/admin/conflicts/RECIPIENT_DISPUTE/leg-1/decide')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({ decision: 'RESOLVED_REFUND', reason: 'no' });
    expect(res.status).toBe(400);
  });

  test('404 when leg does not exist', async () => {
    const res = await request(app)
      .post('/api/admin/conflicts/RECIPIENT_DISPUTE/missing-leg/decide')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({
        decision: 'NO_ACTION',
        reason: 'should 404 — no such leg in the system',
      });
    expect(res.status).toBe(404);
  });

  test('404 when leg exists but is not in DISPUTED state', async () => {
    rows.legRows.set('leg-confirmed', {
      id: 'leg-confirmed',
      journeyId: 'j-y',
      sequence: 1,
      recipientConfirmStatus: 'EXPLICIT_REPLY',
      recipientConfirmedAt: new Date(),
      recipientDisputeReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    rows.journeyRows.set('j-y', { id: 'j-y', customer: null, driver: null });

    const res = await request(app)
      .post('/api/admin/conflicts/RECIPIENT_DISPUTE/leg-confirmed/decide')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({
        decision: 'NO_ACTION',
        reason: 'this leg is not actually disputed; should 404',
      });
    expect(res.status).toBe(404);
  });

  test('403 for non-admin user', async () => {
    seedDisputedLeg('leg-1');
    const res = await request(app)
      .post('/api/admin/conflicts/RECIPIENT_DISPUTE/leg-1/decide')
      .set('Cookie', [`accessToken=${customerToken}`])
      .send({ decision: 'RESOLVED_REFUND', reason: 'customers can not decide' });
    expect(res.status).toBe(403);
  });
});
