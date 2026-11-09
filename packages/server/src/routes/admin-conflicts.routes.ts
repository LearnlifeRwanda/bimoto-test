import { Router, Request, Response, NextFunction } from 'express';
import { ConflictDecision, ConflictType } from '@prisma/client';
import { authMiddleware, adminOnly } from '../middleware/auth';
import { AppError } from '../middleware/error-handler';
import prisma from '../prisma';
import {
  ALL_CONFLICT_TYPES,
  conflictModuleByType,
  isConflictType,
} from '../services/admin/conflict-resolver';
import { verifyAdminActionChain } from '../services/admin/admin-action-audit.service';
import {
  ADMIN_LIST_DEFAULT_LIMIT,
  ADMIN_LIST_MAX_LIMIT,
  ADMIN_REASON_MIN_LENGTH,
} from '../services/admin/config';

const router = Router();
router.use(authMiddleware);
router.use(adminOnly);

const VALID_DECISIONS = new Set<string>(Object.values(ConflictDecision));

function parseLimit(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') {
    return ADMIN_LIST_DEFAULT_LIMIT;
  }
  const n = parseInt(String(raw), 10);
  if (Number.isNaN(n) || n < 1 || n > ADMIN_LIST_MAX_LIMIT) {
    throw new AppError(400, 'INVALID_LIMIT', 'errors.invalidLimit');
  }
  return n;
}

function requireType(raw: string): ConflictType {
  if (!isConflictType(raw)) {
    throw new AppError(400, 'INVALID_CONFLICT_TYPE', 'errors.invalidConflictType');
  }
  return raw;
}

/**
 * @openapi
 * /api/admin/conflicts:
 *   get:
 *     summary: Counts of open conflicts grouped by type.
 *     tags: [Admin - Conflicts]
 *     responses:
 *       200: { description: Counts per conflict type }
 */
router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const counts = await Promise.all(
      ALL_CONFLICT_TYPES.map(async (type) => ({
        type,
        count: await conflictModuleByType[type].countOpen(prisma),
      })),
    );
    res.json({ counts });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/admin/conflicts/audit:
 *   get:
 *     summary: Recent AdminAction rows (most-recent-first).
 *     tags: [Admin - Conflicts]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 200 }
 *       - in: query
 *         name: type
 *         schema: { type: string }
 *     responses:
 *       200: { description: Action rows }
 */
router.get('/audit', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = parseLimit(req.query.limit);
    const type =
      typeof req.query.type === 'string' ? requireType(req.query.type) : undefined;
    const where: any = {};
    if (type) where.conflictType = type;
    const actions = await prisma.adminAction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    res.json({ actions });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/admin/conflicts/audit/verify:
 *   get:
 *     summary: Verify the AdminAction hash chain integrity.
 *     tags: [Admin - Conflicts]
 *     responses:
 *       200: { description: Chain status }
 */
router.get(
  '/audit/verify',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await verifyAdminActionChain();
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * @openapi
 * /api/admin/conflicts/{type}:
 *   get:
 *     summary: List open conflicts of a given type.
 *     tags: [Admin - Conflicts]
 *     parameters:
 *       - in: path
 *         name: type
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 200 }
 *     responses:
 *       200: { description: Open conflicts }
 *       400: { description: Invalid conflict type }
 */
router.get('/:type', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const type = requireType(req.params.type);
    const limit = parseLimit(req.query.limit);
    const items = await conflictModuleByType[type].listOpen(prisma, { limit });
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/admin/conflicts/{type}/{id}:
 *   get:
 *     summary: Conflict detail.
 *     tags: [Admin - Conflicts]
 *     parameters:
 *       - in: path
 *         name: type
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Detail }
 *       400: { description: Invalid type }
 *       404: { description: Not found }
 */
router.get('/:type/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const type = requireType(req.params.type);
    const mod = conflictModuleByType[type];
    const detail = await mod.getDetail(prisma, req.params.id);
    if (!detail) throw new AppError(404, 'NOT_FOUND', 'errors.notFound');
    res.json({ detail, validDecisions: mod.validDecisions });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/admin/conflicts/{type}/{id}/decide:
 *   post:
 *     summary: Record an admin decision for a conflict.
 *     tags: [Admin - Conflicts]
 *     parameters:
 *       - in: path
 *         name: type
 *         required: true
 *         schema: { type: string }
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
 *             required: [decision, reason]
 *             properties:
 *               decision: { type: string }
 *               reason: { type: string }
 *     responses:
 *       200: { description: AdminAction recorded }
 *       400: { description: Invalid input }
 *       404: { description: Target not found }
 */
router.post(
  '/:type/:id/decide',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user?.userId) {
        throw new AppError(401, 'UNAUTHORIZED', 'errors.unauthorized');
      }
      const type = requireType(req.params.type);
      const { decision, reason } = req.body ?? {};
      if (typeof decision !== 'string' || !VALID_DECISIONS.has(decision)) {
        throw new AppError(400, 'INVALID_DECISION', 'errors.invalidDecision');
      }
      const reasonStr = typeof reason === 'string' ? reason.trim() : '';
      if (reasonStr.length < ADMIN_REASON_MIN_LENGTH) {
        throw new AppError(400, 'REASON_TOO_SHORT', 'errors.reasonTooShort');
      }
      const mod = conflictModuleByType[type];
      if (!mod.validDecisions.includes(decision as ConflictDecision)) {
        throw new AppError(
          400,
          'DECISION_NOT_VALID_FOR_TYPE',
          'errors.decisionNotValidForType',
        );
      }
      const adminAction = await mod
        .decide(
          {
            id: req.params.id,
            decision: decision as ConflictDecision,
            reason: reasonStr,
            adminId: req.user.userId,
          },
          prisma,
        )
        .catch((err: any) => {
          if (
            err?.code === 'JOURNEY_NOT_FOUND' ||
            err?.code === 'BID_NOT_FOUND' ||
            err?.code === 'AML_FLAG_NOT_FOUND' ||
            err?.code === 'LEG_NOT_FOUND' ||
            err?.code === 'LEG_NOT_DISPUTED'
          ) {
            throw new AppError(404, 'NOT_FOUND', 'errors.notFound');
          }
          // BID-ATOMICITY G4 — a second admin racing (or repeating) a
          // decision loses the single-winner claim inside decide()'s
          // transaction: clean 409, no side-effects were committed.
          if (err?.code === 'ALREADY_DECIDED') {
            throw new AppError(409, 'ALREADY_DECIDED', 'errors.alreadyDecided');
          }
          throw err;
        });
      res.json({ adminAction });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
