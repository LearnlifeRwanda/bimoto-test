// ROUTES/ADMIN-MOBILITY.ROUTES.TS
//
// INTEL-DECK G4 — the router splits by verb, not by mount.
//
// Dispatch J put `router.use(adminOnly)` at the top and was done. That
// was right while the only reader was a founder. Now there is a
// read-only ANALYST whose entire world is this surface, so the guard
// moves onto each route: the three READS admit ANALYST or ADMIN via
// intelRead; the two MUTATIONS — re-running the aggregation, reloading
// the tier thresholds — stay adminOnly. An analyst may read what the
// pipeline produced; they may not re-run it or move the thresholds that
// govern what it is allowed to say.
//
// The paths are unchanged, so every existing admin caller is unaffected.

import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware, adminOnly, intelRead } from '../middleware/auth';
import { AppError } from '../middleware/error-handler';
import prisma from '../prisma';
import {
  TIER_CONFIGS,
  MOBILITY_RUN_NOW_MAX_RANGE_DAYS,
} from '../services/mobility/config';
import {
  reloadTierClassification,
  getTierClassificationVersion,
} from '../services/mobility/tier-classification';
import { runMobilityAggregationOnce } from '../jobs/mobility-aggregation.job';
import { sanitizeRows } from '../services/mobility/attribute-suppression';
import type { Tier, AggregateTypeName } from '../services/mobility/types';
import { MS_PER_DAY } from '@bimoto/shared';

const router = Router();
router.use(authMiddleware);

const ALL_TIERS: Tier[] = ['DENSE', 'MEDIUM', 'LOW', 'SPARSE'];
const ALL_AGGREGATE_TYPES: AggregateTypeName[] = ['POINT_DENSITY', 'OD_MATRIX'];
const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;

function parseTier(raw: unknown): Tier {
  if (typeof raw !== 'string' || !ALL_TIERS.includes(raw as Tier)) {
    throw new AppError(400, 'INVALID_TIER', 'errors.invalidTier');
  }
  return raw as Tier;
}

function parseAggregateType(raw: unknown): AggregateTypeName {
  if (raw === undefined || raw === null || raw === '') return 'POINT_DENSITY';
  if (typeof raw !== 'string' || !ALL_AGGREGATE_TYPES.includes(raw as AggregateTypeName)) {
    throw new AppError(400, 'INVALID_AGGREGATE_TYPE', 'errors.invalidAggregateType');
  }
  return raw as AggregateTypeName;
}

function parseDate(raw: unknown, field: string): Date {
  if (typeof raw !== 'string') {
    throw new AppError(400, 'INVALID_DATE', `errors.invalidDate.${field}`);
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new AppError(400, 'INVALID_DATE', `errors.invalidDate.${field}`);
  }
  return d;
}

function parseRange(req: Request): { from: Date; to: Date } {
  const from = parseDate(req.query.dateFrom, 'dateFrom');
  const to = parseDate(req.query.dateTo, 'dateTo');
  if (to <= from) {
    throw new AppError(400, 'INVALID_RANGE', 'errors.invalidRange');
  }
  const days = (to.getTime() - from.getTime()) / MS_PER_DAY;
  if (days > MOBILITY_RUN_NOW_MAX_RANGE_DAYS) {
    throw new AppError(400, 'RANGE_TOO_LARGE', 'errors.rangeTooLarge');
  }
  return { from, to };
}

function parseLimit(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_LIMIT;
  const n = parseInt(String(raw), 10);
  if (Number.isNaN(n) || n < 1 || n > MAX_LIMIT) {
    throw new AppError(400, 'INVALID_LIMIT', 'errors.invalidLimit');
  }
  return n;
}

/**
 * @openapi
 * /api/admin/mobility/aggregates:
 *   get:
 *     summary: List MobilityAggregate rows for a tier within a date range.
 *     tags: [Admin - Mobility Intelligence]
 */
router.get('/aggregates', intelRead, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tier = parseTier(req.query.tier);
    const aggregateType = parseAggregateType(req.query.aggregateType);
    const { from, to } = parseRange(req);
    const limit = parseLimit(req.query.limit);
    const rows = await prisma.mobilityAggregate.findMany({
      where: { tier, aggregateType, bucketStart: { gte: from, lt: to } },
      orderBy: { bucketStart: 'asc' },
      take: limit,
    });
    // INTEL-DECK G3 — no serving path returns an unsanitized marginal.
    // The aggregators gate the grain on the way in, but rows written
    // before this dispatch existed were gated on the cell total alone,
    // and a legacy row must not be able to name a category of one on
    // its way out. Same function as the export path, deliberately.
    res.json({ rows: sanitizeRows(rows as Array<{ attributesJson?: unknown }>) });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/admin/mobility/aggregates/stats:
 *   get:
 *     summary: Per-tier counts of cells and points for a date range.
 *     tags: [Admin - Mobility Intelligence]
 */
router.get('/aggregates/stats', intelRead, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { from, to } = parseRange(req);
    const groups = await prisma.mobilityAggregate.groupBy({
      by: ['tier'],
      where: { bucketStart: { gte: from, lt: to } },
      _count: { _all: true },
      _sum: { count: true },
    });
    const stats: Record<Tier, { cells: number; totalPoints: number }> = {
      DENSE: { cells: 0, totalPoints: 0 },
      MEDIUM: { cells: 0, totalPoints: 0 },
      LOW: { cells: 0, totalPoints: 0 },
      SPARSE: { cells: 0, totalPoints: 0 },
    };
    for (const g of groups as any[]) {
      stats[g.tier as Tier] = {
        cells: g._count?._all ?? 0,
        totalPoints: g._sum?.count ?? 0,
      };
    }
    res.json({ stats });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/admin/mobility/aggregates/run-now:
 *   post:
 *     summary: Trigger a one-off aggregation run in the background, optionally over an explicit date range.
 *     description: >
 *       With no body (or an empty one) the run uses the job's own lookback window,
 *       exactly as the nightly cron does. With dateFrom/dateTo it aggregates that
 *       range instead — how an admin re-builds last month's aggregates without a
 *       developer. Both bounds are required together.
 *     tags: [Admin - Mobility Intelligence]
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               dateFrom: { type: string, format: date-time }
 *               dateTo:   { type: string, format: date-time }
 *     responses:
 *       202:
 *         description: Accepted; the run proceeds in the background.
 *       422:
 *         description: The range is unparseable, out of order, incomplete, or longer than the configured maximum.
 */

/**
 * LOOSE-ENDS G6 — the optional range on the run-now body.
 *
 * Same three rules the GET endpoints on this router enforce through
 * `parseRange` — parseable, ordered, within
 * MOBILITY_RUN_NOW_MAX_RANGE_DAYS — and the same error codes, so the
 * ops panel can present them the way it presents every other range
 * failure. The status is 422 rather than the GET legs' 400 because
 * this is a body being rejected on its meaning, not a missing query
 * parameter; a body with neither bound is not an error at all, it is
 * the default run.
 *
 * Both bounds or neither. A half-specified range is the one shape
 * where guessing the other end would silently aggregate a window
 * nobody asked for.
 */
function parseRunNowWindow(body: unknown): { sinceUtc?: Date; untilUtc?: Date } {
  const b = (body ?? {}) as { dateFrom?: unknown; dateTo?: unknown };
  const hasFrom = b.dateFrom !== undefined && b.dateFrom !== null && b.dateFrom !== '';
  const hasTo = b.dateTo !== undefined && b.dateTo !== null && b.dateTo !== '';
  if (!hasFrom && !hasTo) return {};
  if (!hasFrom || !hasTo) {
    throw new AppError(422, 'INVALID_RANGE', 'errors.invalidRange');
  }
  const parse = (raw: unknown, field: string): Date => {
    if (typeof raw !== 'string') {
      throw new AppError(422, 'INVALID_DATE', `errors.invalidDate.${field}`);
    }
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) {
      throw new AppError(422, 'INVALID_DATE', `errors.invalidDate.${field}`);
    }
    return d;
  };
  const sinceUtc = parse(b.dateFrom, 'dateFrom');
  const untilUtc = parse(b.dateTo, 'dateTo');
  if (untilUtc <= sinceUtc) {
    throw new AppError(422, 'INVALID_RANGE', 'errors.invalidRange');
  }
  if ((untilUtc.getTime() - sinceUtc.getTime()) / MS_PER_DAY > MOBILITY_RUN_NOW_MAX_RANGE_DAYS) {
    throw new AppError(422, 'RANGE_TOO_LARGE', 'errors.rangeTooLarge');
  }
  return { sinceUtc, untilUtc };
}

router.post(
  '/aggregates/run-now',
  adminOnly,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Validated BEFORE the 202: a bad range must be told to the
      // admin, not swallowed by a background run he was told was
      // accepted.
      const window = parseRunNowWindow(req.body);
      // Fire-and-forget: do NOT await; return 202 immediately.
      Promise.resolve()
        .then(() => runMobilityAggregationOnce(new Date(), window))
        .catch((err) => {
          console.error('[MOBILITY] run-now failed:', err);
        });
      res.status(202).json({ accepted: true });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * @openapi
 * /api/admin/mobility/tier-config:
 *   get:
 *     summary: Current tier configuration (cellSize, bucketMinutes, kThreshold, attributes).
 *     tags: [Admin - Mobility Intelligence]
 */
router.get('/tier-config', intelRead, (_req: Request, res: Response) => {
  res.json({
    config: TIER_CONFIGS,
    classificationVersion: getTierClassificationVersion(),
    // LOOSE-ENDS G6 — additive. The ops panel's range picker mirrors the
    // server's range rules, and this is the only one of them that is a
    // deployment knob (MOBILITY_RUN_NOW_MAX_RANGE_DAYS). Sending the
    // configured value rather than letting the client carry a copy is
    // what keeps the mirror honest on a deployment that overrides it.
    maxRunNowRangeDays: MOBILITY_RUN_NOW_MAX_RANGE_DAYS,
  });
});

/**
 * @openapi
 * /api/admin/mobility/tier-config/reload:
 *   post:
 *     summary: Reload tier-classification.json from disk.
 *     tags: [Admin - Mobility Intelligence]
 */
router.post(
  '/tier-config/reload',
  adminOnly,
  (_req: Request, res: Response, next: NextFunction) => {
    try {
      const reloaded = reloadTierClassification();
      res.json({ version: reloaded.version });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
