import { BookingMode, JourneyStatus, SmsInboundStatus } from '@prisma/client';
import type { HandlerFn } from '../types';

const ACTIVE_STATUSES: JourneyStatus[] = [
  JourneyStatus.REQUESTED,
  JourneyStatus.MATCHED,
  JourneyStatus.IN_PROGRESS,
  JourneyStatus.AWAITING_CONFIRMATION,
];

function fmt(d: Date): string {
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

export const handle: HandlerFn = async (_ctx, user, _parsed, prisma) => {
  const active = await prisma.journey.findFirst({
    where: {
      OR: [{ customerId: user.id }, { driverId: user.id }],
      status: { in: ACTIVE_STATUSES },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (active) {
    const dest = active.destinationName || 'destination';
    return {
      status: SmsInboundStatus.PROCESSED,
      resolvedEntityId: active.id,
      replyBody: `Bimoto: Active ride to ${dest} (${active.status}).`,
    };
  }

  const upcoming = await prisma.journey.findFirst({
    where: {
      customerId: user.id,
      bookingMode: BookingMode.SCHEDULED,
      scheduledFor: { gte: new Date() },
    },
    orderBy: { scheduledFor: 'asc' },
  });

  if (upcoming?.scheduledFor) {
    return {
      status: SmsInboundStatus.PROCESSED,
      resolvedEntityId: upcoming.id,
      replyBody: `Bimoto: No active rides. Next scheduled: ${fmt(upcoming.scheduledFor)}.`,
    };
  }

  return {
    status: SmsInboundStatus.PROCESSED,
    replyBody: 'Bimoto: No active or scheduled rides. Open the app to book.',
  };
};
