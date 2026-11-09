# The serialization boundary

*CUTGUARD v2 G1/G3. Written because four defects — one of them a blocker
that silently destroyed emergency contacts — were the same defect, and
fixing the four would not have closed it.*

---

## The principle, in one line

**A field reaches a client because somebody wrote it down. Never because
nobody removed it.**

---

## What went wrong

`getMe` built the `/me` payload by SUBTRACTION:

```ts
const { phoneEncrypted, emergencyContactsEncrypted, ...rest } = user;
return { ...rest, phone: …, emergencyContacts: … };
```

That is a **negative list**. It names two columns to drop and ships
whatever remains. Three things follow, and all three were live on the
pilot:

1. **Every column added to `model User` since joined the payload the day
   it was declared.** Nobody decided to ship `moneyPinHash`; nobody
   decided not to. It is `hmacOtp(pin)` with no per-user salt, over a
   four-digit space — so the product's own API became a reverse-table
   oracle for the number standing between a borrowed phone and a motari's
   money.

2. **`verifyOtp` never got even the negative list.** It returned the raw
   Prisma row, so the login `user` had no `phone`, no
   `emergencyContacts`, and no `driverProfile`. Both editing screens seed
   their state once from that object and save by whole-array replace, so
   a rider who added one contact after login PUT `[theNewOne]` over her
   real numbers. Her SOS fan-out went quiet and nothing told her. The
   same mechanism blanked a motari's plate.

3. **The data export contradicted its own legal notice.** The notice
   promises fraud-prevention records are withheld; `isFlagged`,
   `flagReason` and `disputeRate` shipped inline, because the export
   builds its profile block from `getMe`.

The commission had the same shape one layer up. `toCustomerSafeCommission`
existed and was correct — and was called at exactly one site. It was not
a boundary; it was a function most customer paths happened to call. The
accept path did not, and handed the passenger the motari's full
settlement.

---

## The boundary

### `services/client-user.ts` — one door for a user row

`toClientUser(user)` is an explicit **positive allowlist**. A column
added to the model tomorrow is absent from every client payload until
somebody adds it to `CLIENT_USER_KEYS` on purpose — a diff a reviewer can
see, unlike the silence that shipped the PIN hash.

Its parameter type demands `driverProfile` be loaded, so "forgot to
include the relation" is a compile error at the call site, which is the
only place that can fix it.

Everything that puts a user on the wire goes through it: `verifyOtp`,
`getMe`, `updateMe`, and the data export. The export uses the **same
list**, not a superset — every candidate for a superset is either a
credential (never exportable at any width) or exactly the
fraud-prevention record the notice promises is withheld. There is no
third category.

### `services/commission-view.ts` — one door for money

`CustomerSafeCommission` is **nominal**, not structural: it carries a
`unique symbol` brand only that module can mint. A customer-scoped
payload declares that type, and an inline object literal cannot be
assigned to it — `driverPayout` on a customer response is a compile
error, not a review finding.

Three things fail `tsc`, all red-proofed:

- an inline literal carrying `driverPayout` in a customer slot;
- a hand-written literal of even the *correct* four;
- forwarding a `FullCommissionBreakdown` into a customer slot.

Both audiences go through a projector — `toCustomerSafeCommission` and
`toFullCommissionBreakdown` — so the three sites that wrote the ladder
out by hand now build one shape in one place.

---

## The guard

`scripts/serialization-guard` — `pnpm serialize:check`, `pnpm
serialize:map`, `pnpm serialize:test`. Five rules:

| Rule | What it refuses |
|---|---|
| **S1** | A raw Prisma row reaching `res.json` / `res.send` in a routes file — as the body, in a `...spread`, or as a property value. |
| **S2** | An exported service function returning a raw `prisma.user.*` row. This is B-1's exact shape, and the one S1 cannot see. |
| **S3** | A `commissionBreakdown` written as an object literal — as a property *or* as a named local — instead of produced by a projector. |
| **S4** | A commission built by a *customer* projector, attached with no `customerSavingsPreview` gate around it. |
| **S5** | A route calling a version-gated service function without passing the option. |

**Why S4 needs S3, and S5 needs neither.** S3 forces every breakdown
through a projector, so by the time S4 looks there is no hand-rolled shape
left to guess about — the projector's NAME says which audience the value
is for, and S4 asks for a gate only on the customer ones. S5 is a
different question again: from inside a correctly-gated service, a caller
who *forgot* the option looks exactly like a caller who *meant* `false`.
Only the route can tell those apart, so only a rule that reads routes can
catch it.

S5's gated set is **derived**, not listed: every exported service function
whose parameters mention the option. A sixth gated function is covered the
day it is written, with no second place to keep in step.

The two of them together are what makes the version gate a class rather
than five instances. The story is in `docs/rollout-window.md`; the short
version is that S4 was written after gating three surfaces, immediately
found a fourth and fifth its author had reasoned were safe, and S5 was
written after S4 and immediately found a route that had quietly stopped
serving current clients.

A row is safe three ways, all of them positive acts: a `select:` at the
Prisma call (an explicit projection — `include:` is **not**, it widens);
passing through a serializer named in `allowlist.json`; or a site entry
with a stated reason.

**Why S2 is scoped to one model.** Every model has columns; only some
have credentials. Widening S2 to all models would flag hundreds of
internal service returns that never touch a wire, and a guard nobody can
keep green is a guard somebody deletes. If another model grows a
credential column, add it to `S2_MODELS`.

**Why S3's allowlist is empty, and should stay empty.** An S3 exemption
means a money shape is being hand-written again. Its own test asserts the
shipped list has no entries.

**Why S4's is empty too, and what an entry would have to say.** An S4
exemption is a claim about every APK that has ever been installed: that no
client of any generation can crash on this attach. The one time this
dispatch tried to write one — for the accept path, on the ground that v13
reads its confirm-dialog breakdown off the bid ROW — putting the claim in
writing is what showed it was false. v13 puts the accept body straight
into the journey store, and `MatchedPage` renders it whenever the refetch
that would have overwritten it fails.

**Why S5's is NOT empty, and why that is fine.** An S5 exemption is a much
smaller claim: that this handler's own response never carries the object.
All three entries are participation checks — read `customerId` /
`driverId`, decide a 403, answer with something else — and a reviewer can
check each by reading twenty lines.

### What the guard can and cannot see

Stated because a guard that oversells itself is worse than none.

**It sees:** data flow within one function body; a row crossing a module
boundary where S2 looks; a commission literal anywhere in the walked
tree, named or inline.

**It does not see:**

- a row handed to a local helper and spread there;
- a row returned from a non-exported helper, or from a service on any
  model other than `user`;
- `res.json(await someService.thing())` — the walker does not know what
  `thing` returns. S2 is the answer for the model it covers and nothing
  covers the rest;
- a commission literal built into a differently-named local and then
  assigned. The **type** catches that one;
- **(S4)** a SECOND commission attach inside a function that already
  mentions the gate option. The check is lexical and function-scoped, and
  this residual is asserted in the self-test rather than left to be
  discovered. What it does catch is the case that actually happened — a
  new surface, in a new function, with nobody thinking about v13;
- **(S5)** a service function called from somewhere that is not a
  `*.routes.ts` file. Jobs and internal callers get the default, which is
  legacy, which is the answer that cannot break anybody.

Sites outside that reach are pinned by response-shape tests
(`cutguard-user-wire-responses`, `cutguard-accept-bid-customer-money`) and
by the real-Postgres harness `scripts/livewire/cutguard-wire-pins.ts`.
That is why the check is an allowlist rather than a proof — the same
reason `route-guard`'s is.

---

## Adding a field

1. Add it to `CLIENT_USER_KEYS` (and `ClientUser`, which the compiler
   requires) — or to the relevant projector.
2. The set-equality test fails until the serializer emits it. That is the
   test doing its job: widening is a decision, so it should cost a line
   in a test.
3. If a client screen reads it, add it to the compatibility contract in
   `cutguard-savings-preview-gate` so the next rollout knows.
4. If it is a money field going to a customer, decide whether a SHIPPED
   client can render it. If the answer is no, it is version-gated, and S4
   and S5 will insist on it — see `docs/rollout-window.md`.

## Adding an exemption

Don't, if a `select:` will do. If it genuinely will not, the entry needs
a reason that says **why this row may travel raw** — not merely that it
currently does. The shipped entries fall into two categories worth
copying: an *admin investigative surface* whose every column is the
finding, and an *echo of a row the same operator was already shown in
full*.
