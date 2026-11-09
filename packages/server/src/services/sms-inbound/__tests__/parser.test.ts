import { parseMessage } from '../parser';

describe('parseMessage — strict keyword/numeric table', () => {
  test('lowercase yes → CONFIRM_JOURNEY', () => {
    expect(parseMessage('yes').intent).toBe('CONFIRM_JOURNEY');
  });

  test('uppercase YES → CONFIRM_JOURNEY', () => {
    expect(parseMessage('YES').intent).toBe('CONFIRM_JOURNEY');
  });

  test('mixed-case Yes → CONFIRM_JOURNEY', () => {
    expect(parseMessage('Yes').intent).toBe('CONFIRM_JOURNEY');
  });

  test('whitespace-padded "  yes  " → CONFIRM_JOURNEY (smallest-wrongness check)', () => {
    expect(parseMessage('  yes  ').intent).toBe('CONFIRM_JOURNEY');
  });

  test('"1" → CONFIRM_JOURNEY', () => {
    expect(parseMessage('1').intent).toBe('CONFIRM_JOURNEY');
  });

  test('"2" → DISPUTE_JOURNEY', () => {
    expect(parseMessage('2').intent).toBe('DISPUTE_JOURNEY');
  });

  test('STOP and lowercase stop → STOP', () => {
    expect(parseMessage('STOP').intent).toBe('STOP');
    expect(parseMessage('stop').intent).toBe('STOP');
  });

  test('HELP and "?" → HELP', () => {
    expect(parseMessage('HELP').intent).toBe('HELP');
    expect(parseMessage('?').intent).toBe('HELP');
  });

  test('CANCEL → CANCEL_SCHEDULED', () => {
    expect(parseMessage('CANCEL').intent).toBe('CANCEL_SCHEDULED');
  });

  test('ACCEPT and DECLINE → ACCEPT_BID and DECLINE_BID', () => {
    expect(parseMessage('ACCEPT').intent).toBe('ACCEPT_BID');
    expect(parseMessage('DECLINE').intent).toBe('DECLINE_BID');
  });

  test('empty string → UNKNOWN', () => {
    expect(parseMessage('').intent).toBe('UNKNOWN');
  });

  test('"random text" → UNKNOWN', () => {
    expect(parseMessage('random text').intent).toBe('UNKNOWN');
  });

  test('"YES PLEASE" → UNKNOWN (strict only — no fuzzy)', () => {
    expect(parseMessage('YES PLEASE').intent).toBe('UNKNOWN');
  });

  test('null/undefined → UNKNOWN', () => {
    expect(parseMessage(null).intent).toBe('UNKNOWN');
    expect(parseMessage(undefined).intent).toBe('UNKNOWN');
  });

  test('parsed result preserves raw and exposes normalised form', () => {
    const result = parseMessage('  Yes  ');
    expect(result.raw).toBe('  Yes  ');
    expect(result.normalised).toBe('YES');
    expect(result.intent).toBe('CONFIRM_JOURNEY');
  });
});

describe('parseMessage — RECIPIENT_CONFIRM keywords (R3-RECIPIENT-CONFIRM)', () => {
  test('"RECEIVED" → RECIPIENT_CONFIRM', () => {
    expect(parseMessage('RECEIVED').intent).toBe('RECIPIENT_CONFIRM');
  });

  test('lowercase "received" → RECIPIENT_CONFIRM', () => {
    expect(parseMessage('received').intent).toBe('RECIPIENT_CONFIRM');
  });

  test('mixed-case "Received" → RECIPIENT_CONFIRM', () => {
    expect(parseMessage('Received').intent).toBe('RECIPIENT_CONFIRM');
  });

  test('whitespace-padded "  received  " → RECIPIENT_CONFIRM', () => {
    expect(parseMessage('  received  ').intent).toBe('RECIPIENT_CONFIRM');
  });

  test('"OK" → RECIPIENT_CONFIRM', () => {
    expect(parseMessage('OK').intent).toBe('RECIPIENT_CONFIRM');
  });

  test('"CONFIRMED" → RECIPIENT_CONFIRM', () => {
    expect(parseMessage('CONFIRMED').intent).toBe('RECIPIENT_CONFIRM');
  });

  test('Kinyarwanda "MURAKOZE" → RECIPIENT_CONFIRM', () => {
    expect(parseMessage('MURAKOZE').intent).toBe('RECIPIENT_CONFIRM');
  });

  test('Kinyarwanda "NABONYE" → RECIPIENT_CONFIRM', () => {
    expect(parseMessage('nabonye').intent).toBe('RECIPIENT_CONFIRM');
  });

  test('Kinyarwanda "YEGO" → RECIPIENT_CONFIRM', () => {
    expect(parseMessage('YEGO').intent).toBe('RECIPIENT_CONFIRM');
  });

  test('multi-word "GOT IT" → RECIPIENT_CONFIRM', () => {
    expect(parseMessage('GOT IT').intent).toBe('RECIPIENT_CONFIRM');
  });

  test('multi-word "thank you" → RECIPIENT_CONFIRM', () => {
    expect(parseMessage('thank you').intent).toBe('RECIPIENT_CONFIRM');
  });

  test('French "MERCI" → RECIPIENT_CONFIRM', () => {
    expect(parseMessage('merci').intent).toBe('RECIPIENT_CONFIRM');
  });

  test('existing CONFIRM_JOURNEY mappings are not regressed', () => {
    expect(parseMessage('YES').intent).toBe('CONFIRM_JOURNEY');
    expect(parseMessage('1').intent).toBe('CONFIRM_JOURNEY');
    expect(parseMessage('CONFIRM').intent).toBe('CONFIRM_JOURNEY');
  });
});

// R3-RECIPIENT-CONFIRM-2 — recipient flags wrong/damaged parcel.
describe('parseMessage — RECIPIENT_DISPUTE keywords (R3-RECIPIENT-CONFIRM-2)', () => {
  test('English "WRONG" → RECIPIENT_DISPUTE', () => {
    expect(parseMessage('WRONG').intent).toBe('RECIPIENT_DISPUTE');
  });

  test('English "WRONG ITEM" → RECIPIENT_DISPUTE', () => {
    expect(parseMessage('WRONG ITEM').intent).toBe('RECIPIENT_DISPUTE');
  });

  test('lowercase "wrong parcel" → RECIPIENT_DISPUTE', () => {
    expect(parseMessage('wrong parcel').intent).toBe('RECIPIENT_DISPUTE');
  });

  test('English "DAMAGED" → RECIPIENT_DISPUTE', () => {
    expect(parseMessage('DAMAGED').intent).toBe('RECIPIENT_DISPUTE');
  });

  test('English "BROKEN" → RECIPIENT_DISPUTE', () => {
    expect(parseMessage('broken').intent).toBe('RECIPIENT_DISPUTE');
  });

  test('English "NOT MINE" → RECIPIENT_DISPUTE', () => {
    expect(parseMessage('not mine').intent).toBe('RECIPIENT_DISPUTE');
  });

  test('Kinyarwanda "SIBYO" → RECIPIENT_DISPUTE', () => {
    expect(parseMessage('SIBYO').intent).toBe('RECIPIENT_DISPUTE');
  });

  test('Kinyarwanda "BYANGIZWE" → RECIPIENT_DISPUTE', () => {
    expect(parseMessage('byangizwe').intent).toBe('RECIPIENT_DISPUTE');
  });

  test('French "FAUX" → RECIPIENT_DISPUTE', () => {
    expect(parseMessage('FAUX').intent).toBe('RECIPIENT_DISPUTE');
  });

  test('French "ENDOMMAGÉ" → RECIPIENT_DISPUTE', () => {
    expect(parseMessage('endommagé').intent).toBe('RECIPIENT_DISPUTE');
  });

  test('French ASCII fallback "ENDOMMAGE" → RECIPIENT_DISPUTE', () => {
    expect(parseMessage('endommage').intent).toBe('RECIPIENT_DISPUTE');
  });

  test('French "PAS LE BON" → RECIPIENT_DISPUTE', () => {
    expect(parseMessage('pas le bon').intent).toBe('RECIPIENT_DISPUTE');
  });

  // §8 smallest-wrongness gate: dispute must beat confirm when both
  // keywords appear in the same message.
  test('precedence: "OK WRONG ITEM" → RECIPIENT_DISPUTE (dispute beats confirm)', () => {
    expect(parseMessage('OK WRONG ITEM').intent).toBe('RECIPIENT_DISPUTE');
  });

  test('precedence: "WRONG OK" → RECIPIENT_DISPUTE', () => {
    expect(parseMessage('WRONG OK').intent).toBe('RECIPIENT_DISPUTE');
  });

  test('precedence: "thanks but damaged" → RECIPIENT_DISPUTE', () => {
    expect(parseMessage('thanks but damaged').intent).toBe('RECIPIENT_DISPUTE');
  });

  // Existing journey-dispute keyword must NOT regress for Bimoto users.
  // "DISPUTE" alone stays mapped to DISPUTE_JOURNEY (handled by the
  // existing strict-map fallback, since DISPUTE_PATTERNS no longer
  // contains the bare word).
  test('"DISPUTE" alone stays DISPUTE_JOURNEY (Bimoto-user flow unaffected)', () => {
    expect(parseMessage('DISPUTE').intent).toBe('DISPUTE_JOURNEY');
  });

  // Existing confirm keywords still resolve normally when no dispute
  // pattern appears.
  test('"RECEIVED" without any dispute word → RECIPIENT_CONFIRM (no false-positive)', () => {
    expect(parseMessage('RECEIVED').intent).toBe('RECIPIENT_CONFIRM');
  });
});
