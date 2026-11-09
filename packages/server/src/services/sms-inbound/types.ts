import type { PrismaClient, User } from '@prisma/client';
import { SmsInboundIntent, SmsInboundStatus } from '@prisma/client';

export { SmsInboundIntent, SmsInboundStatus };

export type Intent =
  | 'CONFIRM_JOURNEY'
  | 'DISPUTE_JOURNEY'
  | 'CONFIRM_SCHEDULED'
  | 'CANCEL_SCHEDULED'
  | 'ACCEPT_BID'
  | 'DECLINE_BID'
  | 'STATUS_QUERY'
  | 'BALANCE_QUERY'
  | 'RECIPIENT_CONFIRM'
  | 'RECIPIENT_DISPUTE'
  | 'HELP'
  | 'STOP'
  | 'UNKNOWN';

export interface ParsedMessage {
  intent: Intent;
  raw: string;
  normalised: string;
}

export interface InboundContext {
  atMessageId: string;
  fromMsisdn: string;
  toShortcode: string;
  rawBody: string;
  receivedAt: Date;
}

export interface HandlerResult {
  status: SmsInboundStatus;
  resolvedEntityId?: string;
  replyBody?: string;
  errorMessage?: string;
}

export type HandlerFn = (
  ctx: InboundContext,
  user: User,
  parsed: ParsedMessage,
  prisma: PrismaClient,
) => Promise<HandlerResult>;
