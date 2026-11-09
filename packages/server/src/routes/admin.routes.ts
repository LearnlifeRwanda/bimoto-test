import { Router } from 'express';
import { authMiddleware, adminOnly } from '../middleware/auth';
import { AppError } from '../middleware/error-handler';
import { verifyAuditChain } from '../services/escrow-audit.service';
import { generateMonthlyReport } from '../services/report.service';
import prisma from '../prisma';
import { releaseEscrowTx, refundEscrowTx } from '../services/escrow.service';
import { assertDriverApprovable, revokeDriver } from '../services/driver-verification.service';
import {
  notifyDriverVerificationApproved,
  notifyDriverVerificationRejected,
} from '../services/notification.service';
import {
  ADMIN_REASON_MIN_LENGTH,
  ADMIN_DELETION_REQUEST_HISTORY_DAYS,
} from '../services/admin/config';
import { getIO } from '../socket';

const router = Router();

function safeIo() {
  try {
    return getIO();
  } catch {
    return null;
  }
}

// All admin routes require auth + admin role
router.use(authMiddleware);
router.use(adminOnly);

/**
 * @openapi
 * /api/admin/dashboard:
 *   get:
 *     summary: Headline stats for the admin dashboard (counts, revenue, flags).
 *     tags: [Admin]
 *     security:
 *       - requireAdmin: []
 *     responses:
 *       200:
 *         description: Dashboard counters.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 totalUsers:            { type: integer }
 *                 totalDrivers:          { type: integer }
 *                 totalCustomers:        { type: integer }
 *                 totalJourneys:         { type: integer }
 *                 completedJourneys:     { type: integer }
 *                 totalRevenue:          { type: number }
 *                 activeDisputes:        { type: integer }
 *                 flaggedUsers:          { type: integer }
 *                 pendingVerifications:  { type: integer }
 */
// GET /api/admin/dashboard
router.get('/dashboard', async (_req, res, next) => {
  try {
    const totalUsers = await prisma.user.count();
    const totalDrivers = await prisma.user.count({
      where: { role: { in: ['DRIVER', 'BOTH'] } },
    });
    const totalCustomers = await prisma.user.count({
      where: { role: { in: ['CUSTOMER', 'BOTH'] } },
    });
    const totalJourneys = await prisma.journey.count();
    const completedJourneys = await prisma.journey.count({
      where: { status: 'COMPLETED' },
    });

    const escrows = await prisma.escrow.findMany({
      where: { status: 'RELEASED' },
      select: { commission: true },
    });
    const totalRevenue = escrows.reduce((sum: number, e: any) => sum + e.commission, 0);

    const activeDisputes = await prisma.journey.count({
      where: { status: { in: ['DISPUTED', 'INTERRUPTED'] } },
    });
    const flaggedUsers = await prisma.user.count({
      where: { isFlagged: true },
    });
    const pendingVerifications = await prisma.driverProfile.count({
      where: { verificationStatus: { in: ['PENDING', 'UNDER_REVIEW'] } },
    });

    res.json({
      totalUsers,
      totalDrivers,
      totalCustomers,
      totalJourneys,
      completedJourneys,
      totalRevenue,
      activeDisputes,
      flaggedUsers,
      pendingVerifications,
    });
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/admin/verifications:
 *   get:
 *     summary: List driver verification submissions (default = PENDING + UNDER_REVIEW).
 *     tags: [Admin]
 *     security:
 *       - requireAdmin: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [PENDING, UNDER_REVIEW, VERIFIED, REJECTED, REVOKED] }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, default: 0 }
 *     responses:
 *       200:
 *         description: Verification list.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 verifications:
 *                   type: array
 *                   items: { type: object }
 */
// GET /api/admin/verifications
router.get('/verifications', async (req, res, next) => {
  try {
    const status = req.query.status as string | undefined;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;

    const where: any = {};
    if (status) {
      where.verificationStatus = status;
    } else {
      where.verificationStatus = { in: ['PENDING', 'UNDER_REVIEW'] };
    }

    const verifications = await prisma.driverProfile.findMany({
      where,
      include: { user: { select: { id: true, nickname: true, phoneEncrypted: true, role: true, createdAt: true } } },
      take: limit,
      skip: offset,
      orderBy: { user: { createdAt: 'desc' } },
    });

    res.json({ verifications });
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/admin/verifications/{userId}/approve:
 *   post:
 *     summary: Mark a driver verification as VERIFIED.
 *     tags: [Admin]
 *     security:
 *       - requireAdmin: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Updated driver profile.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 profile: { type: object }
 *       404:
 *         description: Driver profile not found.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       422:
 *         description: Identifier/plate missing, or the profile is REVOKED (re-application required).
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
// POST /api/admin/verifications/:userId/approve
router.post('/verifications/:userId/approve', async (req, res, next) => {
  try {
    const existing = await prisma.driverProfile.findUnique({
      where: { userId: req.params.userId },
    });
    if (!existing) {
      throw new AppError(404, 'DRIVER_PROFILE_NOT_FOUND', 'errors.driverProfileNotFound');
    }
    // DRIVER-ID v3 — the person identifier is mandatory at approval for
    // every vehicle type, the plate only where the compliance matrix
    // requires one, and a REVOKED profile can only re-enter via
    // re-application (never directly to VERIFIED).
    assertDriverApprovable(existing);
    const profile = await prisma.driverProfile.update({
      where: { userId: req.params.userId },
      data: {
        verificationStatus: 'VERIFIED',
        verifiedAt: new Date(),
      },
    });
    // FIELD-FIT G4 — tell the person who has been waiting. Fired after
    // the write commits, fire-and-forget: a notification failure must
    // never fail the admin's decision.
    notifyDriverVerificationApproved(req.params.userId);
    res.json({ profile });
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/admin/verifications/{userId}/reject:
 *   post:
 *     summary: Reject a driver verification with a stored reason.
 *     tags: [Admin]
 *     security:
 *       - requireAdmin: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason]
 *             properties:
 *               reason: { type: string }
 *     responses:
 *       200:
 *         description: Updated driver profile.
 *       400:
 *         description: Reason missing.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
// POST /api/admin/verifications/:userId/reject
router.post('/verifications/:userId/reject', async (req, res, next) => {
  try {
    const { reason } = req.body;
    if (!reason) {
      res.status(400).json({ error: { code: 'MISSING_REASON', message: 'Rejection reason is required' } });
      return;
    }
    const profile = await prisma.driverProfile.update({
      where: { userId: req.params.userId },
      data: {
        verificationStatus: 'REJECTED',
        rejectionReason: reason,
      },
    });
    // FIELD-FIT G4 — a rejection travels with its reason, so the motari
    // knows what to fix rather than only that he was refused.
    notifyDriverVerificationRejected(req.params.userId, reason);
    res.json({ profile });
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/admin/verifications/{userId}/revoke:
 *   post:
 *     summary: Revoke a driver's identity — REVOKED status, open bids withdrawn (SYSTEM), audited, remaining balance settled through the standard payout path.
 *     description: Revocation never deletes records and never confiscates money. If the driver is frozen, settlement is deferred — freeze wins; the normal payout machinery settles after unfreeze. A revoked driver re-enters only by re-applying through verification.
 *     tags: [Admin]
 *     security:
 *       - requireAdmin: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason]
 *             properties:
 *               reason: { type: string, minLength: 10 }
 *     responses:
 *       200:
 *         description: Revocation recorded.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 profile:           { type: object }
 *                 adminAction:       { type: object }
 *                 withdrawnBidCount: { type: integer }
 *                 settlement:
 *                   type: object
 *                   properties:
 *                     batchId:           { type: string, nullable: true }
 *                     amount:            { type: number }
 *                     deferredForFreeze: { type: boolean }
 *       400:
 *         description: Reason missing or too short.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       404:
 *         description: Driver profile not found.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       409:
 *         description: Driver is already revoked.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
// POST /api/admin/verifications/:userId/revoke
router.post('/verifications/:userId/revoke', async (req, res, next) => {
  try {
    if (!req.user?.userId) {
      throw new AppError(401, 'UNAUTHORIZED', 'errors.unauthorized');
    }
    const { reason } = req.body ?? {};
    const reasonStr = typeof reason === 'string' ? reason.trim() : '';
    if (reasonStr.length < ADMIN_REASON_MIN_LENGTH) {
      throw new AppError(400, 'REASON_TOO_SHORT', 'errors.reasonTooShort');
    }
    const result = await revokeDriver(
      {
        driverId: req.params.userId,
        adminId: req.user.userId,
        reason: reasonStr,
      },
      prisma,
      safeIo(),
    ).catch((err: any) => {
      if (err?.code === 'DRIVER_PROFILE_NOT_FOUND') {
        throw new AppError(404, 'DRIVER_PROFILE_NOT_FOUND', 'errors.driverProfileNotFound');
      }
      if (err?.code === 'ALREADY_REVOKED') {
        throw new AppError(409, 'ALREADY_REVOKED', 'errors.alreadyRevoked');
      }
      throw err;
    });
    res.json(result);
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/admin/disputes:
 *   get:
 *     summary: List disputed/interrupted journeys with full evidence (escrow, GPS, messages).
 *     tags: [Admin]
 *     security:
 *       - requireAdmin: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [DISPUTED, INTERRUPTED] }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Disputed-journey list with evidence.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 journeys:
 *                   type: array
 *                   items: { type: object }
 */
// GET /api/admin/disputes
router.get('/disputes', async (req, res, next) => {
  try {
    const status = req.query.status as string | undefined;
    const limit = parseInt(req.query.limit as string) || 20;

    const where: any = {};
    if (status) {
      where.status = status;
    } else {
      where.status = { in: ['DISPUTED', 'INTERRUPTED'] };
    }

    const journeys = await prisma.journey.findMany({
      where,
      include: {
        escrow: true,
        customer: { select: { id: true, nickname: true } },
        driver: { select: { id: true, nickname: true } },
        gpsPoints: { orderBy: { timestamp: 'asc' } },
        messages: { orderBy: { createdAt: 'asc' } },
      },
      take: limit,
      orderBy: { updatedAt: 'desc' },
    });

    res.json({ journeys });
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/admin/disputes/{journeyId}/resolve:
 *   post:
 *     summary: Resolve a dispute by releasing the escrow to the driver or refunding the customer.
 *     tags: [Admin]
 *     security:
 *       - requireAdmin: []
 *     parameters:
 *       - in: path
 *         name: journeyId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [action, reason]
 *             properties:
 *               action: { type: string, enum: [release, refund] }
 *               reason: { type: string }
 *     responses:
 *       200:
 *         description: Updated journey + escrow.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 journey: { type: object }
 *                 escrow:  { type: object }
 *       400:
 *         description: Invalid action or missing reason.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       404:
 *         description: Escrow not found.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
// POST /api/admin/disputes/:journeyId/resolve
router.post('/disputes/:journeyId/resolve', async (req, res, next) => {
  try {
    const { action, reason } = req.body;

    if (!action || !['release', 'refund'].includes(action)) {
      res.status(400).json({ error: { code: 'INVALID_ACTION', message: 'Action must be "release" or "refund"' } });
      return;
    }
    if (!reason) {
      res.status(400).json({ error: { code: 'MISSING_REASON', message: 'Resolution reason is required' } });
      return;
    }

    const escrow = await prisma.escrow.findUnique({
      where: { journeyId: req.params.journeyId },
    });

    if (!escrow) {
      res.status(404).json({ error: { code: 'ESCROW_NOT_FOUND', message: 'No escrow found for this journey' } });
      return;
    }

    const journeyStatus = action === 'release' ? 'COMPLETED' : 'CANCELLED';

    // ESCROW-CREDIT G1 — settle via the canonical tx-accepting helpers
    // (escrow transition + audit entry + on release: totalRides,
    // completedShifts, driver balance credit). The previous inline release
    // here flipped the status without crediting the driver.
    const result = await prisma.$transaction(async (tx: any) => {
      // A null from the settle helpers means a concurrent resolver won the
      // status claim (G2); re-read so the response reflects the settled row.
      const updatedEscrow =
        (action === 'release'
          ? await releaseEscrowTx(tx, escrow, req.user!.userId)
          : await refundEscrowTx(tx, escrow, req.user!.userId)) ??
        (await tx.escrow.findUnique({ where: { journeyId: req.params.journeyId } }));

      const updatedJourney = await tx.journey.update({
        where: { id: req.params.journeyId },
        data: { status: journeyStatus },
      });

      return { journey: updatedJourney, escrow: updatedEscrow };
    });

    res.json(result);
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/admin/flagged-users:
 *   get:
 *     summary: List users flagged by the dispute-rate watchdog.
 *     tags: [Admin]
 *     security:
 *       - requireAdmin: []
 *     responses:
 *       200:
 *         description: Flagged-user list (slim projection).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 users:
 *                   type: array
 *                   items: { type: object }
 */
// GET /api/admin/flagged-users
router.get('/flagged-users', async (_req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      where: { isFlagged: true },
      select: {
        id: true,
        nickname: true,
        role: true,
        disputeCount: true,
        disputeRate: true,
        isFlagged: true,
        // PILOT-GUARD Item 1 — the queue exists to be reviewed, and a
        // flag with no reason cannot be. Every writer now records one
        // (aml/flag-store, the scheduled-cancellation path, the
        // graduated no-show penalty), so the reviewer can see which.
        flagReason: true,
        completedRides: true,
        createdAt: true,
      },
    });
    res.json({ users });
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/admin/deletion-requests:
 *   get:
 *     summary: List account-deletion requests — everything still open, plus the last 30 days of executed erasures.
 *     description: >
 *       The ops view of ACCOUNT-RIGHTS. Every non-EXECUTED request (PENDING
 *       inside or past its 72-hour window, and CANCELLED ones) plus recently
 *       EXECUTED erasures, so an operator can answer "why has this person
 *       not been deleted yet" from `deferredReason` without a database
 *       session. Requesters are NOT anonymised until the erasure runs, so a
 *       PENDING row carries a real nickname; an EXECUTED row reads
 *       "Deleted User", which is the anonymisation showing through and is
 *       correct.
 *     tags: [Admin]
 *     security:
 *       - requireAdmin: []
 *     responses:
 *       200:
 *         description: Deletion-request list (slim projection).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 requests:
 *                   type: array
 *                   items: { type: object }
 */
// GET /api/admin/deletion-requests
router.get('/deletion-requests', async (_req, res, next) => {
  try {
    const executedCutoff = new Date(
      Date.now() - ADMIN_DELETION_REQUEST_HISTORY_DAYS * 24 * 60 * 60 * 1000,
    );

    const rows = await prisma.deletionRequest.findMany({
      where: {
        OR: [
          // Everything still open or reversed: PENDING (whether or not its
          // window has run out) and CANCELLED. Not time-bounded — an open
          // request is open however old it is, and a request stuck on a
          // deferral for a fortnight is exactly the row ops needs to see.
          { status: { not: 'EXECUTED' } },
          // Recent history, so "did this erasure actually run" is
          // answerable without going to the database.
          { status: 'EXECUTED', executedAt: { gte: executedCutoff } },
        ],
      },
      select: {
        id: true,
        userId: true,
        status: true,
        requestedAt: true,
        executesAt: true,
        cancelledAt: true,
        executedAt: true,
        deferredReason: true,
        user: { select: { nickname: true } },
      },
      orderBy: { requestedAt: 'desc' },
    });

    // Flattened to the shape the client renders: the nested relation is a
    // query detail, not part of the contract.
    const requests = rows.map(({ user, ...row }) => ({ ...row, nickname: user.nickname }));
    res.json({ requests });
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/admin/flagged-users/{userId}/unflag:
 *   post:
 *     summary: Clear the flag on a user after manual review.
 *     tags: [Admin]
 *     security:
 *       - requireAdmin: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Updated user.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user: { type: object }
 */
// POST /api/admin/flagged-users/:userId/unflag
router.post('/flagged-users/:userId/unflag', async (req, res, next) => {
  try {
    // PILOT-GUARD Item 1(c) — clearing a flag clears its reason.
    //
    // The two conflict-resolver siblings that clear a flag
    // (conflicts/aml-appeal.ts, conflicts/graph-anomaly.ts) have always
    // written `{ isFlagged: false, flagReason: null }`. This path left
    // the reason behind, so a reviewed-and-cleared account kept a stale
    // "why" that no longer applied to anything.
    //
    // CUTGUARD v2 G1 — surfaced by scripts/serialization-guard. This
    // returned the RAW updated row, so the admin console received
    // `moneyPinHash` and `moneyPinPendingHash` (both `hmacOtp(pin)` with
    // NO per-user salt — utils/crypto.ts), `phoneHash`, and both
    // encrypted columns, for any driver an operator unflagged. An
    // unsalted hash over a four-digit space is a reverse table, and the
    // PIN it protects is the one standing between a borrowed phone and
    // that motari's money. "Admin-only" is not an answer to a credential:
    // D25 put the PIN beyond the SERVER's reach on purpose.
    //
    // The client never reads this body (AdminFlaggedUsers just drops the
    // row from its list), so the `select` is the confirmation the route
    // owes and nothing more.
    const user = await prisma.user.update({
      where: { id: req.params.userId },
      data: { isFlagged: false, flagReason: null },
      select: { id: true, isFlagged: true, flagReason: true },
    });
    res.json({ user });
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/admin/escrow/{id}/verify:
 *   get:
 *     summary: Verify an escrow's append-only audit chain (hash-linked entries).
 *     tags: [Admin]
 *     security:
 *       - requireAdmin: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Verification result with broken-link diagnosis on failure.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 valid:        { type: boolean }
 *                 entryCount:   { type: integer }
 *                 brokenAt:     { type: integer, nullable: true, description: 'Index of the first invalid entry, or null.' }
 *                 reason:       { type: string, nullable: true }
 */
// GET /api/admin/escrow/:id/verify
router.get('/escrow/:id/verify', async (req, res, next) => {
  try {
    const result = await verifyAuditChain(req.params.id);
    res.json(result);
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/admin/reports/monthly:
 *   get:
 *     summary: Generate the monthly platform report (rides, GMV, commission, dispute rate).
 *     tags: [Admin]
 *     security:
 *       - requireAdmin: []
 *     parameters:
 *       - in: query
 *         name: year
 *         required: true
 *         schema: { type: integer, example: 2026 }
 *       - in: query
 *         name: month
 *         required: true
 *         schema: { type: integer, minimum: 1, maximum: 12, example: 4 }
 *     responses:
 *       200:
 *         description: Report payload.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 report: { type: object }
 *       400:
 *         description: Invalid year/month.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
// GET /api/admin/reports/monthly
router.get('/reports/monthly', async (req, res, next) => {
  try {
    const year = parseInt(req.query.year as string);
    const month = parseInt(req.query.month as string);

    if (!year || !month || month < 1 || month > 12) {
      res.status(400).json({ error: { code: 'INVALID_PARAMS', message: 'Valid year and month (1-12) required' } });
      return;
    }

    const report = await generateMonthlyReport(year, month);
    res.json({ report });
  } catch (err) { next(err); }
});

export default router;
