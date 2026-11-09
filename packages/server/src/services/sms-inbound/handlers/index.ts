import * as journeyReply from './journey-reply';
import * as scheduledReply from './scheduled-reply';
import * as bidReply from './bid-reply';
import * as status from './status';
import * as balance from './balance';
import * as helpStop from './help-stop';
import * as unknown from './unknown';
import * as recipientConfirm from './recipient-confirm';
import * as recipientDispute from './recipient-dispute';
import type { HandlerFn, Intent } from '../types';

export const handlerByIntent: Record<Intent, HandlerFn> = {
  CONFIRM_JOURNEY: journeyReply.handle,
  DISPUTE_JOURNEY: journeyReply.handle,
  CONFIRM_SCHEDULED: scheduledReply.handle,
  CANCEL_SCHEDULED: scheduledReply.handle,
  ACCEPT_BID: bidReply.handle,
  DECLINE_BID: bidReply.handle,
  STATUS_QUERY: status.handle,
  BALANCE_QUERY: balance.handle,
  // SENDER-MATCH — these two entries are the FALLBACK, not the route.
  //
  // They used to carry the rule "recipients have no Bimoto account by
  // definition", which is why a resolved sender's recipient keyword landed
  // straight on the UNKNOWN nudge. That premise was an artefact: sender-lookup
  // matched nobody (#182), so a recipient reply could only ever arrive as a
  // stranger, and the claim was never once tested against a resolved user.
  //
  // It is false. Every pilot tester holds an account and can be handed a
  // parcel. The authority for a receipt is the leg's contact phone, not the
  // sender's account, so the dispatcher now runs the recipient-leg match for
  // BOTH resolved and unresolved senders and only falls through to these
  // entries when no recent GOODS_DROPOFF leg matches the number — a person
  // who texted "OK"/"YEGO"/"MURAKOZE" with no delivery waiting on them, who
  // does want the "reply YES/1" nudge.
  RECIPIENT_CONFIRM: unknown.handle,
  RECIPIENT_DISPUTE: unknown.handle,
  HELP: helpStop.handle,
  STOP: helpStop.handle,
  UNKNOWN: unknown.handle,
};

export {
  journeyReply,
  scheduledReply,
  bidReply,
  status,
  balance,
  helpStop,
  unknown,
  recipientConfirm,
  recipientDispute,
};
