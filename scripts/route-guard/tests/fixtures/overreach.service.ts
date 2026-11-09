// INCLUDE-REACH G6 fixture — a planted over-reaching read.
//
// Not compiled or imported by anything: the walker reads it as text, the
// way it reads the real tree. It is the shape of the defect this rule
// exists for — a journey read that traverses into the chat, the settlement
// row and the legs' third-party contacts, in a function that never asks who
// is calling.

import prisma from '../prisma';

// The hoisted half of blind spot (a): a selector one const away from the
// read, which excess-property checking never sees.
const DETAIL_INCLUDE = {
  messages: { orderBy: { createdAt: 'asc' } },
  escrow: true,
  legs: { orderBy: { sequence: 'asc' } },
};

export async function getThingById(journeyId: string) {
  return prisma.journey.findUnique({
    where: { id: journeyId },
    include: DETAIL_INCLUDE,
  });
}

// The same read, scoped. `viewerScope` is never allowed to be a finding:
// on a marketplace route, choosing the projection from the caller IS the fix.
export async function getScopedThingById(journeyId: string, requestingUserId: string) {
  const scope = thingViewerScope(requestingUserId);
  const include = scope === 'participant' ? DETAIL_INCLUDE : { legs: { select: { name: true } } };
  return prisma.journey.findUnique({ where: { id: journeyId }, include });
}

export function thingViewerScope(requestingUserId: string | undefined) {
  return requestingUserId ? 'participant' : 'stranger';
}
