import { Router, type Request, type Response } from 'express';
import * as Sentry from '@sentry/node';
import prisma from '../prisma';
import { config } from '../config';
import { getDbHealthSnapshot, withDbRetry } from '../services/db-resilience';
import { resolveBuildCommit } from '../services/build-identity';

const router = Router();

/**
 * @openapi
 * /api/health:
 *   get:
 *     summary: DB-aware health check — status, version, uptime, connection state.
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Health snapshot (status is "degraded" when the DB is unreachable).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:       { type: string, enum: [ok, degraded] }
 *                 dbConnected:  { type: boolean }
 *                 version:      { type: string }
 *                 uptime:       { type: number }
 *                 timestamp:    { type: string, format: date-time }
 *                 paymentsMode: { type: string, enum: [live, simulated] }
 *                 smsMode:      { type: string, enum: [live, simulated] }
 *                 counterBidEnabled: { type: boolean, description: "COUNTER-READY — whether the one-counter-per-bid experiment is switched on." }
 *                 db:
 *                   type: object
 *                   description: Connection history — answers "when did the database last work?" without OS logs.
 *                   properties:
 *                     lastSuccessAt:                 { type: string, format: date-time, nullable: true }
 *                     lastErrorAt:                   { type: string, format: date-time, nullable: true }
 *                     lastErrorCode:                 { type: string, nullable: true }
 *                     lastErrorMessage:              { type: string, nullable: true }
 *                     consecutiveConnectionFailures: { type: number }
 *                     unreachableSince:              { type: string, format: date-time, nullable: true }
 */
router.get('/health', async (_req: Request, res: Response) => {
  let dbConnected = false;
  try {
    // DB-RESILIENCE G2 — SELECT 1 is idempotent, so a short retry is
    // safe. Two attempts keep the probe honest through a single dead
    // socket (the pool is reset between attempts) without making the
    // health endpoint slow while the database is genuinely down.
    await withDbRetry('health-probe', () => prisma.$queryRaw`SELECT 1`, {
      maxAttempts: 2,
      baseDelayMs: 300,
    });
    dbConnected = true;
  } catch (err) {
    Sentry.captureException(err, { tags: { route: 'health' } });
  }

  // FIELD-UX G5 — BUILD_SHA → RENDER_GIT_COMMIT → git rev-parse →
  // "unknown". Still surfaced as `version`; no other field touched.
  const commit = resolveBuildCommit();

  res.json({
    status: dbConnected ? 'ok' : 'degraded',
    dbConnected,
    version: commit,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    // PREPROTO-SIM G1 — the client reads these to render the
    // "SIMULATION — no real money" banner; operators read them to
    // confirm which mode a running server is actually in.
    paymentsMode: config.PAYMENTS_MODE,
    smsMode: config.SMS_MODE,
    // COUNTER-READY G2 — the dormant switch, on the same probe.
    //
    // The client reads its run modes from here once at boot (App.tsx
    // fetchModes → simulation.store), so this is where a flag that must
    // be flippable WITHOUT a new APK belongs: the founder sets
    // COUNTER_BID_ENABLED=true on the pilot server, restarts it, and the
    // next app start finds the counter machinery awake. A Vite env would
    // have been baked into the bundle and needed a rebuild.
    //
    // Always present and always a boolean, in both arms — a client that
    // has to distinguish "off" from "this server is too old to know"
    // would be a client that guesses, and the whole posture here is that
    // a guess never enables anything.
    counterBidEnabled: config.COUNTER_BID_ENABLED,
    // DB-RESILIENCE G5 — when did the database last work, and what was
    // the last connection error? Fed by every retried operation (job
    // ticks, this probe), so a recurrence of the sleep incident is
    // answerable from here instead of macOS power logs. The existing
    // status/dbConnected fields above are unchanged by contract.
    db: getDbHealthSnapshot(),
  });
});

export default router;
