# Dead-export report — 2026-07-13 (LAUNCH-TRUTH G6.4)

> **Superseded for wiring questions** by
> [`wiring-report.md`](./wiring-report.md) (WIRE-AUDIT, 2026-08-03):
> feature-level endpoint → call → screen → reachability verdicts live
> there. This report remains the export-level (ts-prune) reference.

> **Findings only. Nothing was deleted.** Deletion is a separate team
> decision per entry — several categories below are intentionally
> exported (test hooks, barrel files, shutdown handlers) and deleting by
> this list without reading each site would break things.
>
> **Tool:** `ts-prune` (via `pnpm dlx ts-prune`), run once per package
> from the package root. Entries marked "(used in module)" —
> exported-but-only-consumed-locally — were filtered out as noise.
>
> **Known tool limitations (read before acting):**
> 1. ts-prune sees one package at a time. Exports of
>    `packages/shared/src/index.ts` consumed by server/client are flagged
>    as unused inside `shared`; the mirrored `shared/dist/index.d.ts`
>    lines in the server run (96 of them) are the same artifact. The
>    shared/dist sections below are therefore **cross-package noise
>    candidates, not confirmed dead** — confirming any one requires a
>    repo-wide grep.
> 2. Test imports count as usage. **`DriverCard.tsx` — the known orphan
>    (§0.1b of the dispatch: no production code renders it) — is NOT
>    flagged** because `JacketNumber.test.tsx` and
>    `VehicleUpdatedChip.test.tsx` import it. It remains
>    production-orphaned; its fate stays the team's decision.

## Client (`packages/client`) — 31 entries

Mostly *unused default exports* on components that are imported by name
(`export const X` + `export default X`; only the named import is used).
Low-risk cleanup, but each is a one-line convention decision, not dead
logic:

```
src/hooks/useGeocodeSearch.ts:33 - isGeocodingUnavailable
src/components/driver/CancellationPie.tsx:151 - default
src/components/driver/CohortBreakdown.tsx:107 - default
src/components/driver/DriverEarningsCard.tsx:168 - default
src/components/driver/DriverStatsCard.tsx:301 - default
src/components/driver/RatingDistribution.tsx:91 - default
src/components/driver/Sparkline.tsx:73 - default
src/components/journey/ApproachStatusBadge.tsx:60 - default
src/components/journey/ChildAcknowledgmentModal.tsx:80 - default
src/components/journey/ChildPassengerBadge.tsx:36 - default
src/components/journey/ChildPassengerInfoCard.tsx:37 - default
src/components/journey/DriverApproachMap.tsx:193 - default
src/components/journey/GoodsStopEditor.tsx:289 - default
src/components/journey/JourneyLegsDisplay.tsx:289 - default
src/components/journey/JourneyProgress.tsx:16 - JourneyProgress
src/components/journey/LocationPicker.tsx:21 - LocationPicker
src/components/journey/MiniMap.tsx:34 - MiniMap
src/components/journey/PriceInput.tsx:14 - PriceInput
src/components/journey/RoutePreviewMap.tsx:124 - default
src/components/journey/UrgentBadge.tsx:145 - default
src/components/journey/VehicleSelector.tsx:52 - VehicleSelector
src/components/journey/VehicleTypeInfoCard.tsx:76 - default
src/components/rating/ReliabilityBadge.tsx:9 - ReliabilityBadge
src/components/rating/StarRating.tsx:10 - StarRating
src/components/safety/EmergencyButton.tsx:10 - EmergencyButton
src/components/safety/InterruptButton.tsx:10 - InterruptButton
src/components/ui/HelpDisclosure.tsx:93 - default
src/components/welcome/illustrations/index.ts:1 - WelcomeIllustration1
src/components/welcome/illustrations/index.ts:2 - WelcomeIllustration2
src/components/welcome/illustrations/index.ts:3 - WelcomeIllustration3
src/components/welcome/illustrations/index.ts:4 - WelcomeIllustrationProps
```

Noteworthy true-orphan candidates (never imported by any production
file — verify before touching): `JourneyProgress`, `LocationPicker`,
`MiniMap`, `PriceInput`, `VehicleSelector`, `ReliabilityBadge`,
`StarRating`, `EmergencyButton`, `InterruptButton` — several look like
v1 components superseded by later flows. Plus the known test-shadowed
orphan `DriverCard.tsx` (see limitation 2).

## Server (`packages/server`) — 126 in-package entries

Recurring intentional categories (keep):

- **Job stop/reset hooks** (`stop*Job`, `_resetForTests`,
  `_set*ForTests`): exported for the shutdown handler and test isolation;
  some `stop*` are currently only called by tests. ~24 entries.
- **Barrel files** (`services/*/index.ts` re-exports for bnr-report,
  sms-inbound, scheduled-rides, push, journey-resilience,
  payout/preferences, aml/graph-patterns, conflict-resolver): re-exported
  for API surface consistency; consumers import from the concrete module
  instead. ~60 entries.
- **Type-only exports** in `services/*/types.ts` used implicitly via
  inference. ~20 entries.

Possibly-genuine dead code worth a look:

```
src/utils/geo.ts:14 - isWithinRadius
src/services/cooperative/config.ts:11 - COOPERATIVE_DEFAULT_COMMISSION_RATE
src/services/cooperative/config.ts:35 - APPROVE_REQUIRES_MIN_RATING
src/services/cooperative/scope.ts:75 - assertUserInCooperative
src/services/discovery/supply-broadcast.ts:52 - getNotifiedRegistry
src/services/mobility/config.ts:62 - tierConfigFor
src/services/mobility/store.ts:44 - deleteOlderThanForRetention
src/services/funnel-metrics/city-band.ts:108 - reloadCityBandConfig
src/services/funnel-metrics/city-band.ts:113 - getCityBandConfigVersion
src/services/child-safety/legal-thresholds.ts:28 - LegalThresholdKey
src/services/customer-modes/config.ts:39 - CEILING_MULTIPLIER_DEFAULT
```

(The `services/cooperative/**` entries are listed for completeness only —
that area is reserved by the founder and out of scope for any change.)

The other 96 server entries point at `packages/shared/dist/index.d.ts`
and are the cross-package mirror described in limitation 1 — not listed
here as they duplicate the shared section.

## Shared (`packages/shared`) — 165 entries

Almost entirely the `src/index.ts` barrel: every constant/type/schema the
server or client imports via `@bimoto/shared` is flagged because ts-prune
cannot see across the workspace. Treat this section as **unverified**;
any real dead entry here can only be confirmed with a repo-wide usage
grep per symbol. Raw list retained by the tool run; not reproduced here
to avoid implying 165 deletable symbols.

## Suggested next step (not done in this dispatch)

Adopt `knip` at the workspace level (it understands monorepo
cross-package imports) and wire it as a report-only CI job; revisit this
file with its output. Then take deletion decisions entry-by-entry,
starting with the client true-orphan candidates above.
