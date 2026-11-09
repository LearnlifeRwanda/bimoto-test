# Screener help layer — design note

**Dispatch:** R3-SCREENER-HELP-LAYER
**Scope:** per-question help text + per-enum-option descriptions on `/driver/screener`, plus a new reusable `HelpDisclosure` inline primitive and a time-remaining estimate on the progress bar.
**Status:** user-visible. Cumulative pilot-visibility audit K: 2 → 3 (welcome flow + driver screener + driver-screener help layer).

---

## 1. The gap that shipped

PR #70 (R3-DRIVER-SCREENER) shipped the in-app eligibility screener as a bare
form: each of the 8 questions rendered a prompt plus bare option labels and
nothing else. `DriverScreenerPage.tsx` contained **zero** references to help
text, hints, tooltips, descriptions, or `aria-describedby` anywhere in its 391
lines, and the question-catalogue type schema had no `helpKey` field.

Concretely, a pilot driver answering *"Which vehicle do you mainly use?"* saw
four labels — `Bicycle / Motorcycle / Electric bicycle / Electric motorcycle` —
with no explanation of:

- what *"mainly use"* means in context (the 50%-of-trips rule);
- the regulatory distinction between `E_BIKE` and `E_MOTO` (the latter is the
  RURA moto-taxi authorisation category, with a different fare tier);
- what to do if they switch between vehicles.

They guessed. Wrong screener self-classification leads to verification-step
rejection downstream, which hurts the funnel `screener_qualified → onboarded`
ratio — the single metric this whole screener exists to protect.

## 2. Why per-question help (and not just better labels)

Eligibility questions carry regulatory and operational nuance that does not fit
in a label. "Do you have RURA authorisation?" needs to explain what RURA is and
that *not having it yet is fine*; otherwise eligible drivers self-select out.
The help text is the difference between a driver abandoning and a driver
choosing the *needs_follow_up* path that keeps them in the funnel.

Help is **opt-in** (one tap to expand), so it never adds reading weight for
drivers who already understand the question. The default screen stays as terse
as it was.

## 3. Render pattern: inline disclosure (not tooltip, not modal)

Three patterns were considered:

| Pattern | Verdict |
|---|---|
| **Tooltip (hover)** | Rejected. The pilot targets low-end Android handsets. There is no reliable hover on touch; hover tooltips are an accessibility and discoverability dead end on mobile. |
| **Modal** | Rejected. A full-screen interrupt for one paragraph of help is disproportionate, loses the question context, and is heavier to dismiss one-handed. |
| **Inline disclosure** | **Chosen.** A small info-icon trigger expands a tinted region directly beneath the prompt. Works with tap, keeps context, is trivially accessible, and degrades gracefully on slow devices. |

The disclosure is implemented as a new primitive, `HelpDisclosure`
(`packages/client/src/components/ui/HelpDisclosure.tsx`):

- Trigger: a transparent `<button>` with a 14px inline-SVG info-circle and a
  12px brand-blue label. 44px min touch target.
- Body: a `#F8F9FA`-tinted, `rounded-lg`, 13px region with `role="region"`.
- ARIA: `aria-expanded`, `aria-controls` (→ `${id}-body`), `aria-label`.
- Intentionally **single-purpose**: no `variant`/`theme`/`size` props. It is
  one shape with one style. Generalisation can come when a second caller needs
  a second shape — not before.

No new icon dependency was introduced. The codebase has no icon library
(`lucide-react`, `react-icons`, etc. are absent from `packages/client/package.json`);
icons are inline SVG. `HelpDisclosure` follows that convention.

### Per-option descriptions

The 3 enum questions (licence / RURA / vehicle type) additionally render a
caption-weight (11px, `#6c757d`) description beneath each radio label. These are
threaded through the existing `RadioGroup` primitive via a new optional
`description?: string` field on `RadioOption`, rather than re-implementing the
radios inline — this preserves the existing bordered-card radio styling and
keeps a single radio primitive. (The original dispatch sketch assumed raw
`<label>` rendering; the live screener uses `RadioGroup`, so the description was
routed through it instead.)

## 4. Key naming convention

- Per-question help: `screener.help.<questionIdCamelCase>`
  (e.g. `screener.help.primaryVehicleType`). The catalogue stores this on
  `helpKey`.
- Help-trigger accessible label: `screener.help.toggle`.
- Per-option descriptions: `<i18nOptionKeyPrefix>.<optionValue>_description`
  (e.g. `screener.options.vehicleType.E_MOTO_description`). The catalogue stores
  the prefix on `optionDescriptionKeyPrefix` (only on enum questions that have
  descriptions; `primary_city_band` is intentionally left without one).

Both fields are **optional** on the type schema. Questions without them render
exactly as before, and every `t()` call for an optional description passes
`{ defaultValue: '' }` so a missing key renders empty — never
`[screener.options.licence.yes_description]`-style screen noise.

## 5. Time-remaining heuristic

The progress copy gains a coarse estimate:

```
remaining = SCREENER_QUESTIONS.length - answeredCount
minutes   = Math.max(1, Math.ceil(remaining * 15 / 60))
```

15 seconds per remaining question is deliberately rough — the goal is to
reassure ("this is short"), not to be precise. It is clamped to a 1-minute
minimum so the copy never reads "≈ 0 min" as the form completes. The progress
string is `"{{answered}} of {{total}} · ≈ {{minutes}} min"`.

## 6. Kinyarwanda native-review handoff (priority-1)

The ~30 new `rw` strings (help text + option descriptions) are **AI-generated**
and join the **priority-1 native-review batch** (Implementation Roadmap step
1.6 / GAP-P26), alongside the existing `welcome.*` and `screener.*` batches. The
`rw` `screener.help` block carries a `_comment` flag marking this. **Native
reviewer sign-off is required before pilot device-handout.**

## 7. Future reuse (out of scope here)

`HelpDisclosure` is the first inline-help primitive in the codebase and is
designed to be reused:

- **WelcomePage** — could host help on the role/language choices.
- **AdminFunnel** — could explain each funnel-stage metric inline.

Both are explicitly out of scope for this dispatch; they are noted so the next
person reaches for the existing primitive instead of building a second one.
Also out of scope: tooltip/modal alternatives (decided above) and
cross-cooperative help-text variation (single canonical help text per question).
