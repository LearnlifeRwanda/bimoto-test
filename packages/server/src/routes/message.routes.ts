import { Router } from 'express';
import { validate } from '../middleware/validate';
import { authMiddleware } from '../middleware/auth';
import { createMessageSchema, SOCKET_EVENTS } from '@bimoto/shared';
import * as messageService from '../services/message.service';
import { emitToJourney } from '../socket';

const router = Router();

/**
 * @openapi
 * /api/journeys/{id}/messages:
 *   get:
 *     summary: List messages on a journey, optionally filtered by `since` timestamp.
 *     description: Journey parties only. A caller who is not the customer or the
 *       assigned driver gets 403; a journey that does not exist gets 404.
 *     tags: [Messages]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: since
 *         schema: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: Message array.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { type: object }
 *       403:
 *         description: Caller is not a party to the journey.
 *       404:
 *         description: Journey not found.
 */
// GET /api/journeys/:id/messages - list messages (with ?since query)
router.get('/:id/messages', authMiddleware, async (req, res, next) => {
  try {
    const since = req.query.since ? new Date(req.query.since as string) : undefined;
    const messages = await messageService.getMessages(req.params.id, req.user!.userId, since);
    res.json(messages);
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/journeys/{id}/messages:
 *   post:
 *     summary: Send a message on a journey (free-text or quick-message id).
 *     tags: [Messages]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               text:           { type: string }
 *               isQuickMessage: { type: boolean }
 *               quickMessageId: { type: string }
 *     responses:
 *       201:
 *         description: Created message.
 *         content:
 *           application/json:
 *             schema: { type: object }
 */
// POST /api/journeys/:id/messages - create message
//
// PILOT-GUARD Item 6(a) — the body is validated.
//
// `validate` and `createMessageSchema` were both imported at the top of
// this file and neither was used on this route, so a POST with no body
// reached the destructure below, threw a TypeError on `undefined`, and
// came back as a 500 INTERNAL_ERROR. A missing message body is a 400,
// and this is the defect `noUnusedLocals` would have named.
//
// `journeyId` is omitted from the schema on purpose: it names the same
// journey as the `:id` path parameter this route already reads, and no
// caller has ever sent it in the body (the client, and both e2e specs
// that post here, send `{ text }`). Validating it as required would
// reject every legitimate message. The shared schema is left as it is —
// it describes the message, not this route's request shape.
router.post('/:id/messages', authMiddleware, validate(createMessageSchema.omit({ journeyId: true })), async (req, res, next) => {
  try {
    const { text, isQuickMessage, quickMessageId } = req.body;
    const message = await messageService.createMessage(
      req.params.id,
      req.user!.userId,
      text,
      isQuickMessage,
      quickMessageId,
    );
    emitToJourney(req.params.id, SOCKET_EVENTS.NEW_MESSAGE, message);
    res.status(201).json(message);
  } catch (err) { next(err); }
});

export default router;
