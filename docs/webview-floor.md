# ADR: WebView floor for the client bundle — Chrome/WebView 63

**Status:** accepted (FIELD-UX G4, 2026-07)
**Where enforced:** `packages/client/vite.config.ts` → `build.target: 'chrome63'`

## Context

The pilot runs on mixed Android hardware in Kigali, installed by sideloaded
APK — so a device's System WebView may be whatever its factory image or last
Play update left behind. Until this decision the bundle had **no explicit
`build.target`**: Vite's default (`'modules'`) emitted syntax that requires
WebView Chrome ≥ 85 (established in #140) — a floor nobody chose, on a fleet
where nobody verified it.

## Constraints

| Constraint | Floor it implies |
| --- | --- |
| Capacitor 6 (`minSdkVersion 22`, Android 5.1) documents WebView **60** as its minimum | 60 |
| The app loads as `<script type="module">` (native ES modules) | 61 |
| Boot uses native dynamic `import()` (`main.tsx` bootstrap, ErrorBoundary recovery, lazy Capacitor plugins) | **63** |
| Vite `'modules'` default (what we had by accident) | 85–87 |

Reaching below 63 would require `@vitejs/plugin-legacy` (SystemJS loader +
polyfill chunks shipped at runtime) — rejected: FIELD-UX's invariant is that
nothing new ships at runtime, and Capacitor's own 60-floor leaves only the
WebView 60–62 sliver (mid-2017 builds) unreachable.

## Decision

Pin **`build.target: 'chrome63'`** (WebView 63, December 2017). Any device
that can run the Capacitor 6 container and load an ES-module app can now
parse the bundle; the accidental ≥ 85 requirement is gone.

Why this is safe for mixed Kigali hardware: WebView auto-updates through
Play on Android 5+, so even budget phones sit far above 63 when Play works;
the floor exists for the stragglers — factory-image WebViews on devices that
never saw an update. A 2017-era parse floor covers effectively every Android
8/9/10 factory image in circulation.

## The part `build.target` cannot do

esbuild lowers **syntax** (optional chaining, nullish coalescing, class
fields…) but does **not** polyfill **runtime APIs**. Code must not call APIs
newer than Chrome 63 without a guard or local fallback. The one existing
offender (`Object.fromEntries`, Chrome 73, in `lib/api.ts`) was replaced with
a plain loop in the same change. When touching client code, check new
browser-API calls against caniuse for Chrome 63.

Known accepted exception: the generated Workbox service worker is built by
`vite-plugin-pwa`, not by our `build.target`. A too-old WebView merely fails
SW registration — the app itself still boots (PWA caching degrades, nothing
breaks).
