import { SmsInboundStatus, UserRole } from '@prisma/client';
import type { HandlerFn } from '../types';
import { getEffectivePreference } from '../../payout/training-wheels';
import { kigaliHour } from '../../../utils/kigali-time';

function nextDisbursementLine(user: any, now: Date): string {
  const effective = getEffectivePreference({
    payoutPreference: user.payoutPreference ?? 'AT_SHIFT_END',
    completedShifts: user.completedShifts ?? 0,
  });
  if (effective === 'AT_SHIFT_END') {
    return 'Next disbursement: when you end your shift.';
  }
  const hour = kigaliHour(now);
  if (effective === 'TWICE_DAILY') {
    if (hour < 6) return 'Next disbursement: today 06:00.';
    if (hour < 18) return 'Next disbursement: today 18:00.';
    return 'Next disbursement: tomorrow 06:00.';
  }
  // DAILY_22H
  return hour < 22
    ? 'Next disbursement: today 22:00.'
    : 'Next disbursement: tomorrow 22:00.';
}

export const handle: HandlerFn = async (ctx, user, _parsed, prisma) => {
  if (user.role !== UserRole.DRIVER && user.role !== UserRole.BOTH) {
    return {
      status: SmsInboundStatus.PROCESSED,
      replyBody: 'Bimoto: Balance command is for drivers only.',
    };
  }

  const balance = await prisma.driverBalance.findUnique({
    where: { driverId: user.id },
  });
  const pending = balance?.pendingAmount ?? 0;
  const formatted = pending.toLocaleString('en-US');

  return {
    status: SmsInboundStatus.PROCESSED,
    replyBody: `Bimoto: Pending payout RWF ${formatted}. ${nextDisbursementLine(user, ctx.receivedAt)}`,
  };
};
