import { config } from '../../config';

// Env-overridable config for the inbound-SMS subsystem (Dispatch G).
// All thresholds, secrets, shortcodes, and reply templates live here so
// ops can rotate them without a code change.

export const AT_INBOUND_HMAC_SECRET = process.env.AT_INBOUND_HMAC_SECRET ?? '';
export const AT_INBOUND_SHORTCODE = process.env.AT_INBOUND_SHORTCODE ?? '15555';
export const INBOUND_DEDUP_TTL_DAYS = parseInt(process.env.INBOUND_DEDUP_TTL_DAYS ?? '30', 10);
export const REPLY_TIMEOUT_MS = parseInt(process.env.REPLY_TIMEOUT_MS ?? '5000', 10);
export const DISPUTE_REPLY_WINDOW_HOURS = parseInt(
  process.env.DISPUTE_REPLY_WINDOW_HOURS ?? '24',
  10,
);
export const SCHEDULED_REPLY_WINDOW_HOURS = parseInt(
  process.env.SCHEDULED_REPLY_WINDOW_HOURS ?? '48',
  10,
);
export const BID_REPLY_WINDOW_MINUTES = parseInt(
  process.env.BID_REPLY_WINDOW_MINUTES ?? '5',
  10,
);

// SENDER-MATCH-2 — the support clause, and the placeholder it replaces.
//
// The HELP template shipped ending "Support +250 XXX XXX XXX." A user who
// followed it would have dialled nothing. It survived review because HELP
// had never once run for a registered user: the sender lookup matched
// nobody (#182), so this reply was unreachable in production. #193 made it
// reachable, which turns a dormant placeholder into a launch blocker.
//
// The rule is a real number or silence. When SUPPORT_PHONE is unset the
// clause is omitted entirely rather than degrading to a placeholder, so
// there is no configuration in which Bimoto tells somebody to call XXX.
function supportClause(): string {
  const phone = config.SUPPORT_PHONE.trim();
  return phone ? ` Support ${phone}.` : '';
}

/**
 * The HELP reply, which must describe the commands that ACTUALLY work.
 *
 * Under 'safe' — the pilot's tier — listing 1/2/YES/NO would be listing
 * four commands that all answer "use the app", and USE_APP below points
 * users here with "Reply HELP for what works by SMS". The 'full' line is
 * byte-identical to what shipped, minus the placeholder support clause.
 */
/**
 * The reply to a number we cannot match to an account.
 *
 * SENDER-MATCH-2 — this carried the SAME placeholder as HELP, and this one
 * is worse: HELP was unreachable, but UNMATCHED_SENDER is what EVERY inbound
 * message has been answered with for as long as the broken sender lookup
 * stood (#182). Real strangers have been told to call XXX XXX XXX. Same rule
 * applies — a real number or silence.
 */
export function unmatchedSenderReply(): string {
  const phone = config.SUPPORT_PHONE.trim();
  return phone
    ? `Bimoto: We could not match your number. Call support at ${phone}.`
    : 'Bimoto: We could not match your number.';
}

export function helpReply(): string {
  const commands =
    config.SMS_COMMAND_TIER === 'full'
      ? 'Reply 1=confirm 2=dispute YES=accept NO=decline STATUS=info STOP=opt out.'
      : 'Reply STATUS=your ride BALANCE=your money STOP=opt out.';
  return `Bimoto: ${commands}${supportClause()}`;
}

export const REPLY_TEMPLATES = {
  CONFIRMED: 'Bimoto: Thanks — your ride is marked complete.',
  DISPUTED: 'Bimoto: Dispute opened. Admin will contact you within 24h.',
  SCHEDULED_CONFIRMED: 'Bimoto: Your scheduled ride is confirmed.',
  SCHEDULED_CANCELLED: 'Bimoto: Your scheduled ride is cancelled.',
  BID_ACCEPTED: 'Bimoto: Bid accepted. Customer notified.',
  BID_DECLINED: 'Bimoto: Bid declined.',
  STOP_RECORDED:
    'Bimoto: You will not receive non-essential SMS. Reply START to re-enable.',
  // SENDER-MATCH-2 — HELP is now built by helpReply() above (it depends on
  // the tier and on SUPPORT_PHONE). This entry is the tier-'full' wording
  // kept as the template family's record of it; handlers call helpReply().
  HELP: 'Bimoto: Reply 1=confirm 2=dispute YES=accept NO=decline STATUS=info STOP=opt out.',
  // SENDER-MATCH-2 — the one new template: what a gated command answers.
  USE_APP:
    'Bimoto: For ride actions please use the Bimoto app. Reply HELP for what works by SMS.',
  NO_MATCHING_JOURNEY:
    'Bimoto: No active rides found in the last 24h. Open the app or call support.',
  NO_MATCHING_BID:
    'Bimoto: No pending bid for you right now. Open the app to view current rides.',
  NO_MATCHING_SCHEDULED:
    'Bimoto: No upcoming scheduled rides for you. Open the app to book.',
  // SENDER-MATCH-2 — built by unmatchedSenderReply() above; this entry keeps
  // the family's record of the with-a-number wording. The placeholder that
  // used to sit here reached every stranger who ever texted the shortcode.
  UNMATCHED_SENDER: 'Bimoto: We could not match your number.',
  UNKNOWN_INTENT: 'Bimoto: We did not understand. Reply HELP for options.',
} as const;

export type ReplyTemplateKey = keyof typeof REPLY_TEMPLATES;
