// MUST be the first import: Sentry v8's OpenTelemetry-based
// auto-instrumentation only attaches to modules loaded after init.
// See packages/server/src/instrument.ts for the init body.
import './instrument';
import express from 'express';
import http from 'http';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import morgan from 'morgan';
import * as Sentry from '@sentry/node';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './swagger';
import { config } from './config';
import {
  assertFakePaymentsSafety,
  assertSimulationModeSafety,
  assertSmsCommandTierSafety,
  assertSmsTransportSafety,
} from './startup-guard';
import { errorHandler } from './middleware/error-handler';
import { corsOriginCheck, parseTrustProxy } from './middleware/cors-policy';
import { appVersionMiddleware } from './middleware/app-version';
import { initSocket } from './socket';
import healthRoutes from './routes/health.routes';
import authRoutes from './routes/auth.routes';
import userRoutes from './routes/user.routes';
import journeyRoutes from './routes/journey.routes';
import bidRoutes from './routes/bid.routes';
import messageRoutes from './routes/message.routes';
import syncRoutes from './routes/sync.routes';
import pushRoutes from './routes/push.routes';
import adminPushRoutes from './routes/admin-push.routes';
import uploadRoutes from './routes/upload.routes';
import documentRoutes from './routes/document.routes';
import ratingRoutes from './routes/rating.routes';
import pickupVerificationRoutes from './routes/pickup-verification.routes';
import adminRoutes from './routes/admin.routes';
import adminAmlRoutes from './routes/admin-aml.routes';
import adminBnrRoutes from './routes/admin-bnr.routes';
import webhookRoutes from './routes/webhook.routes';
import paymentRoutes from './routes/payment.routes';
import payoutRoutes from './routes/payout.routes';
import scheduledRideRoutes from './routes/scheduled-ride.routes';
import smsInboundRoutes from './routes/sms-inbound.routes';
import adminSmsInboundRoutes from './routes/admin-sms-inbound.routes';
import adminFreezeRoutes from './routes/admin-freeze.routes';
import adminConflictsRoutes from './routes/admin-conflicts.routes';
import adminMobilityRoutes from './routes/admin-mobility.routes';
import intelRoutes from './routes/intel.routes';
import adminFunnelRoutes from './routes/admin-funnel.routes';
import adminPayoutsRoutes from './routes/admin-payouts.routes';
import adminFeeWaiverRoutes from './routes/admin-fee-waiver.routes';
import adminPickupVerificationRoutes from './routes/admin-pickup-verification.routes';
import driverAutoBidRoutes from './routes/driver-auto-bid.routes';
import driverStatsRoutes from './routes/driver-stats.routes';
import bidHistoryRoutes from './routes/bid-history.routes';
import cooperativeLeaderRoutes from './routes/cooperative-leader.routes';
import driverScreenerRoutes from './routes/driver-screener.routes';
import geocodeRoutes from './routes/geocode.routes';
import mapRoutes from './routes/map.routes';
import driverIdRoutes from './routes/driver-id.routes';
import simRoutes from './routes/sim.routes';
import diagnosticsRoutes from './routes/diagnostics.routes';
import adminErrorReportsRoutes from './routes/admin-error-reports.routes';
import adminEmergencyRoutes from './routes/admin-emergency.routes';
import prisma from './prisma';
import { createShutdownHandler } from './shutdown';
import { startBidExpiryJob, stopBidExpiryJob } from './jobs/bid-expiry.job';
import { startAutoConfirmJob, stopAutoConfirmJob } from './jobs/auto-confirm.job';
import {
  startAutoConfirmRecipientJob,
  stopAutoConfirmRecipientJob,
} from './jobs/auto-confirm-recipient.job';
import { startNoShowTimeoutJob, stopNoShowTimeoutJob } from './jobs/no-show-timeout.job';
import { startJourneyExpiryJob, stopJourneyExpiryJob } from './jobs/journey-expiry.job';
import { startReconciliationJob, stopReconciliationJob } from './jobs/reconciliation.job';
import {
  startPaymentReconciliationJob,
  stopPaymentReconciliationJob,
} from './jobs/payment-reconciliation.job';
import {
  startUnpaidMatchReaperJob,
  stopUnpaidMatchReaperJob,
} from './jobs/unpaid-match-reaper.job';
import { startPayoutJob, stopPayoutJob } from './jobs/payout.job';
import { startTwiceDailyPayoutJob, stopTwiceDailyPayoutJob } from './jobs/twice-daily-payout.job';
import { startPayoutFallbackJob, stopPayoutFallbackJob } from './jobs/payout-fallback.job';
import {
  startPayoutReconciliationJob,
  stopPayoutReconciliationJob,
} from './jobs/payout-reconciliation.job';
import {
  startPreferenceChangePayoutJob,
  stopPreferenceChangePayoutJob,
} from './jobs/preference-change-payout.job';
import { startBidWindowOpenerJob, stopBidWindowOpenerJob } from './jobs/bid-window-opener.job';
import { startAutoFallbackPickJob, stopAutoFallbackPickJob } from './jobs/auto-fallback-pick.job';
import {
  startScheduledRideReminderJob,
  stopScheduledRideReminderJob,
} from './jobs/scheduled-ride-reminder.job';
import { startAmlDetectionJob, stopAmlDetectionJob } from './jobs/aml-detection.job';
import { startGraphDetectionJob, stopGraphDetectionJob } from './jobs/graph-detection.job';
import { startBnrMonthlyJob, stopBnrMonthlyJob } from './jobs/bnr-monthly.job';
import {
  startMobilityAggregationJob,
  stopMobilityAggregationJob,
} from './jobs/mobility-aggregation.job';
import {
  startGpsRetentionJob,
  stopGpsRetentionJob,
} from './jobs/gps-retention.job';
// SOS-FOLLOW G3 — the 60-minute valve. An emergency alert grants the
// live follow; this is what makes sure the grant always ends, including
// on the nights nobody is watching the panel.
import {
  startEmergencyExpiryJob,
  stopEmergencyExpiryJob,
} from './jobs/emergency-expiry.job';
// ACCOUNT-RIGHTS-CORE G4 — the 72-hour deletion hold's other end. Sweeps
// the requests whose window has closed and erases them, unless a blocking
// state (live ride, live escrow, open emergency, freeze, unpaid balance)
// defers the row to a later tick.
import {
  startDeletionExecutionJob,
  stopDeletionExecutionJob,
} from './jobs/deletion-execution.job';
import {
  startRateLimiterCleanup,
  stopRateLimiterCleanup,
} from './services/auto-bid/rate-limiter';

// PREPROTO-SIM G1 — abort (never warn) when simulated and real money
// could be confused: simulated payments alongside real gateway keys, or
// a simulated mode in production without the deliberate override.
try {
  assertSimulationModeSafety(config);
  // GROUNDSKEEPER G2 — and a live SMS transport must actually be able to
  // send, rather than logging OTPs to stdout and claiming success.
  assertSmsTransportSafety(config);
  // SENDER-MATCH-2 — and the full SMS command set must never point at real
  // money: money actions on caller-ID authentication need a design, not a
  // flag flip.
  assertSmsCommandTierSafety(config);
  // PILOT-GUARD Item 4 — and the E2E payments hatch must never open onto
  // real money: a synthetic SUCCESS against a live gateway reports fares
  // held that were never charged.
  assertFakePaymentsSafety(config);
} catch (err) {
  console.error(`[STARTUP] ${(err as Error).message}`);
  process.exit(1);
}

const app = express();
const server = http.createServer(app);

// PREPROTO-AUTH G5 — behind Cloudflare Tunnel/reverse proxy req.ip is
// the proxy's address unless the hop is trusted, which would collapse
// all IP-keyed rate limits onto a single bucket. TRUST_PROXY=true
// trusts exactly one hop (see parseTrustProxy — never express's
// trust-everything mode).
app.set('trust proxy', parseTrustProxy(config.TRUST_PROXY));

// Sentry init runs in ./instrument (imported above). v8's
// OpenTelemetry integrations auto-install Express + HTTP request
// instrumentation, so no explicit `app.use(...)` is needed here.

// Security headers. PREPROTO-AUTH G5 — strict CSP: no plugins, no
// framing, no injected <base>/form targets; anything the app doesn't
// need is closed off so injected markup has nowhere to go.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https://tile.openstreetmap.org"],
      connectSrc: ["'self'", "ws:", "wss:"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// Request logging
if (config.NODE_ENV !== 'test') {
  app.use(morgan('combined'));
}

// PREPROTO-AUTH G5 — explicit allow-list from CORS_ORIGINS (falls back
// to CLIENT_URL). Unlisted browser origins get a hard 403; the origin
// header is never reflected.
app.use(cors({ origin: corsOriginCheck, credentials: true }));
app.use(express.json());
app.use(cookieParser());
// CUTGUARD v2 G6 — `req.appVersion` on every request, before any router.
// Absent or unparseable reads as 0 (legacy), which is the safe direction:
// a caller that says nothing is served exactly the pre-window behaviour.
app.use(appVersionMiddleware);
// DOC-GUARD G2 — uploaded documents are no longer public.
//
// This was `app.use('/uploads', express.static('uploads'))`: every
// driving licence, RURA authorisation, insurance certificate and parcel
// photograph served to anyone who could name the URL, with no
// middleware in front of it. One authenticated endpoint replaces it.
// Documents stored before this dispatch are reached through the same
// endpoint with an encoded key (see utils/document-store.ts), so the
// old shape can never be read more loosely than the new one — and
// nothing answers on /uploads at all any more.
app.use('/api/documents', documentRoutes);

// Health check (DB-aware; reports version + uptime + connection status).
app.use('/api', healthRoutes);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/journeys', journeyRoutes);
app.use('/api/journeys', bidRoutes);
app.use('/api/journeys', messageRoutes);
app.use('/api/journeys', uploadRoutes);
app.use('/api/journeys', ratingRoutes);
// PILOT-INSTRUMENT — pickup-identity verification capture (evidence
// for the V-4 trigger; read-only signal, no punitive side effects).
app.use('/api/journeys', pickupVerificationRoutes);
app.use('/api', syncRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/admin/push', adminPushRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin/aml-flags', adminAmlRoutes);
app.use('/api/admin/bnr-reports', adminBnrRoutes);
app.use('/api/admin/sms-inbound', adminSmsInboundRoutes);
app.use('/api/admin/freeze', adminFreezeRoutes);
app.use('/api/admin/conflicts', adminConflictsRoutes);
app.use('/api/admin/mobility', adminMobilityRoutes);
// INTEL-DECK G5 — the ANALYST-readable export surface. Separate mount
// from /api/admin/* because the reader is not an administrator.
app.use('/api/intel', intelRoutes);
app.use('/api/admin/funnel', adminFunnelRoutes);
app.use('/api/admin/payouts', adminPayoutsRoutes);
app.use('/api/admin/fee-waivers', adminFeeWaiverRoutes);
app.use('/api/admin/pickup-verifications', adminPickupVerificationRoutes);
// BLACKBOX G4 — user-sent error reports: the phone posts here only on an
// explicit tap on Send report, and the team reads and exports them under
// /api/admin/error-reports.
app.use('/api/diagnostics', diagnosticsRoutes);
app.use('/api/admin/error-reports', adminErrorReportsRoutes);
// SOS-FOLLOW G3/G5 — the ops emergency surface: the ACTIVE list ops
// follows, the Resolve that ends an alert, and the history of both.
// Router-level adminOnly, so an ANALYST is refused here exactly as
// everywhere else (analyst-access-matrix.test.ts).
app.use('/api/admin/emergency', adminEmergencyRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/payout', payoutRoutes);
app.use('/api/scheduled-rides', scheduledRideRoutes);
app.use('/api/sms', smsInboundRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/driver/auto-bid-rules', driverAutoBidRoutes);
app.use('/api/driver/stats', driverStatsRoutes);
app.use('/api/bids', bidHistoryRoutes);
app.use('/api/cooperative', cooperativeLeaderRoutes);
app.use('/api/drivers/me', driverScreenerRoutes);
app.use('/api/geocode', geocodeRoutes);
// MAP-CACHE G1 — offline Kigali PMTiles extract (404 until the ops
// bundle provisions MAP_PMTILES_PATH; the client degrades to online tiles).
app.use('/api/map', mapRoutes);
// DRIVER-ID v3 — public live-validity lookup (no auth by design; own
// rate-limit scope).
app.use('/api/driver-id', driverIdRoutes);
// PREPROTO-SIM G3 — simulated-SMS inbox. Guarded inside the router
// (admin session or constant-time SIM_INBOX_TOKEN; 503 when
// unconfigured) because it delivers OTP codes in simulated pilots.
app.use('/api/sim', simRoutes);

// OpenAPI / Swagger UI — publicly accessible by design so contributors and
// integrators can read the API contract without a session.
app.get('/api/docs.json', (_req, res) => res.json(swaggerSpec));
app.use(
  '/api/docs',
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    customSiteTitle: 'Bimoto API Docs',
    customCss: '.swagger-ui .topbar { display: none }',
  }),
);

// Sentry's express error handler must be registered AFTER all routes
// and BEFORE any custom error-handling middleware. It is a no-op when
// SENTRY_DSN is unset (instrument.ts initialises with `enabled: false`).
Sentry.setupExpressErrorHandler(app);
app.use(errorHandler);

// Socket.io
initSocket(server);

// Background jobs
startBidExpiryJob();
startAutoConfirmJob();
startAutoConfirmRecipientJob();
startNoShowTimeoutJob();
startJourneyExpiryJob();
startReconciliationJob();
startPaymentReconciliationJob();
startUnpaidMatchReaperJob();
startPayoutJob();
startTwiceDailyPayoutJob();
startPayoutFallbackJob();
startPayoutReconciliationJob();
startPreferenceChangePayoutJob();
startBidWindowOpenerJob();
startAutoFallbackPickJob();
startScheduledRideReminderJob();
startAmlDetectionJob();
startGraphDetectionJob();
startBnrMonthlyJob();
startMobilityAggregationJob();
startGpsRetentionJob();
startEmergencyExpiryJob();
startDeletionExecutionJob();
startRateLimiterCleanup();

// DB-RESILIENCE G3 — complete shutdown: stop all job modules plus
// the rate-limiter cleanup timer, close the HTTP server, disconnect
// Prisma, and exit. Idempotent against a second signal; a 10s ceiling
// forces exit if anything hangs (see shutdown.ts).
const shutdown = createShutdownHandler({
  stopWorkers: [
    stopBidExpiryJob,
    stopAutoConfirmJob,
    stopAutoConfirmRecipientJob,
    stopNoShowTimeoutJob,
    stopJourneyExpiryJob,
    stopReconciliationJob,
    stopPaymentReconciliationJob,
    stopUnpaidMatchReaperJob,
    stopPayoutJob,
    stopTwiceDailyPayoutJob,
    stopPayoutFallbackJob,
    stopPayoutReconciliationJob,
    stopPreferenceChangePayoutJob,
    stopBidWindowOpenerJob,
    stopAutoFallbackPickJob,
    stopScheduledRideReminderJob,
    stopAmlDetectionJob,
    stopGraphDetectionJob,
    stopBnrMonthlyJob,
    stopMobilityAggregationJob,
    stopGpsRetentionJob,
    stopEmergencyExpiryJob,
    stopDeletionExecutionJob,
    stopRateLimiterCleanup,
  ],
  closeServer: (cb) => {
    server.close(cb);
    // Idle keep-alive sockets would otherwise hold close() open until
    // the force-exit timeout; in-flight requests still complete.
    server.closeIdleConnections();
  },
  disconnectDb: () => prisma.$disconnect(),
  exit: (code) => process.exit(code),
});
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// DB-RESILIENCE G3 — process-level safety net. A rejected promise that
// nothing caught is logged with full context but does NOT kill the
// pilot server (a transient P1001 must never take the process down);
// a genuinely uncaught exception means unknown state, so log and exit
// non-zero for a supervisor to restart rather than staying wedged.
process.on('unhandledRejection', (reason) => {
  console.error(
    `[PROCESS] ${new Date().toISOString()} Unhandled promise rejection:`,
    reason,
  );
  Sentry.captureException(reason);
});
process.on('uncaughtException', (err) => {
  console.error(
    `[PROCESS] ${new Date().toISOString()} Uncaught exception — exiting so a supervisor can restart:`,
    err,
  );
  Sentry.captureException(err);
  process.exit(1);
});

const port = config.PORT;
server.listen(port, () => {
  console.log(`Bimoto server running on port ${port}`);
});

export { app, server };
