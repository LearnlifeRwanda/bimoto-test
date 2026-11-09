// FIXTURE — S2's case: an exported service function returning a raw user
// row. This is EXACTLY the shape verifyOtp had, and the shape S1 cannot
// see, because the route one file away only sees a name.

import prisma from '../prisma';

export async function leaksUser(id: string) {
  const user = await prisma.user.findUnique({ where: { phoneHash: id } });
  return { user, isNewUser: false };
}

// The same function, done right — and the reason S2 does not simply
// forbid touching a user row.
export async function safeUser(id: string) {
  const user = await prisma.user.findUnique({
    where: { phoneHash: id },
    select: { id: true, nickname: true },
  });
  return { user };
}

// A non-user model returned from a service is S2's out-of-scope case:
// Escrow carries no credential column, and flagging every internal
// service return is how a guard gets disabled. See check.ts's header.
export async function escrowIsNotS2(id: string) {
  const escrow = await prisma.escrow.findFirst({ where: { id } });
  return { escrow };
}
