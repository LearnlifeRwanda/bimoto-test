// PREPROTO-SIM G3 — the simulated-SMS inbox. In a pilot run this is the
// OTP delivery channel: anyone who can read it can log in as anyone
// (auth adversarial review findings #4/#12). The guard below is
// therefore load-bearing, not cosmetic:
//
//   - access requires an ADMIN session OR the SIM_INBOX_TOKEN header,
//     compared in constant time;
//   - the token is header-borne (never query string — query strings leak
//     into access logs and referrers) and config-enforced to >=32 chars;
//   - fail closed: with no token configured, token access answers 503
//     (misconfiguration is surfaced, codes are never served open);
//   - rate-limited in its own bucket.

import { Router, type Request, type Response, type NextFunction } from 'express';
import crypto from 'crypto';
import prisma from '../prisma';
import { config } from '../config';
import { verifyAccessToken } from '../utils/jwt';
import { extractBearerToken } from '../middleware/auth';
import { rateLimit } from '../middleware/rate-limit';

const router = Router();

const SIM_INBOX_TOKEN_HEADER = 'x-sim-inbox-token';
const MAX_MESSAGES = 100;

// Hash both sides to equal length first — crypto.timingSafeEqual throws
// on length mismatch, and short-circuiting on length would itself leak.
function tokenMatches(supplied: string, expected: string): boolean {
  const a = crypto.createHash('sha256').update(supplied).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

function hasAdminSession(req: Request): boolean {
  const token = req.cookies?.accessToken ?? extractBearerToken(req.headers.authorization);
  if (!token) return false;
  try {
    return verifyAccessToken(token).role === 'ADMIN';
  } catch {
    return false;
  }
}

function simInboxGuard(req: Request, res: Response, next: NextFunction): void {
  const tokenConfigured = config.SIM_INBOX_TOKEN.length >= 32;
  const supplied = req.header(SIM_INBOX_TOKEN_HEADER);

  if (tokenConfigured && supplied && tokenMatches(supplied, config.SIM_INBOX_TOKEN)) {
    next();
    return;
  }
  if (hasAdminSession(req)) {
    next();
    return;
  }
  if (!tokenConfigured) {
    // Fail closed AND loudly: an operator who forgot the token gets a
    // clear misconfiguration signal instead of an open OTP oracle.
    res.status(503).json({
      error: { code: 'SIM_INBOX_NOT_CONFIGURED', message: 'errors.simInboxNotConfigured' },
    });
    return;
  }
  res
    .status(401)
    .json({ error: { code: 'UNAUTHORIZED', message: 'errors.unauthorized' } });
}

router.use(rateLimit(30, 60_000, 'sim-inbox'));
router.use(simInboxGuard);

async function recentMessages(to?: string) {
  return prisma.simulatedMessage.findMany({
    where: to ? { toPhone: { contains: to } } : undefined,
    orderBy: { createdAt: 'desc' },
    take: MAX_MESSAGES,
  });
}

/**
 * @openapi
 * /api/sim/messages:
 *   get:
 *     summary: Recent simulated-SMS messages (newest first, capped at 100). Requires an admin session or the x-sim-inbox-token header.
 *     tags: [Simulation]
 *     parameters:
 *       - in: query
 *         name: to
 *         schema: { type: string }
 *         description: Filter by (partial) recipient phone number.
 *     responses:
 *       200: { description: Message list. }
 *       401: { description: Missing/invalid token and no admin session. }
 *       503: { description: No SIM_INBOX_TOKEN configured (fail closed). }
 */
router.get('/messages', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    const messages = await recentMessages(to);
    res.json({ messages });
  } catch (err) {
    next(err);
  }
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * @openapi
 * /api/sim/inbox:
 *   get:
 *     summary: Minimal server-rendered HTML view of the simulated-SMS inbox (auto-refreshes). Same guard as /api/sim/messages.
 *     tags: [Simulation]
 *     responses:
 *       200: { description: HTML inbox page. }
 *       401: { description: Missing/invalid token and no admin session. }
 *       503: { description: No SIM_INBOX_TOKEN configured (fail closed). }
 */
router.get('/inbox', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    const messages = await recentMessages(to);
    const rows = messages
      .map(
        (msg) => `<tr>
  <td class="time">${escapeHtml(msg.createdAt.toISOString().replace('T', ' ').slice(0, 19))}</td>
  <td class="phone">${escapeHtml(msg.toPhone)}</td>
  <td>${escapeHtml(msg.body)}</td>
</tr>`,
      )
      .join('\n');
    res
      .type('html')
      .send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="5">
<title>Bimoto — Simulated SMS Inbox</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 1rem; background: #fafafa; }
  h1 { font-size: 1.1rem; }
  .banner { background: #b45309; color: #fff; padding: .5rem .75rem; border-radius: 6px; margin-bottom: 1rem; }
  table { border-collapse: collapse; width: 100%; background: #fff; }
  th, td { border: 1px solid #ddd; padding: .4rem .6rem; text-align: left; font-size: .9rem; vertical-align: top; }
  th { background: #f0f0f0; }
  .time, .phone { white-space: nowrap; }
</style>
</head>
<body>
<div class="banner">SIMULATION — captured SMS only, nothing was sent. Auto-refreshes every 5&nbsp;s.</div>
<h1>Simulated SMS inbox (${messages.length} most recent)</h1>
<table>
<thead><tr><th>Time (UTC)</th><th>To</th><th>Message</th></tr></thead>
<tbody>
${rows || '<tr><td colspan="3">No messages captured yet.</td></tr>'}
</tbody>
</table>
</body>
</html>`);
  } catch (err) {
    next(err);
  }
});

export default router;
