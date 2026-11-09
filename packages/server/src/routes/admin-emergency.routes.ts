// SOS-FOLLOW G3 — the ops side of an emergency that always ends.
//
// Router-level adminOnly, like every other /api/admin/* surface. An
// ANALYST is refused here by the same guard that refuses them
// everywhere else, and the analyst access matrix asserts it: the live
// follow is ops-only, and "ops" means the role that can act, never the
// role that can read numbers.
//
// The whole point of this file is the Resolve button. Everything else
// this dispatch builds — the state row, the stream, the ops list — is
// only defensible because an emergency ENDS, and ends by a person
// writing down what happened. So the note is required and held to the
// same ADMIN_REASON_MIN_LENGTH every other administrative decision is:
// "ok" is not a reason to stop following somebody who pressed a panic
// button, and the ten-character floor is the codebase's existing way of
// saying so (admin-freeze.routes.ts).

import { Router } from 'express';
import { EmergencyAlertStatus } from '@prisma/client';
import { authMiddleware, adminOnly } from '../middleware/auth';
import { AppError } from '../middleware/error-handler';
import prisma from '../prisma';
import {
  ADMIN_LIST_DEFAULT_LIMIT,
  ADMIN_LIST_MAX_LIMIT,
  ADMIN_REASON_MIN_LENGTH,
} from '../services/admin/config';
import { endEmergencyAlert } from '../services/emergency-alert.service';

const router = Router();
router.use(authMiddleware);
router.use(adminOnly);

/**
 * @openapi
 * /api/admin/emergency/active:
 *   get:
 *     summary: Every ACTIVE emergency alert, oldest first. Admin only.
 *     tags: [Admin, Emergency]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: The live list the ops view follows.
 */
// Oldest first, deliberately. Every other admin list in this codebase is
// newest-first, because for those the newest row is the most
// interesting. Here the OLDEST open alert is the one nobody has dealt
// with, and it is the one that should be at the top of the screen.
router.get('/active', async (_req, res, next) => {
  try {
    const alerts = await prisma.emergencyAlert.findMany({
      where: { status: EmergencyAlertStatus.ACTIVE },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        journeyId: true,
        raisedById: true,
        raisedByRole: true,
        pressLat: true,
        pressLng: true,
        createdAt: true,
        journey: { select: { type: true, status: true, pickupName: true, destinationName: true } },
        raisedBy: { select: { nickname: true } },
      },
    });
    res.json({ alerts });
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/admin/emergency/history:
 *   get:
 *     summary: Closed emergency alerts (RESOLVED and EXPIRED), newest first. Admin only.
 *     tags: [Admin, Emergency]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Closed alerts with their notes and how each ended.
 */
// RESOLVED and EXPIRED together, distinguished by `status` rather than
// merged. "An administrator looked at this and closed it" and "this
// timed out with nobody looking" are different facts about how the pilot
// is being run, and a history that hid the second one would hide the
// only evidence that the panel is going unwatched.
router.get('/history', async (req, res, next) => {
  try {
    const raw = req.query.limit;
    let limit = ADMIN_LIST_DEFAULT_LIMIT;
    if (raw !== undefined && raw !== '') {
      const n = parseInt(String(raw), 10);
      if (Number.isNaN(n) || n < 1 || n > ADMIN_LIST_MAX_LIMIT) {
        throw new AppError(400, 'INVALID_LIMIT', 'errors.invalidLimit');
      }
      limit = n;
    }

    const alerts = await prisma.emergencyAlert.findMany({
      where: { status: { in: [EmergencyAlertStatus.RESOLVED, EmergencyAlertStatus.EXPIRED] } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        journeyId: true,
        raisedByRole: true,
        status: true,
        createdAt: true,
        resolvedAt: true,
        resolveNote: true,
        journey: { select: { type: true } },
        raisedBy: { select: { nickname: true } },
        resolvedBy: { select: { nickname: true } },
      },
    });
    res.json({ alerts });
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/admin/emergency/{id}/resolve:
 *   post:
 *     summary: Close an ACTIVE emergency alert with a written note. Admin only.
 *     tags: [Admin, Emergency]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [note]
 *             properties:
 *               note: { type: string, description: What happened. Held to ADMIN_REASON_MIN_LENGTH. }
 *     responses:
 *       200:
 *         description: The alert is RESOLVED; both rooms have been told and the follow streams stop.
 *       400:
 *         description: The note is missing or too short.
 *       404:
 *         description: No ACTIVE alert with this id (unknown, or another admin closed it first).
 */
router.post('/:id/resolve', async (req, res, next) => {
  try {
    const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
    if (note.length < ADMIN_REASON_MIN_LENGTH) {
      throw new AppError(400, 'REASON_TOO_SHORT', 'errors.reasonTooShort');
    }

    const outcome = await endEmergencyAlert({
      alertId: req.params.id,
      status: EmergencyAlertStatus.RESOLVED,
      note,
      adminId: req.user!.userId,
    });

    // Already closed, or never existed. Two admins reaching for the same
    // alert is an ordinary race and the loser has nothing to do; the
    // 404 says the alert is not open, which is true either way.
    if (!outcome) {
      throw new AppError(404, 'ALERT_NOT_ACTIVE', 'errors.emergencyAlertNotActive');
    }

    res.json({
      alertId: outcome.alertId,
      journeyId: outcome.journeyId,
      status: outcome.status,
    });
  } catch (err) { next(err); }
});

export default router;
