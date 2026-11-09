// DOC-GUARD G3 — the encryption envelope and the content sniffer.

jest.mock('../config', () => ({
  config: {
    DATABASE_URL: 'test',
    JWT_SECRET: 'test-jwt-secret-at-least-16-chars',
    JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-16-chars',
    ENCRYPTION_KEY: 'a'.repeat(64),
    PORT: 3000,
    CLIENT_URL: 'http://localhost:5173',
    NODE_ENV: 'test',
  },
}));

import {
  encryptDocument,
  decryptDocument,
  isEncryptedDocument,
} from '../utils/document-crypto';
import { sniffFileType } from '../utils/file-type';

const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.from('JFIF body'),
]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('png body'),
]);
const PDF = Buffer.from('%PDF-1.4\nscanner output\n');
const WEBP = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.from([0x1a, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP', 'ascii'),
  Buffer.from('vp8 body'),
]);

describe('document encryption at rest', () => {
  it('round-trips a document byte-for-byte', () => {
    const sealed = encryptDocument(JPEG);
    expect(decryptDocument(sealed)).toEqual(JPEG);
  });

  it('leaves nothing of the plaintext in the stored bytes', () => {
    const secret = Buffer.from('%PDF-1.4\nDriving Licence No. RW-12345\n');
    const sealed = encryptDocument(secret);

    expect(sealed.includes(Buffer.from('RW-12345'))).toBe(false);
    expect(sealed.includes(Buffer.from('%PDF'))).toBe(false);
  });

  it('produces a different ciphertext each time (fresh IV)', () => {
    // Equal ciphertexts would tell an attacker which drivers uploaded
    // the same document.
    expect(encryptDocument(JPEG)).not.toEqual(encryptDocument(JPEG));
  });

  it('round-trips an empty document and a large one', () => {
    // A licence photographed by a phone is a few MB. Compared with
    // Buffer.equals rather than toEqual: jest's deep equality walks a
    // 3 MB buffer element by element and turns this into a 35-second
    // test.
    const big = Buffer.alloc(3 * 1024 * 1024, 7);
    const back = decryptDocument(encryptDocument(big));
    expect(back && back.equals(big)).toBe(true);

    const empty = decryptDocument(encryptDocument(Buffer.alloc(0)));
    expect(empty && empty.length).toBe(0);
  });

  it('refuses a tampered envelope rather than returning bytes', () => {
    const sealed = encryptDocument(JPEG);
    // Flip a bit in the ciphertext body; GCM's tag must catch it.
    sealed[sealed.length - 1] ^= 0x01;

    expect(decryptDocument(sealed)).toBeNull();
  });

  it('refuses an envelope whose auth tag was swapped', () => {
    const sealed = encryptDocument(JPEG);
    sealed[MAGIC_LEN + IV_LEN] ^= 0xff;

    expect(decryptDocument(sealed)).toBeNull();
  });

  const MAGIC_LEN = 12;
  const IV_LEN = 12;

  describe('the dual-form read', () => {
    it('recognises its own envelope', () => {
      expect(isEncryptedDocument(encryptDocument(PDF))).toBe(true);
    });

    it('does not mistake a real document for an envelope', () => {
      for (const plain of [JPEG, PNG, PDF, WEBP]) {
        expect(isEncryptedDocument(plain)).toBe(false);
      }
    });

    it('passes a plaintext-era file straight through', () => {
      // This is what keeps the route correct on a pilot machine whose
      // uploads/ directory has not been swept yet.
      expect(decryptDocument(JPEG)).toEqual(JPEG);
      expect(decryptDocument(PDF)).toEqual(PDF);
    });
  });
});

describe('content sniffing', () => {
  it('identifies each accepted type from its bytes', () => {
    expect(sniffFileType(JPEG)).toBe('image/jpeg');
    expect(sniffFileType(PNG)).toBe('image/png');
    expect(sniffFileType(PDF)).toBe('application/pdf');
    expect(sniffFileType(WEBP)).toBe('image/webp');
  });

  it('rejects a payload that merely claims to be an image', () => {
    // The multipart Content-Type said image/jpeg. The bytes say
    // otherwise, and the bytes are what is checked now.
    const executable = Buffer.from('MZ\x90\x00this is a PE binary');
    const script = Buffer.from('#!/bin/sh\nrm -rf /\n');
    const html = Buffer.from('<html><script>alert(1)</script></html>');

    expect(sniffFileType(executable)).toBeNull();
    expect(sniffFileType(script)).toBeNull();
    expect(sniffFileType(html)).toBeNull();
  });

  it('rejects an empty buffer and a truncated signature', () => {
    expect(sniffFileType(Buffer.alloc(0))).toBeNull();
    expect(sniffFileType(Buffer.from([0xff, 0xd8]))).toBeNull();
    // RIFF without the WEBP tag is some other RIFF container.
    expect(
      sniffFileType(
        Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('AVI ')]),
      ),
    ).toBeNull();
  });

  it('does not treat our own envelope as an uploadable type', () => {
    // Otherwise an attacker could upload a pre-made envelope and have
    // it served back as though the server had sealed it.
    expect(sniffFileType(encryptDocument(JPEG))).toBeNull();
  });
});
