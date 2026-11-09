// DOC-GUARD G3 — documents encrypted at rest.
//
// The mission's second half: a stolen pilot Mac yields ciphertext. The
// files under uploads/ are a motari's driving licence, his RURA
// authorisation and his insurance certificate. Until now they were the
// scanned originals, sitting in plaintext on a laptop in Kigali.
//
// Construction
// ------------
//   AES-256-GCM, the same algorithm and the same key source as the
//   phone-number encryption in utils/crypto.ts (getEncryptionKey()).
//   One key in the server, not two.
//
//   envelope := MAGIC(12) || IV(12) || TAG(16) || ciphertext
//
//   The magic prefix is what makes the dual-form read possible: a file
//   either starts with it and is decrypted, or does not and is served as
//   it is. That is how the route stays correct on a pilot machine whose
//   uploads/ directory is half swept.
//
//   Buffers, not streams. Both upload paths cap at 10 MB
//   (upload.routes.ts:25, user.routes.ts:31) and multer now buffers in
//   memory so the bytes can be sniffed before anything is written, so
//   the whole file is already resident. A streaming construction would
//   add a chunking format and a partial-write failure mode to save
//   nothing at this size.
//
//   The IV is 12 bytes — the standard GCM nonce length — rather than
//   the 16 that utils/crypto.ts uses for its string format. That
//   format's length is fixed by the ciphertexts already in the
//   database and cannot be revisited; this one is new, so it takes the
//   recommended value. The envelope is self-describing, so the two
//   never meet.
//
// The key itself lives only in ENCRYPTION_KEY, in the environment. It
// is not in this repository and must never be written into one.

import crypto from 'crypto';
import { getEncryptionKey } from './crypto';

const ALGORITHM = 'aes-256-gcm';

/**
 * Chosen so it cannot collide with any type the uploads accept: JPEG
 * starts FF D8 FF, PNG 89 50 4E 47, PDF '%PDF-', WebP 'RIFF'.
 */
const MAGIC = Buffer.from('BIMOTO-DOC-1', 'ascii'); // 12 bytes
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const HEADER_LENGTH = MAGIC.length + IV_LENGTH + TAG_LENGTH;

/** True when these bytes are one of our envelopes. */
export function isEncryptedDocument(buf: Buffer): boolean {
  return (
    buf.length >= HEADER_LENGTH && buf.subarray(0, MAGIC.length).equals(MAGIC)
  );
}

/** Wrap a document's bytes in an encrypted envelope. */
export function encryptDocument(plain: Buffer): Buffer {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, iv, tag, ciphertext]);
}

/**
 * Unwrap an envelope, or pass a plaintext-era file straight through.
 *
 * Returns null only when the bytes ARE an envelope and it does not
 * authenticate — a corrupted or tampered file. The caller renders that
 * as 404 rather than serving bytes it cannot vouch for.
 */
export function decryptDocument(stored: Buffer): Buffer | null {
  if (!isEncryptedDocument(stored)) {
    // A file written before this dispatch. Served as-is; the G3 sweep
    // converts these in place, and the authenticated route in front of
    // it means they are no longer public either way.
    return stored;
  }

  const iv = stored.subarray(MAGIC.length, MAGIC.length + IV_LENGTH);
  const tag = stored.subarray(MAGIC.length + IV_LENGTH, HEADER_LENGTH);
  const ciphertext = stored.subarray(HEADER_LENGTH);

  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    return null;
  }
}
