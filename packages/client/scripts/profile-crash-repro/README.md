# PROFILE-RESCUE G1 — reproduction recipe for the Kigali Profile crash

Field report (Kigali, 30 July): tapping Profile on APK v8 crashes the
app; hardware Back exits; relaunch returns to the crash; only recovery
found was reinstall. Server logs show no request when Profile is
tapped.

## The throwing line

`src/pages/shared/ProfilePage.tsx:184`

```tsx
{user.driverProfile.avgRating.toFixed(1)}
```

`driverProfile.avgRating` is a Prisma `Decimal(3,2)` column. Prisma
Decimals JSON-serialize as **strings** (`"4.85"`), and
`GET /api/users/me` (user.service.ts `getMe`) returns the raw Prisma
row. So for every logged-in **driver** (role `DRIVER` or `BOTH`),
`"4.85".toFixed` throws `TypeError: ...toFixed is not a function`
during the very first render of ProfilePage — before any network call,
which is why the server logs show nothing.

This is precisely the shape hazard the RATE-DISPLAY dispatch documented
and absorbed via `lib/driver-rating.ts` (`firstFinite` + `Number()`)
in DriverStatsCard, DriverRatingSummary, BidCard, MatchedPage — every
consumer except this one line.

## Why CI stayed green

`__tests__/ProfilePage-logout.test.tsx` mounts a `CUSTOMER` user, so
the driver-rating branch never renders; and hand-written test fixtures
carry `avgRating` as a number, not the server's Decimal-string.

## Why it sealed the user in (verified in the same run)

The root ErrorBoundary's Retry does `window.location.reload()`; the
URL is still `/profile`, so the reload re-enters the crashed route.
Android's Back has no `backButton` listener, so it exits the app;
relaunch restores the same URL. (Fixed by G3/G4.)

## Reproduce against the real bundle

```sh
pnpm --filter @bimoto/shared build && pnpm --filter @bimoto/client build
cd packages/client/scripts/profile-crash-repro
BIMOTO_MOCK_ROLE=DRIVER   node mock-api.mjs &   # serialization mirrors the real server
node serve-dist.mjs &                            # serves dist/ like the WebView
BIMOTO_MOCK_ROLE=DRIVER   node repro.mjs         # → TypeError + boundary trap
BIMOTO_MOCK_ROLE=CUSTOMER node repro.mjs         # control: profile renders
```

Observed pre-fix (Chromium against `dist/`):

```
[console.error] TypeError: n.driverProfile.avgRating.toFixed is not a function
    at B1 (http://localhost:4173/assets/App-*.js:...)
[repro] boundary=true profileRendered=false
[repro] after Retry: url=http://localhost:4173/profile trappedAgain=true
```

The permanent regression test lives in
`src/__tests__/ProfilePage-driver-rating.test.tsx` (mounts ProfilePage
with a server-shaped driver user, Decimal-as-string).

## §6 walk (post-fix, walk.mjs)

Same servers as above, then:

```sh
BIMOTO_WALK_LEG=1 node walk.mjs   # driver taps Profile → renders (PASS)
# restart mock-api with BIMOTO_MOCK_NICKNAME='' for an artificial crash
BIMOTO_WALK_LEG=2 node walk.mjs   # crash contained in place, nav alive,
                                  # Go-home recovers in-app, no reload (PASS)
```

The hardware-Back legs are native-only (the listener registers only
under Capacitor) and are covered by useAndroidBackButton.test.tsx.

## WebView baseline check (ruled out)

The built chunks emit es2020 syntax plus `??=` (requires WebView
Chrome ≥ 85) and reference `BigInt` (pmtiles, Chrome 67+). A
baseline/parse failure would break the whole app at boot — not one
route — and would survive reinstall; the field failure did neither.
Not the cause here (a pinned `build.target` is still worth considering
separately).
