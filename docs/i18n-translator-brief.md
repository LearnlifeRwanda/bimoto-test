# Bimoto Kinyarwanda Translator Brief

Welcome, and thank you for taking on this work. This brief is everything you
need to start. Read it once end-to-end before opening any other file. Total
read time: ~10 minutes.

## 1. Project context

Bimoto is a two-sided marketplace progressive web app (PWA) for bicycle and
motorcycle (moto) taxi transport in Rwanda. Customers post a ride request
with the price they want to pay; nearby drivers send back binding offers
(bids); the customer picks one and the ride happens. The same PWA serves
both the customer and the driver — they see different screens depending on
their role. The app is used in three languages: Kinyarwanda, English, and
French. **Kinyarwanda (`rw`) is the default locale** and the focus of this
review.

The current Kinyarwanda strings were AI-generated as a placeholder. They are
intelligible but have not been native-reviewed; some are awkward or
inconsistent. Your job is to bring them to production quality before the
pilot launch.

## 2. Scope

You are reviewing three sources:

1. **`packages/client/public/locales/rw/translation.json`** — the main UI
   string bundle. 24 namespaces, 232 keys.
2. **`QUICK_MESSAGES`** in `packages/shared/src/constants/quick-messages.ts`
   — 10 canned chat phrases that appear as quick-reply buttons in the in-app
   chat (e.g., "On my way", "Where are you?").
3. **`KIGALI_LANDMARKS`** in `packages/shared/src/constants/locations.ts` —
   35 named places in Kigali used for pickup/destination autocomplete.

You do **not** need to touch any code or JSON files. All your work happens in
one markdown file: `docs/i18n-rw-review.md` (see §3).

## 3. What to deliver

A single edited copy of **`docs/i18n-rw-review.md`** with the **"Reviewer's
RW"** column filled in for every row. Leave the **"Note"** column for
anything you want us to know — uncertainty, register choice, a flag that the
English source string itself reads awkwardly, a UX recommendation (e.g.,
"this label is too long for Kinyarwanda — consider abbreviation X"), or a
glossary addition you want us to lock.

**That file is generated, not written.** `docs/i18n-rw-review.md` is produced
from the app's locale files by `pnpm i18n:review`, and CI rejects any change
that adds a string without regenerating it — so the copy you receive contains
every phrase the app ships, with the new ones marked `NEW`. Trust the counts
in its own header over any figure quoted in this brief: the header says which
commit it was generated from, and the brief was written by hand at a moment
in time. If your copy has been sitting for a while, ask us for a fresh one —
it is one command, and we will send the regenerated file with your existing
answers still to be merged in.

Specifically, please return:

- The filled-in `i18n-rw-review.md`.
- A short list of **glossary additions or disputes** — terms you think
  should be locked, or terms in `docs/i18n-glossary.md` you disagree with.
- A short list of **awkward English source strings** — if a phrase reads
  badly in English, we want to fix the source rather than make you translate
  bad input.
- Any **UX recommendations** about string length, abbreviations, or layout
  hints.

## 4. Quality criteria

- **Cultural appropriateness.** Strings should sound like something a
  Rwandan staff member at a transport company would write, not a
  word-for-word translation.
- **No awkward calques.** If the English uses an idiom, find the equivalent
  Rwandan idiom rather than translating literally.
- **Mobile-first brevity.** The app runs on small phones (often 360px wide).
  Buttons should fit on one line. Where two correct renderings exist, prefer
  the shorter one.
- **Consistent register.** The current copy uses informal singular (`wowe`,
  `-wawe`). Please confirm this is the right register for a consumer
  transport app and apply the same choice everywhere. If you switch to the
  polite-formal form, switch everywhere — no mixing.
- **Glossary discipline.** Domain terms locked in `docs/i18n-glossary.md`
  must be used as locked. If a locked term reads wrong in context, flag it
  in the Note column rather than diverging silently.
- **Trust-and-safety phrasing.** Strings about emergency, payment, escrow,
  RURA authorization, and helmet requirements are legally and operationally
  sensitive. Err toward clarity and conservatism.

## 5. Format and tooling

- All work in plain markdown.
- You can edit `docs/i18n-rw-review.md` in any text editor (VS Code,
  Sublime, Notepad++) or directly on GitHub in a browser.
- You do not need access to the `.json` source files. Engineering will
  transcribe your filled-in column back into the JSONs and shared
  constants.
- If you want to flag many strings, open separate GitHub issues per topic
  rather than one giant comment thread; we will triage from there.

## 6. Glossary

Read **`docs/i18n-glossary.md`** before you start. It locks domain
vocabulary so the same concept is rendered the same way across all 200+
strings. Where the glossary marks a term as "Translator's call" or "Open
for discussion", you decide; please record your decision in the glossary
PR comment so we can lock it for future translators.

## 7. In-app context

Where possible, see the strings in context — copy alone can be misleading.

- **Staging URL:** _[fill in when staging is up — ask the project lead]_
- If staging is not yet live when you start, ask for screenshots of: the
  chat screen, the bid list screen, the journey-status screen, the
  driver-verification screen, and the payment confirmation screen. These
  five screens cover most of the high-stakes copy.

## 8. Turnaround

Per the existing project budget note, the expected turnaround is **1–2
weeks**. If a particular phrase needs more time for cultural review (e.g.,
how to render "escrow" naturally, or whether to coin a term for "tier"),
please flag it in the Note column rather than rushing — we'd rather wait an
extra few days than ship awkward Kinyarwanda.

If you are time-constrained, you may **deprioritize** extremely technical
error keys (e.g., `errors.invalid_transition`) that are normally only seen
in stack traces; focus on user-facing ride, bid, payment, and chat strings.

## 9. QA process

Once you deliver the filled-in review file:

1. Engineering checks key parity — every row has a non-empty Reviewer's RW
   column, no rows accidentally deleted.
2. A second native speaker (where available) does a **back-translation
   spot-check** on 10 randomly chosen strings — they translate your
   Kinyarwanda back to English without seeing the source, and we compare to
   catch reversed meanings.
3. Engineering opens a follow-up PR that transcribes your column into the
   JSONs and shared constants, and merges it under the Kinyarwanda strings'
   normal review process.
4. We may come back with clarifying questions on 5–10 strings. Please
   budget for one round of revisions.

## 10. Payment & terms

_Placeholder — to be filled in once contract is signed._

Contact the project lead with any questions before you start.
