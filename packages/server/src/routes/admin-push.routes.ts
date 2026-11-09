import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware, adminOnly } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { sendPushToUser } from '../services/push';

const router = Router();

const adminTestSchema = z.object({
  userId: z.string().uuid(),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(1000),
});

/**
 * @openapi
 * /api/admin/push/test:
 *   post:
 *     summary: Send a test push to all of a user's active tokens (admin-only).
 *     description: Used to verify FCM/APNS configuration end-to-end against a real device without booting the full app.
 *     tags: [Push, Admin]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [userId, title, body]
 *             properties:
 *               userId: { type: string, format: uuid }
 *               title:  { type: string }
 *               body:   { type: string }
 *     responses:
 *       200:
 *         description: Per-token send results so the operator can debug provider errors.
 */
router.post('/test', authMiddleware, adminOnly, validate(adminTestSchema), async (req, res, next) => {
  try {
    const { userId, title, body } = req.body as z.infer<typeof adminTestSchema>;
    const results = await sendPushToUser(userId, {
      title,
      body,
      data: { type: 'journey' },
    });
    res.json({ results });
  } catch (err) {
    next(err);
  }
});

export default router;
