// FIXTURE — the shape the guard must REFUSE.
//
// Not compiled into the server; read as text by the self-test. Three
// carriers in one file, because a rule that only sees `res.json(row)`
// would have missed B-1 (a spread) and U-2 (a property).

import prisma from '../prisma';

const router: any = {};

// direct: the row IS the body.
router.get('/direct', async (req: any, res: any) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  res.json(user);
});

// property: the row is a named key on the body. This is verify-otp's shape.
router.post('/property', async (req: any, res: any) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  res.json({ user, isNewUser: false });
});

// spread: the row's columns are flattened into the body. This is the
// `{...user}` that shipped moneyPinHash.
router.get('/spread', async (req: any, res: any) => {
  const row = await prisma.escrow.findFirst({ where: { id: req.params.id } });
  res.json({ ...row, extra: 1 });
});

export default router;
