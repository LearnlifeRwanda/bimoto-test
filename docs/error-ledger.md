# BLACKBOX — the client error ledger

Every error the app hits is remembered on the phone; nothing leaves the
device until the user taps **Send report**.

This document is the evidence file for the BLACKBOX dispatch. Section 1
records what was lost before the ledger existed (measured, not assumed);
the remaining sections record what the ledger stores, what it strips, and
where the team reads it.

---

## 1. Before the ledger — what a Kigali crash left behind

Measured on a live local stack at `main` = `39898b9`
(server `NODE_ENV=test` on `:3000`, Vite dev client on `:5173`, Postgres
16 local, seeded DB, signed in as `TestCustomer`), driven by
`packages/e2e/blackbox-probe.mjs`. For each trigger the probe recorded
what the DOM showed the user, what reached the console, and a full
before/after diff of everything durable this origin holds —
`localStorage`, `sessionStorage`, and every IndexedDB database with a
per-object-store row count.

Triggers A and B need a component that throws, so the probe run used a
temporary four-line patch in `DiagnosticsPage.tsx` and `Toast.tsx`
(throw when the URL carries `?g1crash=screen` / `?g1crash=root`). The
patch was reverted before any BLACKBOX code was written and is not part
of this branch; `Toast` is rendered in `App.tsx` **outside**
`ScreenErrorBoundary`, which is what makes B a top-level-boundary case.

| # | Trigger | What the user sees | Console | What survived afterwards |
|---|---------|--------------------|---------|--------------------------|
| A | Render error inside a routed screen (`DiagnosticsPage` throws) | `screen-error-fallback`: "This screen hit a problem", **Go to home screen** + **Retry**. Shell, bottom nav and banners stay alive. | `[screen] uncaught render error on /diagnostics: Error: …` + React's component-stack warning | **Nothing.** `persistenceDelta: []` — no localStorage key, no sessionStorage key, no IndexedDB row anywhere. |
| B | Render error outside any screen boundary (`Toast` throws) | Top-level `ErrorBoundary`: "Something went wrong" + **Retry**. Whole tree replaced (`root.children == 1`). | `[boot] uncaught render error: Error: …` + React's component-stack warning | **Nothing.** `persistenceDelta: []` |
| C | Unhandled promise rejection (`Promise.reject` with no catch) | **Nothing at all.** Diagnostics keeps rendering; no banner, no toast, no fallback. | **Nothing** — not even a console line from the app; only Playwright's `pageerror` hook saw it | **Nothing.** `persistenceDelta: []` |
| D | `window.onerror`-class error (throw from a `setTimeout`, outside React) | **Nothing at all.** Screen unchanged. | **Nothing** from the app; only the `pageerror` hook saw it | **Nothing.** `persistenceDelta: []` |
| E | Failed API call, 5xx (`/api/health` → 500 via the Diagnostics **Refresh** button, through `apiFetch`) | The `diag-server-build` row shows `—`. No error copy, no toast; the row simply reads "unknown" as if the server had never been asked. | Browser's own `Failed to load resource: … 500` line. Nothing from the app. | **Nothing.** `persistenceDelta: []` |

Raw probe output: `g1-before.json` (five records, each with
`persistenceDelta: []`).

Three facts follow, and they are why this dispatch exists:

1. **Where a boundary exists, recovery works and the evidence is
   thrown away.** A and B produce good recovery UI and a console line
   that dies with the WebView. The user is rescued; the team learns
   nothing.
2. **Where no boundary exists, there is complete silence.** C and D
   produce no user-visible signal *and* no app-side console line. A lost
   promise in Kigali is indistinguishable from nothing happening.
3. **Nothing is persisted, anywhere, in any case.** Five triggers, five
   empty persistence diffs. Every field report therefore arrives as a
   description from memory, which is why the Kigali sheet carries
   screenshots instead of stacks.

---

## 2. What the ledger stores

`packages/client/src/services/error-ledger.ts` — one write path
(`recordError`), five sources, and nothing else that touches storage.

### Persistence: localStorage, one key (`bimoto-error-ledger-v1`)

Not Dexie/IndexedDB, which is this codebase's precedent for cached data
(`services/map-cache.ts`, `db/dexie.ts`). Three reasons, in order:

1. **IndexedDB writes are asynchronous.** This module is written to from
   `componentDidCatch`, `window.onerror` and `unhandledrejection` — the
   exact moments the page may be about to be destroyed. An async write
   can be lost precisely in the case the ledger exists for;
   `localStorage.setItem` returns when the value is durable.
2. **Dexie here holds bulk payload** — a ~40 MB PMTiles archive, cached
   journeys, blobs. The ledger is a few KB of short strings, well inside
   localStorage's budget, and the repo already keeps small durable facts
   there (`hooks/usePreferences.ts`, `PickupVerifyCard`).
3. **`ErrorBoundary`'s level-2 recovery clears Dexie tables.** Keeping
   the ledger out of Dexie means "clear cached data and retry" can never
   erase the record of the crash that prompted it.

### Entry shape

| Field | Always? | Meaning |
|---|---|---|
| `t` | yes | ms since epoch |
| `build` | yes | `__APP_BUILD_SHA__`, or `unknown` |
| `route` | yes | `location.pathname` — never the query string |
| `kind` | yes | `render`, `screen-render`, `unhandled-rejection`, `window-error`, `api-network`, `api-server`, `boot` |
| `message` | yes | the error's own message, redacted then truncated |
| `stack` | when there is one | the error's own stack, redacted then truncated |
| `status` | API entries | HTTP status |
| `method` | API entries | request method |
| `path` | API entries | request path, query string stripped |

There is no field for a request body, a response body, a form value or a
header. A body is not filtered out of an entry — it has nowhere to go in
one.

### Caps

| Cap | Value | Where |
|---|---|---|
| Entries kept | **50** | `MAX_ENTRIES` — ring buffer, oldest evicted first |
| Total stored | **64 KiB** (real UTF-8 bytes) | `MAX_TOTAL_BYTES` — entries dropped oldest-first until the payload fits |
| Message | **300 chars** | `MAX_MESSAGE_CHARS` |
| Stack | **1000 chars** | `MAX_STACK_CHARS` |
| Text redaction will scan | 8× the field cap | so a runaway stack cannot make the crash path the slow path |
| Bundle accepted by the server | **50 entries / 96 KiB** | `MAX_REPORT_ENTRIES`, `MAX_REPORT_BYTES` — 413, not 500 |

Both device caps are re-applied to a ring restored from disk, so a
hand-edited or foreign ring cannot spend more of the phone's storage
than one we wrote ourselves.

## 3. Redaction — at write time, not send time

`redact()` runs on every string that reaches the ledger — message,
stack, route and path alike — **before** truncation and **before**
persistence. A token is not filtered on the way out; it is
unrepresentable in the stored entry.

| Rule | Behaviour |
|---|---|
| `Bearer <token>` | replaced with `Bearer [redacted]` |
| A JWT (`eyJ….….…`) | replaced with `[redacted]` |
| `token=`, `accessToken:`, `refresh_token`, `authorization`, `api_key`, `secret`, `password`, `otp`, `pin`, `code` — any spelling, `=` or `:`, quoted or not | value replaced with `[redacted]` |
| Any unbroken run of 32+ `[A-Za-z0-9_-]` | replaced with `[redacted]` — deliberately over-broad; a false positive costs one unreadable word, a false negative puts a live credential on a phone that can be stolen |
| Phone shapes (`+250781234567`, `0781234567`, `250 781 234 567`) | masked to the last three digits: `*********567`. Separators exclude newlines, so a match can never span two stack frames |
| Query strings and fragments on anything URL-shaped | removed |
| Request/response bodies | structurally impossible — see the entry shape above |

Redaction runs **before** truncation on purpose: cutting first could
bisect a token and leave half of it in the entry.

### One real example, from the test suite

`packages/client/src/__tests__/error-ledger.test.ts` — "a planted bearer
token never reaches storage":

```ts
const secret = 'Bearer sk-live-9f2c4d8e1a6b3f70c5d9e2a4b6c8d0f1';
recordError({
  kind: 'api-network',
  message: `request rejected — ${secret}`,
  path: '/api/journeys',
  method: 'POST',
});
expect(stored()).not.toContain('sk-live-9f2c4d8e1a6b3f70c5d9e2a4b6c8d0f1');
expect(readErrorLedger()[0].message).toContain('[redacted]');
```

`stored()` reads `localStorage` directly — the assertion is against the
bytes on disk, not against a getter that could be filtering. The stored
message is:

```
request rejected — Bearer [redacted]
```

The companion cases plant a JWT, four differently-spelled `key=value`
secrets, a phone number, a query string and a full request body, and
each asserts the secret is absent from `localStorage`.

## 4. The user's half, and the team's half

**On Diagnostics** (`pages/shared/DiagnosticsPage.tsx` +
`components/diagnostics/ErrorLogSection.tsx`): an error-count row
(`diag-error-count`) in the existing row style, then the log itself —
newest first, each entry showing kind, time, status, route, path and
build in mono, with the already-redacted message beneath. Under it the
consent sentence (`diag-error-consent`), **Send report**
(`diag-send-report`), **Clear log** (`diag-clear-log`), and a row
showing what the server actually answered (`diag-send-status`).

**On the server**: `POST /api/diagnostics/error-report`
(`routes/diagnostics.routes.ts`) — authenticated, 5 per hour per user
keyed on the user id, 50 entries / 96 KiB, each entry rebuilt from the
known fields only. The bundle is stored with the reporter's role and the
app build the entries carry
(migration `20260811000000_blackbox_error_report`).

**For the team**: `GET /api/admin/error-reports` (who, when, build,
entry count — nickname, never a phone) and
`GET /api/admin/error-reports/:id/export.json` (the whole bundle, as an
attachment), rendered at `/admin/error-reports` and linked from the
admin dashboard. Read and forward; no alerting, no grouping, no
dashboards.

## 5. After the ledger — the same five triggers

Re-measured on the same live local stack with the same instrument
(`packages/e2e/blackbox-probe.mjs --label after`, raw output in
`docs/error-ledger-probe-after.json`), using the same temporary
`?g1crash=` patch for A and B, reverted afterwards.

| # | Trigger | What the user sees | Entries added | What is now remembered |
|---|---------|--------------------|---------------|------------------------|
| A | Render error inside a routed screen | **Unchanged** — `screen-error-fallback`, Go home + Retry, shell alive | **1** | `screen-render` · `/diagnostics` · build `39898b9` · `G1 probe: screen render crash` + stack |
| B | Render error outside any screen boundary | **Unchanged** — "Something went wrong" + Retry, `root.children == 1` | **1** | `render` · `/diagnostics` · build `39898b9` · `G1 probe: root render crash` + stack |
| C | Unhandled promise rejection | Unchanged — still nothing on screen, which is right: a lost promise is not the user's problem to solve | **1** | `unhandled-rejection` · `/diagnostics` · `G1 probe: lost promise` + stack |
| D | `window.onerror`-class throw | Unchanged — nothing on screen | **1** | `window-error` · `/diagnostics` · `Uncaught Error: G1 probe: window error` + stack |
| E | Failed API call (5xx) | Unchanged — `diag-server-build` reads `—` | **1** | `api-server` · status `500` · `GET /api/health` · `/diagnostics` |

Exactly one entry per trigger, and the probe's recovery-UI fields
(`screenFallback`, `screenRetry`, `screenHome`, `rootBoundary`,
`rootChildren`, `pathname`, `serverBuildRow`) are byte-identical between
the before-run and the after-run in all five cases. The recorder
observes; it does not alter recovery.

### What the after-run caught that the unit tests could not

The first after-run recorded **three** entries for A and for B, not one.
A development React build re-throws every error a boundary catches
through a synthetic event so DevTools can see it, which fires
`window.onerror` first — twice, because React re-renders once before
giving up. A real Chromium hands that handler
`"Uncaught Error: the widget was undefined"` where jsdom hands it
`"the widget was undefined"`, so the boundary's supersede check matched
in the unit tests and missed in the browser. `sameThrow()` now strips
the browser's `Uncaught …:` prefix (and tolerates the two different
truncation offsets it causes), with the real-browser message shape
pinned in the test suite.

## 6. The walk, end to end

`packages/e2e/tests/error-ledger-report.spec.ts` — two phones, real UI:

```
✓  1 [chromium] › tests/error-ledger-report.spec.ts:44:1 ›
   a thrown error becomes a line the team can forward (5.2s)
1 passed
```

The steps it asserts, in order:

1. A passenger's app throws from a timer, outside React — the class §1
   measured as producing nothing at all.
2. `diag-error-count` reads `1`, and the log entry shows the thrown
   message, `window-error` and `/diagnostics`.
3. With the full log on screen and the consent sentence visible, a
   two-second watch on every outbound request records **no** call to
   `/api/diagnostics/error-report`, and `diag-send-status` reads `—`.
4. The passenger taps **Send report**. Exactly one `POST` goes out and
   the status row reads `201`.
5. An admin opens `/admin` → **Error reports**, sees the row
   (`TestCustomer`, `CUSTOMER`), taps **Export JSON**, and the thrown
   error's own message is in the export — and in the database row.

### The rest of the e2e suite

Five specs — `bid-reopen-flow`, `escrow-adoption-flow`, the second
`landmark-ride` case, `match-close-loop`, `payment-card-flow` — fail on
the local stack used for these measurements. They fail **identically on
`main` at `39898b9`** with the same stack and the same environment
(verified by checking out `main`, restarting both dev servers and
re-running the same five), so they are a property of this machine's
local environment, not of the ledger. Every other spec, including the
new one above, passes.
