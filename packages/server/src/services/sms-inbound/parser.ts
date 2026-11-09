import type { Intent, ParsedMessage } from './types';

const INTENT_MAP: Record<string, Intent> = {
  '1': 'CONFIRM_JOURNEY',
  YES: 'CONFIRM_JOURNEY',
  CONFIRM: 'CONFIRM_JOURNEY',
  '2': 'DISPUTE_JOURNEY',
  NO: 'DISPUTE_JOURNEY',
  DISPUTE: 'DISPUTE_JOURNEY',
  CANCEL: 'CANCEL_SCHEDULED',
  ACCEPT: 'ACCEPT_BID',
  DECLINE: 'DECLINE_BID',
  STATUS: 'STATUS_QUERY',
  BALANCE: 'BALANCE_QUERY',
  // R3-RECIPIENT-CONFIRM — keywords that a parcel recipient (not a Bimoto
  // user) might reply to the parcel-delivered SMS. These overlap intent-wise
  // with CONFIRM_JOURNEY but the dispatcher disambiguates: if sender-lookup
  // fails AND intent is RECIPIENT_CONFIRM, route to the recipient-confirm
  // handler; otherwise the existing flow handles it. en/rw/fr all covered.
  RECEIVED: 'RECIPIENT_CONFIRM',
  OK: 'RECIPIENT_CONFIRM',
  CONFIRMED: 'RECIPIENT_CONFIRM',
  'GOT IT': 'RECIPIENT_CONFIRM',
  THANKS: 'RECIPIENT_CONFIRM',
  'THANK YOU': 'RECIPIENT_CONFIRM',
  MURAKOZE: 'RECIPIENT_CONFIRM',
  NABONYE: 'RECIPIENT_CONFIRM',
  YEGO: 'RECIPIENT_CONFIRM',
  'REÇU': 'RECIPIENT_CONFIRM',
  RECU: 'RECIPIENT_CONFIRM',
  MERCI: 'RECIPIENT_CONFIRM',
  HELP: 'HELP',
  '?': 'HELP',
  STOP: 'STOP',
  UNSUBSCRIBE: 'STOP',
};

// R3-RECIPIENT-CONFIRM-2 — dispute keywords are matched as substrings of the
// normalised body (not whole-message), and take precedence over every other
// intent. The load-bearing case is "OK WRONG ITEM" — the recipient
// acknowledges receipt of *something*, but the parcel is wrong. Without the
// substring + precedence rule the parser would resolve this as
// RECIPIENT_CONFIRM (via "OK"), silently dropping the dispute signal.
//
// Keep multi-word entries before single-word so the longer pattern wins
// the toUpperCase substring search visually; functionally, .some short-
// circuits on first hit, but ordering matches the §8 smallest-wrongness
// reading and aids debugging.
const DISPUTE_PATTERNS: string[] = [
  // English. Note: "DISPUTE" alone is intentionally NOT here — it remains
  // mapped to DISPUTE_JOURNEY for Bimoto users replying to the confirm/
  // dispute prompt. Recipients reach the dispute flow via the more natural
  // negative-acknowledgement words below.
  'WRONG ITEM',
  'WRONG PARCEL',
  'NOT MINE',
  'WRONG',
  'DAMAGED',
  'BROKEN',
  // Kinyarwanda
  'SIBYO',
  'BYANGIZWE',
  'SIYO',
  // French
  'PAS LE BON',
  'ENDOMMAGÉ',
  'ENDOMMAGE',
  'MAUVAIS',
  'FAUX',
];

function detectDispute(normalised: string): boolean {
  if (!normalised) return false;
  return DISPUTE_PATTERNS.some((pat) => normalised.includes(pat));
}

export function parseMessage(raw: string | null | undefined): ParsedMessage {
  const safeRaw = raw ?? '';
  const normalised = safeRaw.trim().toUpperCase();
  // Dispute keywords win over every other intent (incl. RECIPIENT_CONFIRM).
  // See DISPUTE_PATTERNS comment for the "OK WRONG ITEM" load-bearing case.
  if (detectDispute(normalised)) {
    return { intent: 'RECIPIENT_DISPUTE', raw: safeRaw, normalised };
  }
  const intent: Intent = INTENT_MAP[normalised] ?? 'UNKNOWN';
  return { intent, raw: safeRaw, normalised };
}
