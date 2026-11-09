// DECRYPT v3 L4 — the last line of defence.
//
// The schema rename (phoneEncrypted) and the single accessor
// (services/user-phone.ts) are what make the mistake hard to write, and
// the source assertions are what keep the convention from rotting. This
// module is what catches the case all three miss: a ciphertext string
// that reaches a real outbound boundary at runtime.
//
// It works because ciphertext has a shape no phone number can have.
// utils/crypto.ts emits `iv:ciphertext:tag`, every part lowercase hex,
// separated by colons. A dialable MSISDN has no colons at all — not in
// E.164 (+250788123456), not in local form (0788123456), not with the
// spaces or dashes people type. So the three-part hex shape is a
// zero-false-positive signature for "this is encrypted material, not a
// number", and refusing it can never refuse a real subscriber.

/**
 * `iv:ciphertext:tag`, all hex — the exact output shape of
 * utils/crypto.ts#encrypt. Anchored, so a number that merely contains a
 * colon is not caught by accident.
 */
export const CIPHERTEXT_SHAPE = /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i;

export function looksLikeCiphertext(value: string | null | undefined): boolean {
  if (!value) return false;
  return CIPHERTEXT_SHAPE.test(value.trim());
}

/**
 * A breadcrumb that identifies the failure without reproducing any of the
 * value. The ciphertext is decryptable material: its length and part
 * count are enough to recognise the bug in a log, and nothing else may be
 * written down. Deliberately NOT utils/sms.service#maskPhone, which keeps
 * the last three digits — on ciphertext those are three characters of the
 * GCM tag.
 */
export function ciphertextBreadcrumb(value: string): string {
  const parts = value.split(':').length;
  return `[redacted ciphertext: ${value.length} chars, ${parts} parts]`;
}

export class NotDialableError extends Error {
  readonly code = 'NOT_DIALABLE';
  readonly context: string;

  constructor(context: string, value: string) {
    super(`${context}: refused a destination that is encrypted material, not a phone number ${ciphertextBreadcrumb(value)}`);
    this.name = 'NotDialableError';
    this.context = context;
  }
}

/**
 * Throws NotDialableError if the value is ciphertext rather than a number.
 *
 * Use at boundaries where a wrong value must fail loudly and be recorded —
 * the mobile-money client, where the number IS the wallet address and a
 * silent pass would leave money in limbo. Callers that prefer a structured
 * result over a throw (sendSms) should use looksLikeCiphertext directly.
 */
export function assertDialable(value: string, context: string): void {
  if (looksLikeCiphertext(value)) {
    throw new NotDialableError(context, value);
  }
}
