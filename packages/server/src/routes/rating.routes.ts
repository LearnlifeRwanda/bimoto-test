import { Router } from 'express';
import { validate } from '../middleware/validate';
import { authMiddleware, customerOnly } from '../middleware/auth';
import { createRatingSchema } from '@bimoto/shared';
import * as ratingService from '../services/rating.service';
import * as journeyService from '../services/journey.service';

const router = Router();

/**
 * @openapi
 * /api/journeys/{id}/rate:
 *   post:
 *     summary: Passenger submits a 1–5 star rating of the driver of a completed journey.
 *     tags: [Ratings]
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
 *             description: >-
 *               Shape enforced by validate(createRatingSchema) — see
 *               packages/shared/src/schemas/rating.schema.ts. journeyId is
 *               required in the BODY as well as the path; posting { stars }
 *               alone is a 400 VALIDATION_ERROR.
 *             required: [journeyId, stars]
 *             properties:
 *               journeyId: { type: string, format: uuid }
 *               stars:     { type: integer, minimum: 1, maximum: 5 }
 *               comment:   { type: string, maxLength: 500 }
 *               reason:
 *                 type: string
 *                 description: >-
 *                   Optional low-star reason key (RatingReason). Never
 *                   required, at any star count.
 *                 enum: [UNSAFE_DRIVING, PRICE_DISAGREEMENT, RUDE_BEHAVIOUR, WRONG_ROUTE, VEHICLE_CONDITION, OTHER]
 *     responses:
 *       201:
 *         description: Created rating.
 *         content:
 *           application/json:
 *             schema: { type: object }
 *       403:
 *         description: >-
 *           Caller is not this journey's passenger. TEAM-ANSWERS G2 —
 *           ratings run one way only (passenger about driver), so the
 *           driver of this journey is refused here exactly as a stranger
 *           is. The driver's route for a bad ride is
 *           POST /api/journeys/{id}/report, which files an incident, not
 *           a grade.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
// POST /api/journeys/:id/rate
//
// TEAM-ANSWERS G2 — THE NARROWING (deliberate, non-additive). This route
// used to resolve either direction: "customer rates driver; driver rates
// customer". Under the founder decision recorded in
// packages/shared/src/types/rating.ts, passengers are never scored, so
// the route now runs one way only.
//
// SAFETY OF THE NARROWING: the driver direction had no caller. A grep of
// packages/{client,server,shared}/src for `/rate` at fb7916b returns the
// route itself, its two test files, and exactly one client caller —
// RateRideCard.tsx:70, mounted only on the passenger's receipt. Nothing
// live loses a path.
//
// customerOnly is defence in depth, not the guarantee: it admits role
// BOTH, and a BOTH user can be the driver on this very journey. The
// guarantee is in ratingService.createRating, which refuses any ratee
// that is not the journey's driver.
router.post('/:id/rate', authMiddleware, customerOnly, validate(createRatingSchema), async (req, res, next) => {
  try {
    const journey = await journeyService.getJourneyById(req.params.id);

    // One direction: this journey's passenger, about this journey's driver.
    if (journey.customerId !== req.user!.userId || !journey.driverId) {
      res.status(403).json({ error: { code: 'NOT_JOURNEY_PARTICIPANT', message: 'errors.notJourneyParticipant' } });
      return;
    }

    const rating = await ratingService.createRating(
      req.params.id,
      req.user!.userId,
      journey.driverId,
      req.body.stars,
      req.body.comment,
      req.body.reason,
    );
    res.status(201).json(rating);
  } catch (err) {
    next(err);
  }
});

export default router;
