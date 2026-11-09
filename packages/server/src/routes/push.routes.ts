import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { validate } from '../middleware/validate';
import prisma from '../prisma';

const router = Router();

const registerSchema = z.object({
  token: z.string().min(1).max(4096),
  platform: z.enum(['IOS', 'ANDROID']),
});

const deregisterSchema = z.object({
  token: z.string().min(1).max(4096),
});

/**
 * @openapi
 * /api/push/register:
 *   post:
 *     summary: Register or refresh the caller's push notification token.
 *     tags: [Push]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, platform]
 *             properties:
 *               token:    { type: string, description: 'FCM registration token (Android) or APNS device token (iOS).' }
 *               platform: { type: string, enum: [IOS, ANDROID] }
 *     responses:
 *       200:
 *         description: Token registered (idempotent).
 */
router.post('/register', authMiddleware, validate(registerSchema), async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const { token, platform } = req.body as z.infer<typeof registerSchema>;

    const existing = await prisma.deviceToken.findUnique({ where: { token } });
    if (existing) {
      await prisma.deviceToken.update({
        where: { token },
        data: {
          userId,
          platform,
          isActive: true,
          failureCount: 0,
          lastSeenAt: new Date(),
        },
      });
    } else {
      await prisma.deviceToken.create({
        data: { userId, platform, token },
      });
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/push/register:
 *   delete:
 *     summary: Deactivate a push token (called on logout).
 *     tags: [Push]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token]
 *             properties:
 *               token: { type: string }
 *     responses:
 *       200:
 *         description: Token deactivated (idempotent — unknown tokens still return 200).
 */
router.delete('/register', authMiddleware, validate(deregisterSchema), async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const { token } = req.body as z.infer<typeof deregisterSchema>;

    await prisma.deviceToken.updateMany({
      where: { userId, token },
      data: { isActive: false },
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
