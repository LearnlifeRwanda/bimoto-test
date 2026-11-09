// LAUNCH-TRUTH G2 — admin fee-waiver surface. Same auth + required-reason
// + hash-chained-audit discipline as the freeze flow. The campaign caps
// are enforced in the service; the GET exposes the counters so an admin
// can see them BEFORE granting.

import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware, adminOnly } from '../middleware/auth';
import { AppError } from '../middleware/error-handler';
import {
  grantFeeWaiver,
  extendFeeWaiver,
  revokeFeeWaiver,
  listFeeWaivers,
  getCampaignCounters,
} from '../services/fee-waiver';
import { ADMIN_REASON_MIN_LENGTH } from '../services/admin/config';

const router = Router();
router.use(authMiddleware);
router.use(adminOnly);

const VALID_TYPES = new Set(['LIFETIME', 'TEMPORARY']);

function requireReason(raw: unknown): string {
  const reason = typeof raw === 'string' ? raw.trim() : '';
  if (reason.length < ADMIN_REASON_MIN_LENGTH) {
    throw new AppError(400, 'REASON_TOO_SHORT', 'errors.reasonTooShort');
  }
  return reason;
}

/**
 * @openapi
 * /api/admin/fee-waivers:
 *   get:
 *     summary: List fee waivers with campaign counters (lifetimeUsed/12, temporaryUsed/500).
 *     tags: [Admin - Fee Waivers]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 200 }
 *       - in: query
 *         name: driverId
 *         schema: { type: string }
 *     responses:
 *       200: { description: Waivers plus campaign counters }
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawLimit = req.query.limit;
    let limit = 100;
    if (rawLimit !== undefined && rawLimit !== '') {
      limit = parseInt(String(rawLimit), 10);
      if (Number.isNaN(limit) || limit < 1 || limit > 200) {
        throw new AppError(400, 'INVALID_LIMIT', 'errors.invalidLimit');
      }
    }
    const driverId =
      typeof req.query.driverId === 'string' && req.query.driverId
        ? req.query.driverId
        : undefined;
    const [waivers, counters] = await Promise.all([
      listFeeWaivers(limit, driverId),
      getCampaignCounters(),
    ]);
    res.json({ waivers, counters });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/admin/fee-waivers/driver/{driverId}/grant:
 *   post:
 *     summary: Grant a fee waiver (LIFETIME or TEMPORARY) to a driver. Audited; refuses on caps or an existing non-revoked waiver.
 *     tags: [Admin - Fee Waivers]
 *     parameters:
 *       - in: path
 *         name: driverId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [type, campaign, reason]
 *             properties:
 *               type: { type: string, enum: [LIFETIME, TEMPORARY] }
 *               campaign: { type: string }
 *               reason: { type: string }
 *     responses:
 *       200: { description: Waiver granted }
 *       400: { description: Invalid type/campaign/reason }
 *       404: { description: Driver not found }
 *       409: { description: Existing waiver or campaign cap reached }
 */
router.post(
  '/driver/:driverId/grant',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user?.userId) {
        throw new AppError(401, 'UNAUTHORIZED', 'errors.unauthorized');
      }
      const { type, campaign } = req.body ?? {};
      const reason = requireReason(req.body?.reason);
      if (typeof type !== 'string' || !VALID_TYPES.has(type)) {
        throw new AppError(400, 'INVALID_WAIVER_TYPE', 'errors.invalidWaiverType');
      }
      const campaignStr = typeof campaign === 'string' ? campaign.trim() : '';
      if (!campaignStr) {
        throw new AppError(400, 'CAMPAIGN_REQUIRED', 'errors.campaignRequired');
      }
      const waiver = await grantFeeWaiver({
        driverId: req.params.driverId,
        type: type as 'LIFETIME' | 'TEMPORARY',
        campaign: campaignStr,
        adminId: req.user.userId,
        reason,
      });
      res.json({ waiver });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * @openapi
 * /api/admin/fee-waivers/{waiverId}/extend:
 *   post:
 *     summary: Extend a TEMPORARY waiver by N months, up to 12 months total from grant. Audited.
 *     tags: [Admin - Fee Waivers]
 *     parameters:
 *       - in: path
 *         name: waiverId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [months, reason]
 *             properties:
 *               months: { type: integer, minimum: 1 }
 *               reason: { type: string }
 *     responses:
 *       200: { description: Waiver extended }
 *       400: { description: Invalid months or reason }
 *       404: { description: Waiver not found }
 *       409: { description: Waiver revoked }
 *       422: { description: Lifetime waiver, or extension exceeds the 12-month ceiling }
 */
router.post(
  '/:waiverId/extend',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user?.userId) {
        throw new AppError(401, 'UNAUTHORIZED', 'errors.unauthorized');
      }
      const reason = requireReason(req.body?.reason);
      const months = Number(req.body?.months);
      const waiver = await extendFeeWaiver({
        waiverId: req.params.waiverId,
        months,
        adminId: req.user.userId,
        reason,
      });
      res.json({ waiver });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * @openapi
 * /api/admin/fee-waivers/{waiverId}/revoke:
 *   post:
 *     summary: Revoke a waiver, forward-only — rides already waived stay waived. Audited.
 *     tags: [Admin - Fee Waivers]
 *     parameters:
 *       - in: path
 *         name: waiverId
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
 *       200: { description: Waiver revoked }
 *       400: { description: Invalid reason }
 *       404: { description: Waiver not found }
 *       409: { description: Already revoked }
 */
router.post(
  '/:waiverId/revoke',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user?.userId) {
        throw new AppError(401, 'UNAUTHORIZED', 'errors.unauthorized');
      }
      const reason = requireReason(req.body?.reason);
      const waiver = await revokeFeeWaiver({
        waiverId: req.params.waiverId,
        adminId: req.user.userId,
        reason,
      });
      res.json({ waiver });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
