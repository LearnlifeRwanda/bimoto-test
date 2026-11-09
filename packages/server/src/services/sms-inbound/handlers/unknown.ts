import { SmsInboundStatus } from '@prisma/client';
import { REPLY_TEMPLATES } from '../config';
import type { HandlerFn } from '../types';

export const handle: HandlerFn = async () => {
  return {
    status: SmsInboundStatus.UNKNOWN_INTENT,
    replyBody: REPLY_TEMPLATES.UNKNOWN_INTENT,
  };
};
