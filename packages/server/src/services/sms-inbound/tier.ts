// SENDER-MATCH-2 — the SMS command tier.
//
// The launch that made the sender lookup tell the truth (#193) also handed
// every registered user the full command set over a channel that
// authenticates by CALLER ID alone. That is the weaker credential — weaker
// than the app's session — and it was about to carry the STRONGER power:
// #193's own census found a driver's YES performing the customer's
// confirmation and releasing his own payment, contradicting #177's
// customerOnly model, and CANCEL reaching a refund path outside #184's
// hardening.
//
// The attack surface that makes caller ID weak — MSISDN spoofing toward an
// aggregator, a borrowed handset, a second SIM — is intrinsically hard to
// simulate or anticipate, so the pilot does not try. Money and marketplace
// actions are OFF; rights and reads launch now.
//
// SAFE is not "harmless": STOP is the compliance win this launch exists
// for, and STATUS/BALANCE disclose the sender's own data to whoever
// commands the caller ID. That is the standard SMS-banking-class bargain,
// stated rather than assumed.
//
// The recipient flows are NEVER tier-gated and are not decided here. They
// are the stranger-authority receipt flows, already live for everyone with
// or without an account, and the dispatcher routes them before this gate is
// reached (#193 §0.3). Their entries below describe that fact; they are not
// what switches them on.

import type { Intent } from './types';

export type CommandTier = 'safe' | 'full';
export type IntentTier = 'safe' | 'gated';

/**
 * Every intent's tier, exhaustively.
 *
 * `Record<Intent, IntentTier>` is the ratchet: add a member to the `Intent`
 * union and this object stops compiling until someone decides whether the
 * new command is a right, a read, or an action. No runtime walker is needed
 * — the compiler is the guard, and it cannot be forgotten.
 */
export const INTENT_TIER: Record<Intent, IntentTier> = {
  // Rights and reads — active in the pilot.
  STOP: 'safe', // the compliance win; the launch's actual point
  HELP: 'safe',
  STATUS_QUERY: 'safe', // reads the sender's own ride
  BALANCE_QUERY: 'safe', // reads the sender's own pending payout
  UNKNOWN: 'safe', // the "we did not understand" nudge

  // Never gated — the dispatcher routes these ahead of the gate. Listed so
  // the exhaustiveness check covers the whole union.
  RECIPIENT_CONFIRM: 'safe',
  RECIPIENT_DISPUTE: 'safe',

  // Money and marketplace — off in the pilot.
  CONFIRM_JOURNEY: 'gated', // releases escrow
  DISPUTE_JOURNEY: 'gated', // freezes escrow
  CANCEL_SCHEDULED: 'gated', // refunds escrow
  ACCEPT_BID: 'gated', // marketplace commitment
  DECLINE_BID: 'gated', // withdraws a bid
  CONFIRM_SCHEDULED: 'gated', // unreachable today (no keyword maps to it)
};

/**
 * Whether this effective intent is refused under this tier.
 *
 * Called on the EFFECTIVE intent — after disambiguateBidContext — so a
 * driver's YES that resolved to ACCEPT_BID is refused as the bid action it
 * became, and the same YES outside the bid window is refused as
 * CONFIRM_JOURNEY. Gating the parsed intent instead would let a bid action
 * through whenever the keyword happened to look like a journey reply.
 */
export function isGatedIntent(intent: Intent, tier: CommandTier): boolean {
  if (tier === 'full') return false;
  return INTENT_TIER[intent] === 'gated';
}
