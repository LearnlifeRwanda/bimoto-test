import { Router } from 'express';
import { decryptedPhone } from '../services/user-phone';
import { authMiddleware, customerOnly } from '../middleware/auth';
import { rateLimit } from '../middleware/rate-limit';
import prisma from '../prisma';
import {
  markEscrowChargeSucceeded,
  markEscrowChargeFailed,
} from '../services/escrow.service';
import { chargeMomo, chargeCard, FlutterwaveError } from '../services/payment';
import { EscrowStatus, EscrowAction, transitionEscrow } from '@bimoto/shared';

const router = Router();

/**
 * @openapi
 * /api/payments/{escrowId}/status:
 *   get:
 *     summary: Read the current escrow status (PENDING / HELD / RELEASED / FAILED / FROZEN / REFUNDED).
 *     description: Visible to the journey customer, the matched driver, or an admin. Rate-limited 30/min.
 *     tags: [Payments]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: escrowId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Status snapshot.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:        { type: string }
 *                 txRef:         { type: string, nullable: true }
 *                 lastUpdatedAt: { type: string, format: date-time }
 *                 failureReason:
 *                   type: string
 *                   nullable: true
 *                   description: >
 *                     SETTLE-UP G3 — the gateway's own code for the most
 *                     recent declined charge (INSUFFICIENT_FUNDS,
 *                     INVALID_WALLET, …), read off the escrow's latest
 *                     CHARGE_FAILED audit entry. Null unless the escrow
 *                     is FAILED.
 *       403:
 *         description: Caller is not a participant or admin.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       404:
 *         description: Escrow not found.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get(
  '/:escrowId/status',
  authMiddleware,
  rateLimit(30, 60_000),
  async (req, res, next) => {
    try {
      const escrow = await prisma.escrow.findUnique({
        where: { id: req.params.escrowId },
        select: {
          id: true,
          customerId: true,
          driverId: true,
          status: true,
          txRef: true,
          createdAt: true,
        },
      });
      if (!escrow) {
        res.status(404).json({ error: { code: 'ESCROW_NOT_FOUND', message: 'errors.escrowNotFound' } });
        return;
      }
      const userId = req.user!.userId;
      if (escrow.customerId !== userId && escrow.driverId !== userId && req.user!.role !== 'ADMIN') {
        res.status(403).json({ error: { code: 'FORBIDDEN', message: 'errors.forbidden' } });
        return;
      }
      // SETTLE-UP G3 — the reload learns WHY, not just THAT.
      //
      // PAY-TRUTH G3 named the gateway's reason in the moment the charge
      // failed (accept-bid's paymentFailureCode, the 502's detail), but a
      // customer who closed the app and came back had nothing to read it
      // from and fell through to the generic "the payment did not go
      // through". The reason was never lost — markEscrowChargeFailed
      // writes it as `reason` on the CHARGE_FAILED audit entry.
      //
      // Read off the CHAIN rather than a new column on the escrow row,
      // deliberately:
      //   * the fact is already stored. A column would be a second home
      //     for one fact, and two homes for a money fact eventually
      //     disagree — the chain is the record of truth here, and it is
      //     where an auditor already looks;
      //   * a column would need backfilling for every escrow that failed
      //     before this dispatch; the chain already carries their
      //     reasons, so those customers get named copy too;
      //   * the cost is one indexed lookup on a single-escrow read that
      //     is already rate-limited to 30/min, and only when the escrow
      //     is actually FAILED.
      //
      // The retry path is unaffected: a revived escrow leaves FAILED, so
      // this answers null again the moment the customer tries.
      let failureReason: string | null = null;
      if (escrow.status === EscrowStatus.FAILED) {
        const lastFailure = await prisma.escrowAuditLog.findFirst({
          where: { escrowId: escrow.id, action: 'CHARGE_FAILED' },
          orderBy: { sequenceNumber: 'desc' },
          select: { metadata: true },
        });
        const reason = (lastFailure?.metadata as { reason?: unknown } | null)?.reason;
        failureReason = typeof reason === 'string' ? reason : null;
      }

      res.json({
        status: escrow.status,
        txRef: escrow.txRef,
        lastUpdatedAt: escrow.createdAt.toISOString(),
        failureReason,
      });
    } catch (err) { next(err); }
  },
);

/**
 * @openapi
 * /api/payments/initiate:
 *   post:
 *     summary: Customer-initiated MoMo charge for a PENDING or FAILED escrow. Rate-limited 5/min.
 *     tags: [Payments]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [escrowId]
 *             properties:
 *               escrowId: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Charge accepted; escrow transitions to HELD or remains PENDING for async confirmation.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:  { type: string, enum: [HELD, PENDING] }
 *                 txRef:   { type: string }
 *                 warning: { type: string, nullable: true }
 *       400:
 *         description: Missing escrowId.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       403:
 *         description: Caller is not the escrow customer.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       404:
 *         description: Escrow not found.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       409:
 *         description: Escrow is not in a retriable state.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       502:
 *         description: Gateway returned a non-retryable failure.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post(
  '/initiate',
  authMiddleware,
  customerOnly,
  rateLimit(5, 60_000),
  async (req, res, next) => {
    try {
      const { escrowId } = req.body ?? {};
      if (!escrowId || typeof escrowId !== 'string') {
        res.status(400).json({ error: { code: 'INVALID_BODY', message: 'errors.invalidBody' } });
        return;
      }
      const escrow = await prisma.escrow.findUnique({
        where: { id: escrowId },
        include: { customer: true },
      });
      if (!escrow) {
        res.status(404).json({ error: { code: 'ESCROW_NOT_FOUND', message: 'errors.escrowNotFound' } });
        return;
      }
      if (escrow.customerId !== req.user!.userId) {
        res.status(403).json({ error: { code: 'FORBIDDEN', message: 'errors.forbidden' } });
        return;
      }

      // Only PENDING and FAILED escrows can be (re-)initiated. HELD/RELEASED
      // already-charged rows are immutable; FROZEN/REFUNDED are admin-only.
      if (escrow.status !== EscrowStatus.PENDING && escrow.status !== EscrowStatus.FAILED) {
        res.status(409).json({
          error: { code: 'ESCROW_NOT_RETRIABLE', message: 'errors.escrowNotRetriable' },
        });
        return;
      }

      // For a FAILED retry we need a fresh txRef so the gateway sees it as a
      // new attempt; for a stuck PENDING we re-use the existing txRef
      // (Flutterwave's idempotency makes the retry safe).
      //
      // PAY-TRUTH G2 — the FAILED→PENDING revival is now a checked
      // transition (EscrowAction.RETRY_CHARGE) rather than a raw status
      // write. transitionEscrow throws for any state that has no
      // RETRY_CHARGE edge, so a SETTLED escrow can never be revived even
      // if the status guard above were ever loosened. The escrow ROW is
      // reused in place: nothing is deleted, nothing is duplicated, and
      // the audit chain keeps appending to the same escrowId.
      let txRef = escrow.txRef;
      if (escrow.status === EscrowStatus.FAILED || !txRef) {
        const nextStatus =
          escrow.status === EscrowStatus.FAILED
            ? transitionEscrow(EscrowStatus.FAILED, EscrowAction.RETRY_CHARGE)
            : EscrowStatus.PENDING;
        txRef = `bimoto-${escrow.journeyId.slice(0, 8)}-${Date.now()}`;
        await prisma.escrow.update({
          where: { id: escrow.id },
          data: {
            status: nextStatus,
            txRef,
            lastChargeAttemptAt: new Date(),
          },
        });
      } else {
        await prisma.escrow.update({
          where: { id: escrow.id },
          data: { lastChargeAttemptAt: new Date() },
        });
      }

      try {
        const charge = await chargeMomo({
          // Gateway phone_number (and the derived pseudo-email) — the
          // customer's real MSISDN, never the stored ciphertext.
          phone: decryptedPhone(escrow.customer),
          amount: escrow.amount,
          txRef,
          narration: `Bimoto ride ${escrow.journeyId.slice(0, 8)}`,
          customerId: escrow.customerId,
          escrowId: escrow.id,
        });
        if (charge.status === 'SUCCESS' && charge.flwTxId) {
          await markEscrowChargeSucceeded(escrow.id, charge.flwTxId);
          res.json({ status: 'HELD', txRef });
          return;
        }
        res.json({ status: 'PENDING', txRef });
      } catch (err) {
        const flw = err instanceof FlutterwaveError ? err : null;
        if (flw && flw.code === 'NO_KEYS_CONFIGURED') {
          // PAY-TRUTH G5 — the same E2E escape hatch bid.service.ts already
          // has on the accept path, extended to the RETRY path. Without it
          // the retry rail could not be proven end-to-end in CI at all: a
          // keyless environment leaves the escrow PENDING forever, so the
          // one thing the e2e spec exists to show — that one tap turns a
          // FAILED escrow into a held payment without losing the motari —
          // would be untestable. Behind the same dedicated flag, set ONLY
          // in .github/workflows/e2e.yml, and deliberately NOT keyed off
          // NODE_ENV (jest suites rely on the PENDING answer below).
          // Production charge behaviour is unchanged: the flag is unset
          // everywhere else, and this branch is only reachable when there
          // is no gateway to charge in the first place.
          if (process.env.E2E_FAKE_PAYMENTS === '1') {
            await markEscrowChargeSucceeded(escrow.id, `e2e-retry-${escrow.id}-${Date.now()}`);
            res.json({ status: 'HELD', txRef });
            return;
          }
          res.json({ status: 'PENDING', txRef, warning: 'no_gateway_keys' });
          return;
        }
        if (flw && !flw.retryable) {
          // PAY-TRUTH G2 — 'keep-match': this IS the retry surface. The
          // customer is holding the phone; a second decline must leave
          // them exactly where they were, with the same motari and the
          // same escrow, free to try again or switch method.
          await markEscrowChargeFailed(escrow.id, flw.code, undefined, 'keep-match');
          res.status(502).json({
            error: { code: 'CHARGE_FAILED', message: 'errors.chargeFailed', detail: flw.code },
          });
          return;
        }
        // Retryable — leave PENDING; reconciler will retry.
        res.json({ status: 'PENDING', txRef, warning: 'transient_error' });
      }
    } catch (err) { next(err); }
  },
);

/**
 * @openapi
 * /api/payments/initiate-card:
 *   post:
 *     summary: Customer-initiated card charge confirmation for a PENDING or FAILED escrow. Rate-limited 5/min.
 *     description: |
 *       The card charge itself happens client-side in the Flutterwave Inline
 *       Widget; the widget returns an `flwTxId`. This endpoint verifies that
 *       transaction against the FLW gateway (defending against client-side
 *       forgery and amount tampering) before transitioning the escrow to HELD.
 *       Mirrors the auth + rate-limit + state-check shape of `/initiate`.
 *     tags: [Payments]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [escrowId, flwTxId]
 *             properties:
 *               escrowId: { type: string, format: uuid }
 *               flwTxId:  { type: string }
 *     responses:
 *       200:
 *         description: Charge verified; escrow transitions to HELD or remains PENDING for async confirmation.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:  { type: string, enum: [HELD, PENDING, FAILED] }
 *                 txRef:   { type: string }
 *                 warning: { type: string, nullable: true }
 *       400:
 *         description: Missing escrowId or flwTxId.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       403:
 *         description: Caller is not the escrow customer.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       404:
 *         description: Escrow not found.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       409:
 *         description: Escrow is not in a retriable state.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       502:
 *         description: Gateway verification returned a non-retryable failure.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post(
  '/initiate-card',
  authMiddleware,
  customerOnly,
  rateLimit(5, 60_000),
  async (req, res, next) => {
    try {
      const { escrowId, flwTxId } = req.body ?? {};
      if (
        !escrowId ||
        !flwTxId ||
        typeof escrowId !== 'string' ||
        typeof flwTxId !== 'string'
      ) {
        res.status(400).json({ error: { code: 'INVALID_BODY', message: 'errors.invalidBody' } });
        return;
      }

      const escrow = await prisma.escrow.findUnique({
        where: { id: escrowId },
        include: { customer: true },
      });
      if (!escrow) {
        res.status(404).json({ error: { code: 'ESCROW_NOT_FOUND', message: 'errors.escrowNotFound' } });
        return;
      }
      if (escrow.customerId !== req.user!.userId) {
        res.status(403).json({ error: { code: 'FORBIDDEN', message: 'errors.forbidden' } });
        return;
      }

      // Same state check as /initiate: only PENDING and FAILED escrows can be
      // (re-)confirmed. HELD/RELEASED are immutable; FROZEN/REFUNDED admin-only.
      if (escrow.status !== EscrowStatus.PENDING && escrow.status !== EscrowStatus.FAILED) {
        res.status(409).json({
          error: { code: 'ESCROW_NOT_RETRIABLE', message: 'errors.escrowNotRetriable' },
        });
        return;
      }

      // Unlike the MoMo /initiate retry, the txRef is NOT regenerated here: the
      // card charge already happened client-side against the escrow's existing
      // txRef (the reference the widget used), and we must verify against that
      // same reference. Without it there is nothing to verify.
      const txRef = escrow.txRef;
      if (!txRef) {
        res.status(409).json({
          error: { code: 'ESCROW_NOT_RETRIABLE', message: 'errors.escrowNotRetriable' },
        });
        return;
      }

      // Bring a FAILED escrow back to PENDING so the markEscrowCharge* helpers
      // (which only act on PENDING rows) can transition it; record the attempt.
      //
      // PAY-TRUTH G2 — same checked revival as /initiate. This is the
      // "switch to card after MoMo declined" path: the customer's escrow
      // is FAILED, the widget just charged their card against the SAME
      // txRef, and RETRY_CHARGE is what makes that reuse legal. The two
      // rails cannot fight over the escrow because both go through the
      // one row and the one PENDING-predicated claim underneath.
      await prisma.escrow.update({
        where: { id: escrow.id },
        data: {
          status:
            escrow.status === EscrowStatus.FAILED
              ? transitionEscrow(EscrowStatus.FAILED, EscrowAction.RETRY_CHARGE)
              : EscrowStatus.PENDING,
          lastChargeAttemptAt: new Date(),
        },
      });

      try {
        const result = await chargeCard({
          flwTxId,
          txRef,
          amount: escrow.amount,
          customerId: escrow.customerId,
          escrowId: escrow.id,
        });

        if (result.status === 'SUCCESS') {
          await markEscrowChargeSucceeded(escrow.id, result.flwTxId);
          res.json({ status: 'HELD', txRef });
          return;
        }
        res.json({ status: result.status, txRef });
      } catch (err) {
        const flw = err instanceof FlutterwaveError ? err : null;
        if (flw && flw.code === 'NO_KEYS_CONFIGURED') {
          res.json({ status: 'PENDING', txRef, warning: 'no_gateway_keys' });
          return;
        }
        if (flw && !flw.retryable) {
          // PAY-TRUTH G2 — 'keep-match': this IS the retry surface. The
          // customer is holding the phone; a second decline must leave
          // them exactly where they were, with the same motari and the
          // same escrow, free to try again or switch method.
          await markEscrowChargeFailed(escrow.id, flw.code, undefined, 'keep-match');
          res.status(502).json({
            error: { code: 'CHARGE_FAILED', message: 'errors.chargeFailed', detail: flw.code },
          });
          return;
        }
        // Retryable — leave PENDING; reconciler will retry.
        res.json({ status: 'PENDING', txRef, warning: 'transient_error' });
      }
    } catch (err) { next(err); }
  },
);

export default router;
