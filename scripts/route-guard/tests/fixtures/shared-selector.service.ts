// The importing side. It names only the OUTER selector, exactly as
// journey.service.ts names `CURATED_BIDDER_SELECT`.
//
// Not compiled or imported by anything: the walker reads it as text.
import prisma from '../prisma';
import { SHARED_DETAIL_INCLUDE } from './shared-selector.view';

export async function getSharedSelectorThing(journeyId: string) {
  return prisma.journey.findUnique({
    where: { id: journeyId },
    include: SHARED_DETAIL_INCLUDE,
  });
}
