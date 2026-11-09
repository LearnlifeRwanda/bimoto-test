// FIXTURE — a read whose write sibling does NOT enforce ownership either
// (a webhook-style open pair). Rule 1 must stay silent here: it measures a
// read against its OWN file's write sibling, and makes no claim about
// routes nobody guards. Guarding this pair is a different rule's job.
import { Router } from 'express';

const router = Router();

router.get('/:id/status', async (req, res) => {
  res.json({ id: req.params.id, status: 'OK' });
});

router.post('/:id/status', async (req, res) => {
  res.status(201).json({ id: req.params.id });
});

export default router;
