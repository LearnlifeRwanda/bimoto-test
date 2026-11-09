// PILOT-INSTRUMENT G3 — admin read-out for the pickup-identity
// verification signal (the V-4 evidence trigger).
//
//   GET /summary   counts by outcome over a window + a recent list of
//                  MISMATCH/UNSURE answers (journey, jacket, reason,
//                  time) for human review.
//
// Read-only by design: this router exposes no write. The rows it reads
// are evidence, not enforcement — see docs/pilot-triggers.md for how
// the pickup-mismatch rate feeds the V-4 (dynamic QR/PIN) decision.
//
// Auth: authMiddleware → adminOnly on every route.

import { Router, Request, Response, NextFunction } from 'express';
import { PickupOutcome } from '@prisma/client';
import { authMiddleware, adminOnly } from '../middleware/auth';
import { AppError } from '../middleware/error-handler';
import prisma from '../prisma';

const router = Router();
router.use(authMiddleware);
router.use(adminOnly);

// Default lookback: 6 weeks — matches the pilot's week-6 review cadence
// (the same rhythm as the AML precision ledger's window).
const SUMMARY_DEFAULT_WINDOW_DAYS = 42;
const RECENT_LIST_LIMIT = 50;

/**
 * @openapi
 * /api/admin/pickup-verifications/summary:
 *   get:
 *     summary: Pickup-identity verification counts by outcome + recent MISMATCH/UNSURE answers (the V-4 trigger read-out).
 *     tags: [Admin]
 *     security:
 *       - requireAdmin: []
 *     parameters:
 *       - in: query
 *         name: since
 *         schema: { type: string, format: date-time }
 *         description: Window start (createdAt >= since). Defaults to 42 days back.
 *     responses:
 *       200:
 *         description: Outcome counts, the mismatch rate over answered prompts, and
 *           the most recent MISMATCH/UNSURE answers for human review.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 since: { type: string, format: date-time }
 *                 counts:
 *                   type: object
 *                   properties:
 *                     MATCHED:  { type: integer }
 *                     MISMATCH: { type: integer }
 *                     UNSURE:   { type: integer }
 *                 total: { type: integer }
 *                 mismatchRate:
 *                   type: number
 *                   nullable: true
 *                   description: (MISMATCH + UNSURE) / total answered; null when no answers yet.
 *                 recent:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       journeyId:    { type: string, format: uuid }
 *                       jacketNumber: { type: string, nullable: true }
 *                       outcome:      { type: string, enum: [MISMATCH, UNSURE] }
 *                       reason:       { type: string, nullable: true }
 *                       answeredAt:   { type: string, format: date-time }
 *       400: { description: Invalid since date. }
 */
// GET /api/admin/pickup-verifications/summary
router.get('/summary', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const since = req.query.since
      ? new Date(String(req.query.since))
      : new Date(Date.now() - SUMMARY_DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    if (Number.isNaN(since.getTime())) {
      throw new AppError(400, 'INVALID_SINCE', 'errors.invalidSince');
    }

    const grouped = await prisma.pickupVerification.groupBy({
      by: ['outcome'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    });

    const counts: Record<PickupOutcome, number> = {
      MATCHED: 0,
      MISMATCH: 0,
      UNSURE: 0,
    };
    for (const row of grouped) {
      counts[row.outcome] = row._count._all;
    }
    const total = counts.MATCHED + counts.MISMATCH + counts.UNSURE;
    // The pickup-mismatch rate (docs/pilot-triggers.md): every answer
    // that is not a clean "yes" counts as a mismatch signal.
    const mismatchRate =
      total === 0 ? null : (counts.MISMATCH + counts.UNSURE) / total;

    const recentRows = await prisma.pickupVerification.findMany({
      where: {
        createdAt: { gte: since },
        outcome: { in: [PickupOutcome.MISMATCH, PickupOutcome.UNSURE] },
      },
      orderBy: { createdAt: 'desc' },
      take: RECENT_LIST_LIMIT,
      include: {
        journey: {
          select: {
            driver: {
              select: {
                driverProfile: { select: { ruraAuthorizationNumber: true } },
              },
            },
          },
        },
      },
    });
    const recent = recentRows.map((row) => ({
      journeyId: row.journeyId,
      jacketNumber:
        row.journey?.driver?.driverProfile?.ruraAuthorizationNumber ?? null,
      outcome: row.outcome,
      reason: row.reason,
      answeredAt: row.updatedAt,
    }));

    res.json({ since: since.toISOString(), counts, total, mismatchRate, recent });
  } catch (err) {
    next(err);
  }
});

export default router;
