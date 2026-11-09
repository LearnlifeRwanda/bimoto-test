# Welcome + Screener Kinyarwanda Native Review (June 2026)

## What this is

The `welcome.*` and `screener.*` Kinyarwanda translations were AI-generated
during R3-WELCOME-FIRST-LAUNCH (PR #67, May 2026), R3-WELCOME-VISUAL-LAYER
(PR #81, June 2026), R3-DRIVER-SCREENER (PR #70, May 2026), and
R3-SCREENER-HELP-LAYER (PR #77, May 2026). Each of those dispatches
flagged the new Kinyarwanda strings as **priority-1 native-review batch**
before pilot device hand-out. This is the consolidated review artifact.

## Why it matters

These strings are the first words a pilot driver, customer, or
cooperative leader sees on the app. AI-generated Kinyarwanda is
serviceable but often misses idiom, register, and the specific
terminology pilots in Kigali actually use. Native review is the gate
between "the app technically displays Kinyarwanda" and "the app speaks
to its users in their own voice."

## Scope

This batch is **78 keys** (the original dispatch estimated ~70):

- `welcome.*` namespace — **18 keys**: 3 carousel slides ×
  (heading, body, illustrationAlt) = 9, plus the Continue/Skip CTAs,
  the 4 language-picker labels, and 3 carousel ARIA strings.
- `screener.*` namespace — **60 keys**: title/subtitle/progress/continue,
  the help toggle + 8 per-question help texts, the 8 question labels,
  the answer-option labels and their `_description` variants (licence,
  rura, vehicleType, cityBand groups), the boolean yes/no labels, and
  the qualification-result + error messages.

**9 keys are explicitly TODO-flagged** in the codebase
(`screener.help.*`, marked `_comment: "TODO Kinyarwanda native review
(R3-SCREENER-HELP-LAYER, GAP-P26)"`). These are sorted to the **top** of
the screener section in the CSV — review them first.

## How to fill in the review

1. Open `welcome-screener-native-review-2026-06.csv` in Google Sheets
   (or LibreOffice Calc / Excel).
2. Read the `en` column as the source of truth — the Kinyarwanda
   should convey the same meaning.
3. The `fr` column is cross-reference only; you don't need to translate
   from French.
4. For each row, set the `status` column to one of:
   - `GOOD` — the rw_current translation is accurate and natural.
   - `NEEDS_FIX` — small correction needed (typo, gender, register).
     Provide the correction in `rw_corrected`.
   - `NEEDS_REWRITE` — translation is wrong or unnatural. Provide a
     full rewrite in `rw_corrected`.
   - `UNSURE` — the source meaning is unclear or you'd want a second
     opinion. Note your uncertainty in `reviewer_notes`.
5. Use the `reviewer_notes` column for any rationale you want preserved
   (dialect choices, terminology decisions, cultural nuance).
6. Prioritise rows where `rw_has_todo_comment` is `YES` — those are the
   keys the engineering team explicitly flagged.

### A note on interpolation placeholders

Some strings contain `{{...}}` placeholders (e.g. `welcome.dotAria` =
`"Screen {{n}}"`, `screener.progress` =
`"{{answered}} of {{total}} · ≈ {{minutes}} min"`). These are filled in
by the app at runtime — **keep the `{{...}}` tokens exactly as-is** in
any correction; only translate the surrounding words.

## Column reference

| Column | Meaning |
|---|---|
| `key` | Dotted i18n key path (do not edit) |
| `namespace` | `welcome` or `screener` (do not edit) |
| `context_note` | Where the string appears in the UI (do not edit) |
| `en` | English source of truth (do not edit) |
| `fr` | French, cross-reference only (do not edit) |
| `rw_current` | Current AI-generated Kinyarwanda (do not edit) |
| `rw_has_todo_comment` | `YES` = explicitly flagged in code; review first |
| `status` | **You fill in**: GOOD / NEEDS_FIX / NEEDS_REWRITE / UNSURE |
| `rw_corrected` | **You fill in**: your corrected Kinyarwanda |
| `reviewer_notes` | **You fill in**: rationale / nuance (optional) |

## What happens next

When you've completed the review, send the filled-in CSV back to the
Bimoto team. A separate engineering dispatch (R3-WELCOME-NATIVE-REVIEW-APPLY)
will apply your corrections to `rw/translation.json` and re-run the
client test suite to confirm no UI strings are silently truncated or
malformed.

## Approximate time investment

~1–2 hours for a fluent Kinyarwanda speaker working through 78 short
strings. Most strings are 1–2 sentences; the screener help text is the
longest at 3–5 sentences each.

## Reviewer

[To be filled in by the maintainer before sending the artifact to a
specific reviewer.]
