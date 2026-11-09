import { SmsInboundStatus } from '@prisma/client';
import { REPLY_TEMPLATES, helpReply } from '../config';
import type { HandlerFn } from '../types';

export const handle: HandlerFn = async (_ctx, user, parsed, prisma) => {
  if (parsed.intent === 'STOP') {
    await prisma.user.update({
      where: { id: user.id },
      data: { smsOptOut: true },
    });
    return {
      status: SmsInboundStatus.OPT_OUT_RECORDED,
      replyBody: REPLY_TEMPLATES.STOP_RECORDED,
    };
  }

  return {
    status: SmsInboundStatus.PROCESSED,
    // SENDER-MATCH-2 — built, not looked up: HELP must name the commands
    // that actually work under the running tier, and must never offer the
    // placeholder support number it used to carry.
    replyBody: helpReply(),
  };
};
