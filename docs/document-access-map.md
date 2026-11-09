# Uploaded documents — producers, consumers, and how they are served

DOC-GUARD G1. Written before any change, against `main` at `e67eb37`.
Section 1 is the state this dispatch found; section 2 is the state it
left. When this document and the code disagree, the code has drifted.

## 1. Before — every uploaded file is public

### The mount

`packages/server/src/index.ts:163`

```ts
app.use('/uploads', express.static('uploads'));
```

No middleware in front of it. It is declared above every `/api/*`
router, so it is not covered by any of their guards.

### Producers — what writes into `uploads/`

| Producer | Writes | Stored URL | DB column |
|---|---|---|---|
| `routes/user.routes.ts:399-427` (`POST /api/users/me/driver-verification/upload/:docType`) | `uploads/verification/<userId>/<docType><ext>` | `/uploads/verification/<userId>/<docType><ext>` | `DriverProfile.drivingLicensePhotoUrl` / `.ruraAuthorizationPhotoUrl` / `.insurancePhotoUrl` (via the `fieldMap` at `:414`) |
| `routes/upload.routes.ts:78-103` (`POST /api/journeys/:id/upload/pickup-photo`) | `uploads/journeys/<journeyId>/photo-<ts>-<rand><ext>` | `/uploads/journeys/<journeyId>/<filename>` | `Journey.pickupPhotoUrl` |
| `routes/upload.routes.ts:145-170` (`POST /api/journeys/:id/upload/delivery-photo`) | same directory | `/uploads/journeys/<journeyId>/<filename>` | `Journey.deliveryPhotoUrl` |

Both upload paths already authenticate and authorise the **write**
(`authMiddleware` + `driverOnly` for verification; participant check at
`upload.routes.ts:90` and `:157`). Only the **read** was unguarded.

### Consumers — what reads those URLs

| Consumer | File | What it does |
|---|---|---|
| Admin verification review | `packages/client/src/pages/admin/AdminVerifications.tsx:212-220` | `<a href={v.drivingLicensePhotoUrl} target="_blank">` — three plain anchors. **The only UI that renders a stored URL.** |
| Admin conflict payload | `packages/server/src/services/admin/conflict-resolver/conflicts/photo-mismatch.ts:100-101` | Copies `pickupPhotoUrl` / `deliveryPhotoUrl` into a `PHOTO_MISMATCH` conflict payload. Pass-through only — no client renders these fields (verified by grep). |
| Offline journey cache | `packages/client/src/db/tables.ts:52-53` | Types `pickupPhotoUrl?` / `deliveryPhotoUrl?` on the cached journey row. Stored, never rendered. |
| Account deletion | `packages/server/src/routes/user.routes.ts:483-486` | `fs.rmSync('uploads/verification/<userId>')` — the one deleter. |
| Reverse proxy | `docs/DEPLOYMENT.md:127-129` | `location /uploads { proxy_pass ... }` — passes the mount through to the app. |
| Wiring map | `docs/wiring-map.md:354`, `docs/wiring-map.json:948` | Records `/uploads → express.static` under "Non-router mounts". |
| Wiring-audit fixture | `scripts/wiring-audit/tests/fixtures/fakerepo/server/index.ts:10` | Test fixture for the audit tool. Not real wiring; deliberately unchanged. |

No consumer required a flow this dispatch must not touch, so no STOP
condition was hit.

### Two facts the dispatch brief had slightly wrong

Both were verified against `main` and are recorded here because they
change the shape of the risk, not just the wording.

1. **Verification filenames are not obscure at all.** The brief
   described the naming as `fieldname + '-' + uniqueSuffix + ext`. That
   is true of journey photos (`upload.routes.ts:16-19`) but *not* of
   verification documents: `user.routes.ts:22-26` names them
   `${docType}${ext}`. Every driving licence on the pilot therefore sat
   at exactly `/uploads/verification/<userId>/driving-license.jpg`. The
   only unknown was the `userId` — and the API hands `driverId` to the
   customer of any journey that motari was matched to (asserted in
   `packages/e2e/tests/escrow-adoption-flow.spec.ts:131`). The URL was
   constructible from data the app gives out, not merely guessable.

2. **PDF was already accepted for verification documents.**
   `user.routes.ts:30-39` allowed `image/jpeg`, `image/png` and
   `application/pdf` — it is WebP that was missing there, while journey
   photos (`upload.routes.ts:26-33`) allowed JPEG/PNG/WebP and rejected
   PDF. So a scanner-app motari was *not* refused by the type list.
   What made the check worthless in both places is that it tested
   `file.mimetype`, a client-supplied header. G3 replaces it with
   content sniffing and keeps the two sets exactly as they were.

### The exposure, proved on a live stack

Real server (`pnpm dev`, `NODE_ENV=test`), real Postgres, real seeded
driver, the real upload endpoint, then an anonymous `curl`:

```
== 2. upload a driving licence through the real endpoint ==
upload response: {"url":"/uploads/verification/cd504741-f5e4-4414-9f59-0a9f2a8dc9dd/driving-license.jpg"}

== 3. UNAUTHENTICATED GET of that document ==
--- no Authorization header, no cookie ---
HTTP 200  bytes=48  type=image/jpeg
--- body actually served to the anonymous caller ---
JFIF-SECRET-LICENCE-CONTENT-OF-A-REAL-MOTARI
```

The same exposure is pinned as a test in
`packages/server/src/__tests__/document-exposure.test.ts`, which asserts
`200` plus plaintext-on-disk. G2 and G3 invert it.

## 2. After

### How a document is served

**One** endpoint, `GET /api/documents/:key`, replacing the static
mount. Nothing answers on `/uploads` at all any more. Two kinds of key:

| Key | Refers to | Minted by |
|---|---|---|
| `<uuid>` | a document stored from DOC-GUARD onwards | every upload |
| `legacy.<base64url>` | a pre-dispatch storage path | the client, from the URL the API reported |

One endpoint rather than two is not only tidiness. The client fetches
with a single template literal — ``apiFetch(`/api/documents/${ref}`)``
— which is what lets the wiring audit see the route as **wired**. A
second, differently-shaped route for the legacy form could only ever
have been called with a whole URL held in a variable, so it would have
shown up as an orphan and needed silencing with an allowlist entry.

The key is decoded, never trusted: whatever it names is matched against
the URL columns before any file is opened, so being able to spell a
path grants nothing.

### The authorisation matrix, as implemented

| Caller | Verification document | Journey pickup/delivery photo |
|---|---|---|
| The driver it belongs to | **200** | n/a |
| That journey's customer | 404 | **200** |
| That journey's driver | 404 | **200** |
| Admin | **200** | **200** |
| Any other signed-in user | 404 | 404 |
| Anonymous | 404 | 404 |
| A URL no row claims | 404 | 404 |
| A row whose file is gone | 404 | 404 |
| An envelope that fails its auth tag | 404 | 404 |

Every refusal is `404` with an empty body — not `403`. The existence of
an identity document is itself information: "there is a driving licence
here, you just may not have it" tells an attacker which userIds are
drivers. `resolveAuth` (factored out of `authMiddleware`, same rule)
lets the route render an auth failure as 404 too, so an anonymous
prober and a signed-in stranger are indistinguishable.

Entitlement comes from the row that claims the URL — never from the
path. That is what makes the legacy shape safe to keep serving: a
legacy URL names a userId in its path, and that name is ignored.

### Existing URLs and existing files

- **URLs: compatibility read, not rewritten.** A rewrite must move a
  file and update a row; a crash between the two leaves a row pointing
  at nothing, which for an identity document is unrecoverable without a
  backup. The compatibility read is correct at every instant, including
  halfway through the sweep below. Proved on a live stack: a
  plaintext-era file planted at the old path, with a profile row
  pointing at the old URL, served `200` to its owner and `404` to a
  stranger and to an anonymous caller — then the sweep encrypted it in
  place and the *same* row, the *same* URL and the *same* key kept
  serving the same bytes.
- **Files: an idempotent in-place sweep**
  (`packages/server/scripts/encrypt-existing-documents.ts`, wired into
  `scripts/update-pilot.command` as step 5/5). Two passes: pass 1
  classifies and writes nothing; pass 2 converts, each file by
  `write-temp` + atomic `rename`. A file already wearing the
  `BIMOTO-DOC-1` envelope is skipped, so a second run converts nothing.
- **Refusal conditions.** If any file is neither our envelope nor a
  recognised JPEG/PNG/WebP/PDF — including a zero-byte file — the sweep
  prints every such path and exits non-zero **having changed nothing at
  all**. Encrypting bytes we cannot read would make them permanently
  unreadable. A failed sweep deliberately does *not* roll the pilot
  update back: the route reads both forms, so an unswept file is a
  follow-up, not an outage.

### Encryption

AES-256-GCM. Key from `ENCRYPTION_KEY` via `getEncryptionKey()` in
`utils/crypto.ts` — the same key source as phone-number encryption, so
files and phone numbers cannot drift onto different key material. The
key exists only in the environment.

    envelope := "BIMOTO-DOC-1"(12) || IV(12) || TAG(16) || ciphertext

Buffers, not streams: both upload paths cap at 10 MB and multer now
buffers in memory so the bytes can be sniffed before anything is
written, so the whole file is already resident. A streaming
construction would add a chunking format and a partial-write failure
mode to save nothing at this size. The IV is 12 bytes — the standard
GCM nonce — rather than the 16 `utils/crypto.ts` uses for its string
format; that format's length is fixed by ciphertexts already in the
database, this one is new. The envelope is self-describing, so the two
never meet. The magic prefix cannot collide with any accepted type
(JPEG `FF D8 FF`, PNG `89 50 4E 47`, PDF `%PDF-`, WebP `RIFF`), which
is what makes the dual-form read possible.

### Validation

`utils/file-type.ts` reads magic bytes; `file.mimetype` is no longer
consulted anywhere. Hand-rolled rather than a new dependency — four
signatures totalling nine bytes of prefix plus one offset check, less
code than a library's import line. Unrecognised content is a rejection,
never a default-allow.

| Upload | Accepted | Rejected |
|---|---|---|
| Driver verification document | JPEG, PNG, **PDF** | WebP, everything else |
| Journey pickup/delivery photo | JPEG, PNG, WebP | **PDF**, everything else |

Both sets are exactly what the mimetype lists allowed before. PDF for
verification documents is the scanner-app case; a pickup photograph is
a photograph.

### Consumers, after

| Consumer | What changed |
|---|---|
| `AdminVerifications.tsx` | The three `<a href>` anchors became `<DocumentLink>`, which fetches through `apiFetch` and renders from an object URL. An anchor cannot carry the in-memory Bearer token, and the relative href resolved against the client origin — already broken wherever it differs from the API's. |
| `lib/document-ref.ts` (new) | Turns a stored URL into the route key, so the fetch is one statically-visible call site. |
| `photo-mismatch.ts` | Unchanged. It passes URLs through a payload; nothing renders them. |
| `db/tables.ts` | Unchanged. Typed fields, never rendered. |
| Account deletion | Now follows the URL columns (read before anonymization nulls them) **and** still removes the legacy directory. |
| Re-upload | Deletes the superseded document, which opaque keys would otherwise strand on disk. |
| `docs/DEPLOYMENT.md` | The nginx `location /uploads` block now proxies to a path with no handler, which answers 404. Harmless, and left in place so an operator who has not re-copied the config is not surprised by a different failure than the app's own. |
