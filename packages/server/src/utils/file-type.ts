// DOC-GUARD — what a file actually is, read from its bytes.
//
// The upload filters this replaces tested `file.mimetype`, which is the
// Content-Type the client typed into the multipart part header. Any
// tool sets it to whatever it likes; it is the attacker's own claim
// about the attacker's own payload, and it was the only check.
//
// Four types are recognised, which is every type either upload path
// accepts. Hand-rolled rather than pulled from a dependency: the
// signatures below are four constants totalling nine bytes of prefix
// plus one offset check, and a magic-bytes library would be a supply
// chain addition for less code than its own import statement.
//
// Recognising a signature is not a promise that the rest of the file is
// well-formed — it is a promise that the file is not something ELSE
// wearing an image's Content-Type, which is the check that was missing.

export type SniffedType =
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'application/pdf';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const PDF_MAGIC = Buffer.from('%PDF-', 'ascii');
const RIFF_MAGIC = Buffer.from('RIFF', 'ascii');
const WEBP_MAGIC = Buffer.from('WEBP', 'ascii');

/**
 * The type this buffer really is, or null when it is none of the four.
 * Null is a rejection, never a default-allow.
 */
export function sniffFileType(buf: Buffer): SniffedType | null {
  if (buf.length >= PNG_MAGIC.length && buf.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
    return 'image/png';
  }
  // JPEG: SOI (FFD8) followed by any marker start (FF). Covers JFIF,
  // Exif and the bare-SOI files some scanner apps emit.
  if (buf.length >= JPEG_MAGIC.length && buf.subarray(0, JPEG_MAGIC.length).equals(JPEG_MAGIC)) {
    return 'image/jpeg';
  }
  if (buf.length >= PDF_MAGIC.length && buf.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) {
    return 'application/pdf';
  }
  // WebP is a RIFF container: 'RIFF' <u32 size> 'WEBP'.
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).equals(RIFF_MAGIC) &&
    buf.subarray(8, 12).equals(WEBP_MAGIC)
  ) {
    return 'image/webp';
  }
  return null;
}
