import { Router, Request, Response, NextFunction } from 'express';
import { FreezeCategory } from '@prisma/client';
import { authMiddleware, adminOnly } from '../middleware/auth';
import { AppError } from '../middleware/error-handler';
import prisma from '../prisma';
import { decryptedPhoneOrNull } from '../services/user-phone';
import { freezeUser, unfreezeUser } from '../services/admin/freeze.service';
import {
  ADMIN_LIST_DEFAULT_LIMIT,
  ADMIN_LIST_MAX_LIMIT,
  ADMIN_REASON_MIN_LENGTH,
} from '../services/admin/config';
import { getIO } from '../socket';

const router = Router();
router.use(authMiddleware);
router.use(adminOnly);

const VALID_CATEGORIES = new Set<string>(Object.values(FreezeCategory));

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

function safeIo() {
  try {
    return getIO();
  } catch {
    return null;
  }
}

/**
 * @openapi
 * /api/admin/freeze:
 *   get:
 *     summary: List currently-frozen users.
 *     tags: [Admin - Freeze]
 *     parameters:
 *       - in: query
 *         name: category
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 200 }
 *     responses:
 *       200: { description: Array of frozen users }
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = parseLimit(req.query.limit);
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    if (category && !VALID_CATEGORIES.has(category)) {
      throw new AppError(400, 'INVALID_CATEGORY', 'errors.invalidCategory');
    }
    const where: any = { frozenAt: { not: null } };
    if (category) where.frozenCategory = category;
    const rows = await prisma.user.findMany({
      where,
      select: {
        id: true,
        nickname: true,
        phoneEncrypted: true,
        role: true,
        frozenAt: true,
        frozenReason: true,
        frozenBy: true,
        frozenCategory: true,
      },
      orderBy: { frozenAt: 'desc' },
      take: limit,
    });
    // The response contract is a dialable `phone`. The select casts that
    // used to sit here hid the field name from the compiler entirely.
    const users = rows.map(({ phoneEncrypted, ...rest }) => ({
      ...rest,
      phone: decryptedPhoneOrNull({ phoneEncrypted }) ?? '',
    }));
    res.json({ users });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/admin/freeze/{userId}:
 *   get:
 *     summary: Frozen-user detail with recent AdminAction history.
 *     tags: [Admin - Freeze]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: User detail + actions }
 *       404: { description: Not found }
 */
router.get('/:userId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const row = await prisma.user.findUnique({
      where: { id: req.params.userId },
      select: {
        id: true,
        nickname: true,
        phoneEncrypted: true,
        role: true,
        frozenAt: true,
        frozenReason: true,
        frozenBy: true,
        frozenCategory: true,
      },
    });
    if (!row) throw new AppError(404, 'NOT_FOUND', 'errors.notFound');
    const { phoneEncrypted, ...rest } = row;
    const user = { ...rest, phone: decryptedPhoneOrNull({ phoneEncrypted }) ?? '' };
    const actions = await prisma.adminAction.findMany({
      where: { targetType: 'USER', targetId: req.params.userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ user, actions });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/admin/freeze/{userId}/audit:
 *   get:
 *     summary: AdminAction rows for this user.
 *     tags: [Admin - Freeze]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Action rows }
 */
router.get('/:userId/audit', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actions = await prisma.adminAction.findMany({
      where: { targetType: 'USER', targetId: req.params.userId },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ actions });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/admin/freeze/{userId}/freeze:
 *   post:
 *     summary: Freeze a user account, hold pending payouts, optionally notify by SMS.
 *     tags: [Admin - Freeze]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason, category]
 *             properties:
 *               reason: { type: string }
 *               category: { type: string }
 *               notify: { type: boolean }
 *     responses:
 *       200: { description: Freeze action recorded }
 *       400: { description: Invalid reason or category }
 *       404: { description: User not found }
 */
router.post(
  '/:userId/freeze',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user?.userId) {
        throw new AppError(401, 'UNAUTHORIZED', 'errors.unauthorized');
      }
      const { reason, category, notify } = req.body ?? {};
      const reasonStr = typeof reason === 'string' ? reason.trim() : '';
      if (reasonStr.length < ADMIN_REASON_MIN_LENGTH) {
        throw new AppError(400, 'REASON_TOO_SHORT', 'errors.reasonTooShort');
      }
      if (typeof category !== 'string' || !VALID_CATEGORIES.has(category)) {
        throw new AppError(400, 'INVALID_CATEGORY', 'errors.invalidCategory');
      }
      const result = await freezeUser(
        {
          userId: req.params.userId,
          adminId: req.user.userId,
          reason: reasonStr,
          category: category as FreezeCategory,
          notify: notify === true,
        },
        prisma,
        safeIo(),
      ).catch((err: any) => {
        if (err?.code === 'USER_NOT_FOUND') {
          throw new AppError(404, 'NOT_FOUND', 'errors.notFound');
        }
        throw err;
      });
      res.json({
        adminAction: result.adminAction,
        heldBatchCount: result.heldBatchCount,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * @openapi
 * /api/admin/freeze/{userId}/unfreeze:
 *   post:
 *     summary: Unfreeze a user account, optionally release held payouts.
 *     tags: [Admin - Freeze]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason]
 *             properties:
 *               reason: { type: string }
 *               releasePayouts: { type: boolean }
 *               notify: { type: boolean }
 *     responses:
 *       200: { description: Unfreeze action recorded }
 *       400: { description: Invalid reason }
 *       404: { description: User not found }
 */
router.post(
  '/:userId/unfreeze',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user?.userId) {
        throw new AppError(401, 'UNAUTHORIZED', 'errors.unauthorized');
      }
      const { reason, releasePayouts, notify } = req.body ?? {};
      const reasonStr = typeof reason === 'string' ? reason.trim() : '';
      if (reasonStr.length < ADMIN_REASON_MIN_LENGTH) {
        throw new AppError(400, 'REASON_TOO_SHORT', 'errors.reasonTooShort');
      }
      const result = await unfreezeUser(
        {
          userId: req.params.userId,
          adminId: req.user.userId,
          reason: reasonStr,
          releasePayouts: releasePayouts === true,
          notify: notify === true,
        },
        prisma,
        safeIo(),
      ).catch((err: any) => {
        if (err?.code === 'USER_NOT_FOUND') {
          throw new AppError(404, 'NOT_FOUND', 'errors.notFound');
        }
        throw err;
      });
      res.json({
        adminAction: result.adminAction,
        releasedBatchCount: result.heldBatchCount,
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
