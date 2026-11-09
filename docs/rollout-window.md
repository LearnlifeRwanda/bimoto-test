# The rollout window

*CUTGUARD v2 G6. What the server does while two generations of the app
are in the field at once, and the lever that ends a rollout.*

---

## The problem this fixes

At `abb6a26`, a grep for `X-App-Version` or `appVersion` across the whole
repository returned **nothing**. There was no version signal in either
direction.

So during a rollout the server had exactly one answer for two generations
of client — and the two generations wanted different answers:

- **B-2** — a v13 passenger **crashes** on the bid-list savings preview.
  Her `BidListPage` reads `totalCommissionAmount.toLocaleString()`, and
  MONEY-VIEW's customer-safe shape does not carry that key. The payload
  that fixed one thing broke her confirm dialog, on the screen where she
  is about to pay.
- **B-3** — a v13 motari is **428-locked** out of his earnings by a
  money-PIN enrollment prompt his build has no screen to answer. He
  cannot see his own money for the length of the rollout.

Neither is fixable by choosing a better payload. They are opposite
requirements. Telling the two clients apart is the only way to serve
both.

---

## The contract

### One source of truth for the version

`android/app/build.gradle` carries `bimotoDefaultVersionCode` — the
number the APK bakes, and the number the `android-build` workflow's smoke
step reads back **out of the assembled APK** and fails on if it does not
match. `vite.config.ts` parses that same line into `__APP_VERSION__`.

A TypeScript constant beside it would be a third place to keep in step
and the first one to go stale, so nothing declares a version. Changing
the cut means changing `build.gradle` and `CURRENT_APP_VERSION`, and the
client test asserts the two agree.

### The header

`packages/client/src/lib/api.ts` sends `X-App-Version` on every request,
at the same seam that already injects `Content-Type` and the bearer
token. It is sent unconditionally, including as `0`.

### The server side

`middleware/app-version.ts` attaches `req.appVersion` before any router.

**Absent, unparseable, negative, or `"14.1-beta"` ⇒ `0` ⇒ LEGACY.** A
caller that says nothing is treated as the oldest client, which is the
answer that cannot break anybody: it withholds new behaviour rather than
assuming a phone can render it. The parser is one regex rather than
`parseInt` on purpose — `parseInt('14.1-beta')` is `14`, which would have
a gate believing a client it should not.

> **This header is a COMPATIBILITY signal and never a security one.**
> It is client-supplied; anybody can claim any version. Every gate that
> reads it is written so that claiming to be legacy can only ever get you
> **less**, never past a check.

---

## The two gates

### B-2 — the savings preview

Every customer-facing exit that carries a commission passes
`customerSavingsPreview: isCurrentApp(req)`.

- **v14+**: the customer gets the customer-safe four.
- **legacy**: the `commissionBreakdown` key is **omitted**, not nulled —
  the shape v13 has always coped with.

The option **defaults to false**, which is what makes the socket path
safe by construction rather than by somebody remembering.

G6 gated one of those exits and this document said the class was closed.
It was not: there were five. What that took to find, and the two guard
rules that now fail the build on a sixth, is the section below.

### B-3 — the money-PIN step-up

Only the **`NOT_SET → 428` arm** is version-gated. This is the load-
bearing detail:

| Driver state | v14 | legacy / no header |
|---|---|---|
| No PIN | `428 MONEY_PIN_ENROLLMENT_REQUIRED` | **through** (da9eca0 behaviour) |
| PIN set, no session | `401 MONEY_STEP_UP_REQUIRED` | `401` — **gated at every version** |
| Locked out | `423 MONEY_PIN_LOCKED` | `423` — **gated at every version** |

Gating the step-up check or the lockout would be a bypass: a borrowed
phone could skip a PIN its owner actually set, undoing D25 with one
header. The enrollment arm cannot be abused that way, because it is only
reachable when `state === 'NOT_SET'` — claiming to be legacy can only let
you skip a PIN that does not exist.

**No v14 money surface is opened.** What changes is that a client which
cannot answer the enrollment prompt is not asked it.

---

## B-2 is a class, and all five instances are gated

**Found by the CUTGUARD v2 e2e amendment, 26 Aug 2026. Closed by
amendment 2 the same day, under founder authorisation.**

G6 gated the bid list and this document reported the class closed. It was
not. The grep that came after it found the same shape reaching a v13
client on two more customer surfaces; the guard rule written to close the
class then found two more that reading had missed.

| Surface | Server | v13 consumer | Now |
|---|---|---|---|
| Bid list | `getBidsForJourney` | `BidListPage` confirm dialog | gated (G6) |
| Journey read | `getJourneyById` | `MatchedPage`, `RideReceiptPage` | gated |
| Rides list | `getJourneys` customer arm | `HistoryPage` | gated |
| Accept (MoMo) | `acceptBid` | `MatchedPage`, via the journey store | gated |
| Accept (card) | `acceptBidForCard` | same | gated |

All five take the same option, `customerSavingsPreview`, appended last and
optional so every existing call site keeps its exact meaning. All five
default to **legacy**, and all five **omit** the key rather than nulling
it — `null` is falsy and survives v13's `&&`, but absent is the shape
those builds have always coped with, and a `null` is a place for the next
refactor to put something back.

**What did NOT change: what the projection contains.** Still the
customer-safe four, still built by the same projectors. Only *whether* it
is attached, and by version. The driver ladder is never gated — his build
has always rendered it, and the gate narrows by CLIENT, not by viewer.

#### Why the two crashing screens crash

Both guard on **presence only**. At `da9eca0` — the v13 baseline —
`MatchedPage` reads:

```
{journey?.commissionBreakdown && (
   … journey.commissionBreakdown.totalCommissionAmount.toLocaleString()
   … journey.commissionBreakdown.driverPayout.toLocaleString()
```

and `HistoryPage` reads `totalCommissionRate`, `totalCommissionAmount`,
`driverTier`, `driverCommissionRate` and `driverPayout` the same way. The
guard that tells the two shapes apart (`hasCustomerSafeCommission`) landed
in **#206**, which is *after* `da9eca0` and therefore **not in the v13
APK**.

Proven at the wire, against real Postgres, before the fix:

```
MatchedPage (journey read)
  keys: bidPrice, customerSavings, customerTier, feeWaiverApplied
  v13 dereferences totalCommissionAmount, totalCommissionRate, driverPayout
  → undefined → .toLocaleString() → TypeError.   *** CRASHED v13 ***

HistoryPage (rides list)
  keys: bidPrice, customerSavings, customerTier, feeWaiverApplied
  v13 dereferences totalCommissionRate, totalCommissionAmount, driverTier,
  driverCommissionRate, driverPayout → TypeError.  *** CRASHED v13 ***
```

and after it, both directions, in `scripts/livewire/cutguard-wire-pins.ts`.

#### The accept path — the one that was nearly attested away

The reasoning that said the accept response was safe went: v13's
`BidListPage` sources its confirm-dialog breakdown from the bid **row**
(`BidListPage.tsx:363`), not from the accept response, and the bid row is
gated. Both halves are true and the conclusion is still wrong.

The accept response does not have to be *read* to be *rendered*. v13 does
`setActiveJourney(updated)` with the accept body — `BidListPage.tsx:422`
on the MoMo path, `:508` on the card path — and navigates to
`/journey/:id/matched`. `MatchedPage` draws whatever is in that store.

It is usually masked: `MatchedPage` returns a spinner (`:272`) until its
own `GET /journeys/:id` resolves and overwrites the store. But that fetch
clears `isLoading` in a `finally`, so when it **fails** the page renders
the accept payload. A failed fetch in the seconds after a mobile-money
round trip is not an exotic state on the network these phones are on, and
the screen it white-screens is the one she lands on having just paid.

That is why the guard's exemption list is empty. The one exemption this
dispatch tried to write was this one, and writing down the claim is what
showed it was false.

#### A sixth surface fails the build

Two rules, in `scripts/serialization-guard`, each seeing what the other
cannot:

- **S4, from the service's side.** A commission attached by a *customer*
  projector must be lexically gated on `customerSavingsPreview`, or
  attested by key with a reason. It can classify by audience only because
  S3 already forces every breakdown through a projector, so the
  projector's NAME says who the value is for. Its residual is written down
  and tested: a **second** attach inside an already-gated function passes.
  What it catches is the case that actually happened — a new surface, in a
  new function, with nobody thinking about v13.
- **S5, from the route's side.** A route calling a version-gated service
  function must pass the option. S4 cannot see this: from inside a
  correctly-gated service, a caller who forgot looks exactly like a caller
  who meant `false`. The gated set is **derived** from the services — every
  exported function whose parameters mention the option — so a sixth gated
  function is covered the day it is written.

S5 found a live instance the moment it ran:
`POST /scheduled-rides/:id/conflict-acknowledge`, the passenger
re-accepting the offer she was warned about. It answers her directly and
fans out to the journey room exactly like `POST /accept-bid`, and it was
calling `acceptBid` with no option — so a v14 passenger who came through
the conflict dialog silently lost the savings line the same passenger kept
on the direct path.

Note which way that failed: **degraded, not crashed**. That is the
safe-by-default direction working. S5 exists because "safe when forgotten"
is only half of "right".

S5's three exemptions are all participation checks — `POST /:id/emergency`,
`GET /:id/emergency/active`, `POST /:id/rate` — handlers that read
`customerId` / `driverId` to decide a 403 and then answer with something
else entirely. Each was read to its closing brace before it was written
down.

#### Where the pins live

| Level | File | What it proves |
|---|---|---|
| Route wiring | `cutguard-version-gate-wiring.test.ts` | the header reaches the service as the option, on all six exits, in both directions, plus `14.1-beta` ⇒ legacy |
| Projection | `money-view-list-attach`, `money-view-escrow-scope`, `cutguard-accept-bid-customer-money` | what the four contain, and what they never contain |
| Guard | `scripts/serialization-guard/tests/check.test.ts` | both rules fail on the shape they exist for and pass on the three real gating shapes; the shipped exemption lists are empty (S4) or exactly the three participation checks (S5) |
| Wire, real Postgres | `scripts/livewire/cutguard-wire-pins.ts` | 45 pins, including all five surfaces both ways |
| Wire, e2e | `version-gate-money.spec.ts`, `journey-read-authorization.spec.ts` | the same, through the real HTTP stack against the e2e database |

Splitting wiring from projection is deliberate: a wiring bug and a
projection bug have different fixes and should not be able to hide behind
each other.

#### The socket exits, and why they differ

Three of the five also fan out over the journey room, which carries no
version header. They do not all answer the same way, and the difference is
the rule rather than an inconsistency:

| Emit | Version read from | Why |
|---|---|---|
| `POST /accept-bid` → `bid-accepted` | the **accepting customer** | for a REQUESTED journey the room is her: the winning motari's join is refused until MATCHED, and he learns on his own user room. Requester and recipient are the same phone. |
| `POST /counter/respond` → `bid-accepted` | **nobody** ⇒ legacy | the requester is the DRIVER; the recipient is the passenger, whose generation his request says nothing about. |
| bid-placed push | **nobody** ⇒ legacy | same absence, same answer (see *The socket carries the legacy shape*, above). |

---

## The force-upgrade lever

`MIN_SUPPORTED_APP_VERSION` is **0**. No client is refused today.

`upgradeRequiredResponse()` defines the `426` body — `UPGRADE_REQUIRED`,
`errors.upgradeRequired`, plus `minVersion` and `yourVersion` so a client
does not have to parse prose to answer "am I the one being refused?".
`requireSupportedApp` is written and **mounted nowhere**.

**Enforcement is deliberately off.** Prematurely bricking phones is the
opposite failure to the one this closes: a motari whose app refuses to
open cannot work, and cannot necessarily download a new APK either. The
flip is an operational decision like `COUNTER_BID_ENABLED` — a person's
call, made when there is a reason.

**To end a rollout:** raise `MIN_SUPPORTED_APP_VERSION`, mount
`requireSupportedApp`. That is the whole change, and it is written down
now precisely because when it is needed it will be needed quickly.

---

## Known costs of the window

### The socket carries the legacy shape

A socket emit has no `X-App-Version`. The bid-placed push is triggered by
the **driver's** `POST /bids`, and his version says nothing about the
passenger's phone — there is no signal about the recipient at that point
in the code.

With no signal, the only safe shape is the legacy one: a v13 passenger
receiving a preview would crash on a push she did not ask for.

**The cost:** during the window, a v14 passenger sees the savings line on
her next fetch rather than the instant the bid lands. A missing line is a
smaller failure than a white screen.

**The follow-up:** carry the app version through the socket handshake
(where the client already sends its token) and shape per recipient. Once
every client is ≥ 14 the gate simply goes.

This narrows — and only narrows — the *freshness* half of MONEY-VIEW v2
G3's no-drift invariant. Its **security** half is untouched: the socket
row is still customer-scoped and carries no column of the motari's money,
asserted in `live-wire-role-scoped-payload`.

### The compatibility contract's blind spot

`cutguard-savings-preview-gate` pins the fields a shipped client depends
on: a response may grow optional fields; it may not remove a depended-on
one, and it may not start sending a field a shipped client would choke on
— which is what B-2 was.

It pins **the payloads named there, against the dependencies written
there**. It cannot discover a client dependency nobody recorded, and it
cannot see the client's renderer. When a dependency is found the hard
way, it gets added so it is never found the hard way twice.

---

## Not closed by this dispatch: **B-5, the signing gate**

`.github/workflows/android-build.yml` runs `assembleDebug`. There is no
committed keystore, no signing secret, and no `signingConfig`. Different
runners produce different debug keystores, so **APK 14 may not install
over APK 13** — Android refuses an update signed by a different key.

This is a physical check, not a code change: install the built APK 14
over an existing APK 13 on a real handset and see whether it upgrades or
demands an uninstall. It is a ~10-minute test on Aljo's side.

**It is the one remaining pre-cut gate this dispatch does not close, and
nothing above helps with it.** A version contract cannot fix a signature
mismatch: a phone that will not accept the update never runs the code
that would have told it its version.
