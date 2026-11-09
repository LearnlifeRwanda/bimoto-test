// FIXTURE — a read that enforces ownership in the handler itself. The
// walker can verify this without help, so rule 1 asks for no allowlist
// entry. Modelled on GET /:id/eta in journey.routes.ts.
import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import prisma from '../prisma';

const router = Router();

router.get('/:id/eta', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const journey = await prisma.journey.findUnique({ where: { id: req.params.id } });
    if (!journey) return res.status(404).json({ message: 'Journey not found' });
    if (journey.customerId !== userId && journey.driverId !== userId) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    res.json({ minutes: 4 });
  } catch (err) { next(err); }
});

router.post('/:id/eta', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const journey = await prisma.journey.findUnique({ where: { id: req.params.id } });
    if (!journey || journey.driverId !== userId) return res.status(403).json({ message: 'Forbidden' });
    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
