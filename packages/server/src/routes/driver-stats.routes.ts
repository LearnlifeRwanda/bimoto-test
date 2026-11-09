// ROUTES/DRIVER-STATS.ROUTES.TS
//
// Dispatch R3-DRIVER-TIER-STATS — driver self-assessment endpoint
// powering the DriverStatsCard widget on the driver Dashboard.
//
//   GET /  per-driver stats over windowDays (default 30, clamped 7..90)
//
// Auth: authMiddleware → driverOnly (DRIVER and BOTH roles only).

import { Router } from 'express';
import { authMiddleware, driverOnly } from '../middleware/auth';
import { getDriverStats } from '../services/driver-stats.service';

const router = Router();

const MIN_WINDOW_DAYS = 7;
const MAX_WINDOW_DAYS = 90;
const DEFAULT_WINDOW_DAYS = 30;

function parseWindowDays(raw: unknown): number {
  const parsed = parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_WINDOW_DAYS;
  return Math.min(Math.max(parsed, MIN_WINDOW_DAYS), MAX_WINDOW_DAYS);
}

/**
 * @openapi
 * /api/driver/stats:
 *   get:
 *     summary: Per-driver self-assessment stats over a configurable window.
 *     tags: [Driver]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: windowDays
 *         schema:
 *           type: integer
 *           minimum: 7
 *           maximum: 90
 *           default: 30
 *     responses:
 *       200:
 *         description: Stats object — see DriverStats interface in driver-stats.service.ts.
 */
router.get('/', authMiddleware, driverOnly, async (req, res, next) => {
  try {
    const driverId = req.user!.userId;
    const windowDays = parseWindowDays(req.query.windowDays);
    const stats = await getDriverStats(driverId, windowDays);
    res.json(stats);
  } catch (err) {
    next(err);
  }
});

export default router;
