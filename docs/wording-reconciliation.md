# TRUE-WORDS — wording reconciliation

**Source of record:** "APP TRANSLATED WORDING CORRECTIONS", 13 Aug 2026 (Trello).
The team reviewed build `5226c5c` (v11/v12). This repository is five merges
further on (`9a86d69`). This document reconciles every action row of that
review against the strings that exist **today**, before any of them is
applied — so the team can see which of their corrections landed, which had
already landed, and which no longer target a live string.

**Vocabulary decision applied on top** (Trello item 1, founder decision,
12 Aug 2026):

| role | EN | RW | FR |
| --- | --- | --- | --- |
| moto | Driver | Umumotari | Chauffeur |
| bicycle | Cyclist | Umunyonzi | Cycliste |
| customer | Passenger | Umugenzi | Passager |

Where the review's corrected **English** says "rider(s)", the decided
vocabulary wins. The review's own corrected **Kinyarwanda** in those rows
already says Umumotari/Umunyonzi, so this is an alignment with the team's
intent, not an override of it. Every such case is listed in
[§6 Nomenclature overrides](#6-nomenclature-overrides).

## 1. Actions

| action | meaning |
| --- | --- |
| **APPLY** | the current string matches the review's *in-app* column; the correction is applied |
| **ALREADY-APPLIED** | the current string already matches the review's *corrected* column; nothing to do |
| **DRIFTED** | the current string matches neither column; **reported only, never applied** |
| **SPLIT-NEEDED** | one key serves screens the review corrects differently |
| **NO-KEY** | the review's row has no live i18n target at all |

Counts are in [§7](#7-counts).

## 2. Row-by-row reconciliation

Column key: `EN` and `RW` carry the action for that half of the row
independently — a row whose English matched but whose Kinyarwanda had moved
on is `APPLY` / `DRIFTED`.

### A. Welcome and first screens

| # | review row | key | EN | RW | note |
| --- | --- | --- | --- | --- | --- |
| A1 | Welcome / Bimoto is the cooperative channel market place… | `welcome.screen1.body` | APPLY | APPLY | Heading `welcome.screen1.heading` already carries "Welcome to Bimoto" / "Murakaza neza kuri Bimoto", so only the body sentence is replaced. Nomenclature override — see N1. |
| A2 | Skip ‖ Simbuka | `welcome.skip` | — | ALREADY-APPLIED | RW is already "Simbuka". |
| A3 | Check Bimoto Driver ‖ Genzura Umushoferi wa Bimoto | `checkDriver.title` | APPLY | APPLY | EN kept as "Check a Bimoto driver" per the decided vocabulary (the review's corrected EN said "rider") — see N2. |
| A4 | User guide ‖ Uburyo bwo gukoresha → Amabwiriza | `guide.title` | — | SPLIT-NEEDED | Same key also serves the profile entry that row H4 corrects to "Imfashanyigisho y'ukoresha ino service". Resolved by splitting — see [§4](#4-splits). |
| A5 | Phone number ‖ Numero ya telephone → Andika numero ya telephone hano | `login.phoneLabel` | — | APPLY | The review corrects the RW **label** into an instruction while leaving EN as "Phone number"; applied as written. The format hint `login.phonePlaceholder` ("7XX XXX XXX") is untouched. Queued for native review because EN and RW now differ in kind. |
| A6 | Send Code ‖ Ohereza → Ohereza Kode | `auth.send_otp`, `login.sendCode` | — | ALREADY-APPLIED | Both already read "Ohereza kode"; the review's capital K on "Kode" is not applied (sentence case is the file's convention). |

### B. Role and vehicle registration

| # | review row | key | EN | RW | note |
| --- | --- | --- | --- | --- | --- |
| B1 | I need rides → As passenger ‖ Ndatwara → Nk'umugenzi | `register.roleCustomer` | APPLY | APPLY | RW-in-app "Ndatwara" is on the *driver* row (B2) in the live build; the review's RW columns for B1/B2 are swapped relative to HEAD. Applied to the semantically correct rows. |
| B2 | I drive → As a driver ‖ → Nk'umumotari/Nk'umunyonzi | `register.roleDriver` | APPLY | APPLY | |
| B3 | Both ‖ Ururimi → Byombi | `register.roleBoth`, `auth.role_both` | — | ALREADY-APPLIED | Both already read "Byombi". The review's in-app "Ururimi" is the *Language* label (`auth.language_label`), a mis-pairing in the source table. |
| B4 | Vehicle information ‖ RW → Amakuru y'ikinyabiziga | `register.vehicleInfo` | — | ALREADY-APPLIED | |
| B5 | Vehicle type ‖ → Ubwoko bw'ikinyabiziga/ikinyamitende | `register.vehicleType` | — | APPLY | Distinct from the booking-form label `journey.vehicleType`, which row E9 corrects differently. No split needed. |
| B6 | Bicycle Taxi ‖ Igare rya Tagisi → Igare | `vehicles.bike` | — | APPLY | |
| B7 | Moto Taxi ‖ Moto Tagisi → Moto | `vehicles.moto` | — | APPLY | |
| B8 | E-Moto Taxi ‖ E-moto tagisi → Moto y'amashanyarazi | `vehicles.emoto` | — | APPLY | |
| B9 | E-Bike Taxi ‖ E-bike tagisi → Igare ry'amashanyarazi | `vehicles.ebike` | — | APPLY | |
| B10 | Moto taxi drivers: … → Moto taxi drivers requirements: … | `vehicles.motoRegistrationHint` | APPLY | APPLY | |

### C. Consent, privacy, terms

| # | review row | key | EN | RW | note |
| --- | --- | --- | --- | --- | --- |
| C1 | Privacy heading ‖ RW → Amakuru yawe, umutekano wawe | `legal.privacyTitle` | — | APPLY | |
| C2 | Data-collection paragraph (EN ok) ‖ RW per doc | `legal.privacyText` | — | APPLY | |
| C3 | Terms of Service → Terms and Services | `legal.termsTitle` | APPLY | — | RW "Amabwiriza y'ikoreshwa" unchanged (the review marked RW ok). |

### D. Parcel / goods flow

| # | review row | key | EN | RW | note |
| --- | --- | --- | --- | --- | --- |
| D1 | Send a parcel → Send a package ‖ Ohereza ipaki → Ohereza umuzigo. | `home.sendParcel` | APPLY | APPLY | Trailing full stop in the review's RW dropped (it is a button label). |
| D2 | Only the package travels… | `home.sendParcelHint` | — | APPLY | |
| D3 | Send goods → Send package ‖ Kohereza ibintu → Kohereza umuzigo | `goods.title` | APPLY | APPLY | |
| D4 | Delivery speed ‖ Umuvuduko kugeza ipaki → Kohereza umuzigo mu buryo bwihuse | `delivery.speedLabel` | — | DRIFTED | Live RW is "Umuvuduko wo gutanga" — neither column. The two-tier speed picker (#160/#161) rewrote this key after the review. Reported only. |
| D5 | Standard tier label ‖ Bisanzwe igiciro gisanzwe → Ntabwo byihutirwa | `goods.tierNormal` | — | APPLY | The in-app RW identifies the **urgency-tier** control ("Bisanzwe · igiciro gisanzwe"), not the delivery-speed control ("Bisanzwe"). |
| D6 | Express tier label ‖ → Byihuse (Vuba vuba) | `delivery.speedExpress` | — | APPLY | |
| D7 | Two options only (Standard/Express) with hours 1/2/3 | `delivery.speed*`, `delivery.standardHours*` | ALREADY-APPLIED | ALREADY-APPLIED | **Verified at HEAD:** `GoodsRequestPage.tsx:46-47` offers exactly STANDARD and EXPRESS, and `:86` carries the 1/2/3-hour window. Shipped in #160/#161. Not re-done. |
| D8 | When do you need the package ‖ Ukeneye umuzigo ryari? | `goods.tierLabel` | APPLY | APPLY | EN "How urgent is this parcel?" → "When do you need the package?". Pairs with D5. |
| D9 | Your price (optional) ‖ RW → Igiciro cy'umuzigo (Shyiramo igiciro cyangwa utegereze igiciro cy'umumotari) | `journey.wishPricePlaceholder` | APPLY | APPLY | Superseded by the placeholder convention — see [§5](#5-global-conventions). The review's long RW hint is preserved as the field's helper text, not as the faded hint. |
| D10 | Goods details → Package details ‖ Amakuru y'ibyoherezwa → Ibigize umuzigo | `goods.details` | APPLY | APPLY | |
| D11 | Description ‖ Ibisobanuro → Ubusobanuro | `goods.description` | — | APPLY | |
| D12 | What is being sent ‖ Urohereza iki? → Wohereje iki | `goods.descriptionPlaceholder` | — | APPLY | |
| D13 | Small ‖ Bito → Umuzigo muto | `goods.size_small` | — | APPLY | |
| D14 | Medium ‖ Bisanzwe → Umuzigo uringaniye | `goods.size_medium` | — | APPLY | |
| D15 | Large ‖ Binini → Umuzigo munini | `goods.size_large` | — | APPLY | |
| D16 | Fragile ‖ Bisenyeka → Birameneka | `goods.fragile` | — | APPLY | |
| D17 | Recipient placeholder → Write here ‖ Andika hano | `goods.recipientNamePlaceholder` | APPLY | APPLY | The faded hint repeated the label. `urgent.recipientPlaceholder` ("Who receives the parcel?") is a question, not a label repeat, and is left alone. |
| D18 | Drop a package on the way ‖ Tanga ifunika mu nzira → Siga umuzigo mu nzira | `delivery.addStopToggle` | — | APPLY | Live RW differs only by the space in "munzira". |

### E. Customer home, nav, new journey

| # | review row | key | EN | RW | note |
| --- | --- | --- | --- | --- | --- |
| E1 | Hello. What do you need today ‖ → Muraho. Turabafasha iki uyu munsi | — | NO-KEY | NO-KEY | `CustomerHomePage.tsx:56` renders `home.title` alone; no greeting string exists in the build. Row E2 is the live match. The greeting variant is reported to the team, not invented. |
| E2 | What do you need today? ‖ → Turagufasha iki uyu munsi | `home.title` | — | APPLY | |
| E3 | Request-a-ride explainer | `home.requestRideHint` | APPLY | APPLY | |
| E4 | Send-a-parcel explainer | `home.sendParcelHint` | — | APPLY | Same key as D2; the two rows agree. |
| E5 | Book now / Leave Now ‖ Genda nonaha → Tugende Nonaha | `scheduled.leaveNow` | ALREADY-APPLIED | APPLY | EN already "Leave now". |
| E6 | Schedule → Book for later ‖ Gena Igihe → Teganya urugendo | `scheduled.scheduleLater` | APPLY | APPLY | |
| E7 | Pickup Time → Departure Time ‖ → Igihe cyo guhaguruka | `scheduled.pickupTimeLabel` | APPLY | APPLY | |
| E8 | Pickup → Departure Point ‖ → Hitamo aho uva | `journey.pickup` | APPLY | APPLY | |
| E9 | Vehicle Type → Preferred Vehicle ‖ → Ikinyabiziga/Ikinyamitende ushaka kugendaho | `journey.vehicleType` | APPLY | APPLY | |
| E10 | Schedule ride → Confirm Ride ‖ Gena urugendo → Emeza Urugendo | `scheduled.submit` | APPLY | APPLY | |
| E11 | Where to? → Where are you going to? ‖ Shyiraho aho ugiye → Emeza aho ugiye | `journey.destinationPlaceholder` | APPLY | DRIFTED | Live RW is "Ugiye he?" — neither column, though it already means "Where are you going?". EN applied, RW reported. |
| E12 | Book now (route) ‖ Genda nonaha → Saba urugendo nonaha | — | NO-KEY | NO-KEY | "Genda nonaha" exists on exactly one key (`scheduled.leaveNow`, taken by E5). No second surface renders it. Conflicting correction reported, not applied. |
| E13 | Pickup location ‖ Aho uva → Aho unsanga | `picker.pickup` | — | APPLY | The map-pin picker's mode toggle. First-person RW ("where you find me") fits the pin picker; the form label is E8. |
| E14 | Destination ‖ Aho ujya → Aho Ugana | `journey.destination` | — | APPLY | Form label. |
| E15 | Destination ‖ Aho ujya → Aho njya | `picker.destination` | — | APPLY | Map-pin picker toggle, matching E13. |
| E16 | Your price (rwf) ‖ Igiciro cyawe (RW ok) | `journey.wishPrice` | — | ALREADY-APPLIED | |
| E17 | Your price optional → drop "(optional)"; faded inputs → Write here | `journey.wishPricePlaceholder` | APPLY | APPLY | See [§5](#5-global-conventions). |
| E18 | Drivers see this as your suggested price ‖ → Igiciro umumotari/umunyonzi abona | `journey.wishPriceHelper` | — | APPLY | |
| E19 | Find drivers ‖ Shakisha abashoferi → Shakisha umumotari/Umunyonzi | `journey.findDrivers` | — | APPLY | Live RW "Shaka abashoferi" differs from the in-app column by one verb form; treated as the same string. |
| E20 | New passenger Ride → New ride ‖ → Urugendo rushya rw'umugenzi | `journey.newRide` | APPLY | ALREADY-APPLIED | |
| E21 | Nav: Requests → Book ‖ Ubusabe (RW ok) | `nav.requests` | APPLY | ALREADY-APPLIED | |
| E22 | Nav: Scheduled → Book for later ‖ Zagenwe → Ibyateganyijwe | `nav.scheduled` | APPLY | APPLY | |
| E23 | Nav: My rides → My Journey ‖ Ingendo zanjye → Urugendo Rwajye | `nav.myRides`, `history.title` | APPLY | APPLY | The review's corrected EN is singular where the live label is plural; applied as written and flagged for the team. |
| E24 | Tap on a map to drop a pin ‖ RW ok | `picker.tapHint` | ALREADY-APPLIED | ALREADY-APPLIED | Verified only. |

### F. Offers / bid list (customer)

| # | review row | key | EN | RW | note |
| --- | --- | --- | --- | --- | --- |
| F1 | Go Back ‖ Bubira inyuma → Subira inyuma | `common.goBack` | — | ALREADY-APPLIED | |
| F2 | Rating ‖ Amanota → Ikigereranyo | `bids.sortRating` | — | APPLY | Scoped to the offer-list sort control. `profile.rating` and the `rating.*` namespace are different surfaces the review did not cover. |
| F3 | Arrival ‖ Igihe azagerera → Kuhagera | `bids.sortEta` | — | APPLY | |
| F4 | Waiting for drivers to make offers… | `bids.waitingForDrivers` | — | APPLY | |
| F5 | Offers appear here on their own → …instantly | `bidList.state.liveHint` | APPLY | APPLY | |
| F6 | New driver ‖ Umushoferi mushya → Umumotari mushya | `bid.new_driver`, `reliability.newDriver` | — | APPLY | |

### G. Payment (customer) and tracking

| # | review row | key | EN | RW | note |
| --- | --- | --- | --- | --- | --- |
| G1 | Payment held in escrow → held in system | `transparency.paymentHeldInEscrow` | APPLY | APPLY | The only passenger-visible "escrow" string. See [§5](#5-global-conventions). |
| G2 | Platform fee: … RWF (10.0%) — wording ok | `transparency.platformFeeAmount` | ALREADY-APPLIED | ALREADY-APPLIED | Verified only. |
| G3 | Driver receives: … ‖ Umumotari/Umunyonzi ahabwa: … | `transparency.driverReceives` | — | APPLY | |
| G4 | LIVE DRIVER TRACKING → …ON MAP | `matched.liveTracking` | APPLY | APPLY | |
| G5 | New driver ‖ Umumotori/umunyonzi mushya | `bid.new_driver`, `reliability.newDriver` | — | ALREADY-APPLIED | Duplicate of F6. The review's "Umumotori" is a typo, normalised to "Umumotari" and queued for native review. |

### H. Profile, settings, offline map

| # | review row | key | EN | RW | note |
| --- | --- | --- | --- | --- | --- |
| H1 | Offline-map copy | `map.offline.description` | ALREADY-APPLIED | APPLY | EN already says "Keep the … map on this phone…". |
| H2 | Download ‖ kuvugurura → Bika muri telefone yawe | `map.offline.download` | — | DRIFTED | Live RW for Download is "Kurura"; "Kuvugurura" is now the *Update* button (`map.offline.update`). The review's row conflates the two. Reported only. |
| H3 | payments ‖ ubwishyu → Ubwishyu | `payments.title` | — | ALREADY-APPLIED | |
| H4 | User guide ‖ → Imfashanyigisho y'ukoresha ino service | `guide.title` (split) | — | SPLIT-NEEDED | See [§4](#4-splits). |
| H5 | Settings ‖ Igenamiterere (case) | `settings.title` | — | ALREADY-APPLIED | |
| H6 | Emergency contact ‖ Kontaki z'ubutabazi → Uwahamagarwa mu gihe havutse ikibazo | `profile.emergencyContacts`, `profile.emergency_contacts`, `settings.emergencyContacts` | — | APPLY | |
| H7 | logout ‖ sohoka → sohokamo | `settings.logout` | — | APPLY | |
| H8 | Simulation - No real money ‖ Igeragezwa - nta mafaranga nyayo | `simulation.banner` | APPLY | ALREADY-APPLIED | EN takes J2's "No real money is used."; RW already reads "IGERAGEZWA — nta mafaranga nyayo". |

### I. User guide (rewritten passages)

| # | review row | key | EN | RW | note |
| --- | --- | --- | --- | --- | --- |
| I1 | Request a Ride passage | `guide.ride.body` | APPLY | APPLY | |
| I2 | Send a parcel passage | `guide.parcel.body` | APPLY | APPLY | Tier naming aligned to the shipped Standard/Express ("Byihuse"), per the review's own note. |
| I3 | Offers heading ‖ Ibitangwa no guhitamo umumotari → Ibiciro no guhitamo umumotari | `guide.bidding.title` | — | ALREADY-APPLIED | Live RW already "Ibiciro n'ihitamo ry'umushoferi"; only the Umushoferi→Umumotari sweep applies. |
| I4 | Offers passage | `guide.bidding.body` | APPLY | APPLY | |
| I5 | SOS passage (passenger) | `guide.sos.body` | APPLY | APPLY | Describes the **passenger** SOS button, which is accurate today. No driver-SOS copy invented (Trello item 14 is open). |
| I6 | Chat/support passage | `guide.help.body` | APPLY | APPLY | |

### J. Driver: requests, dashboard, stats

| # | review row | key | EN | RW | note |
| --- | --- | --- | --- | --- | --- |
| J1 | Simulation → Experiment ‖ Igereranya → Igerageza | — | NO-KEY | DRIFTED | No live string reads "Igereranya". EN "Simulation" is kept (the review's "Experiment" suggestion is flagged, not applied — see [§8](#8-flags-for-the-teams-next-pass)). |
| J2 | No real Money → No real money is used. | `simulation.banner` | APPLY | — | Merged with H8. |
| J3 | Connected ‖ Urahujwe → Ndi ku murongo | `sync.connected` | — | APPLY | |
| J4 | Offline ‖ Sindi ku kazi → Si ndi ku murongo | `dashboard.imOffline` | — | APPLY | `dashboard.imOnline` ("Ndi ku kazi") is its pair and moves with it — see [§8](#8-flags-for-the-teams-next-pass). |
| J5 | View account status ‖ → Reba imiterere ya konti | `account.viewAccount` | — | APPLY | |
| J6 | Acceptance rate | `driver.stats.acceptanceRate` | — | APPLY | |
| J7 | AVG acceptance time | `driver.stats.avgAcceptanceTime` | — | APPLY | |
| J8 | Completion rate | `driver.stats.completionRate` | — | APPLY | |
| J9 | Weekly earnings | `driver.stats.weeklyEarnings` | — | APPLY | |
| J10 | View more stats ‖ → Reba izindi raporo | `driver.stats.showMore` | — | APPLY | The ▼ glyph is kept. |
| J11 | 4 week earnings trend | `driver.stats.earningsTrendTitle` | — | APPLY | |
| J12 | Go online to see nearby requests | `dashboard.goOnline` | — | APPLY | |
| J13 | How you compare in your vehicle type | `driver.stats.cohortBreakdownTitle` | — | APPLY | The review's RW is elided; the "/ikinyamitende" insertion is applied to the live sentence. |
| J14 | MOTO cohort label → MOTO / IGARE | — | NO-KEY | NO-KEY | `CohortBreakdown.tsx:66` renders the raw server vehicle-type enum, not an i18n key. Merging MOTO and IGARE into one label would also merge two cohorts — a product decision, not a wording fix. Reported. |
| J15 | 19 drivers in cohort | `driver.stats.cohortSize` | — | APPLY | RW via the Umushoferi→Umumotari sweep. |
| J16 | No Scheduled Rides Yet | `scheduled.driverListEmpty` | — | APPLY | |
| J17 | Rides you Commit to in Advance will Appear here | `scheduled.driverListEmptyHint` | — | APPLY | The review's RW covers the first sentence; the second sentence (bidding opens 60 min before pickup) post-dates the review and is kept. |
| J18 | Sms Inbox → Inbox messages ‖ Ubutumwa bwa sms → Ubutumwa Bugufi | `simulation.inboxLink` | APPLY | APPLY | |

### K. Driver: payments

| # | review row | key | EN | RW | note |
| --- | --- | --- | --- | --- | --- |
| K1 | Earned today ‖ → Amafaranga winjije uyu munsi | `payout.title` | — | APPLY | |
| K2 | Earned ‖ yinjijwe → Ayo wakoreye | `payout.balanceLabel` | — | APPLY | Merged with K3 — one key carries both halves. |
| K3 | waiting to be paid ‖ → Agomba kwishyurwa | `payout.balanceLabel` | — | APPLY | |
| K4 | Nothing yet today ‖ → Nta mafaranga arageramo | `payout.emptyBalance` | — | APPLY | Merged with K5. |
| K5 | money from completed rides shows up here | `payout.emptyBalance` | — | APPLY | |
| K6 | Your first payouts arrive automatically twice a day (0/3 shifts done)… | `payout.trainingWheelsExplainer` | ALREADY-APPLIED | ALREADY-APPLIED | The live RW already says "imirimo 3" (three shifts), consistent with EN — the review's "amasaha atatu" concern does not reproduce at HEAD. Queued for native review anyway. |
| K7 | Lands in your MOMO wallet at 18:00 | `payout.landsAt` | — | APPLY | The `{{time}}` token replaces the review's literal 18:00. |
| K8 | Pay me now ‖ Wishyure nonaha → Wishyura nonaha | `payout.payMeNow` | — | DRIFTED | Live RW is "Nyishyura nonaha" — neither column. Reported only. |

### L. Driver: offer popup, bid page, cancel, chat

| # | review row | key | EN | RW | note |
| --- | --- | --- | --- | --- | --- |
| L1 | Confirm your offer ‖ Emeza ituro ryawe → Emeza ubusabe bwawe | `transparency.confirmOffer` | — | APPLY | |
| L2 | This price is fixed… | `transparency.priceBinding` | APPLY | APPLY | |
| L3 | Submit offer ‖ Ohereza ituro → Ohereza igiciro | `transparency.submitOffer` | — | APPLY | `bid.submitOffer` already reads "Ohereza igiciro" → ALREADY-APPLIED. |
| L4 | Customer commission ‖ Amakomisiyo y'umukiriya → komisiyo y'umukiriya | `transparency.customerCommission` | — | APPLY | `transparency.driverCommission` moves in parallel — see [§8](#8-flags-for-the-teams-next-pass). |
| L5 | You will receive ‖ Uzahabwa → Urakira | `transparency.youWillReceive` | — | APPLY | |
| L6 | Exact amount depends on customer's tier… | `transparency.exactAmountDependsOnCustomer` | — | APPLY | |
| L7 | Cancel/chat screens marked ok | `matched.cancel*`, `chat.*` | ALREADY-APPLIED | ALREADY-APPLIED | Verified only; no edits beyond the Umushoferi→Umumotari sweep. |

## 3. Enumerations required by the dispatch

### 3.1 Every EN key containing rider/Rider

Four, exactly as the decided sweep predicted:

| key | value | disposition |
| --- | --- | --- |
| `emergency.adminBannerTitle` | "Emergency — rider needs help" | → "passenger" |
| `emergency.adminRiderPhone` | "Rider phone" | → "Passenger phone" (key name unchanged — renaming it would touch the admin surface's call sites for no user-visible gain) |
| `screener.help.is18OrOlder` | "Bimoto is for riders aged 18 and over…" | → "drivers and cyclists" (the screener addresses applicants, not passengers) |
| `transparency.rideReceipt` | "Ride Receipt" | **not** a match — "Ride" is not "rider". Untouched. |

Eight further EN keys carry the Kinyarwanda word "motari" inside English
copy. The decided EN vocabulary is Driver, so they move too:
`journey.describePlaceHelp`, `guide.children.body`,
`payment.recover.driverHeld`, `childTravel.toggleHelper`,
`delivery.speedExpressDesc`, `delivery.standardHoursNote`,
`bids.yourBidDeclined`, `bidList.state.expiredBody`.

### 3.2 Faded placeholder keys — the convention's blast radius

27 keys in the EN locale end in `Placeholder` (or are `chat.placeholder` /
`parcelWeight.placeholder`). Only **two** are faded hints that merely repeat
their field label and carry no format, example, or question:

* `goods.recipientNamePlaceholder` — "Recipient name", under the label "Recipient name"
* `journey.wishPricePlaceholder` — "Your price (optional)", under the label "Your price (RWF)"

Both become "Write here" / "Andika hano" / "Écrivez ici". The other 25 keep
their content, because each carries information the convention would
destroy:

* **format hints** — `login.phonePlaceholder`, `goods.recipientPhonePlaceholder`, `urgent.recipientPhonePlaceholder`, `profile.contactPhonePlaceholder`, `settings.contactPlaceholder`, `payout.codePlaceholder`
* **examples** — `journey.describePlacePlaceholder`, `bid.etaPlaceholder`, `bid.pricePlaceholder`, `child.agePlaceholder`, `delivery.stopNamePlaceholder`, `checkDriver.inputPlaceholder`, `register.nicknamePlaceholder`, `register.platePlaceholder`, `register.vehicleDescriptionPlaceholder`, `urgent.descriptionPlaceholder`
* **questions / actions** — `journey.destinationPlaceholder`, `journey.pickupPlaceholder`, `goods.descriptionPlaceholder`, `urgent.recipientPlaceholder`, `chat.placeholder`, `chat.inputPlaceholder`, `location.searchPlaceholder`, `parcelWeight.placeholder`, `inProgress.mapPlaceholder`

The review's own rows confirm this reading: it corrects
`goods.descriptionPlaceholder` ("What is being sent") *as a question* rather
than replacing it, and names only the recipient field for "Write here".

## 4. Splits

One split, from the collision between A4 and H4 — the review gives the
"User guide" label two different Kinyarwanda renderings depending on where it
appears:

| new key | surface | EN | RW |
| --- | --- | --- | --- |
| `guide.title` (existing) | the guide page's own heading, and the profile entry | User guide | Imfashanyigisho y'ukoresha ino service |
| `guide.welcomeLink` (new) | the welcome screen's link to the guide | User guide | Amabwiriza |

Net key growth: **+1**. Well under the ~30-key STOP threshold in §4 of the
dispatch.

## 5. Global conventions

| # | convention | mechanics |
| --- | --- | --- |
| M1 | Faded input placeholders → "Write here" / "Andika hano" | Applied to the two keys in [§3.2](#32-faded-placeholder-keys--the-conventions-blast-radius) via **per-field keys**, not one shared key. Reason: the placeholder text is already per-field-keyed, nine client test files mock these bundles path-by-path and query by placeholder text, and a shared `common.writeHere` would orphan two keys and force nine test rewrites for zero user-visible difference. The convention is documented here instead of in a key name. |
| M2 | "(optional)" dropped where the placeholder convention replaces it | Applied to `journey.wishPricePlaceholder` only — the one field where the label ("Your price (RWF)") and the faded hint ("Your price (optional)") repeated each other, which is the repetition the review names. Six other "(optional)" labels (`journey.describePlaceLabel`, `delivery.contactNameLabel`, `delivery.contactPhoneLabel`, `delivery.recipientLanguageLabel`, `delivery.standardHoursLabel`, `screener.questions.cooperativeAffiliation`) are genuinely-optional markers on fields with no repeating hint, and are left alone rather than editorialised away. |
| M3 | "escrow" → "held in system" | One passenger-visible string: `transparency.paymentHeldInEscrow`. `errors.escrowNotAdoptable` already reads "This ride's payment is already being processed." — no "escrow" in the copy; only the key name, which is server-contract and untouched. |
| M4 | Driver / Cyclist / Passenger — Umumotari / Umunyonzi / Umugenzi — Chauffeur / Cycliste / Passager | Applied on top of every row above. |
| M5 | RW "Umushoferi"/"Umumotori" → "Umumotari" (or "Umunyonzi" on bicycle surfaces) | 84 RW values carried a `shoferi` stem at HEAD. All are swept morphologically (`umushoferi`→`umumotari`, `abashoferi`→`abamotari`, `mushoferi`→`mumotari`, and the possessive-elided forms). Bicycle-specific surfaces and the rows where the review wrote "umumotari/umunyonzi" explicitly take the paired form. |
| M6 | Rows matching no live string | Reported as NO-KEY / DRIFTED above; never applied. |

## 6. Nomenclature overrides

Every place the decided vocabulary overrode the review's corrected English:

| # | row | review's corrected EN | shipped EN | why |
| --- | --- | --- | --- | --- |
| N1 | A1 (`welcome.screen1.body`) | "…connects riders, passengers, and courier delivery." | "…connects drivers, cyclists, passengers, and courier delivery." | "rider" is retired; the review's own corrected RW for this row already reads "abamotari, abanyonzi" — two words, not one — so the English gains the matching pair. |
| N2 | A3 (`checkDriver.title`) | "Check Bimoto rider" | "Check a Bimoto driver" | "rider" retired. The review's corrected RW ("Genzura Umumotari/Umunyonzi wa Bimoto") is applied verbatim. |
| N3 | §3.1 `emergency.adminBannerTitle` / `emergency.adminRiderPhone` | not in the review | "passenger" / "Passenger phone" | Decided-vocabulary sweep: these described the passenger, not a driver. |
| N4 | §3.1 `screener.help.is18OrOlder` | not in the review | "drivers and cyclists" | Decided-vocabulary sweep on an applicant-facing string. |
| N5 | §3.1, eight keys | not in the review | "motari" → "driver" in English copy | M4 requires the English role word to be Driver. The Kinyarwanda keeps "umumotari". |

## 7. Counts

Counting each review row once, and a row whose two halves differ by its
worse half:

| action | rows | share |
| --- | --- | --- |
| APPLY | 84 | 70.6 % |
| ALREADY-APPLIED | 24 | 20.2 % |
| DRIFTED | 5 | 4.2 % |
| SPLIT-NEEDED | 2 | 1.7 % |
| NO-KEY | 4 | 3.4 % |
| **total action rows** | **119** | |

**DRIFTED share: 4.2 %** — far below the 20 % threshold that would have
stopped this work. The review still targets this build.

The five DRIFTED rows, for the team's next pass:

1. **D4** `delivery.speedLabel` — in-app "Umuvuduko kugeza ipaki", now "Umuvuduko wo gutanga", corrected "Kohereza umuzigo mu buryo bwihuse".
2. **E11** `journey.destinationPlaceholder` (RW half) — in-app "Shyiraho aho ugiye", now "Ugiye he?", corrected "Emeza aho ugiye".
3. **H2** `map.offline.download` — in-app "kuvugurura", now "Kurura" (and "Kuvugurura" is a different button), corrected "Bika muri telefone yawe".
4. **J1** simulation label — in-app "Igereranya" exists nowhere at HEAD.
5. **K8** `payout.payMeNow` — in-app "Wishyure nonaha", now "Nyishyura nonaha", corrected "Wishyura nonaha".

## 8. Flags for the team's next pass

Applied as written but worth the team's eyes:

* **E23** — the review's corrected English "My Journey" is singular where the
  list it labels is plural ("Ingendo zanjye" → "Urugendo Rwajye" likewise).
  Applied verbatim; flag if the plural was intended.
* **A5** — `login.phoneLabel` now reads as an instruction in Kinyarwanda
  ("Andika numero ya telefone hano") while English stays a noun label
  ("Phone number"). Applied as written.
* **J1** — the review suggests renaming "Simulation" to "Experiment" in
  English. Not applied: "Simulation" appears in the pilot banner, the
  payment-simulation confirm, and the SMS-inbox link, and renaming the
  concept is a product call rather than a translation fix.
* **J4** — `dashboard.imOnline` ("Ndi ku kazi") is the pair of the corrected
  `dashboard.imOffline` ("Sindi ku kazi" → "Si ndi ku murongo"). Leaving it
  would strand the toggle in two idioms, so it moves to "Ndi ku murongo".
  This is an extension of the review, not one of its rows.
* **L4** — `transparency.driverCommission` ("Amakomisiyo y'umumotari") is the
  pair of the corrected `transparency.customerCommission`, and takes the same
  lower-case "komisiyo" treatment. Also an extension.
* **G5** — the review writes "Umumotori"; normalised to "Umumotari".
* **J14** — the cohort table renders the raw server vehicle-type enum. Giving
  it a "MOTO / IGARE" label needs a product decision about whether moto and
  bicycle drivers share one cohort.
* **E1 / E12** — two corrections whose in-app strings no longer exist. If the
  team still wants a greeting on the customer home screen, that is a new
  string, not a correction.

## 9. French, and how the review queue was fed

### 9.1 The queue mechanism

`docs/i18n-native-review-queue.md` is **generated**. `scripts/i18n-review/check.ts`
regenerates it in memory on every PR and fails CI when the committed file
differs, precisely so a hand-edit cannot survive. Its sanctioned input is
`scripts/i18n-review/notes.json`, so that is where this pass's queue entries
went:

* **158 `queueFlags` entries**, one per Kinyarwanda value this branch changed,
  each carrying `source: "TRUE-WORDS (PR #165, 2026-08-15)"` and a note that
  says *why* it changed, so a reviewer can triage rather than read 158 rows
  cold:
  * 88 **verbatim from the review** — the team's own Kinyarwanda. The question
    is transcription (the source PDF split words across lines), not translation.
  * 68 **mechanical sweep** — changed only because Umushoferi became Umumotari.
    The question is noun class and agreement.
  * 2 **extensions** — `dashboard.imOnline` and
    `transparency.driverCommission`, moved to stay coherent with their
    corrected pairs.
  * plus `payout.trainingWheelsExplainer`, flagged although its value did not
    change, because the review raised a question about it that HEAD answers
    differently.
* **One `carriedOverGuidance` block**, dated 2026-08-15, explaining the pass,
  the paired-form question ("umumotari/umunyonzi" in a button label is faithful
  to the document but costs UX), and pointing at the French list below.

The two new keys (`guide.welcomeLink`, `goods.wishPriceHelper`) reach the queue
on their own — the generator lists everything added since the review baseline.

### 9.2 French keys changed (55)

French is mechanical in this pass, per the dispatch. A French speaker should
see all of it next round.

**Vocabulary sweep only (26)** — the decided French role word is Chauffeur, so
"conducteur" and the Kinyarwanda "motari" leave French copy. No other change:

`journey.describePlaceHelp`, `guide.children.body`, `errors.notAssignedDriver`,
`errors.driverNotVerified`, `driver.revokedNotice`, `verification.driverNumber`,
`verification.dashboardBannerTitle`, `payment.recover.driverHeld`,
`childTravel.toggleHelper`, `delivery.speedExpressDesc`,
`delivery.standardHoursNote`, `checkDriver.title`, `checkDriver.subtitle`,
`checkDriver.inputLabel`, `checkDriver.active`, `checkDriver.inactive`,
`scheduled.biddingOpensAt`, `scheduled.fallbackNote`, `scheduled.conflictTitle`,
`scheduled.conflictBody`, `scheduled.chooseAnotherDriver`,
`scheduled.acceptAnywayFailed`, `bids.yourBidDeclined`,
`payments.status.RELEASED`, `payments.howItWorks`, `bidList.state.expiredBody`

**Rewritten because the meaning changed (29):**

| key | new French |
| --- | --- |
| `welcome.screen1.body` | Bimoto est l'application de transport qui met en relation chauffeurs, cyclistes, passagers et livraison de colis. |
| `nav.requests` | Réserver |
| `nav.scheduled` | Réserver plus tard |
| `nav.myRides` | Mon trajet |
| `history.title` | Mon trajet |
| `journey.pickup` | Point de départ |
| `journey.newRide` | Nouvelle course |
| `journey.vehicleType` | Véhicule souhaité |
| `journey.wishPricePlaceholder` | Écrivez ici |
| `goods.recipientNamePlaceholder` | Écrivez ici |
| `goods.tierLabel` | Quand avez-vous besoin du colis ? |
| `goods.tierNormal` | Pas urgent · tarif standard |
| `goods.wishPriceHelper` | Fixez un prix pour le colis, ou attendez le prix du chauffeur |
| `guide.welcomeLink` | Guide d'utilisation |
| `guide.ride.body` | Appuyez sur « Demander une course » sur l'écran d'accueil, saisissez votre point de départ et votre destination, puis envoyez votre demande. Un chauffeur viendra ensuite vous chercher. |
| `guide.parcel.body` | Appuyez sur « Envoyer un colis », saisissez les lieux de retrait et de livraison, puis donnez les détails du colis et du destinataire. Le chauffeur récupère le colis et le livre — vous ne voyagez pas avec. Pour une livraison plus rapide, choisissez l'option Express. |
| `guide.bidding.body` | Après l'envoi de votre demande, les chauffeurs proches répondent avec leur tarif. Comparez les prix, les notes et les heures d'arrivée estimées, puis acceptez l'offre que vous préférez. Vous pouvez aussi proposer votre propre tarif — utilisez l'indication de prix équitable pour voir ce que coûtent des trajets similaires. |
| `guide.help.body` | Pendant un trajet, utilisez la discussion intégrée pour communiquer avec votre chauffeur. Pour tout le reste, contactez l'équipe d'assistance Bimoto à un stand pilote ou via votre contact local — ils peuvent revoir n'importe quel trajet avec vous. |
| `matched.liveTracking` | Suivi du chauffeur en direct sur la carte |
| `vehicles.motoRegistrationHint` | Conditions requises pour les chauffeurs de moto-taxi : permis catégorie A, autorisation RURA, adhésion à une coopérative et assurance. |
| `simulation.banner` | SIMULATION — aucun argent réel n'est utilisé |
| `simulation.inboxLink` | Messages reçus |
| `transparency.priceBinding` | Ce prix est fixe. S'il est accepté, le trajet sera effectué à ce prix. |
| `transparency.paymentHeldInEscrow` | Le paiement est conservé dans le système jusqu'à confirmation d'arrivée. |
| `screener.help.is18OrOlder` | Bimoto est réservé aux chauffeurs et cyclistes de 18 ans et plus. Nous ne pouvons pas vous intégrer en dessous de cet âge. Les candidats de moins de 18 ans peuvent rejoindre l'équipe projet dans un autre rôle. |
| `scheduled.scheduleLater` | Réserver plus tard |
| `scheduled.pickupTimeLabel` | Heure de départ |
| `scheduled.submit` | Confirmer la course |
| `register.roleCustomer` | En tant que passager |
| `register.roleDriver` | En tant que chauffeur |
| `bidList.state.liveHint` | Les offres s'affichent ici instantanément — inutile d'actualiser. |

**Left alone deliberately.** French was not touched where only the Kinyarwanda
phrasing moved and the French does not contradict it — the payout screen, the
driver stats labels, the emergency-contact labels, the offline-map description,
`login.phoneLabel` (which stays a noun label in French, matching English rather
than the review's Kinyarwanda instruction), and `legal.termsTitle` (English
"Terms of Service" → "Terms and Services" is a phrasing change, not a meaning
change; "Conditions d'utilisation" still fits).
