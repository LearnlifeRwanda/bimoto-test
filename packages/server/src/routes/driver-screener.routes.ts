// R3-DRIVER-SCREENER — driver-only routes for the 8-question screener.
// Mounted at /api/drivers/me in src/index.ts, so the endpoints become
// POST /api/drivers/me/screener and GET /api/drivers/me/screener.

import { Router } from 'express';
import { authMiddleware, driverOnly } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { screenerSubmissionSchema } from '@bimoto/shared';
import {
  submitScreener,
  getScreenerForDriver,
  DriverProfileNotFoundError,
} from '../services/driver-screener.service';

const router = Router();

/**
 * @openapi
 * /api/drivers/me/screener:
 *   post:
 *     summary: Submit (or resubmit) the driver eligibility screener.
 *     tags: [DriverScreener]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Stored submission with the authoritative eligibility result.
 *       400: { description: Validation failure. }
 *       401: { description: Not authenticated. }
 *       403: { description: Not a driver. }
 *       404: { description: No DriverProfile for the authenticated user. }
 */
router.post(
  '/screener',
  authMiddleware,
  driverOnly,
  validate(screenerSubmissionSchema),
  async (req, res, next) => {
    try {
      const result = await submitScreener(req.user!.userId, req.body);
      res.json(result);
    } catch (err) {
      if (err instanceof DriverProfileNotFoundError) {
        res.status(404).json({
          error: {
            code: 'DRIVER_PROFILE_NOT_FOUND',
            message: 'errors.driver_profile_not_found',
          },
        });
        return;
      }
      next(err);
    }
  },
);

/**
 * @openapi
 * /api/drivers/me/screener:
 *   get:
 *     summary: Read the current screener row for the authenticated driver.
 *     tags: [DriverScreener]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200: { description: Stored submission + eligibility result. }
 *       401: { description: Not authenticated. }
 *       403: { description: Not a driver. }
 *       404: { description: No screener has been submitted yet. }
 */
router.get(
  '/screener',
  authMiddleware,
  driverOnly,
  async (req, res, next) => {
    try {
      const row = await getScreenerForDriver(req.user!.userId);
      if (!row) {
        res.status(404).json({
          error: {
            code: 'SCREENER_NOT_FOUND',
            message: 'errors.screener_not_found',
          },
        });
        return;
      }
      res.json(row);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
