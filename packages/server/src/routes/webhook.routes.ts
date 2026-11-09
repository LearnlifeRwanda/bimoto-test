import { Router } from 'express';
import * as crypto from 'crypto';
import * as Sentry from '@sentry/node';
import prisma from '../prisma';
import { markEscrowChargeSucceeded, markEscrowChargeFailed } from '../services/escrow.service';
import {
  markBatchPaidOut,
  markBatchFailed,
  markBatchTransferReversed,
} from '../services/payout.service';

const router = Router();

/**
 * Handles a `transfer.completed` webhook event (driver payout settlement).
 * Resolves the payout batch by `data.reference` → DriverPayoutBatch.txRef
 * (unique). Idempotent: unknown references and already-consistent states are
 * logged and acknowledged so Flutterwave stops retrying.
 */
async function handleTransferCompleted(data: any): Promise<void> {
  const reference = data?.reference;
  if (!reference) {
    console.warn('[WEBHOOK] transfer.completed without data.reference; ignoring');
    return;
  }

  const batch = await prisma.driverPayoutBatch.findUnique({
    where: { txRef: String(reference) },
  });
  if (!batch) {
    console.warn(`[WEBHOOK] transfer.completed for unknown reference ${reference}; ignoring`);
    return;
  }

  const remoteStatus = String(data?.status ?? '').toLowerCase();
  const succeeded = remoteStatus === 'successful' || remoteStatus === 'success';
  const failed = remoteStatus === 'failed' || remoteStatus === 'failure';

  if (succeeded && batch.status === 'PENDING') {
    await markBatchPaidOut(batch.driverId, batch.id, String(data.id ?? ''));
    console.log(`[WEBHOOK] Transfer settled for payout batch ${batch.id}`);
    return;
  }

  if (failed && batch.status === 'PENDING') {
    // Funds were never deducted from the driver balance (that only happens
    // in markBatchPaidOut), so failing the batch leaves the money in place
    // for the next scheduled run.
    await markBatchFailed(batch.id, 'WEBHOOK_REPORTED_FAILURE');
    console.warn(`[WEBHOOK] Transfer failed for payout batch ${batch.id}; batch marked FAILED`);
    return;
  }

  if (failed && batch.status === 'SUCCESS') {
    // The gateway reports failure after we already marked the batch SUCCESS
    // and deducted the driver balance — reverse it and restore the balance.
    await markBatchTransferReversed(batch.id, 'WEBHOOK_REPORTED_FAILURE');
    return;
  }

  console.log(
    `[WEBHOOK] transfer.completed for batch ${batch.id} already consistent ` +
      `(remote=${remoteStatus}, local=${batch.status}); ignoring`,
  );
}

/**
 * @openapi
 * /api/webhooks/flutterwave:
 *   post:
 *     summary: Flutterwave payment webhook receiver. Idempotent; signature-verified.
 *     description: |
 *       Public endpoint (no cookie auth) — caller authenticates by sending the
 *       `verif-hash` header that matches the configured `FLW_SECRET_HASH`.
 *       Handles both `charge.completed/successful` and `charge.completed/failed`
 *       events, indexed by `data.meta.escrowId`, plus `transfer.completed`
 *       (driver payout settlement), indexed by `data.reference` → payout txRef.
 *     tags: [Webhooks]
 *     security:
 *       - flutterwaveSignature: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [event, data]
 *             properties:
 *               event: { type: string, example: 'charge.completed' }
 *               data:
 *                 type: object
 *                 properties:
 *                   id:     { oneOf: [{ type: string }, { type: integer }] }
 *                   status: { type: string, enum: [successful, failed] }
 *                   meta:
 *                     type: object
 *                     properties:
 *                       escrowId: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Acknowledged.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: ok }
 *       401:
 *         description: Missing or mismatched verif-hash header.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error: { type: string }
 *       500:
 *         description: Server error processing webhook.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error: { type: string }
 */
// POST /api/webhooks/flutterwave
// Called by Flutterwave when payment status changes.
router.post('/flutterwave', async (req, res) => {
  const secretHash = process.env.FLW_SECRET_HASH;
  const signature = req.headers['verif-hash'];

  if (!secretHash) {
    Sentry.captureMessage('FLW_SECRET_HASH not configured', 'warning');
    res.status(500).json({ error: 'Webhook misconfigured' });
    return;
  }

  // Constant-time comparison to prevent timing-attack secret extraction.
  // timingSafeEqual throws RangeError on length-mismatched buffers, so we
  // length-check first and reject mismatched lengths as invalid signatures.
  const sigStr = typeof signature === 'string' ? signature : '';
  const sigBuf = Buffer.from(sigStr, 'utf8');
  const secretBuf = Buffer.from(secretHash, 'utf8');

  if (sigBuf.length !== secretBuf.length) {
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  if (!crypto.timingSafeEqual(sigBuf, secretBuf)) {
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  const { event, data } = req.body ?? {};
  const escrowId = data?.meta?.escrowId;

  try {
    if (event === 'charge.completed' && data?.status === 'successful' && escrowId) {
      // Idempotent — markEscrowChargeSucceeded short-circuits if not PENDING.
      await markEscrowChargeSucceeded(escrowId, String(data.id ?? ''));
      console.log(`[WEBHOOK] Payment confirmed for escrow ${escrowId}`);
    } else if (event === 'charge.completed' && data?.status === 'failed' && escrowId) {
      // Routes through appendAuditEntryTx → CHARGE_FAILED entry preserved
      // for BNR review. Journey revert + bid re-open happen inside the tx.
      await markEscrowChargeFailed(escrowId, 'WEBHOOK_REPORTED_FAILURE', {
        webhookPayload: data,
        ipAddress: req.ip,
      });
      console.warn(`[WEBHOOK] Payment failed for escrow ${escrowId}. Journey reverted.`);
    } else if (event === 'transfer.completed') {
      // Driver payout settlement — see handleTransferCompleted above.
      await handleTransferCompleted(data);
    }

    res.json({ status: 'ok' });
  } catch (error) {
    Sentry.captureException(error, { tags: { route: 'flutterwave-webhook' } });
    console.error('[WEBHOOK] Error processing Flutterwave webhook:', error);
    // Return 500 so Flutterwave retries — handler is idempotent.
    res.status(500).json({ error: 'Processing error' });
  }
});

export default router;
