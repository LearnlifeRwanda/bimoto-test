import { Router } from 'express';
import { JourneyStatus } from '@prisma/client';
import { authMiddleware } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { createPickupVerificationSchema } from '@bimoto/shared';
import prisma from '../prisma';

// PILOT-INSTRUMENT — pickup-identity verification capture (the V-4
// evidence trigger). Records the customer's answer to "Is this your
// driver? (jacket #NNNN)" shown on the matched screen when
// approachStatus hits 'arrived'.
//
// Evidence, not enforcement: the ONLY write in this file is the
// PickupVerification upsert. A MISMATCH/UNSURE answer must never
// freeze, flag, cancel, or notify — it is a row for a human to read
// via the admin summary. Keep it that way.
const router = Router();

/**
 * @openapi
 * /api/journeys/{id}/pickup-verification:
 *   post:
 *     summary: Record the customer's pickup-identity answer ("Is this your driver?"). Evidence only — no side effects.
 *     tags: [Journeys]
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
 *             required: [outcome]
 *             properties:
 *               outcome: { type: string, enum: [MATCHED, MISMATCH, UNSURE] }
 *               reason:  { type: string, enum: [WRONG_NUMBER, NO_VEST, DIFFERENT_PERSON] }
 *     responses:
 *       201:
 *         description: The recorded (or re-recorded — last answer wins) verification row.
 *         content:
 *           application/json:
 *             schema: { type: object }
 *       400:
 *         description: Journey is not MATCHED or IN_PROGRESS.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       403:
 *         description: Caller is not the customer of this journey.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       404:
 *         description: Journey not found.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
// POST /api/journeys/:id/pickup-verification
router.post(
  '/:id/pickup-verification',
  authMiddleware,
  validate(createPickupVerificationSchema),
  async (req, res, next) => {
    try {
      const journey = await prisma.journey.findUnique({
        where: { id: req.params.id },
        select: { id: true, customerId: true, status: true },
      });
      if (!journey) {
        res.status(404).json({
          error: { code: 'JOURNEY_NOT_FOUND', message: 'errors.journeyNotFound' },
        });
        return;
      }
      if (journey.customerId !== req.user!.userId) {
        res.status(403).json({
          error: {
            code: 'NOT_JOURNEY_CUSTOMER',
            message: 'errors.notJourneyCustomer',
          },
        });
        return;
      }
      // The prompt only makes sense at pickup: after match, before the
      // ride is over. Anything else (cancelled, completed, still
      // bidding) is rejected rather than silently recorded.
      if (
        journey.status !== JourneyStatus.MATCHED &&
        journey.status !== JourneyStatus.IN_PROGRESS
      ) {
        res.status(400).json({
          error: {
            code: 'JOURNEY_NOT_AT_PICKUP',
            message: 'errors.journeyNotAtPickup',
          },
        });
        return;
      }

      const { outcome, reason } = req.body as {
        outcome: 'MATCHED' | 'MISMATCH' | 'UNSURE';
        reason?: string;
      };
      // One row per journey; re-answering overwrites (last answer wins).
      const row = await prisma.pickupVerification.upsert({
        where: { journeyId: journey.id },
        create: {
          journeyId: journey.id,
          customerId: journey.customerId,
          outcome,
          reason: reason ?? null,
        },
        update: { outcome, reason: reason ?? null },
      });
      res.status(201).json(row);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
