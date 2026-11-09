// DRIVER-ID v3 G3 — public live-validity lookup.
//
// The piece that kills old vests: anyone can check a driver number in
// seconds, so every physical object carrying a number is a pointer and
// only this endpoint (the app's live state) is the truth.
//
// Contract (deliberately rigid — snapshot-tested):
//   - { active: true, firstName, vehicleType }  ONLY when the driver
//     exists AND is VERIFIED AND suspendedUntil is null/past.
//   - { active: false }  for EVERY other case — revoked, rejected,
//     pending, under review, suspended, and nonexistent numbers alike.
//     Byte-identical so the endpoint is not an existence oracle.
// Never phone, plate, photo, rating, or history in either shape.
// firstName carries User.nickname — the platform's person display name
// (there is no separate legal-name field).
//
// No auth (public by design), but its own rate-limit scope so lookup
// traffic can never drain another bucket (the PR #107 lesson).

import { Router } from 'express';
import prisma from '../prisma';
import { rateLimit } from '../middleware/rate-limit';

const router = Router();

// Conservative, geocode-like posture: 20 lookups / minute / IP.
const driverIdRateLimit = rateLimit(20, 60_000, 'driver-id');

/**
 * @openapi
 * /api/driver-id/{number}:
 *   get:
 *     summary: Public live-validity check for a driver number (jacket number). No auth.
 *     description: Returns the uniform negative `{ active&#58; false }` for every non-active case — revoked, rejected, pending, under review, suspended, or nonexistent — so the endpoint cannot be used as an existence oracle. The positive shape exposes only firstName and vehicleType.
 *     tags: [Driver ID]
 *     parameters:
 *       - in: path
 *         name: number
 *         required: true
 *         schema: { type: string }
 *         description: The RURA authorization number printed on the driver's jacket/vest.
 *     responses:
 *       200:
 *         description: Validity verdict.
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - type: object
 *                   properties:
 *                     active:      { type: boolean, enum: [true] }
 *                     firstName:   { type: string }
 *                     vehicleType: { type: string }
 *                 - type: object
 *                   properties:
 *                     active: { type: boolean, enum: [false] }
 *       429:
 *         description: Rate limited.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
// GET /api/driver-id/:number — public, rate-limited, uniform negative
router.get('/:number', driverIdRateLimit, async (req, res, next) => {
  try {
    const profile = await prisma.driverProfile.findUnique({
      where: { ruraAuthorizationNumber: req.params.number },
      select: {
        verificationStatus: true,
        vehicleType: true,
        user: { select: { nickname: true, suspendedUntil: true } },
      },
    });

    const suspended =
      profile?.user?.suspendedUntil != null &&
      profile.user.suspendedUntil.getTime() > Date.now();

    if (!profile || profile.verificationStatus !== 'VERIFIED' || suspended) {
      res.json({ active: false });
      return;
    }

    res.json({
      active: true,
      firstName: profile.user.nickname,
      vehicleType: profile.vehicleType,
    });
  } catch (err) { next(err); }
});

export default router;
