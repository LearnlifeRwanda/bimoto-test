import { z } from 'zod';
import { MAX_EMERGENCY_CONTACTS, RWANDA_PHONE_REGEX } from '../constants/config.js';

// VALIDATE-MEND G2 — an emergency contact is a number somebody can dial.
//
// Until now `PUT /api/users/me` carried no `validate()` at all — the one
// route in the codebase without a zod schema — so `handleAddContact`'s
// `!newContact.trim()` was the ONLY check between a person's typing and
// `encrypt(JSON.stringify(...))`. "mama", an address, an empty-but-for-
// spaces string: all stored, all encrypted, all unreachable. The field
// only matters once — during an SOS, when journey.routes.ts hands each
// stored contact straight to `sendSms` — and that is the worst possible
// moment to discover the number was never a number.
//
// Validation must sit BEFORE the write. After encrypt() the value is
// opaque: utils/dialable.ts recognises the CIPHERTEXT shape, which is a
// different question from whether a plaintext string is a phone number.
//
// The rule, and why:
//
//   RWANDA_PHONE_REGEX (/^\+250[0-9]{9}$/) is the precedent — it is what
//   auth.schema.ts already demands of the number a person logs in with.
//   An emergency contact is looser in exactly one direction that the
//   field asks for: a Kigali passenger's next of kin may be abroad, and
//   the team asked for country codes. So:
//
//     - Rwandan local  `07XXXXXXXX`     — the form printed on every
//       shopfront in Kigali, and what people actually type.
//     - Rwandan E.164  `+250XXXXXXXXX`  — RWANDA_PHONE_REGEX exactly.
//     - International  `+` then 7–15 digits — E.164's own bounds
//       (ITU-T E.164 caps a subscriber number at 15 digits; 7 is the
//       shortest national number in use).
//
//   Separators people type — spaces, dashes, brackets, a non-breaking
//   space pasted from a contacts app — are stripped before matching.
//   They are punctuation, not data, and refusing "+250 788 123 456"
//   would be refusing a correct number.
//
// STORED FORM: E.164, `+` and digits only. Stated plainly because the
// SOS path depends on it — `sendSms` hands the string to Africa's
// Talking, which wants E.164, and `config.EMERGENCY_OPS_PHONE` and the
// user's own `phone` (RWANDA_PHONE_REGEX at signup) are already that
// shape. A local `07…` is normalised to `+250` + its last nine digits,
// so what is encrypted is what a transport can dial. Nothing here can
// produce a colon, so a normalised contact never trips
// utils/dialable.ts#assertDialable.
//
// LEGACY ROWS ARE NOT TOUCHED. This validates WRITES. Contacts stored
// before this schema existed are read back through
// `parseEmergencyContacts` exactly as before — no migration, no
// re-validation, no row rewritten. A person whose old row holds "mama"
// keeps seeing "mama" until they next edit the list, at which point the
// whole submitted array must pass. That is deliberate: silently deleting
// somebody's emergency contact is worse than showing them a bad one.

/** Punctuation people type into a phone field. Stripped, never stored. */
const PHONE_SEPARATORS = /[\s ().-]/g;

/** Rwandan local form: `07` + eight more digits. */
const RWANDA_LOCAL_PHONE_REGEX = /^0(7[0-9]{8})$/;

/** E.164: `+` then 7–15 digits, leading digit non-zero. */
const E164_PHONE_REGEX = /^\+[1-9][0-9]{6,14}$/;

/**
 * The stored form of a contact, or null if the input is not a phone
 * number at all. Exported so both layers answer with the same function:
 * the client decides whether to show an inline error, the server decides
 * whether to reject, and they can never disagree.
 */
export function normaliseEmergencyContact(raw: string): string | null {
  const compact = raw.trim().replace(PHONE_SEPARATORS, '');
  if (compact === '') return null;

  const local = RWANDA_LOCAL_PHONE_REGEX.exec(compact);
  if (local) return `+250${local[1]}`;

  if (RWANDA_PHONE_REGEX.test(compact)) return compact;
  if (E164_PHONE_REGEX.test(compact)) return compact;

  return null;
}

/** True when the string is something `sendSms` could dial. */
export function isValidEmergencyContact(raw: string): boolean {
  return normaliseEmergencyContact(raw) !== null;
}

/** The i18n key both layers use for a contact that is not a number. */
export const INVALID_EMERGENCY_CONTACT_KEY = 'errors.invalidEmergencyContact';

/**
 * One contact: validated, and TRANSFORMED to its stored E.164 form. The
 * transform is why this schema must be the one the route parses —
 * `validate()` reassigns `req[source]` to the parsed value, so the route
 * body and `updateMe` see the normalised array, never the raw typing.
 */
export const emergencyContactSchema = z
  .string()
  .transform((raw) => normaliseEmergencyContact(raw))
  .refine((v): v is string => v !== null, {
    message: INVALID_EMERGENCY_CONTACT_KEY,
  });

export const emergencyContactsSchema = z
  .array(emergencyContactSchema)
  .max(MAX_EMERGENCY_CONTACTS);

/**
 * The FULL current contract of `PUT /api/users/me` — every field every
 * caller sends today, and nothing narrowed beyond emergencyContacts.
 *
 * Two fields are deliberately left as bare strings:
 *
 *   `role` — because the answer to a non-self-assignable role is
 *   `400 ROLE_NOT_SELF_ASSIGNABLE` from user.service.ts, which
 *   e2e/field-fit.spec.ts asserts by name. A `nativeEnum` here would
 *   turn that into a generic VALIDATION_ERROR and take the honest
 *   message away from the one screen that shows it. The service is the
 *   authority on which roles a person may claim; this schema only says
 *   the field is a string.
 *
 *   `language` — no caller is constrained today (RegisterPage sends the
 *   picker's code), and tightening it would break a language nobody
 *   checked. Out of this wave's scope.
 *
 * Unknown keys are stripped, not rejected: the route destructures the
 * four fields it knows and has always ignored the rest.
 */
export const updateMeSchema = z.object({
  nickname: z.string().optional(),
  language: z.string().optional(),
  emergencyContacts: emergencyContactsSchema.optional(),
  role: z.string().optional(),
});

export type UpdateMeInput = z.infer<typeof updateMeSchema>;
