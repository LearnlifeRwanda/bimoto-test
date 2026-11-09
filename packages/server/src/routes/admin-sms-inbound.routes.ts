import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware, adminOnly } from '../middleware/auth';
import { AppError } from '../middleware/error-handler';
import prisma from '../prisma';
import { SmsInboundStatus } from '@prisma/client';
import {
  processInbound,
  type InboundContext,
} from '../services/sms-inbound';

const router = Router();

router.use(authMiddleware);
router.use(adminOnly);

const VALID_STATUSES = new Set<string>(Object.values(SmsInboundStatus));

/**
 * @openapi
 * /api/admin/sms-inbound:
 *   get:
 *     summary: List inbound SMS rows (most-recent-first).
 *     tags: [Admin - SMS Inbound]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 200, default: 50 }
 *     responses:
 *       200: { description: Array of SmsInbound rows }
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    if (status && !VALID_STATUSES.has(status)) {
      throw new AppError(400, 'INVALID_STATUS', 'errors.invalidStatus');
    }
    const rawLimit = parseInt(String(req.query.limit ?? '50'), 10);
    if (Number.isNaN(rawLimit) || rawLimit < 1 || rawLimit > 200) {
      throw new AppError(400, 'INVALID_LIMIT', 'errors.invalidLimit');
    }
    const rows = await prisma.smsInbound.findMany({
      where: status ? { status: status as SmsInboundStatus } : undefined,
      orderBy: { receivedAt: 'desc' },
      take: rawLimit,
    });
    res.json({ rows });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/admin/sms-inbound/stats:
 *   get:
 *     summary: Counts of inbound rows by status over the last 7 days.
 *     tags: [Admin - SMS Inbound]
 *     responses:
 *       200: { description: Stats grouped by status }
 */
router.get('/stats', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const grouped = await prisma.smsInbound.groupBy({
      by: ['status'],
      where: { receivedAt: { gte: since } },
      _count: { _all: true },
    });
    const stats = grouped.reduce<Record<string, number>>((acc, g) => {
      acc[g.status] = g._count._all;
      return acc;
    }, {});
    res.json({ since, stats });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/admin/sms-inbound/{id}:
 *   get:
 *     summary: Fetch a single SmsInbound row by id.
 *     tags: [Admin - SMS Inbound]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Row found }
 *       404: { description: Not found }
 */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const row = await prisma.smsInbound.findUnique({ where: { id: req.params.id } });
    if (!row) {
      throw new AppError(404, 'NOT_FOUND', 'errors.notFound');
    }
    res.json({ row });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/admin/sms-inbound/{id}/replay:
 *   post:
 *     summary: Re-run processInbound for a previously stored row.
 *     tags: [Admin - SMS Inbound]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Replay enqueued }
 */
router.post(
  '/:id/replay',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const row = await prisma.smsInbound.findUnique({ where: { id: req.params.id } });
      if (!row) {
        throw new AppError(404, 'NOT_FOUND', 'errors.notFound');
      }
      // Reset to PENDING so the dispatcher will reprocess it.
      await prisma.smsInbound.update({
        where: { id: row.id },
        data: { status: SmsInboundStatus.PENDING, errorMessage: null, processedAt: null },
      });
      const ctx: InboundContext = {
        atMessageId: row.atMessageId,
        fromMsisdn: row.fromMsisdn,
        toShortcode: row.toShortcode,
        rawBody: row.rawBody,
        receivedAt: row.receivedAt,
      };
      const result = await processInbound(ctx);
      res.json({ result });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * @openapi
 * /api/admin/sms-inbound/{id}/dismiss:
 *   post:
 *     summary: Mark the row as PROCESSED with a dismissal reason; no reply sent.
 *     tags: [Admin - SMS Inbound]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason: { type: string }
 *             required: [reason]
 *     responses:
 *       200: { description: Dismissed }
 */
router.post(
  '/:id/dismiss',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const reason = String((req.body ?? {}).reason ?? '').trim();
      if (!reason) {
        throw new AppError(400, 'REASON_REQUIRED', 'errors.reasonRequired');
      }
      const row = await prisma.smsInbound.findUnique({ where: { id: req.params.id } });
      if (!row) {
        throw new AppError(404, 'NOT_FOUND', 'errors.notFound');
      }
      const updated = await prisma.smsInbound.update({
        where: { id: row.id },
        data: {
          status: SmsInboundStatus.PROCESSED,
          errorMessage: `Dismissed: ${reason}`,
          processedAt: new Date(),
        },
      });
      res.json({ row: updated });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
