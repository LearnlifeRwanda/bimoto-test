// Dispatch M — cooperative-leader API surface. All routes mounted at
// /api/cooperative/. Both authMiddleware and requireCooperativeLeader
// run on every request — read or write — so cooperative scoping is
// always enforced. Group 5 ships read-only routes; group 6 adds
// management mutations; group 8 adds the dispatch endpoint.

import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware, requireCooperativeLeader } from '../middleware/auth';
import { AppError } from '../middleware/error-handler';
import prisma from '../prisma';
import {
  computeCooperativeDashboard,
  listCooperativeDrivers,
  getDriverDetail,
  computeFinancialSummary,
} from '../services/cooperative/dashboard.service';
import {
  approveDriver,
  rejectDriver,
  setDriverActive,
  addDriverToCooperativeViaLeader,
  removeDriverFromCooperativeViaLeader,
} from '../services/cooperative/management.service';
import {
  dispatchBidOnBehalf,
  DispatchValidationError,
  DispatchInProgressError,
} from '../services/cooperative/dispatch.service';
import { AuthorizationError } from '../services/cooperative/scope';
import {
  DASHBOARD_DEFAULT_PERIOD_DAYS,
  DASHBOARD_MAX_PERIOD_DAYS,
  DRIVER_LIST_PAGE_SIZE,
  DRIVER_LIST_MAX_PAGE_SIZE,
  COOPERATIVE_REASON_MIN_LENGTH,
} from '../services/cooperative/config';

const router = Router();
router.use(authMiddleware);
router.use(requireCooperativeLeader);

function parsePeriodDays(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') {
    return DASHBOARD_DEFAULT_PERIOD_DAYS;
  }
  const n = parseInt(String(raw), 10);
  if (Number.isNaN(n) || n < 1 || n > DASHBOARD_MAX_PERIOD_DAYS) {
    throw new AppError(400, 'INVALID_PERIOD_DAYS', 'errors.invalidPeriodDays');
  }
  return n;
}

function parseLimit(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') return DRIVER_LIST_PAGE_SIZE;
  const n = parseInt(String(raw), 10);
  if (Number.isNaN(n) || n < 1 || n > DRIVER_LIST_MAX_PAGE_SIZE) {
    throw new AppError(400, 'INVALID_LIMIT', 'errors.invalidLimit');
  }
  return n;
}

function parseOffset(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') return 0;
  const n = parseInt(String(raw), 10);
  if (Number.isNaN(n) || n < 0) {
    throw new AppError(400, 'INVALID_OFFSET', 'errors.invalidOffset');
  }
  return n;
}

function requireCoopId(req: Request): string {
  const id = req.user?.cooperativeId;
  if (!id) {
    throw new AppError(403, 'NO_COOPERATIVE_ASSIGNED', 'errors.no_cooperative_assigned');
  }
  return id;
}

/**
 * @openapi
 * /api/cooperative/dashboard:
 *   get:
 *     summary: Aggregate dashboard summary for the leader's cooperative.
 *     tags: [Cooperative Leader]
 *     parameters:
 *       - in: query
 *         name: periodDays
 *         schema: { type: integer, minimum: 1, maximum: 90 }
 *     responses:
 *       200: { description: Dashboard summary }
 */
router.get('/dashboard', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cooperativeId = requireCoopId(req);
    const periodDays = parsePeriodDays(req.query.periodDays);
    const summary = await computeCooperativeDashboard(
      prisma,
      cooperativeId,
      periodDays,
    ).catch((err) => {
      if (err instanceof AuthorizationError) {
        throw new AppError(404, 'NOT_FOUND', 'errors.notFound');
      }
      throw err;
    });
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/cooperative/drivers:
 *   get:
 *     summary: Paginated driver list for the leader's cooperative.
 *     tags: [Cooperative Leader]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 200 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, minimum: 0 }
 *       - in: query
 *         name: onlineOnly
 *         schema: { type: boolean }
 *       - in: query
 *         name: flaggedOnly
 *         schema: { type: boolean }
 *     responses:
 *       200: { description: Driver rows }
 */
router.get('/drivers', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cooperativeId = requireCoopId(req);
    const limit = parseLimit(req.query.limit);
    const offset = parseOffset(req.query.offset);
    const onlineOnly = req.query.onlineOnly === 'true';
    const flaggedOnly = req.query.flaggedOnly === 'true';
    const drivers = await listCooperativeDrivers(prisma, cooperativeId, {
      limit,
      offset,
      onlineOnly,
      flaggedOnly,
    });
    res.json({ drivers });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/cooperative/drivers/{driverProfileId}:
 *   get:
 *     summary: Per-driver detail (recent journeys + earnings + AML flags).
 *     tags: [Cooperative Leader]
 *     parameters:
 *       - in: path
 *         name: driverProfileId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Driver detail }
 *       404: { description: Driver not in this cooperative }
 */
router.get('/drivers/:driverProfileId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cooperativeId = requireCoopId(req);
    const detail = await getDriverDetail(
      prisma,
      cooperativeId,
      req.params.driverProfileId,
    ).catch((err) => {
      if (err instanceof AuthorizationError) {
        throw new AppError(404, 'NOT_FOUND', 'errors.notFound');
      }
      throw err;
    });
    res.json(detail);
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/cooperative/financials:
 *   get:
 *     summary: Cooperative-level financial summary (totals + per-driver).
 *     tags: [Cooperative Leader]
 *     parameters:
 *       - in: query
 *         name: periodDays
 *         schema: { type: integer, minimum: 1, maximum: 90 }
 *     responses:
 *       200: { description: Financial summary }
 */
router.get('/financials', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cooperativeId = requireCoopId(req);
    const periodDays = parsePeriodDays(req.query.periodDays);
    const summary = await computeFinancialSummary(
      prisma,
      cooperativeId,
      periodDays,
    ).catch((err) => {
      if (err instanceof AuthorizationError) {
        throw new AppError(404, 'NOT_FOUND', 'errors.notFound');
      }
      throw err;
    });
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/cooperative/me:
 *   get:
 *     summary: Leader's own user info + their cooperative summary.
 *     tags: [Cooperative Leader]
 *     responses:
 *       200: { description: Leader + cooperative basics }
 */
router.get('/me', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cooperativeId = requireCoopId(req);
    const cooperative = await prisma.cooperative.findUnique({
      where: { id: cooperativeId },
      select: {
        id: true,
        name: true,
        registrationNumber: true,
        leaderId: true,
        commissionRate: true,
        currency: true,
        active: true,
      },
    });
    if (!cooperative) {
      throw new AppError(404, 'NOT_FOUND', 'errors.notFound');
    }
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: {
        id: true,
        nickname: true,
        phoneEncrypted: true,
        role: true,
        cooperativeId: true,
      },
    });
    res.json({ user, cooperative });
  } catch (err) {
    next(err);
  }
});

const VALID_VEHICLE_TYPES = new Set(['BIKE', 'MOTO', 'E_MOTO', 'E_BIKE']);

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function mapDispatchError(err: any): never {
  if (err instanceof AuthorizationError) {
    throw new AppError(404, 'NOT_FOUND', 'errors.notFound');
  }
  if (err instanceof DispatchInProgressError) {
    throw new AppError(409, 'DISPATCH_IN_PROGRESS', 'errors.dispatchInProgress');
  }
  if (err instanceof DispatchValidationError) {
    if (err.code === 'customer-not-found' || err.code === 'driver-not-found') {
      throw new AppError(404, 'NOT_FOUND', 'errors.notFound');
    }
    if (err.code === 'invalid-price') {
      throw new AppError(400, 'INVALID_PRICE', 'errors.invalidPrice');
    }
    throw new AppError(
      422,
      err.code.toUpperCase().replace(/-/g, '_'),
      `errors.${err.code}`,
    );
  }
  throw err;
}

/**
 * @openapi
 * /api/cooperative/dispatch:
 *   post:
 *     summary: Manually dispatch a known customer to a driver in this cooperative.
 *     tags: [Cooperative Leader]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - driverId
 *               - customerId
 *               - pickupLat
 *               - pickupLng
 *               - destinationLat
 *               - destinationLng
 *               - vehiclePreference
 *             properties:
 *               driverId: { type: string }
 *               customerId: { type: string }
 *               pickupLat: { type: number }
 *               pickupLng: { type: number }
 *               pickupName: { type: string }
 *               destinationLat: { type: number }
 *               destinationLng: { type: number }
 *               destinationName: { type: string }
 *               vehiclePreference: { type: string, enum: [BIKE, MOTO, E_MOTO, E_BIKE] }
 *               priceRwf: { type: number }
 *               etaMinutes: { type: integer }
 *     responses:
 *       201: { description: Bid dispatched }
 *       400: { description: Invalid payload }
 *       404: { description: Driver or customer not found }
 *       409: { description: Another dispatch for this driver is already in flight }
 *       422: { description: Driver / customer state prevents dispatch }
 */
router.post('/dispatch', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cooperativeId = requireCoopId(req);
    const body = req.body ?? {};
    const driverId = typeof body.driverId === 'string' ? body.driverId : '';
    const customerId = typeof body.customerId === 'string' ? body.customerId : '';
    const vehiclePreference =
      typeof body.vehiclePreference === 'string' ? body.vehiclePreference : '';
    if (!driverId || !customerId) {
      throw new AppError(400, 'INVALID_IDS', 'errors.invalidIds');
    }
    if (!VALID_VEHICLE_TYPES.has(vehiclePreference)) {
      throw new AppError(400, 'INVALID_VEHICLE', 'errors.invalidVehicle');
    }
    if (
      !isFiniteNumber(body.pickupLat) ||
      !isFiniteNumber(body.pickupLng) ||
      !isFiniteNumber(body.destinationLat) ||
      !isFiniteNumber(body.destinationLng)
    ) {
      throw new AppError(400, 'INVALID_COORDS', 'errors.invalidCoords');
    }
    if (
      Math.abs(body.pickupLat) > 90 ||
      Math.abs(body.destinationLat) > 90 ||
      Math.abs(body.pickupLng) > 180 ||
      Math.abs(body.destinationLng) > 180
    ) {
      throw new AppError(400, 'INVALID_COORDS', 'errors.invalidCoords');
    }
    if (body.priceRwf !== undefined && body.priceRwf !== null) {
      if (!isFiniteNumber(body.priceRwf) || body.priceRwf <= 0) {
        throw new AppError(400, 'INVALID_PRICE', 'errors.invalidPrice');
      }
    }
    if (body.etaMinutes !== undefined && body.etaMinutes !== null) {
      if (!isFiniteNumber(body.etaMinutes) || body.etaMinutes < 0) {
        throw new AppError(400, 'INVALID_ETA', 'errors.invalidEta');
      }
    }

    const result = await dispatchBidOnBehalf(prisma, {
      leaderUserId: req.user!.userId,
      cooperativeId,
      driverId,
      customerId,
      pickupLat: body.pickupLat,
      pickupLng: body.pickupLng,
      pickupName: typeof body.pickupName === 'string' ? body.pickupName : undefined,
      destinationLat: body.destinationLat,
      destinationLng: body.destinationLng,
      destinationName:
        typeof body.destinationName === 'string' ? body.destinationName : undefined,
      vehiclePreference,
      priceRwf: typeof body.priceRwf === 'number' ? body.priceRwf : undefined,
      etaMinutes: typeof body.etaMinutes === 'number' ? body.etaMinutes : undefined,
    }).catch(mapDispatchError);

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

function mapAuthOrThrow(err: any): never {
  if (err instanceof AuthorizationError) {
    throw new AppError(404, 'NOT_FOUND', 'errors.notFound');
  }
  if (err?.code === 'REASON_TOO_SHORT') {
    throw new AppError(400, 'REASON_TOO_SHORT', 'errors.reasonTooShort');
  }
  if (err?.code === 'DRIVER_ALREADY_IN_OTHER_COOPERATIVE') {
    throw new AppError(
      409,
      'DRIVER_ALREADY_IN_OTHER_COOPERATIVE',
      'errors.driverAlreadyInOtherCooperative',
    );
  }
  throw err;
}

/**
 * @openapi
 * /api/cooperative/drivers/{driverProfileId}/approve:
 *   post:
 *     summary: Approve (verify) a driver in this cooperative.
 *     tags: [Cooperative Leader]
 *     parameters:
 *       - in: path
 *         name: driverProfileId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason: { type: string }
 *     responses:
 *       200: { description: Approved }
 *       404: { description: Driver not in this cooperative }
 */
router.post(
  '/drivers/:driverProfileId/approve',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const cooperativeId = requireCoopId(req);
      const updated = await approveDriver(prisma, {
        leaderUserId: req.user!.userId,
        cooperativeId,
        driverProfileId: req.params.driverProfileId,
        reason: typeof req.body?.reason === 'string' ? req.body.reason : undefined,
      }).catch(mapAuthOrThrow);
      res.json({ driver: updated });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * @openapi
 * /api/cooperative/drivers/{driverProfileId}/reject:
 *   post:
 *     summary: Reject a driver application in this cooperative.
 *     tags: [Cooperative Leader]
 *     parameters:
 *       - in: path
 *         name: driverProfileId
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
 *     responses:
 *       200: { description: Rejected }
 *       400: { description: Reason missing or too short }
 *       404: { description: Driver not in this cooperative }
 */
router.post(
  '/drivers/:driverProfileId/reject',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const cooperativeId = requireCoopId(req);
      const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
      if (reason.length < COOPERATIVE_REASON_MIN_LENGTH) {
        throw new AppError(400, 'REASON_TOO_SHORT', 'errors.reasonTooShort');
      }
      const updated = await rejectDriver(prisma, {
        leaderUserId: req.user!.userId,
        cooperativeId,
        driverProfileId: req.params.driverProfileId,
        reason,
      }).catch(mapAuthOrThrow);
      res.json({ driver: updated });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * @openapi
 * /api/cooperative/drivers/{driverProfileId}/set-active:
 *   post:
 *     summary: Mark a driver active or inactive (separate from verification).
 *     tags: [Cooperative Leader]
 *     parameters:
 *       - in: path
 *         name: driverProfileId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [active]
 *             properties:
 *               active: { type: boolean }
 *               reason: { type: string }
 *     responses:
 *       200: { description: Updated }
 *       400: { description: Missing active flag }
 *       404: { description: Driver not in this cooperative }
 */
router.post(
  '/drivers/:driverProfileId/set-active',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const cooperativeId = requireCoopId(req);
      if (typeof req.body?.active !== 'boolean') {
        throw new AppError(400, 'INVALID_ACTIVE_FLAG', 'errors.invalidActiveFlag');
      }
      const updated = await setDriverActive(prisma, {
        leaderUserId: req.user!.userId,
        cooperativeId,
        driverProfileId: req.params.driverProfileId,
        active: req.body.active,
        reason: typeof req.body?.reason === 'string' ? req.body.reason : undefined,
      }).catch(mapAuthOrThrow);
      res.json({ driver: updated });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * @openapi
 * /api/cooperative/drivers/{driverProfileId}/add-to-cooperative:
 *   post:
 *     summary: Sponsor an existing driver into this cooperative.
 *     tags: [Cooperative Leader]
 */
router.post(
  '/drivers/:driverProfileId/add-to-cooperative',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const cooperativeId = requireCoopId(req);
      const updated = await addDriverToCooperativeViaLeader(prisma, {
        leaderUserId: req.user!.userId,
        cooperativeId,
        driverProfileId: req.params.driverProfileId,
        reason: typeof req.body?.reason === 'string' ? req.body.reason : undefined,
      }).catch(mapAuthOrThrow);
      res.json({ driver: updated });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * @openapi
 * /api/cooperative/drivers/{driverProfileId}/remove-from-cooperative:
 *   post:
 *     summary: Remove a driver from this cooperative (DriverProfile remains).
 *     tags: [Cooperative Leader]
 */
router.post(
  '/drivers/:driverProfileId/remove-from-cooperative',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const cooperativeId = requireCoopId(req);
      const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
      if (reason.length < COOPERATIVE_REASON_MIN_LENGTH) {
        throw new AppError(400, 'REASON_TOO_SHORT', 'errors.reasonTooShort');
      }
      const updated = await removeDriverFromCooperativeViaLeader(prisma, {
        leaderUserId: req.user!.userId,
        cooperativeId,
        driverProfileId: req.params.driverProfileId,
        reason,
      }).catch(mapAuthOrThrow);
      res.json({ driver: updated });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
