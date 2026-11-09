// ROUTES/DRIVER-AUTO-BID.ROUTES.TS
//
// REST surface for Dispatch K2 — driver auto-bid rules.
//
//   GET    /            list driver's rules (priority asc)
//   POST   /            create a new rule (max 5 enabled, priority unique)
//   PATCH  /:id         update a rule (cross-driver protected)
//   DELETE /:id         delete a rule
//   POST   /pause-all   one-tap kill switch — paused rules are skipped by evaluator
//   POST   /resume-all  reactivate all paused rules at once
//
// Auth: existing authMiddleware → driverOnly. The store layer
// re-validates business rules so any path (tests, future jobs)
// stays inside the contract.

import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { authMiddleware, driverOnly } from '../middleware/auth';
import { AppError } from '../middleware/error-handler';
import prisma from '../prisma';
import * as rulesStore from '../services/auto-bid/rules-store';
import { RuleStoreError, type RuleInput } from '../services/auto-bid/types';
import {
  MAX_PICKUP_DISTANCE_M,
  MAX_RIDE_DISTANCE_M,
  MAX_RULES_PER_DRIVER,
  MIN_PICKUP_DISTANCE_M,
  MIN_RIDE_DISTANCE_M,
} from '../services/auto-bid/config';

const router = Router();

const ruleInputSchema = z.object({
  priority: z.number().int().min(0).max(MAX_RULES_PER_DRIVER - 1),
  enabled: z.boolean(),
  maxPickupDistanceM: z.number().int().min(MIN_PICKUP_DISTANCE_M).max(MAX_PICKUP_DISTANCE_M),
  maxRideDistanceM: z.number().int().min(MIN_RIDE_DISTANCE_M).max(MAX_RIDE_DISTANCE_M),
  // DEADWOOD G4 — the enum drift that made one filter unusable.
  //
  // This accepted 'EMOTO' while the shared VehicleType enum (and every
  // Journey.vehiclePreference row written from it) says 'E_MOTO'. The
  // evaluator matches with a plain !== against journey.vehiclePreference
  // (services/auto-bid/evaluator.ts), so a rule filtered to electric
  // motos could never match a journey: the driver wrote a rule that was
  // silently guaranteed never to fire.
  //
  // Canonical value is now the shared enum's 'E_MOTO'. 'EMOTO' is still
  // ACCEPTED and normalised rather than rejected, because a deployed
  // APK still sends it — a 400 on a rule a driver had already written
  // would be a worse bug than the one being fixed. Rows persisted with
  // the old spelling are rewritten by the
  // 20260813000000_deadwood_auto_bid_emoto migration.
  //
  // FLIGHT-RECORDER G5.4 — E_BIKE was the fourth member of the shared
  // VehicleType enum and the only one this filter never accepted. An
  // e-bike driver could scope a rule to any machine but his own: the
  // list offered MOTO, BIKE and E_MOTO, so his choices were "every
  // journey" or a vehicle he does not ride. Added additively; every
  // stored rule keeps the value it has.
  vehicleTypeFilter: z
    .enum(['MOTO', 'BIKE', 'E_MOTO', 'E_BIKE', 'EMOTO'])
    .transform((v) => (v === 'EMOTO' ? 'E_MOTO' : v))
    .nullable(),
  bidAmountMode: z.enum(['FLAT', 'PERCENT_OF_FAIR_PRICE']),
  bidAmountValue: z.number().positive(),
});

const ruleUpdateSchema = ruleInputSchema.partial();

// Map store-layer errors to HTTP status codes. Centralized here so
// every route returns the same status for the same store-error code.
function storeErrorStatus(code: string): number {
  switch (code) {
    case 'TOO_MANY_RULES':
    case 'PRIORITY_TAKEN':
    case 'INVALID_AMOUNT':
    case 'INVALID_DISTANCE':
    case 'INVALID_PRIORITY':
      return 400;
    case 'NOT_RULE_OWNER':
      return 403;
    case 'RULE_NOT_FOUND':
      return 404;
    default:
      return 400;
  }
}

function asAppError(err: unknown): AppError {
  if (err instanceof RuleStoreError) {
    return new AppError(storeErrorStatus(err.code), err.code, err.message);
  }
  if (err instanceof AppError) return err;
  return new AppError(500, 'INTERNAL_ERROR', 'errors.generic');
}

/**
 * @openapi
 * /api/driver/auto-bid-rules:
 *   get:
 *     summary: List the calling driver's auto-bid rules.
 *     tags: [DriverAutoBid]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Rules sorted by priority asc.
 */
router.get('/', authMiddleware, driverOnly, async (req, res, next) => {
  try {
    const rules = await rulesStore.listRulesForDriver(prisma, req.user!.userId);
    res.json(rules);
  } catch (err) {
    next(asAppError(err));
  }
});

/**
 * @openapi
 * /api/driver/auto-bid-rules:
 *   post:
 *     summary: Create a new auto-bid rule.
 *     tags: [DriverAutoBid]
 *     security:
 *       - cookieAuth: []
 */
router.post(
  '/',
  authMiddleware,
  driverOnly,
  validate(ruleInputSchema),
  async (req, res, next) => {
    try {
      const created = await rulesStore.createRule(
        prisma,
        req.user!.userId,
        req.body as RuleInput,
      );
      res.status(201).json(created);
    } catch (err) {
      next(asAppError(err));
    }
  },
);

/**
 * @openapi
 * /api/driver/auto-bid-rules/{id}:
 *   patch:
 *     summary: Update fields on an auto-bid rule.
 *     tags: [DriverAutoBid]
 *     security:
 *       - cookieAuth: []
 */
router.patch(
  '/:id',
  authMiddleware,
  driverOnly,
  validate(ruleUpdateSchema),
  async (req, res, next) => {
    try {
      const updated = await rulesStore.updateRule(
        prisma,
        req.params.id,
        req.user!.userId,
        req.body as Partial<RuleInput>,
      );
      res.json(updated);
    } catch (err) {
      next(asAppError(err));
    }
  },
);

/**
 * @openapi
 * /api/driver/auto-bid-rules/{id}:
 *   delete:
 *     summary: Delete an auto-bid rule. Historical bids stay (autoBidRuleId becomes null).
 *     tags: [DriverAutoBid]
 *     security:
 *       - cookieAuth: []
 */
router.delete('/:id', authMiddleware, driverOnly, async (req, res, next) => {
  try {
    await rulesStore.deleteRule(prisma, req.params.id, req.user!.userId);
    res.status(204).send();
  } catch (err) {
    next(asAppError(err));
  }
});

/**
 * @openapi
 * /api/driver/auto-bid-rules/pause-all:
 *   post:
 *     summary: One-tap kill switch — pause all the driver's rules.
 *     tags: [DriverAutoBid]
 *     security:
 *       - cookieAuth: []
 */
router.post('/pause-all', authMiddleware, driverOnly, async (req, res, next) => {
  try {
    const result = await rulesStore.pauseAllRules(prisma, req.user!.userId);
    res.json(result);
  } catch (err) {
    next(asAppError(err));
  }
});

/**
 * @openapi
 * /api/driver/auto-bid-rules/resume-all:
 *   post:
 *     summary: Resume all paused rules in one shot.
 *     tags: [DriverAutoBid]
 *     security:
 *       - cookieAuth: []
 */
router.post('/resume-all', authMiddleware, driverOnly, async (req, res, next) => {
  try {
    const result = await rulesStore.resumeAllRules(prisma, req.user!.userId);
    res.json(result);
  } catch (err) {
    next(asAppError(err));
  }
});

export default router;
