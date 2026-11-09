import { Router } from 'express';
import { decryptedPhone } from '../services/user-phone';
import { authMiddleware, driverOnly } from '../middleware/auth';
import { requireMoneyStepUp } from '../middleware/money-step-up';
import { rateLimit } from '../middleware/rate-limit';
import prisma from '../prisma';
import { sendOtp } from '../services/otp.service';
import { applyPreferenceChange } from '../services/payout/preferences';
import { firePreferenceChangeBatch } from '../services/payout.service';
import { getEffectivePreference } from '../services/payout/training-wheels';
import { getActiveWaiver } from '../services/fee-waiver';
import { nextKigaliHourInstant } from '../utils/kigali-time';

const router = Router();

const VALID_PREFERENCES = ['AT_SHIFT_END', 'TWICE_DAILY', 'DAILY_22H'] as const;
type PayoutPref = typeof VALID_PREFERENCES[number];

// Kigali wall-clock hours the payout jobs fire at (payout.job.ts /
// twice-daily-payout.job.ts). Mirrored here so the summary can tell the
// driver when the next scheduled batch lands.
const SCHEDULE_HOURS: Record<PayoutPref, number[] | null> = {
  AT_SHIFT_END: null,
  TWICE_DAILY: [6, 18],
  DAILY_22H: [22],
};

// 3 OTP requests per minute per IP — stops trivial SMS-cost abuse.
const otpRateLimit = rateLimit(3, 60_000);

/**
 * @openapi
 * /api/payout/summary:
 *   get:
 *     summary: Driver's payout snapshot — pending balance, effective preference, and next scheduled payout instant.
 *     tags: [Payout]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Current payout summary.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 pendingAmount:        { type: number }
 *                 storedPreference:     { type: string, enum: [AT_SHIFT_END, TWICE_DAILY, DAILY_22H] }
 *                 effectivePreference:  { type: string, enum: [AT_SHIFT_END, TWICE_DAILY, DAILY_22H] }
 *                 trainingWheelsActive: { type: boolean }
 *                 completedShifts:      { type: number }
 *                 canEndShift:          { type: boolean }
 *                 nextScheduledPayout:  { type: string, format: date-time, nullable: true }
 *                 payoutsFrozen:        { type: boolean }
 *                 feeWaiver:
 *                   type: object
 *                   nullable: true
 *                   properties:
 *                     type:      { type: string, enum: [LIFETIME, TEMPORARY] }
 *                     expiresAt: { type: string, format: date-time, nullable: true }
 *       404:
 *         description: User not found.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
// MONEY-PIN G2 — the census of money surfaces, and the whole of it.
//
// Four routes carry this gate: the balance snapshot, the two halves of
// the payout-preference change, and the manual end-shift payout. They
// are the routes that show a driver's money or move it. Nothing else in
// the server has the gate, and that is the ruling, not an oversight: the
// friction is placed exactly where a mistake is expensive and nowhere
// else, so a day of riding, bidding and chatting never sees a PIN pad.
//
// GET /summary is gated even though it only READS, because what it
// reads is his balance — the single number a borrowed phone must not
// display.
router.get(
  '/summary',
  authMiddleware,
  driverOnly,
  requireMoneyStepUp,
  async (req, res, next) => {
    try {
      const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
      if (!user) {
        res.status(404).json({ error: { code: 'USER_NOT_FOUND', message: 'errors.userNotFound' } });
        return;
      }
      const balance = await prisma.driverBalance.findUnique({ where: { driverId: user.id } });
      const stored = user.payoutPreference as PayoutPref;
      const effective = getEffectivePreference({
        payoutPreference: stored,
        completedShifts: user.completedShifts,
      });
      const scheduleHours = SCHEDULE_HOURS[effective];
      // LAUNCH-TRUTH G4 — the driver's own card must show the waiver
      // and its cliff IN ADVANCE: a driver never discovers the waiver's
      // end in a smaller payout. Minimum shape only — no admin, reason,
      // or campaign leaks to the client.
      const waiver = await getActiveWaiver(user.id);
      res.json({
        pendingAmount: balance?.pendingAmount ?? 0,
        storedPreference: stored,
        effectivePreference: effective,
        trainingWheelsActive: effective !== stored,
        completedShifts: user.completedShifts,
        // LAUNCH-TRUTH G5 — the manual right follows the STORED choice:
        // training wheels set the automatic schedule but must not remove
        // the "Pay me now" button from a driver who chose AT_SHIFT_END.
        canEndShift: stored === 'AT_SHIFT_END',
        nextScheduledPayout: scheduleHours
          ? nextKigaliHourInstant(new Date(), scheduleHours).toISOString()
          : null,
        // Boolean only — frozenReason/frozenBy/frozenCategory stay server-side.
        payoutsFrozen: user.frozenAt !== null,
        feeWaiver: waiver
          ? {
              type: waiver.type,
              expiresAt: waiver.expiresAt ? waiver.expiresAt.toISOString() : null,
            }
          : null,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * @openapi
 * /api/payout/preference/request-otp:
 *   post:
 *     summary: Request an OTP for a driver payout-preference change. Rate-limited 3/min.
 *     tags: [Payout]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [newPreference]
 *             properties:
 *               newPreference:
 *                 type: string
 *                 enum: [AT_SHIFT_END, TWICE_DAILY, DAILY_22H]
 *     responses:
 *       200:
 *         description: OTP issued.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 otpId:     { type: string }
 *                 expiresAt: { type: string, format: date-time }
 *       400:
 *         description: Invalid preference.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       404:
 *         description: User not found.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
// LEGACY OTP ARM, kept live and gated. Ruling D25 made the money PIN the
// proof this flow asks for, so the client no longer walks this path — but
// the arm stays (guards.ts keeps both), and while it exists it must sit
// behind the same gate as the change it authorises. Without the gate this
// route would be the bypass: request an OTP on a borrowed phone, read the
// SMS on that same phone, and the PIN in front of POST /preference would
// have protected nothing.
router.post(
  '/preference/request-otp',
  authMiddleware,
  driverOnly,
  requireMoneyStepUp,
  otpRateLimit,
  async (req, res, next) => {
    try {
      const { newPreference } = req.body ?? {};
      if (!VALID_PREFERENCES.includes(newPreference)) {
        res.status(400).json({ error: { code: 'INVALID_PREFERENCE', message: 'errors.invalidPreference' } });
        return;
      }
      const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
      if (!user) {
        res.status(404).json({ error: { code: 'USER_NOT_FOUND', message: 'errors.userNotFound' } });
        return;
      }
      const result = await sendOtp({
        userId: user.id,
        // otp.service keeps its plaintext contract: it both SENDS to this
        // value and derives OtpCode.phoneHash from it, so ciphertext here
        // made the code undeliverable AND the hash unmatchable.
        phone: decryptedPhone(user),
        purpose: 'PAYOUT_PREFERENCE_CHANGE',
      });
      res.json({ otpId: result.otpId, expiresAt: result.expiresAt.toISOString() });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * @openapi
 * /api/payout/preference:
 *   post:
 *     summary: Confirm a driver payout-preference change with the OTP issued via /preference/request-otp.
 *     tags: [Payout]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [newPreference, otpId, code]
 *             properties:
 *               newPreference: { type: string, enum: [AT_SHIFT_END, TWICE_DAILY, DAILY_22H] }
 *               otpId:         { type: string }
 *               code:          { type: string }
 *     responses:
 *       200:
 *         description: Preference applied.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 newPreference:          { type: string }
 *                 immediatePayoutQueued:  { type: boolean }
 *                 queuedFor:              { type: string, format: date-time, nullable: true }
 *       400:
 *         description: Invalid preference / missing OTP credentials.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post(
  '/preference',
  authMiddleware,
  driverOnly,
  requireMoneyStepUp,
  async (req, res, next) => {
    try {
      const { newPreference, otpId, code } = req.body ?? {};
      if (!VALID_PREFERENCES.includes(newPreference)) {
        res.status(400).json({ error: { code: 'INVALID_PREFERENCE', message: 'errors.invalidPreference' } });
        return;
      }
      // MONEY-PIN G2 — which arm of the step-up union this call uses.
      //
      // requireMoneyStepUp has ALREADY proven a live PIN session by the
      // time this runs, so the PIN arm is the default and needs nothing
      // in the body. A caller that still sends an otpId+code gets the OTP
      // arm, which verifies the code AND spends it — that arm is not a
      // fallback the PIN arm can be downgraded to, because reaching this
      // line at all required the PIN.
      const stepUp = otpId && code
        ? ({ kind: 'otp', otpId, code } as const)
        : ({ kind: 'pin' } as const);
      const result = await applyPreferenceChange({
        userId: req.user!.userId,
        newPreference: newPreference as PayoutPref,
        ipAddress: req.ip,
        stepUp,
      });
      res.json({
        newPreference,
        immediatePayoutQueued: result.immediatePayoutQueued,
        queuedFor: result.payoutDueAt ? result.payoutDueAt.toISOString() : null,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * @openapi
 * /api/payout/end-shift:
 *   post:
 *     summary: Driver triggers an end-of-shift payout (allowed when the STORED preference is AT_SHIFT_END — training wheels set the automatic schedule but do not remove the manual right).
 *     tags: [Payout]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Payout queued (or no-op if no balance).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 batchId:            { type: string, nullable: true, format: uuid }
 *                 amount:             { type: number }
 *                 expectedDeliveryAt: { type: string, format: date-time, nullable: true }
 *       400:
 *         description: Driver's effective preference is not AT_SHIFT_END.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       404:
 *         description: User not found.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
// The one route in the server that MOVES a driver's money on his own
// say-so. §0 of the dispatch recorded "drivers have NO on-demand
// withdrawal"; this endpoint is one — an AT_SHIFT_END driver fires his
// own batch here — so it is gated, and reported as a correction.
router.post(
  '/end-shift',
  authMiddleware,
  driverOnly,
  requireMoneyStepUp,
  async (req, res, next) => {
    try {
      const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
      if (!user) {
        res.status(404).json({ error: { code: 'USER_NOT_FOUND', message: 'errors.userNotFound' } });
        return;
      }
      const effective = getEffectivePreference({
        payoutPreference: user.payoutPreference,
        completedShifts: user.completedShifts,
      });
      // LAUNCH-TRUTH G5 — the gate is the driver's STORED choice.
      // Training wheels override the automatic schedule (effective =
      // TWICE_DAILY for new drivers) but must not remove the manual
      // right. A driver who deliberately chose TWICE_DAILY or DAILY_22H
      // still gets NOT_SHIFT_END_MODE. Every other guard — freeze,
      // AML hard-cap, in-flight-transfer exclusion, balance floor —
      // lives in firePreferenceChangeBatch and is unchanged.
      if (user.payoutPreference !== 'AT_SHIFT_END') {
        res.status(400).json({
          error: { code: 'NOT_SHIFT_END_MODE', message: 'errors.notShiftEndMode' },
          effectivePreference: effective,
        });
        return;
      }
      const fired = await firePreferenceChangeBatch(user.id, 'SHIFT_END');
      const expectedDeliveryAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      res.json({
        batchId: fired.batchId,
        amount: fired.amount,
        expectedDeliveryAt: fired.batchId ? expectedDeliveryAt : null,
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
