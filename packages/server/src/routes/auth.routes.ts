import { Router, Request, Response } from 'express';
import { validate } from '../middleware/validate';
import { requestOtpSchema, verifyOtpSchema } from '@bimoto/shared';
import { rateLimit } from '../middleware/rate-limit';
import * as authService from '../services/auth.service';
import { extractBearerToken } from '../middleware/auth';
import { config } from '../config';

import { closeMoneyStepUp } from '../middleware/money-step-up';

const router = Router();

// PREPROTO-AUTH G4 — cookie flags come from COOKIE_SECURE (default true),
// not NODE_ENV: a dev-mode server behind an HTTPS tunnel still issues
// Secure cookies.
const ACCESS_COOKIE_MAX_AGE = 15 * 60 * 1000;
const REFRESH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  secure: config.COOKIE_SECURE,
  sameSite: 'lax' as const,
  maxAge,
});
function setSessionCookies(res: Response, accessToken: string, refreshToken: string): void {
  res.cookie('accessToken', accessToken, cookieOptions(ACCESS_COOKIE_MAX_AGE));
  res.cookie('refreshToken', refreshToken, cookieOptions(REFRESH_COOKIE_MAX_AGE));
}

// PREPROTO-AUTH G2 — key OTP limits on the target identity (phone), not
// the source IP: guessing a victim's code from a botnet must hit the same
// bucket as guessing it from one machine.
const phoneKey = (req: Request): string | undefined =>
  typeof req.body?.phone === 'string' ? req.body.phone : undefined;

/**
 * @openapi
 * /api/auth/request-otp:
 *   post:
 *     summary: Request a one-time password sent via SMS to the supplied phone.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phone]
 *             properties:
 *               phone: { type: string, example: '+250788123456' }
 *     responses:
 *       200:
 *         description: OTP issued.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 otpId: { type: string }
 *                 expiresAt: { type: string, format: date-time }
 *       429:
 *         description: Rate-limited (max 3 requests per 10 minutes per phone, 30 per IP).
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
// POST /api/auth/request-otp
// PREPROTO-AUTH G5 — two limiters: per-phone (protects a victim from
// SMS-bombing regardless of attacker IPs) and per-IP (caps how many
// distinct phones one source can target).
router.post(
  '/request-otp',
  rateLimit(3, 10 * 60 * 1000, 'request-otp-phone', phoneKey),
  rateLimit(30, 10 * 60 * 1000, 'request-otp-ip'),
  validate(requestOtpSchema),
  async (req, res, next) => {
  try {
    const result = await authService.requestOtp(req.body.phone);
    res.json(result);
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/auth/verify-otp:
 *   post:
 *     summary: Verify an OTP and issue session cookies (accessToken + refreshToken).
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phone, otp]
 *             properties:
 *               phone: { type: string }
 *               otp:   { type: string, example: '123456' }
 *     responses:
 *       200:
 *         description: Session cookies set; user and tokens returned (tokens for the cross-origin native client).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:         { type: object }
 *                 isNewUser:    { type: boolean }
 *                 accessToken:  { type: string }
 *                 refreshToken: { type: string }
 *       400:
 *         description: Invalid OTP.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       429:
 *         description: Rate-limited (max 10 attempts per 15 minutes per phone).
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
// POST /api/auth/verify-otp
router.post('/verify-otp', rateLimit(10, 15 * 60 * 1000, 'verify-otp', phoneKey), validate(verifyOtpSchema), async (req, res, next) => {
  try {
    const { user, isNewUser, accessToken, refreshToken } = await authService.verifyOtp(req.body.phone, req.body.otp);
    setSessionCookies(res, accessToken, refreshToken);
    // PREPROTO-AUTH G6 — tokens also travel in the body for the
    // Capacitor app, which is cross-origin (https://localhost) and
    // stores them via the native secure token store. The web client
    // keeps using the httpOnly cookies and ignores the body tokens'
    // persistence (access token stays in memory only).
    res.json({ user, isNewUser, accessToken, refreshToken });
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/auth/refresh:
 *   post:
 *     summary: Rotate the session. Accepts the refresh token from the cookie, a JSON body field, or an Authorization Bearer header (native cross-origin client).
 *     tags: [Auth]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               refreshToken: { type: string }
 *     responses:
 *       200:
 *         description: New cookies set; rotated tokens returned in the body.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:      { type: boolean }
 *                 accessToken:  { type: string }
 *                 refreshToken: { type: string }
 *       401:
 *         description: Missing or invalid refresh token.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       429:
 *         description: Rate-limited (max 60 refreshes per 15 minutes per IP).
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
// POST /api/auth/refresh
router.post('/refresh', rateLimit(60, 15 * 60 * 1000, 'auth-refresh'), async (req, res, next) => {
  try {
    // PREPROTO-AUTH G6 — the native app is cross-origin and holds the
    // refresh token in secure storage, not a cookie; accept it from the
    // body or Authorization header too. Cookie stays preferred so the
    // web flow is unchanged.
    const token =
      req.cookies?.refreshToken ??
      (typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : undefined) ??
      extractBearerToken(req.headers.authorization);
    if (!token) { res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'errors.unauthorized' } }); return; }
    const { accessToken, refreshToken } = await authService.refreshTokens(token);
    setSessionCookies(res, accessToken, refreshToken);
    res.json({ success: true, accessToken, refreshToken });
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/auth/logout:
 *   post:
 *     summary: Revoke the refresh-token family server-side and clear the session cookies.
 *     tags: [Auth]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Session revoked; cookies cleared.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 */
// POST /api/auth/logout
router.post('/logout', async (req, res) => {
  // PREPROTO-AUTH G3 — kill the session server-side, not just the cookie
  // copy. Best-effort: logout always answers 200. G6 — the native app
  // presents its stored refresh token in the body instead of a cookie.
  const token =
    req.cookies?.refreshToken ??
    (typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : undefined);
  const revokedUserId = await authService.revokeSession(token);
  // MONEY-PIN G2 — a money step-up dies with the session that opened it.
  // Otherwise the next person to log in on a handed-over handset would
  // inherit an open money session from the driver who just logged out.
  if (revokedUserId) closeMoneyStepUp(revokedUserId);
  res.clearCookie('accessToken');
  res.clearCookie('refreshToken');
  res.json({ success: true });
});

export default router;
