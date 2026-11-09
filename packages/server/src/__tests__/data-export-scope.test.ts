// EXPORT-AND-LEDGER G4 — what the export contains, what it must never
// contain, and the two shapes D20 ruled on by name.
//
// The absence assertions are the load-bearing half. A presence test that
// passes tells you the expansion landed; an absence test that passes is
// the only thing standing between a future "just include everything"
// refactor and an AML flag arriving in the hands of the person it is
// about. So the excluded tables are asserted BY KEY, in both directions:
// no key may appear, AND the excluded-table lists themselves are asserted
// to be the ones D20 named, so emptying a list cannot make the check
// vacuous.

jest.mock('../prisma', () => {
  const model = () => ({ findMany: jest.fn(), findUnique: jest.fn() });
  return {
    __esModule: true,
    default: {
      user: model(),
      driverProfile: model(),
      journey: model(),
      bid: model(),
      escrow: model(),
      feeWaiver: model(),
      driverPayoutBatch: model(),
      payoutPreferenceChangeLog: model(),
      rating: model(),
      message: model(),
      emergencyAlert: model(),
      rideReport: model(),
      pickupVerification: model(),
      journeyReconciliationResponse: model(),
      vehicleChangeLog: model(),
      driverAutoBidRule: model(),
      deletionRequest: model(),
    },
  };
});

jest.mock('../services/user.service', () => ({
  getMe: jest.fn(),
}));

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import userRoutes from '../routes/user.routes';
import prisma from '../prisma';
import * as userService from '../services/user.service';
import { errorHandler } from '../middleware/error-handler';
import { generateAccessToken } from '../utils/jwt';
import {
  DATA_EXPORT_NOTICE,
  DATA_EXPORT_NOTICE_KEY,
  EXPORT_EXCLUDED_INVESTIGATIVE_TABLES,
  EXPORT_EXCLUDED_NOISE_TABLES,
} from '../services/data-export.service';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/users', userRoutes);
app.use(errorHandler);

const SUBJECT = 'subject-user-id';
const OTHER = 'counterparty-user-id';
const ADMIN = 'admin-user-id';
const cookie = `accessToken=${generateAccessToken({ userId: SUBJECT, role: 'BOTH' })}`;

const p = prisma as unknown as Record<string, { findMany: jest.Mock; findUnique: jest.Mock }>;

const at = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, n));

/**
 * A subject with a row in EVERY table D20 ruled in. Deliberately built as
 * the rows a REAL query would return, i.e. already shaped by the service's
 * `select` — a fixture carrying columns the select excludes would let a
 * removed select pass unnoticed, so the stripped-column assertions below
 * plant their forbidden values through the ONE surface that can carry
 * them: the whole-row reads (journeys, escrows) and the message sender
 * lookup.
 */
function seedEverything() {
  (userService.getMe as jest.Mock).mockResolvedValue({
    id: SUBJECT,
    nickname: 'Subject',
    phone: '+250788000001',
    accountDeletion: null,
  });
  p.driverProfile.findUnique.mockResolvedValue({ userId: SUBJECT, vehicleType: 'MOTO' });
  p.journey.findMany.mockResolvedValue([
    { id: 'j1', customerId: SUBJECT, driverId: OTHER, status: 'COMPLETED' },
    { id: 'j2', customerId: OTHER, driverId: SUBJECT, status: 'COMPLETED' },
  ]);
  p.bid.findMany.mockResolvedValue([
    { id: 'b1', journeyId: 'j2', driverId: SUBJECT, price: 1200, status: 'ACCEPTED' },
  ]);
  p.escrow.findMany.mockResolvedValue([
    { id: 'e1', journeyId: 'j1', customerId: SUBJECT, driverId: OTHER, amount: 1200 },
  ]);
  p.feeWaiver.findMany.mockResolvedValue([
    { id: 'w1', driverId: SUBJECT, type: 'LIFETIME', campaign: 'pilot', reason: 'early motari' },
  ]);
  p.driverPayoutBatch.findMany.mockResolvedValue([
    { id: 'pb1', driverId: SUBJECT, amount: 9000, status: 'SUCCESS', held: false },
  ]);
  p.payoutPreferenceChangeLog.findMany.mockResolvedValue([
    { id: 'pc1', userId: SUBJECT, oldPreference: 'DAILY', newPreference: 'INSTANT' },
  ]);
  p.rating.findMany.mockImplementation(async (args: any) => {
    if (args.where.raterId === SUBJECT) {
      return [
        {
          id: 'r-given',
          journeyId: 'j1',
          ratedId: OTHER,
          stars: 5,
          comment: 'good ride',
          reason: null,
          createdAt: at(1),
        },
      ];
    }
    return [
      {
        id: 'r-received',
        journeyId: 'j2',
        stars: 2,
        comment: 'late',
        reason: 'LATE',
        createdAt: at(2),
      },
    ];
  });
  p.message.findMany.mockResolvedValue([
    {
      id: 'm1',
      journeyId: 'j1',
      senderId: SUBJECT,
      text: 'on my way',
      isQuickMessage: false,
      quickMessageId: null,
      createdAt: at(3),
    },
    {
      id: 'm2',
      journeyId: 'j1',
      senderId: OTHER,
      text: 'I am at the gate',
      isQuickMessage: true,
      quickMessageId: 'q7',
      createdAt: at(4),
    },
  ]);
  p.user.findMany.mockResolvedValue([
    { id: SUBJECT, nickname: 'Subject' },
    { id: OTHER, nickname: 'Bosco' },
  ]);
  p.emergencyAlert.findMany.mockResolvedValue([
    {
      id: 'a1',
      journeyId: 'j1',
      raisedById: SUBJECT,
      raisedByRole: 'CUSTOMER',
      pressLat: -1.95,
      pressLng: 30.06,
      status: 'RESOLVED',
      createdAt: at(5),
      resolvedAt: at(6),
    },
  ]);
  p.rideReport.findMany.mockResolvedValue([
    { id: 'rr1', journeyId: 'j2', reporterId: SUBJECT, reason: 'RUDE', details: null },
  ]);
  p.pickupVerification.findMany.mockResolvedValue([
    { id: 'pv1', journeyId: 'j1', customerId: SUBJECT, outcome: 'CONFIRMED', reason: null },
  ]);
  p.journeyReconciliationResponse.findMany.mockResolvedValue([
    { id: 'rc1', journeyId: 'j1', respondingUserId: SUBJECT, response: 'ARRIVED_SAFELY' },
  ]);
  p.vehicleChangeLog.findMany.mockResolvedValue([
    { id: 'vc1', driverId: SUBJECT, oldVehicleType: 'BIKE', newVehicleType: 'MOTO' },
  ]);
  p.driverAutoBidRule.findMany.mockResolvedValue([
    { id: 'ab1', driverId: SUBJECT, priority: 1, enabled: true },
  ]);
  p.deletionRequest.findMany.mockResolvedValue([
    { id: 'dr1', userId: SUBJECT, status: 'CANCELLED', deferredReason: null },
  ]);
}

async function fetchExport() {
  const res = await request(app).get('/api/users/me/data-export').set('Cookie', cookie);
  expect(res.status).toBe(200);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  seedEverything();
});

// ------------------------------------------------------------- presence

describe('every table D20 ruled IN reaches the file', () => {
  const EXPECTED_TABLES = [
    'profile',
    'driverProfile',
    'journeys',
    'bids',
    'escrows',
    'feeWaivers',
    'payoutBatches',
    'payoutPreferenceChanges',
    'ratings',
    'messages',
    'emergencyAlerts',
    'rideReports',
    'pickupVerifications',
    'reconciliationResponses',
    'vehicleChangeLogs',
    'autoBidRules',
    'deletionRequests',
  ];

  test.each(EXPECTED_TABLES)('%s is present and populated', async (key) => {
    const res = await fetchExport();
    expect(res.body).toHaveProperty(key);
    const value = res.body[key];
    if (Array.isArray(value)) expect(value.length).toBeGreaterThan(0);
    else expect(value).toBeTruthy();
  });

  test('the five original keys survive under their original names', async () => {
    const res = await fetchExport();
    for (const key of ['profile', 'driverProfile', 'journeys', 'ratings', 'messages']) {
      expect(res.body).toHaveProperty(key);
    }
    // ratings stayed an ARRAY. Splitting it into { given, received } would
    // have been the obvious shape and would have changed the type of an
    // existing key under any consumer reading it.
    expect(Array.isArray(res.body.ratings)).toBe(true);
  });

  test('it is still a download, not a page', async () => {
    const res = await fetchExport();
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename=bimoto-data-export.json',
    );
  });

  test('the subject own phone is included — portability is the point', async () => {
    const res = await fetchExport();
    expect(res.body.profile.phone).toBe('+250788000001');
  });
});

// ------------------------------------------------------------- absence

describe('the five investigative tables never ship, under any name', () => {
  test('the excluded list is the one D20 named — so absence is not vacuous', () => {
    expect([...EXPORT_EXCLUDED_INVESTIGATIVE_TABLES].sort()).toEqual(
      [
        'accountTombstone',
        'adminActions',
        'amlFlags',
        'driverConflictOverrides',
        'nameMismatchLogs',
      ].sort(),
    );
  });

  test.each([...EXPORT_EXCLUDED_INVESTIGATIVE_TABLES])(
    '%s is absent by key',
    async (key) => {
      const res = await fetchExport();
      expect(Object.keys(res.body)).not.toContain(key);
    },
  );

  test('no key under any casing looks like one of them', async () => {
    const res = await fetchExport();
    const keys = Object.keys(res.body).map((k) => k.toLowerCase());
    for (const forbidden of ['aml', 'adminaction', 'namemismatch', 'conflictoverride', 'tombstone']) {
      expect(keys.filter((k) => k.includes(forbidden))).toEqual([]);
    }
  });

  test('the service asks the database for none of them', async () => {
    await fetchExport();
    for (const model of [
      'amlFlag',
      'adminAction',
      'nameMismatchLog',
      'driverConflictOverride',
      'accountTombstone',
    ]) {
      expect((prisma as unknown as Record<string, unknown>)[model]).toBeUndefined();
    }
  });
});

describe('the four noise tables never ship either', () => {
  test('the noise list is the one D20 named', () => {
    expect([...EXPORT_EXCLUDED_NOISE_TABLES].sort()).toEqual(
      ['deviceTokens', 'errorReports', 'syncEvents', 'syncRejections'].sort(),
    );
  });

  test.each([...EXPORT_EXCLUDED_NOISE_TABLES])('%s is absent by key', async (key) => {
    const res = await fetchExport();
    expect(Object.keys(res.body)).not.toContain(key);
  });
});

// ------------------------------------------------------------ the notice

describe('the carve-out is stated in the file', () => {
  test('notice and noticeKey are present, and notice comes first', async () => {
    const res = await fetchExport();
    expect(res.body.notice).toBe(DATA_EXPORT_NOTICE);
    expect(res.body.noticeKey).toBe(DATA_EXPORT_NOTICE_KEY);
    expect(Object.keys(res.body)[0]).toBe('notice');
  });

  test('the sentence names the withheld categories and a route to ask', () => {
    const n = DATA_EXPORT_NOTICE.toLowerCase();
    for (const phrase of [
      'anti-money-laundering',
      'administrator actions',
      'name-mismatch',
      'conflict overrides',
      'tombstone',
    ]) {
      expect(n).toContain(phrase);
    }
    expect(n).toContain('request');
  });
});

// ------------------------------------------------------- the projections

describe('full conversations, counterparty as a nickname and nothing more', () => {
  test('both sides of the chat are present', async () => {
    const res = await fetchExport();
    expect(res.body.messages).toHaveLength(2);
    expect(res.body.messages.map((m: any) => m.direction)).toEqual(['SENT', 'RECEIVED']);
    expect(res.body.messages.map((m: any) => m.text)).toEqual([
      'on my way',
      'I am at the gate',
    ]);
  });

  test('the counterparty is a nickname — no id, no phone', async () => {
    const res = await fetchExport();
    const received = res.body.messages.find((m: any) => m.direction === 'RECEIVED');
    expect(received.senderNickname).toBe('Bosco');
    expect(received).not.toHaveProperty('senderId');
    expect(received).not.toHaveProperty('sender');
    expect(JSON.stringify(received)).not.toContain(OTHER);
    expect(JSON.stringify(received)).not.toMatch(/\+?250\d{9}/);
  });

  test('the sender lookup asks only for id and nickname', async () => {
    await fetchExport();
    const call = p.user.findMany.mock.calls[0][0];
    expect(call.select).toEqual({ id: true, nickname: true });
  });

  test('the read is scoped to journeys the subject was a party to', async () => {
    await fetchExport();
    const call = p.message.findMany.mock.calls[0][0];
    expect(call.where).toEqual({ journeyId: { in: ['j1', 'j2'] } });
    // and no longer to what the subject SENT, which was the old shape
    expect(call.where).not.toHaveProperty('senderId');
  });
});

describe('ratings: the rater is stripped from what the subject received', () => {
  test('a received rating carries no raterId, and keeps its content', async () => {
    const res = await fetchExport();
    const received = res.body.ratings.find((r: any) => r.direction === 'RECEIVED');
    expect(received).not.toHaveProperty('raterId');
    expect(received.stars).toBe(2);
    expect(received.comment).toBe('late');
    expect(received.reason).toBe('LATE');
  });

  test('a given rating keeps ratedId — the subject knows whom they rated', async () => {
    const res = await fetchExport();
    const given = res.body.ratings.find((r: any) => r.direction === 'GIVEN');
    expect(given.ratedId).toBe(OTHER);
    expect(given.stars).toBe(5);
  });

  test('the received query never selects raterId at all', async () => {
    await fetchExport();
    const receivedCall = p.rating.findMany.mock.calls.find(
      (c: any[]) => c[0].where.ratedId === SUBJECT,
    )!;
    expect(receivedCall[0].select.raterId).toBeUndefined();
    // The old shape was one whole-row findMany over an OR. Two scoped
    // queries with explicit selects is what replaced it, and that is what
    // makes the strip structural rather than a delete-after-the-fact.
    expect(p.rating.findMany).toHaveBeenCalledTimes(2);
  });
});

describe('the emergency projection is narrowed by name', () => {
  test('resolver identity and admin note are absent', async () => {
    const res = await fetchExport();
    const alert = res.body.emergencyAlerts[0];
    expect(alert).not.toHaveProperty('resolvedById');
    expect(alert).not.toHaveProperty('resolveNote');
    expect(alert).not.toHaveProperty('resolvedBy');
  });

  test('the subject still learns their alarm was closed, and when', async () => {
    const res = await fetchExport();
    const alert = res.body.emergencyAlerts[0];
    expect(alert.status).toBe('RESOLVED');
    expect(alert.resolvedAt).toBeTruthy();
    expect(alert.pressLat).toBe(-1.95);
  });

  test('the query selects neither stripped column', async () => {
    await fetchExport();
    const { select } = p.emergencyAlert.findMany.mock.calls[0][0];
    expect(select.resolvedById).toBeUndefined();
    expect(select.resolveNote).toBeUndefined();
  });
});

describe('the other stripped identities, asserted at the query', () => {
  test('a bid does not carry the cooperative leader who dispatched it', async () => {
    await fetchExport();
    const { select } = p.bid.findMany.mock.calls[0][0];
    expect(select.dispatchedByLeaderId).toBeUndefined();
  });

  test('a fee waiver does not carry the admin who granted or revoked it', async () => {
    await fetchExport();
    const { select } = p.feeWaiver.findMany.mock.calls[0][0];
    expect(select.grantedBy).toBeUndefined();
    expect(select.revokedBy).toBeUndefined();
  });

  test('a payout batch says it is HELD without saying by whom or why', async () => {
    await fetchExport();
    const { select } = p.driverPayoutBatch.findMany.mock.calls[0][0];
    expect(select.heldBy).toBeUndefined();
    expect(select.heldReason).toBeUndefined();
    expect(select.held).toBe(true);
    expect(select.heldAt).toBe(true);
  });
});

describe('every query is scoped to the subject', () => {
  test('no read is unscoped', async () => {
    await fetchExport();
    const scoped: Array<[string, jest.Mock]> = [
      ['bid', p.bid.findMany],
      ['escrow', p.escrow.findMany],
      ['feeWaiver', p.feeWaiver.findMany],
      ['driverPayoutBatch', p.driverPayoutBatch.findMany],
      ['payoutPreferenceChangeLog', p.payoutPreferenceChangeLog.findMany],
      ['emergencyAlert', p.emergencyAlert.findMany],
      ['rideReport', p.rideReport.findMany],
      ['pickupVerification', p.pickupVerification.findMany],
      ['journeyReconciliationResponse', p.journeyReconciliationResponse.findMany],
      ['vehicleChangeLog', p.vehicleChangeLog.findMany],
      ['driverAutoBidRule', p.driverAutoBidRule.findMany],
      ['deletionRequest', p.deletionRequest.findMany],
    ];
    for (const [name, mock] of scoped) {
      const where = mock.mock.calls[0][0].where;
      expect(where).toBeDefined();
      expect(JSON.stringify(where)).toContain(SUBJECT);
    }
  });

  test('nothing in the file mentions an admin who is not the subject', async () => {
    const res = await fetchExport();
    expect(JSON.stringify(res.body)).not.toContain(ADMIN);
  });
});
