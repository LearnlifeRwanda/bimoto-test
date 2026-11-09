// VALIDATE-MEND G2 — the contact rule, at the layer both sides share.
//
// The client's inline check and the server's validate() both call
// normaliseEmergencyContact, so proving the rule here proves it for
// both. What the two layers do with the answer is tested separately
// (server: user-update-validation.test.ts; client:
// SettingsPage-contact-validation.test.tsx).

import {
  emergencyContactsSchema,
  isValidEmergencyContact,
  normaliseEmergencyContact,
  updateMeSchema,
  MAX_EMERGENCY_CONTACTS,
  RWANDA_PHONE_REGEX,
  type User,
} from '../index';

describe('the emergency-contact rule', () => {
  describe('accepts the forms a Rwandan passenger actually types', () => {
    it.each([
      ['local, bare', '0788123456', '+250788123456'],
      ['local, spaced the way the shopfronts print it', '0788 123 456', '+250788123456'],
      ['local, dashed', '078-812-3456', '+250788123456'],
      ['E.164, bare — RWANDA_PHONE_REGEX exactly', '+250788123456', '+250788123456'],
      ['E.164, spaced', '+250 788 123 456', '+250788123456'],
      ['E.164, bracketed the way a contacts app pastes it', '+250 (788) 123-456', '+250788123456'],
      ['a 072 number — MTN is not the only network', '0722000111', '+250722000111'],
    ])('%s', (_label, input, stored) => {
      expect(normaliseEmergencyContact(input)).toBe(stored);
      expect(isValidEmergencyContact(input)).toBe(true);
    });
  });

  describe('accepts an international next of kin — the team asked for country codes', () => {
    it.each([
      ['UK', '+447700900123', '+447700900123'],
      ['UK, spaced', '+44 7700 900123', '+447700900123'],
      ['Uganda', '+256772123456', '+256772123456'],
      ['US', '+12025550143', '+12025550143'],
      ['the shortest E.164 still dialable (7 digits)', '+2345678', '+2345678'],
      ['the longest E.164 the ITU allows (15 digits)', '+123456789012345', '+123456789012345'],
    ])('%s', (_label, input, stored) => {
      expect(normaliseEmergencyContact(input)).toBe(stored);
    });
  });

  describe('refuses what is not a number — the whole point of the wave', () => {
    it.each([
      ['the field-reported case: a word', 'mama'],
      ['a word with a plausible shape', 'Mama Kigali'],
      ['whitespace only', '   '],
      ['empty', ''],
      ['an address', 'KG 7 Ave, Kigali'],
      ['an email', 'aunt@example.com'],
      ['too short for any national number', '+250'],
      ['a local number one digit short', '078812345'],
      ['a local number one digit long', '07881234567'],
      ['a local number that is not a mobile prefix', '0688123456'],
      ['digits with no country code and no leading 0', '788123456'],
      ['16 digits — past the E.164 ceiling', '+1234567890123456'],
      ['a leading zero after the plus', '+0788123456'],
      ['letters mixed into digits', '+250788ABC456'],
      ['a ciphertext-shaped string, which must never be storable', 'a1b2:c3d4:e5f6'],
    ])('%s', (_label, input) => {
      expect(normaliseEmergencyContact(input)).toBeNull();
      expect(isValidEmergencyContact(input)).toBe(false);
    });
  });

  it('stores the E.164 form, which is the form the SOS path can dial', () => {
    // journey.routes.ts hands each stored contact to sendSms, and
    // sms.service.ts wants what Africa's Talking wants. Prove the
    // normalised form is the same shape the user's OWN phone already
    // has — RWANDA_PHONE_REGEX is what auth.schema demands at signup.
    const stored = normaliseEmergencyContact('0788 123 456');
    expect(stored).not.toBeNull();
    expect(RWANDA_PHONE_REGEX.test(stored!)).toBe(true);
  });
});

describe('the array', () => {
  it('normalises every entry, not just the first', () => {
    const parsed = emergencyContactsSchema.parse(['0788 123 456', '+44 7700 900123']);
    expect(parsed).toEqual(['+250788123456', '+447700900123']);
  });

  it('accepts an empty list — that is how the last contact is removed', () => {
    expect(emergencyContactsSchema.parse([])).toEqual([]);
  });

  it(`accepts the cap of ${MAX_EMERGENCY_CONTACTS} and refuses one more`, () => {
    const three = Array(MAX_EMERGENCY_CONTACTS).fill('0788123456');
    expect(emergencyContactsSchema.parse(three)).toHaveLength(MAX_EMERGENCY_CONTACTS);
    expect(() => emergencyContactsSchema.parse([...three, '0788123457'])).toThrow();
  });

  it('refuses the whole list when one entry is not a number', () => {
    expect(() => emergencyContactsSchema.parse(['0788123456', 'mama'])).toThrow();
  });
});

describe('updateMeSchema — the FULL contract, tightened in exactly one place', () => {
  it.each([
    ['SettingsPage/ProfilePage add+remove', { emergencyContacts: ['0788123456'] }],
    ['ProfilePage/SettingsPage remove-the-last', { emergencyContacts: [] }],
    ['ProfilePage save profile', { nickname: 'Aline' }],
    ['RegisterPage', { nickname: 'Aline', role: 'DRIVER', language: 'rw' }],
    ['e2e field-fit role set', { role: 'DRIVER' }],
    ['an empty body — the route has always tolerated one', {}],
  ])('accepts the payload %s sends today', (_label, body) => {
    expect(() => updateMeSchema.parse(body)).not.toThrow();
  });

  it('lets a non-self-assignable role THROUGH to the service', () => {
    // e2e/field-fit.spec.ts asserts 400 ROLE_NOT_SELF_ASSIGNABLE by
    // name. A nativeEnum here would answer with a generic zod dump and
    // take that message away, so `role` is deliberately a bare string
    // and user.service.ts stays the authority.
    expect(updateMeSchema.parse({ role: 'ADMIN' })).toEqual({ role: 'ADMIN' });
  });

  it('strips unknown keys rather than refusing them', () => {
    // The route destructures four fields and has always ignored the
    // rest; refusing extras would be a tightening nobody asked for.
    expect(updateMeSchema.parse({ nickname: 'Aline', somethingElse: 1 })).toEqual({
      nickname: 'Aline',
    });
  });

  it('refuses garbage contacts', () => {
    expect(() => updateMeSchema.parse({ emergencyContacts: ['mama'] })).toThrow();
  });
});

// CLEAN-SWEEP G3 — the shared type is answerable to the schema.
//
// `User.emergencyContacts` said `string` while the client store said
// `string[]` and the server had sent arrays since #192. `tsc` surfaced
// nothing when the type was corrected — not because the fix was
// consequence-free, but because the shared `User` interface has NO
// importer anywhere in the repo (client, server, e2e and all eight script
// projects declare or infer their own). An unread type cannot be caught
// by the compiler, so it is caught here instead: the schema is the
// authority on this field, and the type must accept what the schema
// produces.
describe('the shared User type agrees with the schema (CLEAN-SWEEP G3)', () => {
  it("accepts the schema's output as User.emergencyContacts", () => {
    const parsed = emergencyContactsSchema.parse(['0788 123 456', '+250788123456']);

    // This is the assertion: it is a COMPILE error if the field is not an
    // array type. `string` would not accept `string[]`, which is exactly
    // the contradiction that shipped.
    const contacts: User['emergencyContacts'] = parsed;

    expect(contacts).toEqual(['+250788123456', '+250788123456']);
  });

  it('accepts the empty array — removing the last contact', () => {
    const contacts: User['emergencyContacts'] = emergencyContactsSchema.parse([]);
    expect(contacts).toEqual([]);
  });

  it('is optional, because a user who never set one has no field', () => {
    const contacts: User['emergencyContacts'] = undefined;
    expect(contacts).toBeUndefined();
  });
});
