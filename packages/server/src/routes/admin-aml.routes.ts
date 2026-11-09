import { Router, Request, Response, NextFunction } from 'express';
import { decryptedPhoneOrNull } from '../services/user-phone';
import { AmlFlagType as AmlFlagTypeEnum } from '@prisma/client';
import { authMiddleware, adminOnly } from '../middleware/auth';
import { AppError } from '../middleware/error-handler';
import prisma from '../prisma';
import {
  getOpenFlags,
  resolveFlag,
  AmlFlagSeverity,
  AmlFlagStatus,
  AmlFlagType,
} from '../services/aml';

// Default lookback for the precision ledger: 6 weeks — the pilot's
// calibration window.
const PRECISION_DEFAULT_WINDOW_DAYS = 42;

const router = Router();

router.use(authMiddleware);
router.use(adminOnly);

/**
 * @openapi
 * /api/admin/aml-flags:
 *   get:
 *     summary: List AML flags (default status=OPEN, ordered by severity desc).
 *     tags: [Admin]
 *     security:
 *       - requireAdmin: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [OPEN, DISMISSED, MARKED_FOR_FREEZE, RESOLVED] }
 *       - in: query
 *         name: severity
 *         schema: { type: string, enum: [LOW, MEDIUM, HIGH, CRITICAL] }
 *       - in: query
 *         name: type
 *         schema: { type: string }
 *       - in: query
 *         name: since
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50 }
 *     responses:
 *       200:
 *         description: Flag list.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 flags: { type: array, items: { type: object } }
 *                 total: { type: integer }
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const since = req.query.since ? new Date(String(req.query.since)) : undefined;
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 50;
    const result = await getOpenFlags({
      status: (req.query.status as AmlFlagStatus | undefined) ?? undefined,
      severity: (req.query.severity as AmlFlagSeverity | undefined) ?? undefined,
      type: (req.query.type as AmlFlagType | undefined) ?? undefined,
      since,
      limit,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/admin/aml-flags/export:
 *   get:
 *     summary: Export flag history as CSV for BNR SAR submission.
 *     tags: [Admin]
 *     security:
 *       - requireAdmin: []
 *     parameters:
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: CSV file.
 *         content:
 *           text/csv:
 *             schema: { type: string }
 */
router.get('/export', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const from = req.query.from ? new Date(String(req.query.from)) : new Date(0);
    const to = req.query.to ? new Date(String(req.query.to)) : new Date();
    const flags = await prisma.amlFlag.findMany({
      where: { detectedAt: { gte: from, lte: to } },
      include: {
        user: { select: { phoneEncrypted: true } },
        escrow: { select: { amount: true } },
      },
      orderBy: { detectedAt: 'asc' },
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="aml-flags.csv"');

    const header = [
      'flagId',
      'userId',
      'userPhone',
      'type',
      'severity',
      'status',
      'detectedAt',
      'resolvedAt',
      'resolvedBy',
      'resolutionNotes',
      'journeyId',
      'escrowAmount',
      'metadataJson',
    ].join(',');
    res.write(header + '\n');

    for (const f of flags) {
      const row = [
        f.id,
        f.userId,
        decryptedPhoneOrNull(f.user) ?? '',
        f.type,
        f.severity,
        f.status,
        f.detectedAt?.toISOString() ?? '',
        f.resolvedAt?.toISOString() ?? '',
        f.resolvedBy ?? '',
        csvEscape(f.resolutionNotes ?? ''),
        f.journeyId ?? '',
        f.escrow?.amount ?? '',
        csvEscape(JSON.stringify(f.metadata ?? {})),
      ].join(',');
      res.write(row + '\n');
    }
    res.end();
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/admin/aml-flags/precision:
 *   get:
 *     summary: Per-pattern precision ledger — verdict counts and overturn rate since a date.
 *     tags: [Admin]
 *     security:
 *       - requireAdmin: []
 *     parameters:
 *       - in: query
 *         name: since
 *         schema: { type: string, format: date-time }
 *         description: Window start (detectedAt >= since). Defaults to 42 days back.
 *     responses:
 *       200:
 *         description: Per-AmlFlagType counts. upheld = RESOLVED, overturned = DISMISSED,
 *           overturnRate = overturned / (upheld + overturned), null when no verdicts yet.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 since: { type: string, format: date-time }
 *                 byType:
 *                   type: object
 *                   additionalProperties:
 *                     type: object
 *                     properties:
 *                       open:            { type: integer }
 *                       markedForFreeze: { type: integer }
 *                       upheld:          { type: integer }
 *                       overturned:      { type: integer }
 *                       overturnRate:    { type: number, nullable: true }
 *       400: { description: Invalid since date. }
 */
// NOTE: must stay registered before the '/:flagId' param route below, or
// Express would capture 'precision' as a flag id.
router.get('/precision', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const since = req.query.since
      ? new Date(String(req.query.since))
      : new Date(Date.now() - PRECISION_DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    if (Number.isNaN(since.getTime())) {
      throw new AppError(400, 'INVALID_SINCE', 'errors.invalidSince');
    }

    // One (type, status) groupBy, served by the [type, detectedAt] index.
    const grouped = await prisma.amlFlag.groupBy({
      by: ['type', 'status'],
      where: { detectedAt: { gte: since } },
      _count: { _all: true },
    });

    interface PrecisionBucket {
      open: number;
      markedForFreeze: number;
      upheld: number;
      overturned: number;
      overturnRate: number | null;
    }
    const byType: Record<string, PrecisionBucket> = {};
    for (const type of Object.values(AmlFlagTypeEnum)) {
      byType[type] = { open: 0, markedForFreeze: 0, upheld: 0, overturned: 0, overturnRate: null };
    }
    for (const row of grouped) {
      const bucket = byType[row.type];
      if (!bucket) continue;
      const count = row._count._all;
      if (row.status === 'OPEN') bucket.open = count;
      else if (row.status === 'MARKED_FOR_FREEZE') bucket.markedForFreeze = count;
      else if (row.status === 'RESOLVED') bucket.upheld = count;
      else if (row.status === 'DISMISSED') bucket.overturned = count;
    }
    for (const bucket of Object.values(byType)) {
      const verdicts = bucket.upheld + bucket.overturned;
      bucket.overturnRate = verdicts === 0 ? null : bucket.overturned / verdicts;
    }

    res.json({ since: since.toISOString(), byType });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/admin/aml-flags/{flagId}:
 *   get:
 *     summary: Single flag detail with linked user/journey/escrow.
 *     tags: [Admin]
 *     security:
 *       - requireAdmin: []
 *     parameters:
 *       - in: path
 *         name: flagId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Flag detail. }
 *       404: { description: Not found. }
 */
router.get('/:flagId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const flag = await prisma.amlFlag.findUnique({
      where: { id: req.params.flagId },
      include: {
        user: { select: { id: true, phoneEncrypted: true, nickname: true, isFlagged: true } },
        journey: true,
        escrow: true,
      },
    });
    if (!flag) {
      throw new AppError(404, 'AML_FLAG_NOT_FOUND', 'errors.amlFlagNotFound');
    }
    res.json({ flag });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/admin/aml-flags/{flagId}/dismiss:
 *   post:
 *     summary: Dismiss a flag as a false positive.
 *     tags: [Admin]
 *     security:
 *       - requireAdmin: []
 *     parameters:
 *       - in: path
 *         name: flagId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               notes: { type: string }
 *               confirmCriticalDismiss: { type: boolean }
 *     responses:
 *       200: { description: Dismissed. }
 *       400: { description: CRITICAL flag requires confirmCriticalDismiss=true. }
 *       404: { description: Not found. }
 */
router.post('/:flagId/dismiss', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user?.userId) {
      throw new AppError(401, 'UNAUTHORIZED', 'errors.unauthorized');
    }
    await resolveFlag({
      flagId: req.params.flagId,
      resolvedBy: req.user.userId,
      resolutionNotes: req.body?.notes,
      status: 'DISMISSED',
      confirmCriticalDismiss: req.body?.confirmCriticalDismiss === true,
    });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/admin/aml-flags/{flagId}/mark-for-freeze:
 *   post:
 *     summary: Mark the flagged user for freeze (sets User.isFlagged=true; H performs the actual freeze).
 *     tags: [Admin]
 *     security:
 *       - requireAdmin: []
 *     parameters:
 *       - in: path
 *         name: flagId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [notes]
 *             properties:
 *               notes: { type: string }
 *     responses:
 *       200: { description: Marked for freeze. }
 *       400: { description: notes is required. }
 *       404: { description: Not found. }
 */
router.post(
  '/:flagId/mark-for-freeze',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user?.userId) {
        throw new AppError(401, 'UNAUTHORIZED', 'errors.unauthorized');
      }
      const notes: string | undefined = req.body?.notes;
      if (!notes || !notes.trim()) {
        throw new AppError(400, 'NOTES_REQUIRED', 'errors.notesRequired');
      }
      const flag = await prisma.amlFlag.findUnique({
        where: { id: req.params.flagId },
      });
      if (!flag) {
        throw new AppError(404, 'AML_FLAG_NOT_FOUND', 'errors.amlFlagNotFound');
      }
      await resolveFlag({
        flagId: req.params.flagId,
        resolvedBy: req.user.userId,
        resolutionNotes: notes,
        status: 'MARKED_FOR_FREEZE',
      });
      await prisma.user.update({
        where: { id: flag.userId },
        data: { isFlagged: true },
      });
      res.json({ success: true, userId: flag.userId });
    } catch (err) {
      next(err);
    }
  },
);

function csvEscape(value: string): string {
  if (!value) return '';
  const needs = value.includes(',') || value.includes('"') || value.includes('\n');
  if (!needs) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

export default router;
