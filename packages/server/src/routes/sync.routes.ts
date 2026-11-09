import { Router } from 'express';
import { validate } from '../middleware/validate';
import { authMiddleware } from '../middleware/auth';
import { syncUploadSchema, gpsBatchSchema } from '@bimoto/shared';
import * as syncService from '../services/sync.service';

const router = Router();

/**
 * @openapi
 * /api/sync/events:
 *   post:
 *     summary: Upload a batch of offline-captured sync events.
 *     tags: [Sync]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [events]
 *             properties:
 *               events:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     id:        { type: string, format: uuid, description: 'Client-generated event id (idempotency key).' }
 *                     type:      { type: string }
 *                     payload:   { type: object }
 *                     timestamp: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: Per-event accept/reject result.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 processed:
 *                   type: array
 *                   items: { type: string }
 *                   description: clientEventIds that were applied (or were already present from a prior sync).
 *                 rejected:
 *                   type: array
 *                   items:
 *                     type: object
 *                     required: [clientEventId, code, message]
 *                     properties:
 *                       clientEventId: { type: string }
 *                       code:
 *                         type: string
 *                         enum: [FK_VIOLATION, DUPLICATE_EVENT_ID, VALIDATION_ERROR, STALE_TIMESTAMP, PERMISSION_DENIED, UNKNOWN]
 *                       message: { type: string }
 *                       serverState: { type: object }
 */
// POST /api/sync/events - upload sync events
router.post('/sync/events', authMiddleware, validate(syncUploadSchema), async (req, res, next) => {
  try {
    const result = await syncService.processEvents(req.user!.userId, req.body.events);
    res.json(result);
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/sync/events:
 *   get:
 *     summary: Download events for the caller since the given timestamp.
 *     tags: [Sync]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: since
 *         schema: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: Event array (chronological).
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { type: object }
 */
// GET /api/sync/events - download events since timestamp
router.get('/sync/events', authMiddleware, async (req, res, next) => {
  try {
    const since = req.query.since ? new Date(req.query.since as string) : new Date(0);
    const events = await syncService.getEventsSince(req.user!.userId, since);
    res.json(events);
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/sync/gps:
 *   post:
 *     summary: Batch-upload GPS points captured offline for an in-progress journey.
 *     tags: [Sync]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [journeyId, points]
 *             properties:
 *               journeyId: { type: string, format: uuid }
 *               points:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [lat, lng, timestamp]
 *                   properties:
 *                     lat:       { type: number, format: float }
 *                     lng:       { type: number, format: float }
 *                     accuracy:  { type: number, format: float }
 *                     speed:     { type: number, format: float }
 *                     timestamp: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: Persisted point count.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 inserted: { type: integer }
 *       403:
 *         description: Caller is not a party to the journey.
 *       404:
 *         description: No such journey.
 */
// POST /api/sync/gps - batch upload GPS points
//
// LOOSE-ENDS G5 — the caller's identity is threaded through, because
// this route used to accept a batch for ANY existing journeyId from
// ANY authenticated token. The GET leg above has always scoped itself
// to the caller's own journeys; the write leg now does too.
router.post('/sync/gps', authMiddleware, validate(gpsBatchSchema), async (req, res, next) => {
  try {
    const result = await syncService.saveGpsBatch(
      req.body.journeyId,
      req.body.points,
      req.user!.userId,
    );
    res.json(result);
  } catch (err) { next(err); }
});

export default router;
