// Africa's Talking inbound-SMS webhook target.
//
// AT POSTs application/x-www-form-urlencoded with fields { id, from, to,
// text, date, linkId? } and signs the raw body with HMAC-SHA256 in the
// X-AT-Signature header. We mount a route-local urlencoded middleware
// (instead of relying on the app-wide JSON middleware) so we can stash the
// raw body via the verify callback for signature verification — JSON
// middleware would not see this request, and capturing rawBody only here
// avoids touching every other route.
//
// The handler returns 200 BEFORE processing completes. AT treats anything
// 2xx as success and won't retry; idempotency in the dispatcher (keyed by
// AT message id) protects against duplicate processing if AT does retry.

import { Router, Request, Response } from 'express';
import express from 'express';
import * as Sentry from '@sentry/node';
import { rateLimit } from '../middleware/rate-limit';
import {
  AT_INBOUND_HMAC_SECRET,
  AT_INBOUND_SHORTCODE,
  normaliseMsisdn,
  processInbound,
  verifyAtSignature,
  type InboundContext,
} from '../services/sms-inbound';

declare global {
  namespace Express {
    interface Request {
      rawBody?: string;
    }
  }
}

const router = Router();

const captureRaw = express.urlencoded({
  extended: true,
  verify: (req: Request, _res, buf) => {
    req.rawBody = buf.toString('utf8');
  },
});

/**
 * @openapi
 * /api/sms/inbound:
 *   post:
 *     summary: Africa's Talking inbound-SMS webhook. HMAC-signed form body; returns 200 before processing (AT treats 2xx as delivered; the dispatcher is idempotent by AT message id).
 *     tags: [Webhooks]
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               id:   { type: string }
 *               from: { type: string }
 *               to:   { type: string }
 *               text: { type: string }
 *               date: { type: string }
 *     responses:
 *       200: { description: Accepted (processing continues asynchronously) }
 *       401: { description: HMAC signature verification failed }
 */
router.post(
  '/inbound',
  rateLimit(60, 60_000),
  captureRaw,
  (req: Request, res: Response) => {
    const rawBody = req.rawBody ?? '';
    const sig = req.header('x-at-signature') ?? '';

    if (!verifyAtSignature(rawBody, sig, AT_INBOUND_HMAC_SECRET)) {
      console.warn(
        `[sms-inbound] signature verify failed from=${(req.body as any)?.from ?? 'unknown'}`,
      );
      res.status(401).end();
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const ctx: InboundContext = {
      atMessageId: String(body.id ?? ''),
      fromMsisdn: normaliseMsisdn(String(body.from ?? '')),
      toShortcode: String(body.to ?? AT_INBOUND_SHORTCODE),
      rawBody: String(body.text ?? ''),
      receivedAt: body.date ? new Date(String(body.date)) : new Date(),
    };

    if (!ctx.atMessageId) {
      res.status(400).json({ error: 'missing message id' });
      return;
    }

    setImmediate(async () => {
      try {
        await processInbound(ctx);
      } catch (err) {
        Sentry.captureException(err);
        console.error('[sms-inbound] processInbound failed:', err);
      }
    });

    res.status(200).json({ received: true });
  },
);

export default router;
