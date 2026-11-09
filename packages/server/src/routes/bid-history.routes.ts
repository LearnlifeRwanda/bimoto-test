// ROUTES/BID-HISTORY.ROUTES.TS
//
// Driver-scoped bid history with auto-bid rule attribution.
// Mounted at /api/bids — kept separate from bid.routes.ts (which is
// under /api/journeys) so the URL space stays clean.
//
//   GET /api/bids/my-history             all recent bids by the caller
//   GET /api/bids/my-history?autoOnly=true   auto-bids only
//
// Each row carries the joined `autoBidRule` snapshot when set, so
// driver UI can render "this bid came from rule #2".

import { Router } from 'express';
import { authMiddleware, driverOnly } from '../middleware/auth';
import * as bidService from '../services/bid.service';

const router = Router();

/**
 * @openapi
 * /api/bids/my-history:
 *   get:
 *     summary: Driver's bid history with auto-bid rule attribution.
 *     tags: [Bids]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: autoOnly
 *         schema: { type: boolean }
 *         description: When true, returns only auto-bids (autoBidRuleId IS NOT NULL).
 *     responses:
 *       200:
 *         description: Bid array (most recent first), with `autoBidRule` joined.
 */
router.get('/my-history', authMiddleware, driverOnly, async (req, res, next) => {
  try {
    const onlyAutoBids = req.query.autoOnly === 'true';
    const bids = await bidService.getDriverBidHistory(req.user!.userId, {
      onlyAutoBids,
    });
    res.json(bids);
  } catch (err) {
    next(err);
  }
});

export default router;
