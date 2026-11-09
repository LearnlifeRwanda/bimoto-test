jest.mock('../prisma', () => {
  const adminActionRows: any[] = [];
  const journeyRows = new Map<string, any>();
  const reconciliationByJourney = new Map<string, any[]>();
  const amlFlagRows = new Map<string, any>();
  const bidRows = new Map<string, any>();
  const legRows = new Map<string, any>();
  // TEAM-ANSWERS G3 — the tenth type's table. This suite counts EVERY
  // conflict type, so a new type means a new model here.
  const rideReportRows = new Map<string, any>();
  const escrowAuditRows: any[] = [];
  const tx: any = {
    rideReport: {
      findMany: jest.fn(async ({ take }: any = {}) => {
        const rows = Array.from(rideReportRows.values());
        return take ? rows.slice(0, take) : rows;
      }),
      findUnique: jest.fn(async ({ where }: any) => rideReportRows.get(where.id) ?? null),
    },
    leg: {
      findMany: jest.fn(async ({ where = {} }: any = {}) => {
        return Array.from(legRows.values()).filter((l: any) => {
          if (
            where.recipientConfirmStatus &&
            l.recipientConfirmStatus !== where.recipientConfirmStatus
          ) {
            return false;
          }
          return true;
        });
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
    journey: {
      findMany: jest.fn(async () =>
        Array.from(journeyRows.values()).map((j: any) => ({
          ...j,
          reconciliationResponses:
            reconciliationByJourney.get(j.id) ?? [],
          gpsPoints: [],
        })),
      ),
      findUnique: jest.fn(async ({ where }: any) => {
        const j = journeyRows.get(where.id);
        if (!j) return null;
        return {
          ...j,
          reconciliationResponses: reconciliationByJourney.get(j.id) ?? [],
          gpsPoints: [],
          escrow: null,
        };
      }),
    },
    bid: {
      findMany: jest.fn(async () => Array.from(bidRows.values())),
      findUnique: jest.fn(async ({ where }: any) => bidRows.get(where.id) ?? null),
    },
    amlFlag: {
      findMany: jest.fn(async ({ where = {} }: any = {}) => {
        return Array.from(amlFlagRows.values()).filter((f: any) => {
          if (where.severity && f.severity !== where.severity) return false;
          if (where.status && f.status !== where.status) return false;
          if (where.userId && f.userId !== where.userId) return false;
          if (where.NOT?.id && f.id === where.NOT.id) return false;
          if (where.user?.isFlagged !== undefined && f.user?.isFlagged !== where.user.isFlagged) {
            return false;
          }
          return true;
        });
      }),
      findUnique: jest.fn(async ({ where }: any) => amlFlagRows.get(where.id) ?? null),
      update: jest.fn(async ({ where, data }: any) => {
        const f = amlFlagRows.get(where.id);
        if (!f) return null;
        Object.assign(f, data);
        return f;
      }),
      count: jest.fn(async ({ where = {} }: any = {}) => {
        return Array.from(amlFlagRows.values()).filter((f: any) => {
          if (where.userId && f.userId !== where.userId) return false;
          if (where.severity && f.severity !== where.severity) return false;
          if (where.status && f.status !== where.status) return false;
          if (where.NOT?.id && f.id === where.NOT.id) return false;
          return true;
        }).length;
      }),
    },
    user: {
      findUnique: jest.fn(async () => ({ frozenAt: null })),
      update: jest.fn(async () => ({})),
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
      findMany: jest.fn(async ({ where = {} }: any = {}) => {
        return adminActionRows.filter((r) => {
          if (where.action && r.action !== where.action) return false;
          if (where.targetType && r.targetType !== where.targetType) return false;
          if (where.targetId?.in && !where.targetId.in.includes(r.targetId))
            return false;
          if (where.conflictType && r.conflictType !== where.conflictType) return false;
          return true;
        });
      }),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `aa-${adminActionRows.length + 1}`, ...data };
        adminActionRows.push(row);
        return row;
      }),
    },
    escrowAuditLog: {
      findFirst: jest.fn(async () =>
        escrowAuditRows.length === 0
          ? null
          : escrowAuditRows[escrowAuditRows.length - 1],
      ),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `ea-${escrowAuditRows.length + 1}`, ...data };
        escrowAuditRows.push(row);
        return row;
      }),
    },
  };
  return {
    __esModule: true,
    default: {
      ...tx,
      $transaction: jest.fn(async (fn: any) => fn(tx)),
      __rows: {
        adminActionRows,
        journeyRows,
        reconciliationByJourney,
        amlFlagRows,
        bidRows,
        legRows,
      },
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

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/admin/conflicts', adminConflictsRoutes);
app.use(errorHandler);

const adminId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const adminToken = generateAccessToken({ userId: adminId, role: 'ADMIN' });

const rows = (prisma as any).__rows as {
  adminActionRows: any[];
  journeyRows: Map<string, any>;
  reconciliationByJourney: Map<string, any[]>;
  amlFlagRows: Map<string, any>;
  bidRows: Map<string, any>;
  legRows: Map<string, any>;
};

beforeEach(() => {
  jest.clearAllMocks();
  _resetAuthStatusCacheForTests();
  rows.adminActionRows.length = 0;
  rows.journeyRows.clear();
  rows.reconciliationByJourney.clear();
  rows.amlFlagRows.clear();
  rows.bidRows.clear();
  rows.legRows.clear();
});

describe('GET /api/admin/conflicts', () => {
  test('returns counts for all 10 types', async () => {
    const res = await request(app)
      .get('/api/admin/conflicts')
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(res.status).toBe(200);
    // TEAM-ANSWERS G3 added RIDE_REPORT as the tenth type.
    expect(res.body.counts).toHaveLength(10);
    const types = res.body.counts.map((c: any) => c.type);
    expect(types).toEqual(
      expect.arrayContaining([
        'JOURNEY_RECONCILIATION',
        'AML_APPEAL',
        'BID_MANIPULATION',
        'GPS_PLAUSIBILITY',
        'STALE_DRIVER_NO_SHOW',
        'PHOTO_MISMATCH',
        'GRAPH_ANOMALY',
        'DRIVER_NO_SHOW_DISPUTE',
        'RECIPIENT_DISPUTE',
        'RIDE_REPORT',
      ]),
    );
  });
});

describe('GET /api/admin/conflicts/:type', () => {
  test('400 on invalid type', async () => {
    const res = await request(app)
      .get('/api/admin/conflicts/NOT_A_TYPE')
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(res.status).toBe(400);
  });

  test('200 with empty array on a known type', async () => {
    const res = await request(app)
      .get('/api/admin/conflicts/JOURNEY_RECONCILIATION')
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });
});

describe('POST /:type/:id/decide — AML appeal OVERTURN clears isFlagged when no other CRITICAL', () => {
  test('happy path', async () => {
    const flagId = 'flag-1';
    rows.amlFlagRows.set(flagId, {
      id: flagId,
      userId: 'u-1',
      type: 'HARD_LIMIT_EXCEEDED',
      severity: 'CRITICAL',
      status: 'OPEN',
      detectedAt: new Date(),
      user: { isFlagged: true },
    });
    const res = await request(app)
      .post(`/api/admin/conflicts/AML_APPEAL/${flagId}/decide`)
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({ decision: 'OVERTURN_FLAG', reason: 'mistaken positive — admin reviewed' });
    expect(res.status).toBe(200);
    expect(res.body.adminAction.action).toBe('RESOLVE_AML_APPEAL');
    expect(res.body.adminAction.conflictDecision).toBe('OVERTURN_FLAG');
    expect((prisma as any).user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isFlagged: false }),
      }),
    );
  });

  test('decision not valid for type → 400', async () => {
    rows.amlFlagRows.set('f2', {
      id: 'f2',
      userId: 'u-1',
      type: 'HARD_LIMIT_EXCEEDED',
      severity: 'CRITICAL',
      status: 'OPEN',
      detectedAt: new Date(),
    });
    const res = await request(app)
      .post(`/api/admin/conflicts/AML_APPEAL/f2/decide`)
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({ decision: 'RESOLVED_REFUND', reason: 'invalid combination test' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('DECISION_NOT_VALID_FOR_TYPE');
  });

  test('400 when reason too short', async () => {
    rows.amlFlagRows.set('f3', {
      id: 'f3',
      userId: 'u-1',
      type: 'HARD_LIMIT_EXCEEDED',
      severity: 'CRITICAL',
      status: 'OPEN',
      detectedAt: new Date(),
    });
    const res = await request(app)
      .post(`/api/admin/conflicts/AML_APPEAL/f3/decide`)
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({ decision: 'UPHOLD_FLAG', reason: 'no' });
    expect(res.status).toBe(400);
  });

  test('404 on missing flag id', async () => {
    const res = await request(app)
      .post(`/api/admin/conflicts/AML_APPEAL/nope/decide`)
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({ decision: 'UPHOLD_FLAG', reason: 'long enough reason here' });
    expect(res.status).toBe(404);
  });
});

describe('GET /:type/:id — validDecisions are returned alongside detail', () => {
  test('JOURNEY_RECONCILIATION returns the four reconciliation decisions', async () => {
    const journeyId = 'j-jr-1';
    rows.journeyRows.set(journeyId, {
      id: journeyId,
      pickupName: 'A',
      destinationName: 'B',
      reconciliationOpenedAt: new Date(),
      createdAt: new Date(),
    });
    const res = await request(app)
      .get(`/api/admin/conflicts/JOURNEY_RECONCILIATION/${journeyId}`)
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(res.status).toBe(200);
    expect(res.body.detail.id).toBe(journeyId);
    expect(res.body.validDecisions).toEqual([
      'RESOLVED_REFUND',
      'RESOLVED_PAY',
      'RESOLVED_SPLIT',
      'NO_ACTION',
    ]);
  });

  test('AML_APPEAL returns the three flag-decision options', async () => {
    const flagId = 'f-vd-1';
    rows.amlFlagRows.set(flagId, {
      id: flagId,
      userId: 'u-1',
      type: 'HARD_LIMIT_EXCEEDED',
      severity: 'CRITICAL',
      status: 'OPEN',
      detectedAt: new Date(),
      user: { id: 'u-1', nickname: 'alice', phone: '+250', isFlagged: true },
    });
    const res = await request(app)
      .get(`/api/admin/conflicts/AML_APPEAL/${flagId}`)
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(res.status).toBe(200);
    expect(res.body.validDecisions).toEqual([
      'UPHOLD_FLAG',
      'OVERTURN_FLAG',
      'NO_ACTION',
    ]);
  });

  test('GPS_PLAUSIBILITY returns the FORCE_COMPLETE-style decision set', async () => {
    const journeyId = 'j-gps-1';
    rows.journeyRows.set(journeyId, {
      id: journeyId,
      pickupName: 'A',
      destinationName: 'B',
      endedAt: new Date(),
      createdAt: new Date(),
    });
    const res = await request(app)
      .get(`/api/admin/conflicts/GPS_PLAUSIBILITY/${journeyId}`)
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(res.status).toBe(200);
    expect(res.body.validDecisions).toEqual([
      'FORCE_COMPLETE',
      'RESOLVED_REFUND',
      'NO_ACTION',
    ]);
  });

  test('404 on unknown id has no validDecisions field', async () => {
    const res = await request(app)
      .get('/api/admin/conflicts/JOURNEY_RECONCILIATION/does-not-exist')
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(res.status).toBe(404);
    expect(res.body.validDecisions).toBeUndefined();
  });
});

describe('GET /audit and /audit/verify', () => {
  test('GET /audit returns the AdminAction list', async () => {
    rows.adminActionRows.push({
      id: 'a1',
      action: 'FREEZE_USER',
      targetType: 'USER',
      targetId: 'u-1',
      conflictType: null,
      createdAt: new Date(),
    });
    const res = await request(app)
      .get('/api/admin/conflicts/audit')
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(res.status).toBe(200);
    expect(res.body.actions).toHaveLength(1);
  });

  test('GET /audit/verify returns valid:true on empty chain', async () => {
    const res = await request(app)
      .get('/api/admin/conflicts/audit/verify')
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
  });
});
