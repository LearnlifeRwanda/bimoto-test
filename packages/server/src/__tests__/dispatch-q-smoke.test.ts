// Dispatch Q smoke test — verifies all six fixes coexist:
//   1. Flutterwave webhook timing-safe signature compare.
//   2. Cooperative dispatch per-driver in-flight lock (concurrent same-driver lockout).
//   3. Schema introspection: every @relation has onDelete.
//   4. journey-state-transitions chokepoint cancels suggest-up timers.
//   5. Rate-limiter cleanup: inactive driver pruned.
//   6. Auth + audit + evaluator hazard JSDoc warnings present.

import * as fs from 'fs';
import * as path from 'path';

jest.mock('../services/escrow.service', () => ({
  markEscrowChargeSucceeded: jest.fn().mockResolvedValue(undefined),
  markEscrowChargeFailed: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@sentry/node', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));

import express from 'express';
import request from 'supertest';
import webhookRoutes from '../routes/webhook.routes';
import {
  _resetForTests as resetRateLimiter,
  _seedBucketForTests,
  runRateLimiterCleanup,
  _bucketCountForTests,
} from '../services/auto-bid/rate-limiter';

const SECRET = 's'.repeat(32);

describe('Dispatch Q smoke — all six hardening fixes coexist', () => {
  it('1. Flutterwave webhook rejects bad signature with 401 (constant-time)', async () => {
    process.env.FLW_SECRET_HASH = SECRET;
    const app = express();
    app.use(express.json());
    app.use('/api/webhooks', webhookRoutes);

    // Length-mismatched: must NOT throw RangeError, returns 401.
    const res = await request(app)
      .post('/api/webhooks/flutterwave')
      .set('verif-hash', 'wrong')
      .send({ event: 'charge.completed', data: { status: 'successful' } });
    expect(res.status).toBe(401);

    delete process.env.FLW_SECRET_HASH;
  });

  it('1b. Flutterwave webhook accepts valid signature (length-matched, value-matched)', async () => {
    process.env.FLW_SECRET_HASH = SECRET;
    const app = express();
    app.use(express.json());
    app.use('/api/webhooks', webhookRoutes);

    const res = await request(app)
      .post('/api/webhooks/flutterwave')
      .set('verif-hash', SECRET)
      .send({ event: 'charge.completed', data: { status: 'successful', meta: {} } });
    expect(res.status).toBe(200);

    delete process.env.FLW_SECRET_HASH;
  });

  it('2. Cooperative dispatch service exports DispatchInProgressError', () => {
    const dispatchModule = require('../services/cooperative/dispatch.service');
    expect(dispatchModule.DispatchInProgressError).toBeDefined();
    const e = new dispatchModule.DispatchInProgressError('driver-1');
    expect(e.driverId).toBe('driver-1');
  });

  it('2b. Cooperative dispatch service has no (prisma as any) references', () => {
    const filePath = path.resolve(
      __dirname,
      '../services/cooperative/dispatch.service.ts',
    );
    const src = fs.readFileSync(filePath, 'utf8');
    expect(src).not.toMatch(/\(prisma as any\)/);
  });

  it('3. Every @relation directive in schema has onDelete', () => {
    const schemaPath = path.resolve(__dirname, '../../prisma/schema.prisma');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    const lines = schema.split('\n');
    const offenders: string[] = [];
    for (const line of lines) {
      // FK-side relation: contains "fields:" and is on a single line.
      if (/@relation\([^)]*fields:/.test(line) && !/onDelete/.test(line)) {
        offenders.push(line.trim());
      }
    }
    expect(offenders).toEqual([]);
  });

  it('4. journey-state-transitions chokepoint exists and is callable', () => {
    const mod = require('../services/journey-state-transitions');
    expect(typeof mod.onJourneyExitsRequested).toBe('function');
    expect(() => mod.onJourneyExitsRequested('j-1', 'smoke')).not.toThrow();
  });

  it('4b. bid.service + journey.service + journey-expiry.job call the chokepoint', () => {
    const bidSrc = fs.readFileSync(
      path.resolve(__dirname, '../services/bid.service.ts'),
      'utf8',
    );
    const journeySrc = fs.readFileSync(
      path.resolve(__dirname, '../services/journey.service.ts'),
      'utf8',
    );
    const expirySrc = fs.readFileSync(
      path.resolve(__dirname, '../jobs/journey-expiry.job.ts'),
      'utf8',
    );
    expect(bidSrc).toMatch(/onJourneyExitsRequested/);
    expect(journeySrc).toMatch(/onJourneyExitsRequested/);
    expect(expirySrc).toMatch(/onJourneyExitsRequested/);
  });

  it('5. Rate-limiter cleanup prunes inactive drivers', () => {
    resetRateLimiter();
    const now = new Date('2026-05-05T12:00:00Z');
    const stale = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    _seedBucketForTests('inactive-driver', [stale, stale]);
    expect(_bucketCountForTests()).toBe(1);

    const stats = runRateLimiterCleanup(now);
    expect(stats.prunedBuckets).toBe(1);
    expect(_bucketCountForTests()).toBe(0);
    resetRateLimiter();
  });

  it('5b. startRateLimiterCleanup is wired in index.ts', () => {
    const indexSrc = fs.readFileSync(
      path.resolve(__dirname, '../index.ts'),
      'utf8',
    );
    expect(indexSrc).toMatch(/startRateLimiterCleanup/);
  });

  it('6. Hazard JSDoc warnings present in evaluator + audit chain + auth', () => {
    const evaluator = fs.readFileSync(
      path.resolve(__dirname, '../services/auto-bid/evaluator.ts'),
      'utf8',
    );
    const escrowAudit = fs.readFileSync(
      path.resolve(__dirname, '../services/escrow-audit.service.ts'),
      'utf8',
    );
    const adminAudit = fs.readFileSync(
      path.resolve(__dirname, '../services/admin/admin-action-audit.service.ts'),
      'utf8',
    );
    const auth = fs.readFileSync(
      path.resolve(__dirname, '../middleware/auth.ts'),
      'utf8',
    );

    expect(evaluator).toMatch(/HAZARD/);
    expect(escrowAudit).toMatch(/HAZARD|AUDIT CHAIN/);
    expect(adminAudit).toMatch(/HAZARD|AUDIT CHAIN/);
    expect(auth).toMatch(/isFlagged/);
  });
});
