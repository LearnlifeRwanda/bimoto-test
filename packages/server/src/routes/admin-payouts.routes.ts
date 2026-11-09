import { Router, Request, Response, NextFunction } from 'express';
import { decryptedPhoneOrNull } from '../services/user-phone';
import { DriverPayoutStatus, PayoutBatchTrigger } from '@prisma/client';
import { authMiddleware, adminOnly } from '../middleware/auth';
import { AppError } from '../middleware/error-handler';
import prisma from '../prisma';
import {
  ADMIN_LIST_DEFAULT_LIMIT,
  ADMIN_LIST_MAX_LIMIT,
} from '../services/admin/config';
import {
  getEffectivePreference,
  PayoutPref,
} from '../services/payout/training-wheels';
import { countFrozenDrivers } from '../services/admin/freeze.service';

const router = Router();
router.use(authMiddleware);
router.use(adminOnly);

const VALID_STATUSES = new Set<string>(Object.values(DriverPayoutStatus));
const VALID_TRIGGERS = new Set<string>(Object.values(PayoutBatchTrigger));

// A PENDING batch normally settles within one reconciler cycle; anything
// still PENDING after this long is "stuck" and worth an operator's look.
const STUCK_PENDING_MINUTES = 30;

// Default list window: 7 days.
const DEFAULT_SINCE_HOURS = 168;

// DECRYPT v3 addendum — extracted to a const, which is precisely why the
// rename slipped past tsc here: TypeScript applies excess-property checking
// only to FRESH object literals, so a select hoisted into a variable is
// never checked against Prisma's UserSelect at all. Prisma still rejects an
// unknown field at runtime, so this had to be found by executing it.
const DRIVER_SELECT = { id: true, nickname: true, phoneEncrypted: true } as const;

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

function parseOffset(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') return 0;
  const n = parseInt(String(raw), 10);
  if (Number.isNaN(n) || n < 0) {
    throw new AppError(400, 'INVALID_OFFSET', 'errors.invalidOffset');
  }
  return n;
}

function parseSinceHours(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') {
    return DEFAULT_SINCE_HOURS;
  }
  const n = parseInt(String(raw), 10);
  if (Number.isNaN(n) || n < 1) {
    throw new AppError(400, 'INVALID_SINCE_HOURS', 'errors.invalidSinceHours');
  }
  return n;
}

/** Attach { nickname, phone } for each batch's driverId (one users query). */
async function joinDrivers(batches: any[]): Promise<any[]> {
  const driverIds = Array.from(new Set(batches.map((b) => b.driverId)));
  if (driverIds.length === 0) return batches;
  const users = await prisma.user.findMany({
    where: { id: { in: driverIds } },
    select: DRIVER_SELECT,
  });
  // The response contract is a dialable `phone` (AdminPayouts.tsx renders
  // b.driver.phone); the column behind it is ciphertext.
  const byId = new Map(
    users.map(({ phoneEncrypted, ...rest }) => [
      rest.id,
      { ...rest, phone: decryptedPhoneOrNull({ phoneEncrypted }) ?? '' },
    ]),
  );
  return batches.map((b) => ({
    ...b,
    driver: byId.get(b.driverId) ?? null,
  }));
}

/** Count batches grouped by a field, zero-filled over the enum's values. */
async function countsBy(
  field: 'status' | 'trigger',
  values: string[],
  where: any,
): Promise<Record<string, number>> {
  const groups = await (prisma.driverPayoutBatch.groupBy as any)({
    by: [field],
    where,
    _count: { _all: true },
  });
  const out: Record<string, number> = {};
  for (const v of values) out[v] = 0;
  for (const g of groups) out[g[field]] = g._count._all;
  return out;
}

/**
 * @openapi
 * /api/admin/payouts/batches:
 *   get:
 *     summary: List payout batches (newest first) with driver nickname/phone.
 *     tags: [Admin - Payouts]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [PENDING, SUCCESS, FAILED] }
 *       - in: query
 *         name: trigger
 *         schema: { type: string }
 *       - in: query
 *         name: held
 *         schema: { type: boolean }
 *       - in: query
 *         name: driverId
 *         schema: { type: string }
 *       - in: query
 *         name: sinceHours
 *         schema: { type: integer, minimum: 1, default: 168 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 200, default: 50 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, minimum: 0, default: 0 }
 *     responses:
 *       200: { description: Batches + total count for pagination }
 *       400: { description: Invalid filter value }
 */
router.get('/batches', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = parseLimit(req.query.limit);
    const offset = parseOffset(req.query.offset);
    const sinceHours = parseSinceHours(req.query.sinceHours);

    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    if (status && !VALID_STATUSES.has(status)) {
      throw new AppError(400, 'INVALID_STATUS', 'errors.invalidStatus');
    }
    const trigger = typeof req.query.trigger === 'string' ? req.query.trigger : undefined;
    if (trigger && !VALID_TRIGGERS.has(trigger)) {
      throw new AppError(400, 'INVALID_TRIGGER', 'errors.invalidTrigger');
    }
    const heldRaw = typeof req.query.held === 'string' ? req.query.held : undefined;
    if (heldRaw !== undefined && heldRaw !== 'true' && heldRaw !== 'false') {
      throw new AppError(400, 'INVALID_HELD', 'errors.invalidHeld');
    }
    const driverId =
      typeof req.query.driverId === 'string' && req.query.driverId !== ''
        ? req.query.driverId
        : undefined;

    const where: any = {
      createdAt: { gte: new Date(Date.now() - sinceHours * 60 * 60 * 1000) },
    };
    if (status) where.status = status;
    if (trigger) where.trigger = trigger;
    if (heldRaw !== undefined) where.held = heldRaw === 'true';
    if (driverId) where.driverId = driverId;

    const [total, batches] = await Promise.all([
      prisma.driverPayoutBatch.count({ where }),
      prisma.driverPayoutBatch.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
    ]);

    res.json({ batches: await joinDrivers(batches), total, limit, offset });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/admin/payouts/summary:
 *   get:
 *     summary: Operations pulse — batch counts, stuck/reversal/held/frozen totals.
 *     tags: [Admin - Payouts]
 *     responses:
 *       200:
 *         description: >
 *           Counts by status and trigger for the last 24h and 7d; PENDING
 *           batches older than 30 min (stuck); batches reversed within the
 *           last 7d (reversedAt window; pre-2026-07 reversals lack the
 *           timestamp and fall back to the FAILED-with-paidOutAt-in-window
 *           approximation); currently-held batches; currently-frozen drivers;
 *           open AML flags by severity (review-queue depth).
 */
router.get('/summary', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const now = Date.now();
    const h24 = new Date(now - 24 * 60 * 60 * 1000);
    const d7 = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const stuckCutoff = new Date(now - STUCK_PENDING_MINUTES * 60 * 1000);

    const statuses = Object.values(DriverPayoutStatus);
    const triggers = Object.values(PayoutBatchTrigger);

    const [
      byStatus24h,
      byTrigger24h,
      byStatus7d,
      byTrigger7d,
      stuckPendingCount,
      reversedCount7d,
      heldCount,
      frozenDriverCount,
      openAmlBySeverity,
    ] = await Promise.all([
      countsBy('status', statuses, { createdAt: { gte: h24 } }),
      countsBy('trigger', triggers, { createdAt: { gte: h24 } }),
      countsBy('status', statuses, { createdAt: { gte: d7 } }),
      countsBy('trigger', triggers, { createdAt: { gte: d7 } }),
      prisma.driverPayoutBatch.count({
        where: { status: 'PENDING', createdAt: { lt: stuckCutoff } },
      }),
      // Reversals (payout.service markBatchTransferReversed): since PAYOUT-E
      // the reversal stamps reversedAt, so the 7d window is exact. Rows
      // reversed before the reversedAt column existed have it null — for
      // those only, fall back to the old approximation (FAILED with
      // paidOutAt in window; the webhook flip leaves paidOutAt set).
      prisma.driverPayoutBatch.count({
        where: {
          status: 'FAILED',
          OR: [
            { reversedAt: { gte: d7 } },
            { reversedAt: null, paidOutAt: { gte: d7 } },
          ],
        },
      }),
      prisma.driverPayoutBatch.count({ where: { held: true } }),
      countFrozenDrivers(),
      // Review-queue depth: open AML flags by severity, one groupBy on
      // the [status, severity] index.
      prisma.amlFlag.groupBy({
        by: ['severity'],
        where: { status: 'OPEN' },
        _count: { _all: true },
      }),
    ]);

    const openAmlFlags: Record<string, number> = {
      LOW: 0,
      MEDIUM: 0,
      HIGH: 0,
      CRITICAL: 0,
    };
    let openAmlFlagCount = 0;
    for (const row of openAmlBySeverity) {
      openAmlFlags[row.severity] = row._count._all;
      openAmlFlagCount += row._count._all;
    }

    res.json({
      last24h: { byStatus: byStatus24h, byTrigger: byTrigger24h },
      last7d: { byStatus: byStatus7d, byTrigger: byTrigger7d },
      stuckPendingCount,
      reversedCount7d,
      heldCount,
      frozenDriverCount,
      openAmlFlags,
      openAmlFlagCount,
      stuckThresholdMinutes: STUCK_PENDING_MINUTES,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/admin/payouts/driver/{driverId}:
 *   get:
 *     summary: Driver money view — balance, preference, freeze state, last 20 batches.
 *     tags: [Admin - Payouts]
 *     parameters:
 *       - in: path
 *         name: driverId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Driver money detail }
 *       404: { description: Driver not found }
 */
router.get('/driver/:driverId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.driverId },
      select: {
        id: true,
        nickname: true,
        phoneEncrypted: true,
        role: true,
        payoutPreference: true,
        completedShifts: true,
        frozenAt: true,
        frozenReason: true,
        frozenBy: true,
        frozenCategory: true,
      },
    });
    if (!user) throw new AppError(404, 'NOT_FOUND', 'errors.notFound');
    const u = user as any;
    const driverId: string = u.id;

    const [balance, batches] = await Promise.all([
      prisma.driverBalance.findUnique({ where: { driverId } }),
      prisma.driverPayoutBatch.findMany({
        where: { driverId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);

    const stored = u.payoutPreference as PayoutPref;
    const effective = getEffectivePreference({
      payoutPreference: stored,
      completedShifts: u.completedShifts,
    });

    res.json({
      driver: {
        id: u.id,
        nickname: u.nickname,
        phone: decryptedPhoneOrNull(u) ?? '',
        role: u.role,
      },
      pendingAmount: balance?.pendingAmount ?? 0,
      storedPreference: stored,
      effectivePreference: effective,
      trainingWheelsActive: effective !== stored,
      freeze: {
        frozenAt: u.frozenAt,
        frozenReason: u.frozenReason,
        frozenBy: u.frozenBy,
        frozenCategory: u.frozenCategory,
      },
      batches,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/admin/payouts/batches/{id}:
 *   get:
 *     summary: Single payout batch, full row + driver.
 *     tags: [Admin - Payouts]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Batch detail }
 *       404: { description: Not found }
 */
router.get('/batches/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const batch = await prisma.driverPayoutBatch.findUnique({
      where: { id: req.params.id },
    });
    if (!batch) throw new AppError(404, 'NOT_FOUND', 'errors.notFound');
    const [joined] = await joinDrivers([batch]);
    res.json({ batch: joined });
  } catch (err) {
    next(err);
  }
});

export default router;
