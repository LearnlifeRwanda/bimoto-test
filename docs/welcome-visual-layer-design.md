# Welcome visual layer — design note

**Dispatch:** R3-WELCOME-VISUAL-LAYER
**Status:** shipped (light-mode, static)

## Why

The welcome carousel that PR #67 (R3-WELCOME-FIRST-LAUNCH) shipped renders three
slides of text-only `heading + body`. The on-main `WelcomeCarousel.tsx` had zero
image, svg, illustration, or asset references. The welcome screen is the most
brand-defining moment in the app — every pilot driver sees it on first launch,
usually in their second language. A driver who skims (most do) got nothing visual
to anchor each slide's intent.

This layer adds one inline-SVG illustration per slide that conveys ~60% of the
slide's meaning before any text is read.

## What

Three React components, each a self-contained 160×160 inline SVG:

| Component | Slide | Concept |
|---|---|---|
| `WelcomeIllustration1` | "Welcome to Bimoto" | Motorcycle + bicycle on a surface circle, faint location pins → rides across Rwanda. |
| `WelcomeIllustration2` | "Powered by cooperatives" | Three user figures in a triangle, connected, with a crest at the centroid → cooperative network. |
| `WelcomeIllustration3` | "Fixed-price bidding" | Price tag with a checkmark, three bid cards converging → every price is a binding offer. |

They live in
`packages/client/src/components/welcome/illustrations/` and are exported through a
barrel (`index.ts`).

## How it wires in

The carousel is a **generic display component**: it takes `screens: WelcomeScreen[]`
and renders whatever each screen object carries. We extended the `WelcomeScreen`
interface with an optional field:

```ts
export interface WelcomeScreen {
  heading: string;
  body: string;
  Illustration?: React.ComponentType<{ 'aria-label'?: string }>;
}
```

When `screen.Illustration` is present, the carousel renders it above the heading
with `aria-label={t(`welcome.screen${current + 1}.illustrationAlt`)}`. The 1-indexed
slide identity lives in the parent `WelcomePage.tsx`, which is the single source of
truth for which illustration goes with which screen:

```tsx
const screens = [
  { heading: ..., body: ..., Illustration: WelcomeIllustration1 },
  { heading: ..., body: ..., Illustration: WelcomeIllustration2 },
  { heading: ..., body: ..., Illustration: WelcomeIllustration3 },
];
```

This keeps the carousel decoupled from specific illustration identities — any other
consumer can pass different illustrations or none. The swipe handler, 3-dot pager,
and ARIA wiring are untouched; the illustration insertion is purely additive.

## Palette mapping

Each illustration uses **only** the four brand-palette values, consistent with the
inline-hex convention already used across the client (`Button.tsx`,
`HelpDisclosure.tsx`, `BidCard.tsx`, etc.):

| Hex | Role | Use in illustrations |
|---|---|---|
| `#1B4F72` | primary navy | dominant tone — vehicle/figure silhouettes, outlines, price tag |
| `#F39C12` | accent orange | warmth — bicycle, network connectors, bid cards, accents |
| `#F8F9FA` | surface | background circle fill, "white" checkmark / tag hole |
| `#212529` | text | location pins, currency label |

A test in `__tests__/WelcomeCarousel.test.tsx` enforces this with a sweep over every
`fill` and `stroke` attribute (allowing only the four hex values, case-insensitive,
plus `none`).

## Accessibility

Each illustration is `<svg role="img" aria-labelledby={titleId}>` with a single
`<title>` element (id from React `useId()`) carrying the alt text passed via the
`aria-label` prop. Screen readers announce the alt text. The illustrations are
decorative-with-meaning, not pure decoration, so they are intentionally labelled
rather than `aria-hidden`.

Alt text is fully internationalised: `welcome.screen{1,2,3}.illustrationAlt` in
`en`, `fr`, and `rw`. The Kinyarwanda strings are AI-generated and join the
**priority-1 native-review batch** (GAP-P26) alongside the existing `welcome.*` and
`screener.*` batches — native reviewer sign-off is required before pilot
device-handout.

## Shared visual language

All three illustrations share the same circular surface background, stroke weights
(2px outlines / 3px feature lines), and palette discipline, so they read as a *set*
rather than three unrelated images. A consistent ~8–10px buffer from the viewBox
edges keeps them from looking cropped when the welcome screen scales across Android
phones from 320×480 up to 414×896.

## Out of scope / future

- **Animation / motion** on slide reveal (e.g. the motorcycle "driving in"). Static
  only for now; animation is a follow-up if motion earns its place.
- **Dark mode.** Single light-mode treatment for now. A dark-mode plan would swap the
  surface circle to a dark fill and lift the navy silhouettes toward a lighter tint;
  because every colour is a single named palette token per shape, this is a localised
  change when the app gains a dark theme.
- **Per-cooperative branded illustration variants.** Single canonical set for now.
