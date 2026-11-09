// ROUTES/ADMIN-FUNNEL.ROUTES.TS
//
// R3-FUNNEL-METRICS-DASHBOARD — admin-internal endpoints for the
// /admin/funnel page.
//
//   GET /metrics       JSON FunnelMetricsResult
//   GET /export.csv    text/csv attachment
//
// Auth: authMiddleware → adminOnly on every route.

import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware, adminOnly } from '../middleware/auth';
import { AppError } from '../middleware/error-handler';
import {
  CITY_BAND_KEYS,
  type CityBand,
} from '@bimoto/shared';
import {
  currentIsoWeek,
  getFunnelMetrics,
  getFunnelMetricsCsv,
} from '../services/funnel-metrics.service';

const router = Router();
router.use(authMiddleware);
router.use(adminOnly);

const ISO_WEEK_RE = /^\d{4}-W\d{2}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseWeekOf(raw: unknown): string {
  if (raw === undefined || raw === null || raw === '') return currentIsoWeek();
  if (typeof raw !== 'string' || !ISO_WEEK_RE.test(raw)) {
    throw new AppError(400, 'INVALID_WEEK_OF', 'errors.invalidWeekOf');
  }
  return raw;
}

function parseCityBand(raw: unknown): CityBand | undefined {
  if (raw === undefined || raw === null || raw === '' || raw === 'all') {
    return undefined;
  }
  if (
    typeof raw !== 'string' ||
    !CITY_BAND_KEYS.includes(raw as CityBand)
  ) {
    throw new AppError(400, 'INVALID_CITY_BAND', 'errors.invalidCityBand');
  }
  return raw as CityBand;
}

function parseCooperativeId(raw: unknown): string | undefined {
  if (raw === undefined || raw === null || raw === '' || raw === 'all') {
    return undefined;
  }
  if (typeof raw !== 'string' || !UUID_RE.test(raw)) {
    // Permissive: silently drop bad UUIDs rather than 400, since the
    // cooperative dropdown may pass non-UUID sentinel values during
    // future filter-state migrations. Validated callers still get
    // applied; bogus values fall back to "all cooperatives".
    return undefined;
  }
  return raw;
}

/**
 * @openapi
 * /api/admin/funnel/metrics:
 *   get:
 *     summary: 4-stage funnel + 6 operational metrics over a 5-week window.
 *     tags: [Admin - Funnel Metrics]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: weekOf
 *         schema:
 *           type: string
 *           pattern: "^\\d{4}-W\\d{2}$"
 *       - in: query
 *         name: cityBand
 *         schema:
 *           type: string
 *           enum: [kigali_dense, kigali_periphery, bugesera_corridor, other]
 *       - in: query
 *         name: cooperativeId
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: FunnelMetricsResult — see service file for shape.
 */
router.get('/metrics', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const weekOf = parseWeekOf(req.query.weekOf);
    const cityBand = parseCityBand(req.query.cityBand);
    const cooperativeId = parseCooperativeId(req.query.cooperativeId);
    const result = await getFunnelMetrics({ weekOf, cityBand, cooperativeId });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/admin/funnel/export.csv:
 *   get:
 *     summary: Same data as /metrics, as a CSV attachment.
 *     tags: [Admin - Funnel Metrics]
 */
router.get('/export.csv', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const weekOf = parseWeekOf(req.query.weekOf);
    const cityBand = parseCityBand(req.query.cityBand);
    const cooperativeId = parseCooperativeId(req.query.cooperativeId);
    const csv = await getFunnelMetricsCsv({ weekOf, cityBand, cooperativeId });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="funnel-${weekOf}.csv"`,
    );
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

export default router;
