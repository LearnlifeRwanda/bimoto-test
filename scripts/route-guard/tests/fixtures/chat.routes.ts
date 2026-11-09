// FIXTURE — the AUDIT-BATTERY §G-1 shape, reproduced verbatim in
// miniature: a read that never asks who is calling, beside a write in the
// same file that does. This is the regression rule 1 exists to catch.
import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import * as messageService from '../services/message.service';

const router = Router();

router.get('/:id/messages', authMiddleware, async (req, res, next) => {
  try {
    const since = req.query.since ? new Date(req.query.since as string) : undefined;
    const messages = await messageService.getMessages(req.params.id, since);
    res.json(messages);
  } catch (err) { next(err); }
});

router.post('/:id/messages', authMiddleware, async (req, res, next) => {
  try {
    const message = await messageService.createMessage(req.params.id, req.user!.userId, req.body.text);
    res.status(201).json(message);
  } catch (err) { next(err); }
});

export default router;
