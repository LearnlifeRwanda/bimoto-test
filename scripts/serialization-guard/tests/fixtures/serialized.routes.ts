// FIXTURE — the shape the guard must ACCEPT.
//
// Two ways to be safe, both of them positive acts: a `select:` written at
// the call site, and a serializer named in allowlist.json.

import prisma from '../prisma';
import { toClientUser } from '../services/client-user';

const router: any = {};

// safe by serializer.
router.get('/serialized', async (req: any, res: any) => {
  const row = await prisma.user.findUnique({ where: { id: req.params.id } });
  const user = toClientUser(row as any);
  res.json({ user });
});

// safe by select: the columns are written down here, so a column added to
// the model tomorrow does not join this payload.
router.get('/selected', async (req: any, res: any) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: { id: true, nickname: true },
  });
  res.json({ user });
});

export default router;
