# PARCEL-PARITY G1 — terrain survey

Evidence only. Nothing in this dispatch's later groups may contradict a
row below without saying so.

Taken at `main` = `de63a3d` ("OUTBOX: booking that survives a dead zone,
a boot that remembers you", #167), on branch
`claude/parcel-parity-map-emergency-chat-kdg1m1`.

Baseline gates at that commit, re-run here before any edit:

| Gate | Result |
| --- | --- |
| `pnpm wiring:check` | OK — 60 allowlisted findings, 0 warnings |
| `pnpm wiring:map` | 162 endpoints, 140 calls, 46 routes, 116 nav edges, 60 orphans, 0 unreachable |
| `pnpm i18n:review:check` | OK — 1237 en / 1237 fr / 1237 rw, digest `7480591b4e403473` |
| client unit (`vitest run`) | 177 files, 1206 tests, all green |

One §0 fact needs correcting and one needs qualifying; both are below
(§1 note, §4 note). Neither is a STOP.

---

## 1. GoodsPickupPage — what is there, and where the three things go

`packages/client/src/pages/driver/GoodsPickupPage.tsx`, 376 lines, routed
at `/driver/goods/:id` (`App.tsx:365`, inside `ProtectedRoute` →
`DriverRoute` → `AppShell`).

**Correction to §0.** §0 records the file as having "zero matches for
any map component, zero for EmergencySOS, zero for chat". That
reproduces exactly. But §0 also implies this screen is "the driver's
active screen for the whole parcel flow". It is not — it is the second
half of it. `ActiveJourneyBanner.tsx:150-181` routes the motari by
status, and only `IN_PROGRESS` lands here:

| role | type | status | screen |
| --- | --- | --- | --- |
| driver | any | `MATCHED` | `/driver/approach/:id` — ApproachPage |
| driver | `PASSENGER` | `IN_PROGRESS` | `/driver/ride/:id` — ActiveRidePage |
| driver | parcel types | `IN_PROGRESS` | `/driver/goods/:id` — **GoodsPickupPage** |

So a motari carrying a parcel already gets the map, the red button and
the chat line while he rides to the pickup — ApproachPage is shared by
both journey types and has all three. He loses all three the moment the
journey goes `IN_PROGRESS`, which is precisely the leg where he is
carrying somebody's goods across Kigali. The mission is unchanged; the
gap is narrower and sharper than §0 states.

### 1.1 The stage machine

`PickupStep` (`:11`), local `useState`, never persisted, never derived
from the server:

| step | how it is reached | where the motari is |
| --- | --- | --- |
| `pickup_photo` | initial state on every mount | at (or riding to) the pickup, photographing the parcel |
| `confirm_goods` | after `POST /api/journeys/:id/upload/pickup-photo` succeeds (`:102`) | at the pickup, checking the parcel against the description |
| `delivery_photo` | `handleConfirmGoods` (`:110-112`), no network call | riding to, or arrived at, the drop-off |
| `done` | after `POST /api/journeys/:id/upload/delivery-photo` succeeds (`:124`) | finished; the only action is "back to dashboard" |

Because the step is local state, a reload during a delivery returns the
motari to `pickup_photo`. Out of scope here, named for the record.

### 1.2 Coordinates — they are on the journey, nothing new is needed

`schema.prisma:487-501`: a goods journey is an ordinary `Journey` row.
Same six columns a passenger ride uses:

```
pickupLat  Float      destinationLat  Float
pickupLng  Float      destinationLng  Float
pickupName String     destinationName String
```

`GoodsRequestPage.tsx:260-265` posts exactly those on create, so a
parcel journey is single-leg: no `JourneyLeg` rows, no `GOODS_DROPOFF`
leg to read. `GET /api/journeys/:id` (the page's own loader, `:36`)
already returns them — the same response ApproachPage reads
`pickupLat`/`pickupLng` out of at `:94-99` and ActiveRidePage reads
`destinationLat`/`destinationLng` out of at `:108-113`.

**No server data is missing. §4's coordinate STOP does not fire.**

Stage → map target, per §2 G2 ("pickup point before `confirm_goods`,
drop-off after"):

| step | target | `targetKind` |
| --- | --- | --- |
| `pickup_photo` | pickup | `pickup` |
| `confirm_goods` | pickup | `pickup` |
| `delivery_photo` | destination | `destination` |
| `done` | none — no map | — |

`confirm_goods` sits on the pickup side: the motari is standing at the
pickup with the parcel in his hands and has not started the delivery
leg; `handleConfirmGoods` is the event that crosses the boundary.

### 1.3 Where the three bands sit in the existing layout

The page is `min-h-screen … px-4 py-6` (`:141`) with a single
`max-w-sm mx-auto` column (`:142`) holding a step indicator and one
step panel. ApproachPage by contrast is a full-bleed `flex flex-col`
column whose map is edge-to-edge.

- **Map** — above the `max-w-sm` column, full-bleed like ApproachPage's,
  so the page's own horizontal padding does not box it in. Same
  `DriverNavMap` default `h-56` band.
- **Chat entry** — in the step panel's action area, next to the primary
  button, the way ApproachPage's sticky action bar carries it
  (`ApproachPage:332-334`).
- **SOS** — no layout decision: `EmergencyButton` is
  `fixed bottom-24 right-4 z-50`, so mounting `<EmergencySOS>` anywhere
  in the tree puts it in the identical place it occupies on every other
  screen.

---

## 2. Emergency on a goods journey

### 2.1 The guard covers it — verified, not assumed

`packages/server/src/routes/journey.routes.ts:951-961`:

```ts
const journey = await journeyService.getJourneyById(req.params.id, req.user!.userId);
const callerIsCustomer = journey.customerId === callerId;
const callerIsDriver   = !!journey.driverId && journey.driverId === callerId;
if (!callerIsCustomer && !callerIsDriver) { 403 }
```

There is no `journey.type` test anywhere in the handler (`:951-1216`).
The gate is participation and nothing else. A goods journey at
`IN_PROGRESS` has a `customerId` and a matched `driverId`, so its motari
passes as a participant exactly as a passenger ride's does.

Payload assembly is likewise type-blind: the rider read (`:973-987`),
the driver read (`:995-1021`), the caller's-own-contacts choice
(`:1027`), the driver's last-known GPS fallback (`:1031-1032`), the SMS
storm guard keyed on `(journeyId, EMERGENCY_ALERT, callerId)`
(`:1043-1055`) and the `SyncEvent` record (`:1064-1082`) all read
columns every journey has.

**No server gap. §4's participant-guard STOP does not fire.** The client
mount is the whole of the driver-side work.

### 2.2 Wording gaps — named, and what can be fixed here

Four places say "ride"/"passenger" about what may be a parcel run.

| # | Where | Text | Fixable in this dispatch? |
| --- | --- | --- | --- |
| W1 | `GoodsPickupPage` — the new SOS mount | none yet; `emergency.label` = "Emergency", `emergency.callEmergencyNumber` = "Call 112", `emergency.notifying/notified/notifyFailed` all name Bimoto, not a ride | **No gap.** `EmergencySOS`'s own copy is journey-neutral end to end. Nothing to add. |
| W2 | `emergency.alertReceived` = "Emergency alert on this ride" | passenger-ride wording | Not on this screen — it is the in-journey socket notice. Left alone; §3 keeps ride screens untouched. |
| W3 | admin banner: `emergency.adminBannerTitle` = "Emergency — passenger needs help", `adminRiderPhone` = "Passenger phone" | On a parcel run the customer is a **sender**, not a passenger. An admin reading a goods emergency is told the wrong noun. | **No.** The banner renders from `EmergencyAlertEvent`, which carries no journey type (`emitToAdmins`, `:1109-1123`). Telling it apart needs a new field on the admin payload — a **shape change**, which §3's "emergency endpoint unchanged" forbids. Named as a seam; see §5. |
| W4 | server SMS: `contactSmsBody` (`:1164-1172`) — "pressed the emergency button **during a ride** / … **mu rugendo**" | Same noun problem, to the caller's own family. | **No.** Same reason as W3 in reverse: `journey.type` *is* in scope at that line, so a two-branch string is technically trivial, but it is a server behaviour change inside the endpoint §3 pins as unchanged, and it is not an i18n key (these bodies are hardcoded bilingual literals, deliberately). Named as a seam; see §5. |

No test asserts the W3 or W4 strings, so neither is protected by a
green test — the constraint is the §3 invariant, not test coverage.

**Net for G3.1: there is no goods-specific wording gap on the motari's
own screen.** The gaps are on ops-facing surfaces and both need either a
payload field or a server-string change that §3 rules out. G3 therefore
adds no emergency i18n keys.

---

## 3. Chat on a goods journey

### 3.1 The room exists and is type-blind

`ChatPage` is routed at `/journey/:id/chat`. Messages come from
`GET`/`POST /api/journeys/:id/messages` and the socket joins a room
keyed by journey id. Nothing in that path reads `journey.type`.

### 3.2 Both sides — who already has an entry

| side | screen for a goods journey | `ChatEntryButton`? | `EmergencySOS`? |
| --- | --- | --- | --- |
| customer | `MATCHED` → `/journey/:id/matched` — MatchedPage | yes, `:502` | yes, `:587` |
| customer | `IN_PROGRESS` → `/journey/:id/progress` — InProgressPage | yes, `:138` | yes, `:145` |
| driver | `MATCHED` → ApproachPage | yes, `:333` | yes, `:378` |
| driver | `IN_PROGRESS`, passenger → ActiveRidePage | yes | yes |
| driver | `IN_PROGRESS`, parcel → **GoodsPickupPage** | **no** | **no** |

**The customer side is already symmetric.** MatchedPage and
InProgressPage are shared by both journey types — neither branches on
`type` at all (zero `goods` matches in MatchedPage). A parcel sender can
already reach the chat and the red button from both of their screens.
G3.2's "add the same entry component there if G1 found it missing" is a
no-op: nothing is missing on the customer side.

Missing on exactly one screen: the motari's, at `IN_PROGRESS`, carrying
a parcel. That is the whole of the chat work.

---

## 4. The chrome band — every in-flow element, and the four states

`AppShell.tsx:39-48` — one `relative z-10` wrapper holding five children,
all in normal flow, so each one's presence pushes `<main>` down by its
own height.

**Qualification of §0.** §0 states the band measures 73 → 113 px at the
offline transition. jsdom has no layout engine and this sandbox cannot
be trusted for browser measurement (§0, §5), so the numbers below are
derived from the static Tailwind utilities on each element — every one
of them is a literal class, so the derivation is exact for a viewport
with no safe-area inset. The derivation gives 73 → **109** px, a 36 px
excursion rather than 40. The *direction and mechanism* §0 describes
reproduce exactly; the last 4 px do not, and the work does not depend on
which figure is right. Not a STOP.

Tailwind defaults in play: `text-xs` = 12/16, `text-sm` = 14/20,
`py-1` = 4, `py-2` = 8, `h-12` = 48, `border-b` = 1.
`tailwind.config.js` extends the scale with named steps and does not
override `xs`/`sm`.

| element | classes | height | in flow? |
| --- | --- | --- | --- |
| `AppHeader` | `h-12` + `border-b` + `pt-[env(safe-area-inset-top)]` | **49** + inset | permanent |
| `SyncIndicator` | `py-1 … text-xs` | **24** | conditional |
| `ConnectionBanner` offline / back-online | `py-2 … text-sm` | **36** | conditional |
| `ConnectionBanner` unreachable | `py-2` + `min-h-[32px]` button | **48** | conditional |
| `RejectedEventsBanner` | `py-2 text-sm min-h-[44px]` + `border-b` | **45** | conditional |
| `OutboxBanner` pending | `py-2 text-sm min-h-[44px]` + `border-b` | **45** | conditional |
| `OutboxBanner` sent | `py-2` + `min-h-[44px]` buttons + `border-b` | **61** | conditional |

Negative grep confirmed at HEAD: no `fixed`, `absolute` or `sticky` in
`ConnectionBanner.tsx`, `SyncIndicator.tsx`, `RejectedEventsBanner.tsx`
or `OutboxBanner.tsx`. Every one of them displaces content.

### The four states G4 must make identical

| # | state | strips rendered | band total | `<main>` top |
| --- | --- | --- | --- | --- |
| 1 | **online**, idle | Sync 24 (`sync.connected`) | 49 + 24 = **73** | 73 |
| 2 | **offline** | Sync 24 (`sync.offline`) + Banner 36 | 49 + 60 = **109** | 109 |
| 3 | **rejected events** (online) | Sync 24 + Rejected 45 | 49 + 69 = **118** | 118 |
| 4 | **outbox pending** (online) | Sync 24 + Outbox 45 | 49 + 69 = **118** | 118 |

Worst case observed in the derivation — offline, with a rejected event
and a held booking both present: 49 + 24 + 36 + 45 + 45 = **199 px**, a
**126 px** excursion from the idle 73. Two further transitions worth
naming because they move content *upward*, which reads as a jump just as
badly:

- online → **unreachable**: `SyncIndicator` returns `null` (`:41`) and
  the banner grows to 48 → band 97. Content moves **up** 12 px relative
  to offline, down 24 from idle.
- the **back-online flash**: 2.5 s of a 36 px green strip
  (`BACK_ONLINE_FLASH_MS`), then it leaves. Every screen shifts down
  36 px and back up again, unprompted, on every recovery.

This is what "the field's first trial complained about jumping screens"
means concretely. The overlay must reproduce every one of those seven
appearances as *floating* content over an unchanged `<main>` box.

### z-order the overlay must fit into

| layer | z | note |
| --- | --- | --- |
| `MapCanvas` | `z-0` | full-bleed, `fixed inset-x-0 top-0 bottom-16` |
| **shell band** | **`z-10`** | where the overlay goes |
| `LocationPickerMap` overlay | `z-20` | already paints over the band on the three picker screens (AppShell's own note) — unchanged by this work |
| bottom sheet | `z-30` | |
| `BottomNav` | `z-40` | |
| `EmergencyButton` (SOS) | `z-50` | `fixed bottom-24 right-4` — **bottom** right, so a top band cannot overlap it geometrically, and it outranks the band anyway |
| `Toast` | `z-[60]` | `fixed top-4` — overlaps the band's area and must stay on top |
| `AdminEmergencyAlerts` | `z-[100]` | admin island only |

Keeping the overlay at the band's existing `z-10` preserves all eight
relationships unchanged. Toasts stay above it; the SOS stays reachable.

### Safe area

`AppHeader` owns `pt-[env(safe-area-inset-top)]` (its own header note
calls this symmetric to `BottomNav`'s bottom inset). Anchoring the
overlay to the **bottom edge of the header** rather than to the viewport
inherits that inset for free and needs no magic number and no second
`env()` call — which is also what keeps `AppHeader.test.tsx`'s
"header owns the top safe area" assertion true unmodified.

**§4's accessibility / safe-area STOP does not fire.**

---

## 5. Seams named, not touched

1. **W3** — the admin emergency banner calls a parcel sender a
   "passenger". Fixing it needs `type` on the `EmergencyAlertEvent`
   payload; §3 forbids the shape change.
2. **W4** — the emergency contact SMS says "during a ride / mu rugendo"
   for a parcel run, to the caller's own family. `journey.type` is in
   scope at the call site; the change is one branch. §3 forbids it here.
3. **`emergency.alertReceived`** = "Emergency alert on this ride" — same
   noun, on the in-journey socket notice.
4. `PickupStep` is local state: reloading mid-delivery returns the
   motari to step 1.
5. `pnpm wiring:map` reports UNRESOLVED as **0 / 0 / 5** (endpoints /
   calls / **nav**). §0 says "0 UNRESOLVED". The endpoint and call
   columns are 0 as §0 implies; five *nav* edges have always been
   unresolved and `wiring:check` is green over them. Recorded so the G5
   comparison is against the true baseline.

---

## 6. G5 — what was built, and what it cost

### Gates, at `fe2798c`

| Gate | Baseline (`de63a3d`) | After | |
| --- | --- | --- | --- |
| client unit | 177 files / 1206 tests | **179 / 1224** | +2 files, +18 tests |
| server unit | — | **268 suites / 2340 tests**, 1 skipped | green |
| `wiring:check` | OK, 60 allowlisted, 0 warnings | **identical** | |
| `wiring:map` | 162 / 140 / 46 / 116, 60 orphans, 0 unreachable | **identical** | |
| `wiring:test` | — | 20 pass / 0 fail | |
| `i18n:review:check` | OK, 1237 × 3, digest `7480591b4e403473` | **identical digest** | no new keys |
| `i18n:review:test` | — | 27 pass / 0 fail | |
| `tsc --noEmit` (client) | clean | clean | |
| e2e | — | **judged by CI** (§0/§5: no PostGIS here) | |

Wiring nav-edge **delta**: the count is unchanged at 116, but the
reachability attribution grew — `/journey/:id/chat` gains
`screen:/driver/goods/:id` as a source. The count did not move because
`ChatEntryButton` owns the `navigate()`, so the edge already existed;
what changed is which screen can reach it.

### The occlusion cost of the overlay — named, because it is a choice

The overlay is the founder-approved direction and §4's STOP does not
fire: G1's heights predicted every one of these appearances. But the
consequence is worth stating plainly, because one of the seven is not
transient.

`SyncIndicator` renders in three of its four states, and its steady
state is `sync.connected` — a 24 px green strip that is up whenever the
app is online and not syncing, which is most of the time. In flow it
reserved 24 px; floating, it **covers** the top 24 px of `<main>` on
every screen, permanently. On most screens that lands on the page's own
top padding (`GoodsPickupPage` opens with `py-6`), on a few it clips the
top of a coloured page header.

The alternative, if that trade reads wrong in the field:

- **A — shipped.** All four strips float. Zero shift in all seven
  appearances. Cost: 24 px of every screen permanently under a
  "Connected" strip.
- **B — one line different.** `SyncIndicator` keeps a reserved 24 px
  slot in flow (it already occupies one in three of four states; the
  slot would simply stay empty in `unreachable` instead of collapsing),
  and only the three genuinely transient banners float. Zero shift in
  the same seven appearances, because the reserved slot is constant.
  Cost: none over today's steady state — occlusion happens only when
  something is actually wrong.

B is strictly gentler and equally stable. A is what §2 G4.1 asks for
("banners float above content, never displace it") and is what shipped.
Switching to B is a change to `SyncIndicator`'s null branch plus one
wrapper class; the stability test in `ShellBandStability.test.tsx` would
need its expected in-flow shape updated and nothing else.

> **SUPERSEDED by CHROME-C.** The founder chose neither A nor B but
> **Option C**: status moves into the header, events become toasts plus
> a badge, and nothing covers content unless the user asked for it. §7
> below is the relocation map for that. A/B is kept as history because
> it records why the overlay was not the end of the road.

---

## 7. CHROME-C G1 — the relocation map

Every piece of information and every action the four strips carry
today, and where it goes. The rule: relocated, never lost.

Verified on branch head `5ae3db6`. All §0 facts reproduce:
`AppShell.tsx:89` mounts the overlay container holding the four strips;
`SyncIndicator.tsx:41` returns `null` in `unreachable`;
`ConnectionBanner`'s unreachable face carries **Try now**;
`OutboxBanner`'s sent face carries **View the ride**;
`AppHeader` is `h-12` + `pt-[env(safe-area-inset-top)]` with
`BackControl` at the start and the mark `ml-auto` at the end;
`Toast` is a single mount at `z-[60] fixed top-4`.

### 7.1 State by state

| Today | Header word + treatment | Toast | Badge | Detail sheet |
| --- | --- | --- | --- | --- |
| `SyncIndicator` "Connected" (green strip) | **Connected** — tint pill `#EAF3DE`, dot `#639922`, text `#27500A` | — | — | connection section |
| `SyncIndicator` "Syncing…" (blue pulse) | **Syncing** — same tint pill, spinner replaces the dot | — | — | connection section |
| `ConnectionBanner` back-online flash (2.5 s green) | **Back online** — same tint pill, word swaps; **no wash, no motion** | — | — | connection section |
| `SyncIndicator` "Offline — changes will sync…" (orange strip) | **Offline** — solid chip `#C9821E`, white text | — | — | connection section |
| `ConnectionBanner` offline face (orange, 36 px) | *merged into the row above* — one claim, one place | — | — | full sentence lives here |
| `ConnectionBanner` unreachable (blue, 48 px, **Try now** + countdown) | **No server** — solid chip `#A32D2D` + **whole-header wash** (`#FCEBEB` bg, `#F7C1C1` border, `#791F1F` text) | — | — | **Try now** + live countdown |
| `SyncIndicator` renders `null` while unreachable (`:41`) | *gone* — the header always states one truth, so the "two voices" rule that produced that `null` no longer applies | — | — | — |
| `RejectedEventsBanner` strip (45 px, count) | — | on arrival: rejection toast | **+1 per rejected item** | rejected list, per-item **Retry** / **Discard** (sync events) and **Discard** (bookings), with the server's own reason |
| `OutboxBanner` pending (45 px, count, tap→modal) | — | on save: "Saved on this phone" | **+1 per held booking** | pending list + per-item **Cancel** |
| `OutboxBanner` sent (61 px, **View the ride**) | — | on send: sent toast | **+1 while unviewed** | the offer + **View the ride** |
| **all at once** | one chip (severity wins: No server > Offline > Connected) | toasts queue as today | sum of the above | all sections stacked |

### 7.2 Three decisions that depart from §2's letter

**(a) The detail surface is `Modal`, not `BottomSheet`.** §2 G2 names
BottomSheet. But the content being relocated *already lives in a
`Modal`* in both banners — `RejectedEventsBanner:100` and
`OutboxBanner`'s pending modal — so "reuse the content rather than
rewrite it" points at Modal, and §7's "existing patterns only" is
satisfied either way. BottomSheet is also the wrong shape here: it is
`fixed inset-x-0 bottom-16 z-30 h-[calc(100dvh-9rem)]` with drag
handles and two snap states, built to sit over a full-bleed map on the
four picker screens, and it has no dismissed state — it is always
either collapsed or expanded. A status detail surface has to open from
nothing on *every* screen and close back to nothing. `Modal` is
`fixed inset-0 z-50` with a backdrop and an explicit close, already
used for exactly this content. Named here rather than silently chosen.

**(b) The event toasts carry no action button — the actions move to the
sheet.** §2 G3 asks for a toast with **View the ride** and a rejection
toast with **View**. The existing toast cannot do it: `ui.store`'s API
is `showToast(message, type)` with no action parameter, and
`Toast.tsx` renders a message plus a close button on a fixed 3000 ms
timer. Giving it an action means changing the toast system — which §2
G3 forbids ("no new toast machinery") and §3 names as an invariant
("Toast system unmodified"). So the toast announces and leaves, and
every action it would have carried is reachable through the badge and
the sheet, which is what §2 G1's own rule requires ("relocated, never
lost"). Concretely, **View the ride** lives in the sheet's offer
section for as long as `lastSent` is set, and the badge counts it, so
the offer cannot be missed by someone who looked away for four
seconds — which is strictly better than a 3 s toast was.

**(c) One line moves in `LocationPickerMap`.** Its overlay is
`fixed inset-x-0 top-3 z-20` (`:207`) and its mode chips (y 12-56,
x 115-277 on a 393 px viewport) paint over the header band (y 0-49) on
the four picker screens. `AppShell`'s own note has recorded this as
KNOWN, MEASURED since APP-HEADER G1 and called a top offset "the tidy
fix", out of scope at the time. It is in scope now: the header is where
status lives, and a mission whose first sentence is "nothing covers
anything" cannot ship with map chips covering the status word. The
overlay moves to `top-[calc(env(safe-area-inset-top)+3.5rem)]` — 56 px,
clearing the 49 px header plus its inset. `LocationPickerMap` is not on
§0's untouchable list.

### 7.3 Header geometry

`[BackControl] [status pill] ——— [mark]`. BackControl occupies x 4-96
and renders nothing on the two home paths (`HOME_PATHS`), so the pill
sits at the start of the free span in both variants. Tap target is the
whole pill at `min-h-[44px]`.

The status words in the three locales, measured from the locale files:

| key | en | rw | fr |
| --- | --- | --- | --- |
| `sync.connected` (reused) | Connected (9) | Ndi ku murongo (14) | Connecté (8) |
| `sync.syncing` (reused) | Syncing... (10) | Guhuza... (9) | Synchronisation... (18) |
| `connection.backOnline` (reused) | Back online (11) | Wongeye kuba ku murongo (23) | De nouveau en ligne (19) |
| `status.offline` (**new**) | Offline | — | — |
| `status.noServer` (**new**) | No server | — | — |

`sync.offline` (42/68/69 chars) and `connection.offline`/`unreachable`
(50/63/55 and 30/55/50) are full sentences built for a strip and cannot
go in a header pill; they keep their job inside the sheet, where the
long form is the right form. Only the two genuinely missing short words
are new keys. **Long-word fallback is in use**: the word is
`truncate max-w-[8.5rem]`, which is loose for en/fr and clips only
rw's 23-character back-online flash; the full state is always on the
pill's `aria-label`, and the sheet is one tap away.

### 7.4 What §3 has to hold

Every action in the "today" column above is asserted reachable in
`ShellBandStability.test.tsx`'s reshaped form: **Try now**,
**View the ride**, per-item **Retry**, **Discard**, **Cancel**.
