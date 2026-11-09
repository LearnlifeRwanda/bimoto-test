// DOC-GUARD G3 — encrypt the documents already sitting on the pilot Mac.
//
// The authenticated route reads both forms (utils/document-crypto.ts
// passes a plaintext-era file straight through), so nothing is broken
// while these files remain in the clear. What remains broken is the
// half of the mission this sweep closes: a stolen laptop must yield
// ciphertext, and a file written before this dispatch is still the
// scanned original.
//
// Two passes, and the order is the whole point:
//
//   Pass 1 classifies every file and CHANGES NOTHING. If a single file
//          cannot be confidently classified, the sweep prints it and
//          exits non-zero having touched nothing at all.
//   Pass 2 converts, one atomic rename at a time.
//
// Refusing on ambiguity rather than guessing is deliberate. The failure
// mode of a wrong guess is encrypting something that was already
// encrypted, or writing an envelope around bytes we misread — either
// way an identity document that can never be recovered. A sweep that
// stops and asks is cheap; a corrupted licence is not.
//
// Idempotent: a file already wearing the BIMOTO-DOC-1 envelope is
// skipped, so running this twice (or after a crash) converts nothing
// the second time and exits 0.
//
// Run:  pnpm --filter @bimoto/server documents:encrypt
//       (the pilot updater runs it automatically)

import fs from 'fs';
import path from 'path';
import { encryptDocument, isEncryptedDocument } from '../src/utils/document-crypto';
import { sniffFileType } from '../src/utils/file-type';
import { UPLOAD_ROOT } from '../src/utils/document-store';

const TMP_SUFFIX = '.doc-guard-tmp';

interface Classified {
  file: string;
  state: 'already-encrypted' | 'plaintext' | 'ambiguous';
  detail: string;
}

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function classify(file: string): Classified {
  const buf = fs.readFileSync(file);

  if (isEncryptedDocument(buf)) {
    return { file, state: 'already-encrypted', detail: 'BIMOTO-DOC-1 envelope' };
  }

  if (buf.length === 0) {
    // A zero-byte file is not a document. Encrypting it would produce a
    // valid envelope around nothing and hide the fact that it is empty.
    return { file, state: 'ambiguous', detail: 'empty file' };
  }

  const sniffed = sniffFileType(buf);
  if (sniffed) {
    return { file, state: 'plaintext', detail: sniffed };
  }

  return {
    file,
    state: 'ambiguous',
    detail: `unrecognised content (first bytes: ${buf
      .subarray(0, 8)
      .toString('hex')})`,
  };
}

function main(): void {
  const root = UPLOAD_ROOT;
  console.log(`[DOC-GUARD] sweeping ${path.resolve(root)}`);

  const all = walk(root);

  // Leftovers from an interrupted run. They are never the live file —
  // conversion renames tmp OVER the original — so removing them is safe
  // and keeps a later pass from classifying them.
  const leftovers = all.filter((f) => f.endsWith(TMP_SUFFIX));
  for (const f of leftovers) {
    fs.rmSync(f, { force: true });
    console.log(`[DOC-GUARD] removed interrupted temp file: ${f}`);
  }

  const files = all.filter((f) => !f.endsWith(TMP_SUFFIX));
  if (files.length === 0) {
    console.log('[DOC-GUARD] no documents on disk — nothing to do.');
    return;
  }

  // ---- Pass 1: classify. Nothing is written in this pass. ----
  const classified = files.map(classify);
  const ambiguous = classified.filter((c) => c.state === 'ambiguous');

  if (ambiguous.length > 0) {
    console.error('');
    console.error(
      `[DOC-GUARD] REFUSING TO SWEEP — ${ambiguous.length} file(s) could not be`,
    );
    console.error('            classified as either an encrypted document or a');
    console.error('            recognised image/PDF. Nothing has been changed.');
    console.error('');
    for (const a of ambiguous) {
      console.error(`            ${a.file}\n              ${a.detail}`);
    }
    console.error('');
    console.error('            These files need a human. Encrypting something we');
    console.error('            cannot read would make it permanently unreadable.');
    console.error('');
    process.exitCode = 1;
    return;
  }

  const plaintext = classified.filter((c) => c.state === 'plaintext');
  const already = classified.length - plaintext.length;

  if (plaintext.length === 0) {
    console.log(
      `[DOC-GUARD] all ${already} document(s) already encrypted — nothing to do.`,
    );
    return;
  }

  // ---- Pass 2: convert. ----
  let converted = 0;
  for (const { file, detail } of plaintext) {
    const tmp = `${file}${TMP_SUFFIX}`;
    const plain = fs.readFileSync(file);
    fs.writeFileSync(tmp, encryptDocument(plain));
    // Atomic within the filesystem: the file is either the original or
    // the envelope, never a half-written mixture.
    fs.renameSync(tmp, file);
    converted += 1;
    console.log(`[DOC-GUARD] encrypted (${detail}): ${file}`);
  }

  console.log('');
  console.log(
    `[DOC-GUARD] done — ${converted} encrypted, ${already} already encrypted.`,
  );
}

main();
