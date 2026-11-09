# Bimoto Kinyarwanda Translation Glossary

> **Note:** This glossary is not exhaustive. The translator may flag additional
> terms during review and propose entries; the glossary will be updated
> alongside the translation PR.

This is the controlled vocabulary the Kinyarwanda translator must use
consistently across `packages/client/public/locales/rw/translation.json`,
`QUICK_MESSAGES`, and `KIGALI_LANDMARKS`. Two strings using the same concept
must not disagree.

Each entry is marked one of:

- **Locked** — the AI rendering has been verified consistent across all current
  uses; keep this exact Kinyarwanda word/phrase.
- **Translator's call** — choose the best Rwandan rendering; current AI text
  may be wrong, inconsistent, or awkward.
- **Open for discussion** — the right approach (translate, transliterate, leave
  in English with a parenthetical) is genuinely unclear; please propose.
- **Do not translate** — keep in English / original.

## Bidding & marketplace

| English term | Definition | Expected Rwandan rendering | Status |
|---|---|---|---|
| bid / offer | A driver's price proposal for a journey | `ituro` (sg.) / `amaturo` (pl.) | Locked |
| submit an offer | Send a bid to the customer | `Ohereza ituro` | Locked |
| fixed price | Binding price agreed up-front, not metered | `igiciro gihamye` (sg.) / `ibiciro bihamye` (pl.) | Locked |
| fair price | Suggested market price for a route | `igiciro gikwiye` | Locked |
| your price (wish price) | The price the customer wants to pay | `igiciro cyawe` | Locked |
| journey / ride | A booked trip from pickup to destination | `urugendo` | Locked |
| ride request | A customer's open request for drivers to bid on | `ubusabe` | Locked |
| match (verb) | Pair a customer with a driver who accepted a bid | `guhuza` / `byahurijwe` (passive) | Locked |
| accept (a bid) | Customer accepts a driver's offer | `Emera` | Locked |
| withdraw (a bid) | Driver retracts their offer | `Kuraho ituro` | Locked |
| tier | Loyalty/commission tier the user belongs to | `urwego` | Locked |
| commission / platform fee | The cut Bimoto takes from each ride | Translator's call — current text uses both `amafaranga y'urubuga` (platform fee) and `amakomisiyo` (commission) interchangeably; please pick one and apply consistently, or distinguish them deliberately | Translator's call |
| payout / "you will receive" | The amount paid out to the driver after fees | `Uzahabwa` | Locked |
| escrow | Payment held by the platform until ride is confirmed | Open for discussion — current text uses descriptive phrasing (`ubwishyu burafatwa kugeza...`); consider whether to coin a term, transliterate, or keep descriptive | Open for discussion |

## Trust & compliance

| English term | Definition | Expected Rwandan rendering | Status |
|---|---|---|---|
| RURA | Rwanda Utilities Regulatory Authority | `RURA` | Do not translate |
| RURA authorization | Driver's RURA transport permit | `uruhushya rwa RURA` | Locked |
| RURA-authorized (driver badge) | Badge label | `wemejwe na RURA` | Locked |
| insurance | Third-party vehicle insurance | `ubwishingizi` | Locked |
| insured (badge) | Vehicle has valid insurance | `gifite ubwishingizi` | Locked |
| cooperative | Registered moto-taxi cooperative | `koperative` | Locked |
| cooperative member | Driver is a member of a cooperative | `umunyamuryango wa koperative` | Locked |
| verified | KYC / document check passed | `byemejwe` | Locked |
| not verified | KYC pending | `ntibiranemezwa` | Locked |
| verification | Driver document review process | `kwemeza` | Locked |
| dispute / disputed | A ride flagged for review | `biraburanishwa` | Translator's call — please confirm "biraburanishwa" reads correctly for a passive ride status |
| rating (n.) / score | Star rating (1–5) | `amanota` | Locked |
| reliability score | Driver reliability metric | Translator's call — not yet in user-facing copy |

## Vehicles

| English term | Definition | Expected Rwandan rendering | Status |
|---|---|---|---|
| bicycle (taxi) | Pedal bicycle taxi | `igare` (vehicle) / `igare rya tagisi` (vehicle as taxi service) | Locked |
| moto / motorcycle taxi | Motorbike taxi | `moto` / `moto tagisi` | Locked |
| e-moto / electric motorcycle taxi | Battery-electric motorbike taxi | `e-moto` | Locked |
| e-bike / electric bicycle taxi | Battery-electric bicycle taxi | `e-bike` | Locked |
| vehicle | Generic transport vehicle | `ikinyabiziga` | Locked |
| vehicle preference | Customer's preferred vehicle type | `icyifuzo cy'ikinyabiziga` | Locked |
| any vehicle | No preference | `ikinyabiziga icyo ari cyo cyose` | Locked |
| electric (label) | Powered by electricity | `amashanyarazi` | Locked |
| zero emission | No exhaust emissions | `nta mwotsi` | Locked |
| helmet | Protective helmet (legally required) | `ingofero` | Locked |
| plate (number) | License plate | `ipurake` | Translator's call — please confirm; this looks like a transliteration |

## Payments

| English term | Definition | Expected Rwandan rendering | Status |
|---|---|---|---|
| RWF | Rwandan Franc | `RWF` | Do not translate |
| MoMo / MoMo Pay | MTN Mobile Money | `MoMo` | Do not translate |
| pay (verb) | Pay for a ride | `kwishyura` | Locked |
| payment | Payment transaction | `ubwishyu` / `kwishyura` | Locked |
| insufficient funds | Account balance too low | `amafaranga ntahagije` | Locked |
| top up | Add money to MoMo balance | `ongera amafaranga` | Locked |
| receipt | Ride receipt | `inyemezabwishyu` | Locked |
| refund | Money returned to customer | Translator's call — not yet in user-facing copy |

## Roles

| English term | Definition | Expected Rwandan rendering | Status |
|---|---|---|---|
| customer | The person requesting a ride | `umukiriya` | Locked |
| driver | The person providing the ride | `umushoferi` | Locked |
| passenger | The person being transported (during the ride) | `umugenzi` | Locked |
| recipient (goods) | Person receiving delivered goods | `uwakiriye` | Locked |
| sender (goods) | Person sending goods | Translator's call — not yet in user-facing copy |

## Geography

| English term | Definition | Expected Rwandan rendering | Status |
|---|---|---|---|
| pickup (location) | Where the ride starts | `aho uva` (where you come from) | Locked |
| destination | Where the ride ends | `aho ujya` (where you are going) | Locked |
| pickup goods (verb) | Driver collecting goods from sender | `gufata ibintu` | Locked |
| delivery | Handing goods to recipient | `gutanga ibintu` | Locked |
| landmark | A named place used for orientation | Translator's call — not yet in user-facing copy |
| use my current location | GPS pickup helper | `koresha aho ndi ubu` | Locked |

## Safety

| English term | Definition | Expected Rwandan rendering | Status |
|---|---|---|---|
| emergency | Safety incident requiring immediate help | `ubutabazi` | Locked |
| EMERGENCY (panic button label) | Big red button | `UBUTABAZI` (uppercase) | Locked |
| emergency contacts | People notified by panic button | `abo guhamagara mu bihe bikomeye` | Translator's call — please review for naturalness; current rendering literally means "people to call in serious times" |
| interrupt (a ride) | Stop a ride mid-journey | `guhagarika urugendo` | Locked |
| GPS / GPS tracking | Location tracking for safety | `GPS` | Do not translate |
| plausibility | Internal anti-fraud check | n/a — not user-facing |

## Brand & UX

| English term | Definition | Expected Rwandan rendering | Status |
|---|---|---|---|
| Bimoto | Product name | `Bimoto` | Do not translate |
| tagline | "Your ride, your price" | `Urugendo rwawe, igiciro cyawe` | Locked |
| OTP / verification code | One-time SMS code | `kode yo kwemeza` | Locked |
| log in | Authenticate | `injira` | Locked |
| log out | End session | `sohoka` | Locked |
| register / sign up | Create an account | `iyandikishe` | Locked |
| settings | App settings screen | `igenamiterere` | Locked |
| profile | User profile screen | `umwirondoro` | Locked |
| nickname | Display name | `izina rikuriho` | Locked |

## Register and tone

- **Address form.** The current copy uses the informal singular `wowe` / `-wa-`
  / `-wawe` form (e.g., `igiciro cyawe`, `urugendo rwawe`). Please confirm this
  is appropriate for a consumer transport app, or propose a switch to the
  polite-formal form. The choice must be applied consistently across all
  strings.
- **Brevity.** Mobile-first; prefer shorter renderings when accuracy is
  preserved. Buttons should ideally fit on one line on a 360px-wide screen.
- **Calques.** Avoid word-for-word transliterations of English idiom. If a
  natural Kinyarwanda expression conveys the same meaning, prefer it even when
  it diverges from the English wording.
