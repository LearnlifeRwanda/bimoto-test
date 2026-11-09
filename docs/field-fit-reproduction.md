# FIELD-FIT — reproduction table

Every claim in the August team PDF, the tracking spreadsheet and the
11 August fold-in audit, walked on a live local stack before anything
was changed.

**Stack.** Postgres 16 (no PostGIS — the schema needs none), all 32
migrations applied, `prisma/seed.ts`, server on `:3000` with
`NODE_ENV=test` (so `request-otp` returns `testOtp`),
`PAYMENTS_MODE=simulated`, `SMS_MODE=simulated`, Vite client on
`:5173`, Chromium via Playwright. Base commit `84e2742`.

**One environment caveat, stated up front.** This sandbox has no
egress to OpenStreetMap tiles and no `LOCATIONIQ_API_KEY`, so the
background map renders its "can't load" fallback and
`/api/geocode/search` answers 503. Every walk below that needed a
pickup or destination used the offline Kigali landmark catalogue
(`KIGALI_LANDMARKS`, shipped in `@bimoto/shared` by LANDMARKS #157),
which is exactly the path that survives with no geocoder. Where that
caveat changes a verdict, it is called out in the row.

## Before-table

| # | What the team reported | Reproduced? | Where it actually lives |
|---|---|---|---|
| 1a | "Schedule a ride button is currently not working" | **No, as stated** | The walk completes: home → *Request a ride* → *Schedule* → pickup time → both points from the landmark list → *Schedule ride* → `POST /api/journeys` `201` → `/journey/<id>/scheduled`. **But** the entry is a segmented control *inside* `/journey/new`; there is no "Schedule a ride" control on the customer home at all. And with tiles **and** geocoder both down, only pickup can be set (GPS); the destination cannot, so the button stays disabled — the likeliest field shape of this report. |
| 1b | "Scheduled page can not get the data of scheduled rides" | **Yes** | `routes/scheduled-ride.routes.ts:31-39` filters `driverId: req.user.userId`. A `SCHEDULED` journey has `driverId = null` until a bid is accepted, and the bid window only opens 60 min before pickup — so the motari's list is structurally empty. Measured `count=0` with a live scheduled ride in the database. |
| 1c | schedule-confirm: "price optional but you can not confirm ride when the price is not entered" | **No** | Server returns `201` for a `SCHEDULED` create with no `wishPrice`. No submit anywhere in the customer flows is gated on a price (`grep "disabled={…[Pp]rice"` finds exactly one hit: the driver's `BidPage`, where a bid without a price is meaningless). Walked in the browser with the field left empty: journey created, `wishPrice` absent from the POST body. |
| 2 | "created an account as a driver and after some time the app changes your account to both" | **Yes** | `services/user.service.ts:124-127`. `createDriverProfile` writes `role: 'BOTH'` unconditionally, inside the same transaction as the profile insert. `RegisterPage.tsx:82-115` `PUT`s the chosen role and then `POST`s the driver profile, so choosing *Motari* is overwritten one request later. The client keeps showing `DRIVER` (it renders the `PUT` response); the next login reads `BOTH` from the database — "after some time". |
| 2b | *(not reported — found while reproducing #2)* | **Yes** | `updateMe` (`user.service.ts:75`) passes `req.body.role` straight to `prisma.user.update` with no allow-list. Any authenticated user can `PUT /api/users/me {"role":"ADMIN"}`, re-login, and reach `GET /api/admin/verifications` (`200`, driver identity documents). Verified end to end. |
| 3a | motari has "no way of adding documents (licence, id, driving permit, insurance)" | **Yes** | `/driver/verification` is navigated to from exactly one place in the whole client: `DriverScreenerPage.tsx:126,136`, a one-shot onboarding screen. Walked as a seeded unverified `DRIVER`: `/driver`, `/profile`, `/driver/account`, `/settings` — none mentions documents with a link, none links to `/driver/verification`. Separately: the page offers **licence, RURA, insurance** only — there is no national-ID upload, and the server's `validDocTypes` (`user.routes.ts:409`) has no `national-id` either. |
| 3b | "You can not login as a different user" | **No** | `performLogout` (`lib/logout.ts`) is wired to a one-tap row on Profile (`profile-logout-button`) and to Settings. Server revokes the refresh-token family and clears both cookies (`auth.routes.ts:212-218`). Confirmed the Profile row renders for a driver. |
| 3c | "NO RESEND THE Verification CODE TAP" | **No** | The login OTP step renders the resend control with a live countdown ("Kohereza indi mu masegonda 57"), behind a 60 s client cooldown over the server's 3-per-10-min budget. It is the only verification-code screen in the app — `RegisterPage` has no code step, and `PickupVerifyCard` is a yes/no prompt, not a code entry. |
| 3d | booking outside Kigali "gets an error" | **Yes** | Verbatim, from a Musanze pickup: `{"error":{"code":"VALIDATION_ERROR","message":"errors.validation","details":[{"code":"too_big","maximum":-1.85,…,"message":"Number must be less than or equal to -1.85","path":["pickupLat"]},…]}}`. The gate is `latSchema`/`lngSchema` in `shared/src/schemas/journey.schema.ts:6-7`, not a missing validation site — §0.3(d)'s "no operation-area validation site was found" is incorrect; there are two (the schema, and `validatePickupCoords`, which is reached only on the `SCHEDULED` branch). |
| 4a | "`VehicleSelector` already has distinct Bike/Moto/EMoto/EBike icons — the passenger half may already hold" | **No — it does not hold** | `VehicleSelector.tsx` is imported by **nothing**. All three real vehicle pickers (`NewJourneyPage:537`, `RegisterPage:228`, `SettingsPage:251`) render text-only buttons. And in the orphan itself, `MotoIcon`/`EMotoIcon` are a lightning bolt (`M13 10V3L4 14h7v7l9-11h-7z`), not a motorcycle; only the bicycle glyph is what it claims to be. |
| 4b | driver registration/verification surfaces "still carry car imagery" | **No** | No car glyph, emoji or wording survives anywhere in the client. `RegisterPage`'s role icons are 🙋 / 🏍️ / ↔️ (FIELD-BATCH G1 already inverted them back); `DriverVerificationPage` has no imagery at all. The only `car` matches are an English comment and the French conjunction *car*. |
| 4c | "driver tabs have no Home entry" | **Yes, for a real `DRIVER`** | `driverTabs` (`BottomNav.tsx:54-59`) is Requests / Scheduled / My rides / Profile. Masked in practice today: because of #2 nearly every motari is `BOTH`, and `bothTabs` *does* start with Home — the seeded `TestDriver` renders five tabs. Fixing #2 makes this visible. |
| 5 | `pickupDescription` / `destinationDescription` missing on `ActiveRidePage` | **Yes** | Zero references in the file; `ApproachPage.tsx:224` has the null-guarded render to copy. |
| 6 | no active notification on an admin approve/reject | **Yes** | `admin.routes.ts:187-208` (approve) and `:243-256` (reject) update the `driverProfile` row and return it. Neither imports or calls anything in `notification.service`, `push/` or `sms.service`. The driver finds out by opening the app. |

## Disagreements with the dispatch's §0

Recorded per §5 ("code wins; disagreements in the report"):

1. **§0.3(d)** — "no operation-area validation site was found by repo
   search". Two exist: the zod bounds in `journey.schema.ts:6-7`
   (which is what actually fires today, on every booking) and
   `validatePickupCoords` in
   `services/scheduled-rides/validators.ts:38`, wired only into the
   `SCHEDULED` branch of `createJourney`. The work is to replace an
   ugly message at a seam that exists, not to add a seam.
2. **§0.4** — "the passenger-side `VehicleSelector.tsx` already has
   distinct Bike/Moto/EMoto/EBike icons — the passenger half of the
   complaint may already hold". It does not: the component is
   unreferenced, and its moto glyph is a lightning bolt.
3. **§0.4** — "the driver-side registration/verification surfaces
   still carry car imagery". They carry no imagery at all; the car
   glyphs were already removed.
4. **§0.4 / §2 G4** — "driver tabs have no Home entry … if the
   integrity test permits a four-tab driver nav". `driverTabs` already
   has four entries and `bothTabs` five; the integrity test constrains
   only that every target resolves to a declared route, never the
   count. No STOP condition.
5. **§0.1** — the three scheduling reports are three different things,
   and only one of them (the motari's list) is a defect on `main`.

## After-table

The same walks, rerun against the branch. Stack as above; the sandbox
caveat (no OSM tile egress, no `LOCATIONIQ_API_KEY`) is unchanged.

| # | What the team reported | Then | Now |
|---|---|---|---|
| 1a | "Schedule a ride button is currently not working" | Walk completed; no "Schedule" control on the customer home, and no destination settable with tiles and geocoder both down | Unchanged — nothing was broken to fix. The walk still completes: `POST /api/journeys` `201` → `/journey/<id>/scheduled`. Reported as not-reproduced rather than declared fixed. |
| 1b | "Scheduled page can not get the data of scheduled rides" | `count=0` with a live scheduled ride in the database; structurally unreachable | Offer at 09:47 → the motari's page shows it, labelled "Your offer is waiting for the passenger", 1,500 RWF. Customer accepts → same row reads "Confirmed — this ride is yours". |
| 1c | schedule-confirm demands a price | Server `201` without `wishPrice`; no customer submit gated on price | Unchanged; not reproduced. |
| 2 | `DRIVER` → `BOTH` role flip | Chose DRIVER → account `BOTH` after the driver-profile POST | Chose DRIVER → account `DRIVER`, before and after the next login. |
| 2b | self-assigning `ADMIN` (found, not reported) | `PUT {"role":"ADMIN"}` → `200`, `/api/admin/verifications` → `200` | `400 ROLE_NOT_SELF_ASSIGNABLE`; role unchanged. `CUSTOMER`/`DRIVER`/`BOTH` still accepted. |
| 3a | no way to add documents | No link from `/driver`, `/profile`, `/driver/account`, `/settings` | Dashboard banner ("Finish your driver documents") and a Profile row ("My documents"), both landing on `/driver/verification` with its three upload buttons. **Still open:** no national-ID upload — see below. |
| 3b | cannot log in as a different user | Already worked | Walked end to end: pure `DRIVER` → Profile → Log Out → `/welcome`, store cleared → login as TestCustomer → lands on `/` as a different person. |
| 3c | no resend tap | Already present with a countdown | Unchanged. Covered by `LoginPage-otp-flow.test.tsx` ("resend is disabled behind the 60s cooldown, then sends again"). |
| 3d | out-of-area booking "gets an error" | `VALIDATION_ERROR` + `"Number must be less than or equal to -1.85"` | `400 OUTSIDE_OPERATION_AREA` / `errors.outsideOperationArea` → "That place is not in our operation area. Bimoto serves Kigali for now." (en/fr/rw). Inside Kigali still `201`. |
| 4a | moto identity | `VehicleSelector` imported by nothing; all three pickers text-only; its moto glyph a lightning bolt | One glyph set in `components/journey/vehicle-icons`, used by all four pickers; MOTO is a motorcycle; the bolt marks the electric variants and is pinned out of the rest of the tree by test. |
| 4b | car imagery on driver surfaces | None present | Unchanged; not reproduced. |
| 4c | driver tabs have no Home | `Requests / Scheduled / My rides / Profile` | `Home / Scheduled / My rides / Profile`, Home → `/driver`. Nav-integrity test green, untouched. |
| 5 | descriptions missing on `ActiveRidePage` | Zero references | Both rendered with `ApproachPage`'s null-guarded component. |
| 6 | no notification on an admin decision | Row updated, nothing sent | Reject → "Impapuro ntizemewe. … Licence photo unreadable. …"; approve → "Wemerewe. …" — the driver's own language, reason carried, delivered by push or SMS. |
| 7 | parcel weights | No weight concept | 11 kg on a bicycle-with-passenger → `422 PARCEL_TOO_HEAVY_FOR_VEHICLE`; 9 kg → `201`. 71/70 kg bicycle alone, 16/15 kg moto with passenger likewise. Declaring nothing still books. |
| — | engaged motari | Offered every new request while carrying one | Feed `1` → accepts → feed `0` with two more open; dashboard says "Finish your current ride first"; ride completes → feed `2`. Each block logs `[FEED-BLOCKED] … count=N`. |

## Still open

**No national-ID upload.** The team listed "id" among the documents a
motari should be able to add. `DriverVerificationPage` offers licence,
RURA and insurance; the server's `validDocTypes` matches, and
`DriverProfile` has no column for a fourth. Adding one means a schema
migration plus wiring into the DOC-GUARD erasure paths (encrypted
storage, superseded-file deletion, account-deletion erasure follows the
URL columns) — more than the reachability §0.3(a) scoped, and dangerous
to do halfway. Flagged rather than half-built.

**The moto-alone envelope rule is stated, not enforced.** See
`ENFORCE_MOTO_ALONE_SIZE_RULE` in
`packages/shared/src/constants/parcel-weight.ts`. The other three rules
limit a field that did not exist until now, so enforcing them refuses
nothing that was ever booked. This one limits `goodsSizeCategory`, which
the parcel form has always sent and whose default is MEDIUM on a MOTO —
enforcing it as written refuses the ordinary moto parcel booking that
`e2e/tests/create-ride-ui.spec.ts` asserts works today, and with it most
of the existing parcel business. "Moto alone: envelope-size parcels
only" may have been a statement about safe carrying rather than a block
on bookings that work. The limit is shown on the parcel form and every
booking outside it is logged (`[PARCEL-OVER-RULE]`), so the team can see
how often it happens before deciding. One boolean turns it into a
refusal; the code, copy and error code are already there.

## E2e failures in this sandbox, and whose they are

Five specs fail here. All five were checked against unmodified `main`
(source and specs both reverted to `84e2742`, same clean database):

- `bid-reopen-flow`, `escrow-adoption-flow`, `match-close-loop`,
  `payment-card-flow` — fail identically on `main`. All four hang on the
  accept-bid/payment confirm step.
- `landmark-ride:108` — flaky on `main` too: 2 of 3 runs hang for the
  full 240 s timeout on the map-tap step (this sandbox has no tile
  egress, so Leaflet never becomes interactive). With the branch, 1 of 3.

One real interaction was found and fixed rather than explained away: the
suite shares seed drivers, and specs routinely finish with their driver
still `MATCHED`. Because an engaged motari is now shown no new requests,
one spec's leftover emptied the next spec's feed. `releaseDriverEngagements`
(same shape as the existing `cancelExistingScheduledJourneys`) is called
by the specs that need a driver with a live feed.
