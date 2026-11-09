# Driver Screener — Design Note

**Dispatch:** R3-DRIVER-SCREENER · **Status:** landed in PR replacing the
`// STUB: ... until R3-DRIVER-SCREENER lands` site at
`funnel-metrics.service.ts:370-372`.

## Why this exists

The funnel-metrics dashboard (PR #65) declared four driver-funnel stages:
**registered → screener_qualified → onboarded → active**. Three of them
had real data sources from day 1. The fourth — *screener-qualified* — was
literally a stub: it aliased the onboarded count and the
`/admin/funnel` tile carried a "Stubbed until R3-DRIVER-SCREENER ships"
badge.

This dispatch closes that hole by giving the screener stage a real data
source: an 8-question in-app driver screener that every driver answers
between consent and vehicle verification.

## The 8 questions

Frozen in `packages/shared/src/screener/questions.ts`. Each has a
stable `id`, an `i18nKey` (looked up by both server and client), and a
`kind` that controls the renderer:

| id | kind | gates eligibility? |
|---|---|---|
| `is_18_or_older` | boolean | yes — `false` → ineligible (`under_18`) |
| `holds_drivers_licence` | enum (yes / in_progress / no) | yes — `no` → ineligible (`no_drivers_licence`) |
| `has_rura_authorisation` | enum (have / applying / not_yet) | yes — `not_yet` → needs_follow_up (`needs_rura_path`) |
| `primary_vehicle_type` | enum (BIKE / MOTO / E_MOTO / E_BIKE) | no — matching signal only |
| `cooperative_affiliation` | optional FK + free-text fallback | no — matching signal only |
| `primary_city_band` | enum (kigali_dense / kigali_periphery / bugesera_corridor / other) | no — matching signal only |
| `weekly_availability_hours` | integer (0..100) | yes — `< 5` → needs_follow_up (`low_availability`) |
| `prior_platform_experience` | boolean + optional months | no — matching signal only |

The four gating questions cover the floor: the driver is a legal adult
(`under_18`), can legally drive (`no_drivers_licence`), can commercially
drive (`needs_rura_path`), and has enough time to be matched
(`low_availability`). Vehicle/cooperative/city/experience are
*matching* signals — useful for dispatch but not blocking.

## Eligibility logic

A pure function in `packages/shared/src/screener/eligibility.ts`:

```ts
if (!is_18_or_older)                       return 'ineligible / under_18';
if (holdsDriversLicence === 'no')          return 'ineligible / no_drivers_licence';
if (hasRuraAuthorisation === 'not_yet')    return 'needs_follow_up / needs_rura_path';
if (weeklyAvailabilityHours < 5)           return 'needs_follow_up / low_availability';
return 'eligible';
```

The function is imported by both server (for the authoritative result
stored on submit) and client (for local pre-render checks). Same answers
→ same result; no drift possible.

## GDPR / Law 058/2021 posture

The catalogue collects **operational self-attestations only** — age,
licence/RURA status, vehicle type, cooperative affiliation, city band,
availability, prior platform experience. None of these are special
categories under Rwandan Law 058/2021 Art. 5 / GDPR Art. 9 (health,
biometric, religion, ethnic origin, national ID).

This posture is enforced by a test: `catalogue-gdpr-posture.test.ts`
lints every question's `id` and `i18nKey` against a disallowed
substring list — `['health', 'medical', 'religion', 'ethnic',
'national_id', 'biometric']`. Adding a question whose key contains any
of those substrings fails CI.

## Funnel-metrics rewire

`computeWeek` in `funnel-metrics.service.ts` now does a 5th
`prisma.count` against `DriverScreener` (cumulative through
`endUtc`, only `eligibilityResult: 'ELIGIBLE'` rows, scoped to the
cooperative's driver-id list when filtered). The L370-372 STUB is
replaced with `screenerQualified: perWeek.map((w) => w.screenerQualified)`
and the meta flag flips from `true` to `false`.

`/admin/funnel` drops the "Stubbed until R3-DRIVER-SCREENER ships" badge
in the same commit as the i18n key removal — neither half renders
without the other.

### Operations Lead reading guide

After this dispatch, the four funnel tiles on `/admin/funnel` are:

- **Registered** — drivers (User.role ∈ {DRIVER, BOTH}) created cumulatively through this week.
- **Screener-qualified** *(now real)* — drivers with a completed `DriverScreener` row whose `eligibilityResult = ELIGIBLE`.
- **Onboarded** — drivers with `verificationStatus = VERIFIED` and a cooperative attribution.
- **Active** — drivers with ≥ `ACTIVE_DRIVER_TRIP_THRESHOLD` completed trips in the trailing `ACTIVE_DRIVER_WINDOW_DAYS` window.

**Invariant** (asserted in fixtures by
`screener-qualified >= onboarded for any cohort with at least 1 onboarded driver`):
under the post-screener world, every driver who is onboarded should
also have completed an eligible screener. Production data won't satisfy
this until backfill — legacy drivers verified before R3-DRIVER-SCREENER
landed have no screener row. The funnel will show an apparent
"onboarded > screener_qualified" mismatch in early weeks. This is
expected and resolves either via backfill (run the screener for legacy
drivers retroactively) or natural churn.

## Routing in the onboarding flow

- `/welcome` (carousel, language picker — PR #67)
- `/login` or `/register`
- `/consent` (privacy + terms acceptance)
- `/driver/screener` *(new)* — for DRIVER / BOTH roles
- `/driver/verification` (existing — uploads licence, RURA, insurance)

`ConsentPage`'s post-consent redirect was updated to send DRIVER / BOTH
users to `/driver/screener` instead of `/`. The screener is not yet a
*hard* gate — a driver who navigates to `/` directly after consent will
reach the customer home without the screener. Promoting the screener to
a hard gate (via `needsScreener(user)` in `ProtectedRoute`) is a
follow-up: it requires propagating a `screenerCompletedAt` field into
the auth payload, which is a bigger change than this dispatch.

For the v1 user-visible promise — "a driver who finishes welcome,
registers, gives consent next reaches the screener" — the soft-gate
post-consent redirect is sufficient.

## Schema delta

```prisma
model DriverScreener {
  id                       String   @id @default(cuid())
  driverProfileId          String   @unique @db.Uuid
  driverProfile            DriverProfile @relation(...)
  is18OrOlder              Boolean
  holdsDriversLicence      ScreenerLicenceStatus
  hasRuraAuthorisation     ScreenerRuraStatus
  primaryVehicleType       VehicleType                  // existing enum
  cooperativeId            String?
  cooperative              Cooperative? @relation(...)
  cooperativeNameProvided  String?
  primaryCityBand          String                       // shared TS union, validated by Zod
  weeklyAvailabilityHours  Int
  priorPlatformExperience  Boolean
  priorPlatformMonths      Int?
  eligibilityResult        ScreenerEligibilityResult
  ineligibilityReason      ScreenerIneligibilityReason?
  completedAt              DateTime @default(now())
}

enum ScreenerLicenceStatus       { YES IN_PROGRESS NO }
enum ScreenerRuraStatus          { HAVE APPLYING NOT_YET }
enum ScreenerEligibilityResult   { ELIGIBLE INELIGIBLE NEEDS_FOLLOW_UP }
enum ScreenerIneligibilityReason { UNDER_18 NO_DRIVERS_LICENCE NEEDS_RURA_PATH LOW_AVAILABILITY }
```

`primaryCityBand` is stored as `String` rather than as a Prisma enum to
keep the on-disk value identical to the shared TS union
(`'kigali_dense' | 'kigali_periphery' | ...`) — adding a Prisma enum
would force a case-translation layer between Prisma's
SCREAMING_CASE convention and the shared lowercase literals. Validated
at the Zod boundary in `screener.schema.ts`.

The migration is purely additive (one new table, four new enums, three
indexes, two FKs). No `ALTER` on existing tables, zero `INSERT`
statements.

## Follow-ups (out of scope here)

- **Backfill** for legacy onboarded drivers (so the
  `screener_qualified >= onboarded` invariant holds in production data).
- **Hard-gate** the screener via `needsScreener(user)` in
  `ProtectedRoute`, propagating `screenerCompletedAt` into the auth
  payload.
- **Catalogue refinement** — the 8 questions are frozen for this
  dispatch but the function is pure and the catalogue is a single
  source of truth; refining them is a follow-up PR.
- **Cooperative picker** — the `cooperative_affiliation` question
  currently stores a free-text name only. A future PR can swap this for
  a real FK picker that lists cooperatives by name.
- **Priority-1 native review** of the Kinyarwanda i18n batch
  (bundled with the `welcome.*` batch from PR #67).
