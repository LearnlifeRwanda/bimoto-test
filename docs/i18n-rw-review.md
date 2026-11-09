# Bimoto Kinyarwanda Bilingual Review

> **Translator:** fill in the **Reviewer's RW** column for every row.
> Use the **Note** column for uncertainty, glossary disputes, or UX flags
> (see `docs/i18n-translator-brief.md` and `docs/i18n-glossary.md`).

> **This file is generated. Do not edit it by hand** — run `pnpm i18n:review`
> and your edit is gone. It is rewritten whole from the locale files on every
> run, and CI fails a PR that adds a string without regenerating it, so what
> you read below is what the app ships. Translator prose that must survive a
> regeneration lives in `scripts/i18n-review/notes.json`.

## What this file audited

| | |
|---|---|
| English keys | 1615 |
| French keys | 1615 |
| Kinyarwanda keys | 1615 |
| Canned chat phrases (`QUICK_MESSAGES`) | 91 |
| Kigali landmarks (`KIGALI_LANDMARKS`) | 238 |
| Namespaces | 84 |
| New since the review baseline | 592 |
| Kinyarwanda identical to English | 30 |
| Generator last run | 2026-08-26 at commit `b2a2fe0` |
| Sources digest | `ed3dd35963f2173d` |

Sources read (as text, on every run):

- `packages/client/public/locales/en/translation.json`
- `packages/client/public/locales/fr/translation.json`
- `packages/client/public/locales/rw/translation.json`
- `packages/shared/src/constants/quick-messages.ts`
- `packages/shared/src/constants/locations.ts`

## Key parity

- Every one of the 1615 English keys exists in French.
- Every one of the 1615 English keys exists in Kinyarwanda.
- Kinyarwanda carries no keys English lacks.

The parity gate `packages/client/src/__tests__/i18n-parity.test.ts` fails CI on any of the above, so a missing key is caught before it reaches this file.

## How to read the Flags column

| Flag | Meaning |
|------|---------|
| **NEW** | Added since the review baseline (`e28cd92`). No native speaker has seen it yet — review these first. |
| `same-as-EN: brand` | The rw value is byte-identical to the en value. A product or service name that keeps its own spelling in every language. Intentional — nothing to do. |
| `same-as-EN: needs-decision` | The rw value is byte-identical to the en value. The generator will not guess. A native speaker decides whether the English word is the natural Kinyarwanda rendering or a gap. |
| `same-as-EN: placeholder` | The rw value is byte-identical to the en value. No prose at all — interpolation slots, digits, a phone or code mask, a unit. Intentional — nothing to do. |
| `same-as-EN: proper-noun` | The rw value is byte-identical to the en value. A name: language endonym, place, organisation. Intentional — nothing to do. |
| `same-as-EN: untranslated` | The rw value is byte-identical to the en value. Confirmed English text still shipping in the rw file. Needs a translation. |
| **STUB** | The Kinyarwanda value is a placeholder marker, not a translation. Always a gap. |

30 rows are byte-identical to their English source. Most are supposed to be; the category says which, and `needs-decision` marks the ones no rule can settle. They are listed together below so a reviewer can clear them in one pass instead of tripping over them one namespace at a time.

## Namespace summary

| Namespace | Keys | NEW | Same as EN | Needs decision | Notes |
|-----------|-----:|----:|-----------:|---------------:|------:|
| [`account`](#namespace-account) | 25 | 0 | 0 | 0 | 2 |
| [`activeJourney`](#namespace-activejourney) | 8 | 8 | 0 | 0 | 0 |
| [`activeRide`](#namespace-activeride) | 12 | 0 | 0 | 0 | 0 |
| [`admin`](#namespace-admin) | 25 | 0 | 0 | 0 | 0 |
| [`app`](#namespace-app) | 2 | 0 | 1 | 0 | 0 |
| [`appLock`](#namespace-applock) | 28 | 28 | 0 | 0 | 0 |
| [`approach`](#namespace-approach) | 12 | 2 | 0 | 0 | 0 |
| [`attribution`](#namespace-attribution) | 1 | 0 | 0 | 0 | 1 |
| [`auth`](#namespace-auth) | 13 | 0 | 1 | 0 | 0 |
| [`autoBid`](#namespace-autobid) | 40 | 40 | 1 | 1 | 0 |
| [`bid`](#namespace-bid) | 36 | 8 | 0 | 0 | 0 |
| [`bidList`](#namespace-bidlist) | 18 | 18 | 0 | 0 | 0 |
| [`bids`](#namespace-bids) | 35 | 20 | 0 | 0 | 2 |
| [`chat`](#namespace-chat) | 19 | 0 | 0 | 0 | 0 |
| [`checkDriver`](#namespace-checkdriver) | 8 | 0 | 0 | 0 | 0 |
| [`child`](#namespace-child) | 21 | 0 | 0 | 0 | 0 |
| [`childTravel`](#namespace-childtravel) | 4 | 4 | 0 | 0 | 0 |
| [`common`](#namespace-common) | 17 | 3 | 1 | 1 | 1 |
| [`confirm`](#namespace-confirm) | 1 | 0 | 0 | 0 | 0 |
| [`confirmArrival`](#namespace-confirmarrival) | 5 | 5 | 0 | 0 | 0 |
| [`connection`](#namespace-connection) | 9 | 4 | 0 | 0 | 9 |
| [`dashboard`](#namespace-dashboard) | 18 | 3 | 0 | 0 | 4 |
| [`deletion`](#namespace-deletion) | 53 | 53 | 0 | 0 | 0 |
| [`delivery`](#namespace-delivery) | 55 | 11 | 0 | 0 | 0 |
| [`diagnostics`](#namespace-diagnostics) | 24 | 24 | 0 | 0 | 0 |
| [`driver`](#namespace-driver) | 38 | 2 | 0 | 0 | 2 |
| [`driverApproach`](#namespace-driverapproach) | 10 | 0 | 1 | 0 | 0 |
| [`driverNav`](#namespace-drivernav) | 3 | 3 | 0 | 0 | 0 |
| [`emergency`](#namespace-emergency) | 54 | 36 | 0 | 0 | 10 |
| [`errors`](#namespace-errors) | 105 | 66 | 0 | 0 | 29 |
| [`goods`](#namespace-goods) | 28 | 1 | 1 | 0 | 3 |
| [`goodsPickup`](#namespace-goodspickup) | 24 | 1 | 0 | 0 | 0 |
| [`guide`](#namespace-guide) | 18 | 5 | 0 | 0 | 13 |
| [`history`](#namespace-history) | 6 | 2 | 0 | 0 | 1 |
| [`home`](#namespace-home) | 9 | 0 | 0 | 0 | 5 |
| [`inProgress`](#namespace-inprogress) | 11 | 0 | 0 | 0 | 0 |
| [`intel`](#namespace-intel) | 58 | 58 | 2 | 1 | 0 |
| [`interrupt`](#namespace-interrupt) | 5 | 0 | 0 | 0 | 0 |
| [`journey`](#namespace-journey) | 66 | 10 | 4 | 3 | 10 |
| [`journeyHistory`](#namespace-journeyhistory) | 5 | 0 | 0 | 0 | 0 |
| [`layout`](#namespace-layout) | 3 | 2 | 0 | 0 | 0 |
| [`legal`](#namespace-legal) | 17 | 9 | 0 | 0 | 0 |
| [`location`](#namespace-location) | 6 | 0 | 0 | 0 | 0 |
| [`login`](#namespace-login) | 16 | 0 | 1 | 0 | 4 |
| [`map`](#namespace-map) | 36 | 24 | 0 | 0 | 12 |
| [`match`](#namespace-match) | 7 | 0 | 0 | 0 | 0 |
| [`matched`](#namespace-matched) | 33 | 0 | 0 | 0 | 1 |
| [`moneyPin`](#namespace-moneypin) | 32 | 32 | 0 | 0 | 0 |
| [`nav`](#namespace-nav) | 8 | 0 | 0 | 0 | 1 |
| [`notFound`](#namespace-notfound) | 2 | 0 | 0 | 0 | 0 |
| [`notify`](#namespace-notify) | 12 | 12 | 0 | 0 | 0 |
| [`outbox`](#namespace-outbox) | 17 | 17 | 1 | 0 | 1 |
| [`parcel`](#namespace-parcel) | 3 | 3 | 1 | 0 | 0 |
| [`parcelWeight`](#namespace-parcelweight) | 6 | 6 | 0 | 0 | 0 |
| [`payment`](#namespace-payment) | 31 | 15 | 2 | 0 | 0 |
| [`payments`](#namespace-payments) | 13 | 0 | 0 | 0 | 10 |
| [`payout`](#namespace-payout) | 34 | 2 | 1 | 0 | 0 |
| [`picker`](#namespace-picker) | 7 | 0 | 0 | 0 | 6 |
| [`priority`](#namespace-priority) | 4 | 0 | 0 | 0 | 0 |
| [`profile`](#namespace-profile) | 30 | 1 | 1 | 0 | 0 |
| [`rating`](#namespace-rating) | 18 | 16 | 0 | 0 | 0 |
| [`receipt`](#namespace-receipt) | 4 | 0 | 0 | 0 | 4 |
| [`register`](#namespace-register) | 23 | 1 | 0 | 0 | 0 |
| [`reliability`](#namespace-reliability) | 2 | 0 | 0 | 0 | 0 |
| [`report`](#namespace-report) | 15 | 15 | 0 | 0 | 0 |
| [`ride`](#namespace-ride) | 12 | 0 | 0 | 0 | 0 |
| [`scheduled`](#namespace-scheduled) | 30 | 4 | 1 | 0 | 4 |
| [`screener`](#namespace-screener) | 60 | 0 | 0 | 0 | 0 |
| [`settings`](#namespace-settings) | 21 | 8 | 1 | 0 | 0 |
| [`sheet`](#namespace-sheet) | 1 | 0 | 0 | 0 | 1 |
| [`simulation`](#namespace-simulation) | 4 | 0 | 0 | 0 | 0 |
| [`states`](#namespace-states) | 2 | 0 | 0 | 0 | 2 |
| [`status`](#namespace-status) | 10 | 0 | 0 | 0 | 0 |
| [`sync`](#namespace-sync) | 18 | 0 | 0 | 0 | 0 |
| [`tiers`](#namespace-tiers) | 3 | 0 | 0 | 0 | 0 |
| [`toast`](#namespace-toast) | 1 | 1 | 0 | 0 | 0 |
| [`transparency`](#namespace-transparency) | 39 | 3 | 0 | 0 | 0 |
| [`urgent`](#namespace-urgent) | 35 | 0 | 1 | 0 | 0 |
| [`vehicle`](#namespace-vehicle) | 7 | 0 | 5 | 5 | 0 |
| [`vehicleTypeInfo`](#namespace-vehicletypeinfo) | 16 | 3 | 0 | 0 | 0 |
| [`vehicles`](#namespace-vehicles) | 8 | 0 | 0 | 0 | 0 |
| [`verification`](#namespace-verification) | 21 | 3 | 0 | 0 | 0 |
| [`wallet`](#namespace-wallet) | 1 | 0 | 0 | 0 | 1 |
| [`welcome`](#namespace-welcome) | 18 | 0 | 3 | 0 | 0 |
| **total** | **1615** | **592** | **30** | **11** | **139** |

## Review first: new since the baseline

592 keys arrived after `e28cd92` (PILOT-READY (#136), 2026-07-28 — the last commit that changed English source text; every key added after it is still unseen by a native reviewer.).

| Key | English | Current RW (AI) | Reviewer's RW | Note |
|-----|---------|-----------------|---------------|------|
| `activeJourney.inProgressDelivery` | Delivery in progress | Kohereza birakomeje |  |  |
| `activeJourney.inProgressRide` | Ride in progress | Urugendo rurakomeje |  |  |
| `activeJourney.matchedCustomer` | Driver on the way | Umumotari ari mu nzira |  |  |
| `activeJourney.matchedDriver` | Matched — head to the pickup | Wabonye urugendo — jya aho bagutegereje |  |  |
| `activeJourney.resume` | Tap to return | Kanda usubireyo |  |  |
| `activeJourney.titleDelivery` | Active delivery | Kohereza birimo gukorwa |  |  |
| `activeJourney.titleRide` | Active ride | Urugendo rurimo gukorwa |  |  |
| `activeJourney.waitingForOffers` | Waiting for offers | Gutegereza ibiciro |  |  |
| `appLock.call112` | Call 112 | Hamagara 112 |  |  |
| `appLock.chooseCode` | Choose a code of at least {{min}} digits | Hitamo kode y'imibare itari munsi ya {{min}} |  |  |
| `appLock.confirmCode` | Enter the same code again | Ongera wandike iyo kode imwe |  |  |
| `appLock.disableCta` | Turn off app lock | Hagarika urufunguzo |  |  |
| `appLock.disabled` | App lock is off. | Urufunguzo rwahagaritswe. |  |  |
| `appLock.enableCta` | Turn on app lock | Fungura urufunguzo |  |  |
| `appLock.enabled` | App lock is on. It will ask next time you open the app. | Urufunguzo rurakora. Ruzasabwa ubutaha ufunguye porogaramu. |  |  |
| `appLock.enterCodeToDisable` | Enter your app code | Andika kode ya porogaramu |  |  |
| `appLock.forgotHelp` | Forgot your code? Log out and log back in with an SMS code. Logging out removes the app lock. | Wibagiwe kode? Sohoka wongere winjire ukoresheje kode ya SMS. Gusohoka bikuraho urufunguzo rwa porogaramu. |  |  |
| `appLock.formatHelp` | At least {{min}} digits — longer than your 4-digit money PIN, so the two can never be the same. | Nibura imibare {{min}} — ndende kurusha kode y'amafaranga y'imibare 4, kugira ngo zitigere zisa. |  |  |
| `appLock.logoutCta` | Log out | Sohoka |  |  |
| `appLock.mismatch` | Those did not match. Start again. | Ntabwo zihuye. Ongera utangire. |  |  |
| `appLock.padLabel` | App lock keypad | Ahanditse kode ya porogaramu |  |  |
| `appLock.recommendDriver` | If you sometimes hand your phone to other people, an app lock is worth turning on. | Niba rimwe na rimwe uha abandi telefone yawe, urufunguzo rwa porogaramu rufite akamaro. |  |  |
| `appLock.rejectMoneyPinLength` | That is 4 digits, which is a money PIN. Your app code needs at least {{min}}, so you can never mix the two up. | Iyo ni imibare 4, ni kode y'amafaranga. Kode ya porogaramu isaba nibura imibare {{min}}, kugira ngo utazivanga. |  |  |
| `appLock.rejectNotDigits` | Digits only. | Imibare gusa. |  |  |
| `appLock.rejectTooShort` | Too short. Use at least {{min}} digits. | Ni ngufi cyane. Koresha nibura imibare {{min}}. |  |  |
| `appLock.settingsHelp` | Lock the whole app behind a code of your own. Off unless you turn it on. Calling 112 always works, locked or not. | Funga porogaramu yose ukoresheje kode yawe bwite. Ntikora keretse uyifunguye. Guhamagara 112 bihora bikora, ifunze cyangwa ifunguye. |  |  |
| `appLock.settingsTitle` | App lock | Urufunguzo rwa porogaramu |  |  |
| `appLock.sosOnRide` | You have a ride in progress. You can still raise an alert. | Ufite urugendo rukomeje. Uracyashobora gutabaza. |  |  |
| `appLock.subtitle` | This phone is locked. | Iyi telefone irafunze. |  |  |
| `appLock.timeoutHelp` | By default the app only locks when you restart it. You can also have it lock after you have been away for a while. | Muri rusange porogaramu ifunga gusa iyo wongeye kuyifungura. Ushobora no gutuma ifunga numara igihe utayikoresha. |  |  |
| `appLock.timeoutLabel` | Also lock after being away | Nanone ifunge numara igihe utayikoresha |  |  |
| `appLock.timeoutMinutes` | {{count}} min | Iminota {{count}} |  |  |
| `appLock.timeoutOff` | Only on restart | Iyo wongeye gufungura gusa |  |  |
| `appLock.title` | Enter your app code | Andika kode ya porogaramu |  |  |
| `appLock.unlock` | Unlock | Fungura |  |  |
| `appLock.wrongCode` | Wrong code. Try again. | Kode ntiyemewe. Ongera ugerageze. |  |  |
| `approach.paymentConfirmed` | Fare paid — this ride is covered. | Ikiguzi cyishyuwe — uru rugendo rwishyuwe. |  |  |
| `approach.paymentSettling` | Fare not confirmed yet. Keep going — if it is not paid within {{minutes}} minutes, we release you and tell you here. | Ikiguzi ntikiremezwa. Komeza — nikidashyurwa mu minota {{minutes}}, turagufungura tukakubwira hano. |  |  |
| `autoBid.addRule` | Write a rule | Andika itegeko |  |  |
| `autoBid.amountFlatLabel` | Your price | Igiciro cyawe |  |  |
| `autoBid.amountHelp` | Between {{min}} and {{max}}. | Hagati ya {{min}} na {{max}}. |  |  |
| `autoBid.amountModeLabel` | What do you bid? | Utanga igiciro ki? |  |  |
| `autoBid.amountPercentLabel` | Percent of the fair price | Ijanisha ry'igiciro gikwiye |  |  |
| `autoBid.atCap` | You have all {{max}} rules. Delete one to write another. | Ufite amategeko {{max}} yose. Siba rimwe kugira ngo wandike irindi. |  |  |
| `autoBid.capNote` | You are using {{used}} of {{max}} rules. | Ukoresha amategeko {{used}} kuri {{max}}. |  |  |
| `autoBid.deleteRule` | Delete this rule | Siba iri tegeko |  |  |
| `autoBid.enabledLabel` | Rule status when saved | Uko itegeko rizaba rimeze igihe ribitswe |  |  |
| `autoBid.entryHint` | Write your rules now. They stay off until Bimoto turns this on. | Andika amategeko yawe ubu. Ntazakora kugeza Bimoto ibikoresheje. |  |  |
| `autoBid.entryLabel` | Set up automatic bidding | Shyiraho gutanga igiciro byikora |  |  |
| `autoBid.intro` | A rule tells Bimoto which jobs you would take and what you would charge, so a bid can go out without you touching the phone. | Itegeko ribwira Bimoto ingendo wakwakira n'igiciro wasaba, kugira ngo igiciro gitangwe utakoze kuri telefone. |  |  |
| `autoBid.maxPickupHelp` | Up to {{max}} km. | Kugeza kuri km {{max}}. |  |  |
| `autoBid.maxPickupLabel` | How far will you go to collect? | Ugenda kure kangahe kugira ngo ufate umukiriya? |  |  |
| `autoBid.maxRideHelp` | Up to {{max}} km from pickup to destination. | Kugeza kuri km {{max}} uhereye aho ufatira ukageza aho ugana. |  |  |
| `autoBid.maxRideLabel` | How long a job will you take? | Urugendo rungana iki wakwakira? |  |  |
| `autoBid.modeFlat` | A fixed price | Igiciro gihoraho |  |  |
| `autoBid.modePercent` | A share of the fair price | Igice cy'igiciro gikwiye |  |  |
| `autoBid.newRule` | New rule | Itegeko rishya |  |  |
| `autoBid.noRules` | You have not written any rules yet. | Nta tegeko urandika kugeza ubu. |  |  |
| `autoBid.offBody` | You can write your rules and they are saved. Nothing bids on your behalf until Bimoto turns this on — every job still needs you to bid yourself. | Ushobora kwandika amategeko yawe akabikwa. Nta kintu na kimwe gitanga igiciro mu izina ryawe kugeza Bimoto ibikoresheje — buri rugendo rugusaba gutanga igiciro wowe ubwawe. |  |  |
| `autoBid.offTitle` | Automatic bidding is off during the pilot. | Gutanga igiciro byikora ntibikora muri iki gihe cy’igerageza. |  |  |
| `autoBid.pauseAll` | Pause all my rules | Hagarika amategeko yanjye yose |  |  |
| `autoBid.resumeAll` | Turn all my rules back on | Subiza amategeko yanjye yose |  |  |
| `autoBid.resumeAllBlocked` | Available once Bimoto turns automatic bidding on. | Bizaboneka Bimoto nimara gukoresha gutanga igiciro byikora. |  |  |
| `autoBid.ruleOrder` | Rule {{n}} | Itegeko {{n}} |  |  |
| `autoBid.saveRule` | Save rule | Bika itegeko |  |  |
| `autoBid.stateActive` | Active | Rirakora |  |  |
| `autoBid.stateWaiting` | Saved, not active | Ryabitswe, ntirikora |  |  |
| `autoBid.summaryDistances` | Up to {{pickupKm}} km to collect, jobs up to {{rideKm}} km. | Kugeza km {{pickupKm}} kugira ngo ufate, ingendo kugeza km {{rideKm}}. |  |  |
| `autoBid.summaryFlat` | Bids {{amount}} RWF. | Itanga {{amount}} RWF. |  |  |
| `autoBid.summaryPercent` | Bids {{percent}}% of the fair price. | Itanga {{percent}}% by'igiciro gikwiye. |  |  |
| `autoBid.summaryVehicle` | Machine: {{vehicle}}. | Ikinyabiziga: {{vehicle}}. |  |  |
| `autoBid.title` | Automatic bidding | Gutanga igiciro byikora |  |  |
| `autoBid.vehicleAny` | Any machine | Ikinyabiziga icyo ari cyo cyose |  |  |
| `autoBid.vehicleBike` | Bicycle | Igare |  |  |
| `autoBid.vehicleEbike` | Electric bicycle | Igare ry'amashanyarazi |  |  |
| `autoBid.vehicleEmoto` | Electric moto | Moto y'amashanyarazi |  |  |
| `autoBid.vehicleLabel` | Which jobs? | Ingendo zihe? |  |  |
| `autoBid.vehicleMoto` | Moto | Moto |  |  |
| `bid.counterAcceptButton` | Accept price | Emera igiciro |  |  |
| `bid.counterAccepted` | Price accepted — the ride is yours | Igiciro cyemewe — urugendo ni urwawe |  |  |
| `bid.counterDeclineButton` | Keep my price | Guma ku giciro cyanjye |  |  |
| `bid.counterDeclineNote` | If you decline, your offer of {{price}} RWF stays on their screen. | Nutemera, igiciro cyawe cya {{price}} RWF kiguma ku kigaragaza cyabo. |  |  |
| `bid.counterDeclined` | Your offer stands at your own price | Igiciro cyawe kiracyahari nk’uko wagitanze |  |  |
| `bid.counterTheirPrice` | They suggest {{amount}} RWF | Basaba {{amount}} RWF |  |  |
| `bid.counterTitle` | A different price was suggested | Hatanzwe ikindi giciro |  |  |
| `bid.counterYourPrice` | Your offer: {{price}} RWF | Igiciro watanze: {{price}} RWF |  |  |
| `bidList.request.offersBody` | {{count}} so far. Take one, or wait for more. | {{count}} kugeza ubu. Hitamo kimwe, cyangwa utegereze ibindi. |  |  |
| `bidList.request.offersTitle` | Offers have arrived | Ibiciro byaje |  |  |
| `bidList.request.sentBody` | Drivers nearby are being asked now. Offers appear here on their own. | Abamotari bari hafi barabazwa ubu. Ibiciro bizigaragaza hano ubwabyo. |  |  |
| `bidList.request.sentTitle` | Request sent — waiting for offers | Icyifuzo cyoherejwe — gutegereza ibiciro |  |  |
| `bidList.request.sentToast` | Request sent — we are asking drivers now | Icyifuzo cyoherejwe — turimo kubaza abamotari |  |  |
| `bidList.state.expiredBody` | No driver took this ride in time. You can ask again — it only takes a moment. | Nta motari wafashe uru rugendo ku gihe. Ushobora kongera gusaba — ni akanya gato. |  |  |
| `bidList.state.expiredTitle` | This request is closed | Ubu busabe bwarafunzwe |  |  |
| `bidList.state.fetching` | Looking for offers… | Turashakisha ibiciro… |  |  |
| `bidList.state.liveHint` | Offers appear here instantly — you don't need to refresh. | Igiciro kigaragara aha. Nta mpamvu yo gusubira inyuma. |  |  |
| `bidList.state.offlineBody` | Your phone can't reach Bimoto right now. Offers already sent are safe; this page will fill in as soon as the connection is back. | Telefoni yawe ntiribashije kugera kuri Bimoto ubu. Ibiciro byamaze koherezwa birakomeza kubaho; uru rupapuro ruzuzura umurandasi nugaruka. |  |  |
| `bidList.state.offlineTitle` | Connection lost — still trying | Umurandasi wacitse — turacyagerageza |  |  |
| `bidList.state.requestAgain` | Request a ride again | Ongera usabe urugendo |  |  |
| `bidList.withdraw` | Withdraw my request | Kuraho icyifuzo cyanjye |  |  |
| `bidList.withdrawConfirm` | Yes, withdraw | Yego, kuraho |  |  |
| `bidList.withdrawConfirmBody` | Your request will be closed and any offers on it will end. You can book again at any time. | Icyifuzo cyawe kizafungwa kandi ibiciro byatanzwe bizarangira. Ushobora kongera gusaba igihe icyo ari cyo cyose. |  |  |
| `bidList.withdrawConfirmTitle` | Withdraw this request? | Kuraho iki cyifuzo? |  |  |
| `bidList.withdrawKeep` | Keep waiting | Komeza gutegereza |  |  |
| `bidList.withdrawn` | Your request was withdrawn | Icyifuzo cyawe cyavanyweho |  |  |
| `bids.anyVehicleWaiting` | Offers can come from bicycles, motos and e-motos. | Ibiciro bishobora guturuka ku magare, kuri moto no kuri e-moto. |  |  |
| `bids.cheapestOfKind` | Cheapest here | Gihendutse hano |  |  |
| `bids.counterDeclinedState` | Your price was not accepted. This offer still stands at {{price}} RWF. | Igiciro cyawe nticyemewe. Iki giciro kiracyari {{price}} RWF. |  |  |
| `bids.counterEqualsPrice` | That is the price already offered. | Icyo ni cyo giciro cyari cyatanzwe. |  |  |
| `bids.counterIntro` | {{driver}} offered {{price}} RWF. What would you like to pay? | {{driver}} yatanze {{price}} RWF. Wifuza kwishyura angahe? |  |  |
| `bids.counterLabel` | Your price (RWF) | Igiciro cyawe (RWF) |  |  |
| `bids.counterLapsedState` | This offer expired before your price was answered. | Iki giciro cyarangiye igihe mbere y’uko igiciro cyawe gisubizwa. |  |  |
| `bids.counterOnce` | You can suggest a price once per offer. | Ushobora gusaba igiciro rimwe gusa kuri buri giciro cyatanzwe. |  |  |
| `bids.counterOutOfBounds` | Enter a price between {{min}} and {{max}} RWF. | Andika igiciro kiri hagati ya {{min}} na {{max}} RWF. |  |  |
| `bids.counterPendingState` | You suggested {{amount}} RWF — waiting for an answer | Wasabye {{amount}} RWF — utegereje igisubizo |  |  |
| `bids.counterSend` | Send | Ohereza |  |  |
| `bids.counterSent` | Your price was sent to the driver | Igiciro cyawe cyoherejwe umushoferi |  |  |
| `bids.decline` | Decline | Wanga |  |  |
| `bids.declineConfirm` | Decline this offer? Your request stays open and the other offers stay live. | Wanga iki cyifuzo? Icyifuzo cyawe gikomeza gufunguye, n’ibindi byifuzo bigakomeza. |  |  |
| `bids.declined` | Offer declined. | Icyifuzo cyanzwe. |  |  |
| `bids.sectionHeader` | {{vehicle}} · {{count}} offer | {{vehicle}} · igiciro {{count}} |  |  |
| `bids.sectionHeader_other` | {{vehicle}} · {{count}} offers | {{vehicle}} · ibiciro {{count}} |  |  |
| `bids.suggestPrice` | Suggest another price | Saba ikindi giciro |  |  |
| `bids.yourBidAccepted` | Your offer was accepted — the passenger is waiting | Igiciro wasabye cyemewe — umugenzi arakutegereje |  |  |
| `bids.yourBidDeclined` | The passenger did not take this offer | Umugenzi ntiyemeye iki cyifuzo |  |  |
| `childTravel.blockedByParcel` | You're sending a package on this ride — book a separate ride to travel with a child. | Uri kohereza ipaki kuri uru rugendo — saba urundi rugendo niba ugenda n'umwana. |  |  |
| `childTravel.noticeToDriver` | The passenger is travelling with a child. | Umugenzi ari kugendana n'umwana. |  |  |
| `childTravel.toggle` | Travelling with a child? | Uri kugendana n'umwana? |  |  |
| `childTravel.toggleHelper` | Tick this and the driver sees it before accepting, so they know a child is coming. | Nushyiraho aka kamenyetso, umumotari arakabona mbere yo kwemera, akamenya ko hari umwana ugiye kugenda. |  |  |
| `common.off` | Off | Birafunze |  |  |
| `common.on` | On | Birafunguye |  |  |
| `common.refresh` | Refresh | Ongera ufungure |  |  |
| `confirmArrival.confirm` | Confirm arrival | Emeza ko wageze |  |  |
| `confirmArrival.done` | Arrival confirmed. Thank you. | Kugera kwemejwe. Murakoze. |  |  |
| `confirmArrival.fallback` | If you do not, it confirms itself after 2 hours and your motari is paid either way. | Nutabikora, rwiyemeza nyuma y’amasaha 2 kandi umumotari wawe agahembwa uko byagenda kose. |  |  |
| `confirmArrival.prompt` | Your motari says the ride is done. Confirm you have arrived. | Umumotari wawe avuga ko urugendo rurangiye. Emeza ko wageze. |  |  |
| `confirmArrival.title` | Ride finished | Urugendo rurangiye |  |  |
| `connection.detailTitle` | Connection & saved bookings | Umurongo n’ibyabitswe |  | CHROME-C: title of the sheet the status pill opens. Covers BOTH the connection and anything saved on the phone waiting to go out, so it must not name only one of them. |
| `connection.openDetail` | open details | fungura ibisobanuro |  | CHROME-C: screen-reader-only tail on the status pill's label, e.g. 'Offline — open details'. A verb phrase, lower case, never shown visually. |
| `connection.shortNoServer` | No server | Nta seriveri |  | CHROME-C: the header status pill's word for network-up-but-Bimoto-unreachable. Short, as above; `connection.unreachable` is the same state's full sentence in the detail sheet. This is the one state that turns the whole header red, so the word must carry that weight in two or three syllables. |
| `connection.shortOffline` | Offline | Nta murandasi |  | CHROME-C: the header status pill's word for a device with no network. MUST be short — it sits in a pill beside the back control, not in a banner. `connection.offline` is the same state's full sentence and stays as it is, inside the detail sheet. |
| `dashboard.finishCurrentRide` | Finish your current ride first | Banza urangize urugendo urimo |  |  |
| `dashboard.finishCurrentRideSubtitle` | New requests come back as soon as you complete the ride you have. | Ibisabwa bishya bizagaruka umaze kurangiza urugendo ufite. |  |  |
| `dashboard.reopenedUnpaid` | Back in the list: the passenger’s payment did not complete, so this ride is open to everyone again. | Yagarutse ku rutonde: kwishyura k’umugenzi ntibyakunze, bityo uru rugendo rwongeye gufungurirwa bose. |  |  |
| `deletion.bannerCancel` | Keep my account | Gumana konti yanjye |  |  |
| `deletion.bannerCancelFailed` | We could not stop the deletion. Please try again. | Ntitwashoboye guhagarika gusiba. Ongera ugerageze. |  |  |
| `deletion.bannerCancelPending` | Keeping your account… | Kugumana konti yawe… |  |  |
| `deletion.bannerCancelled` | Your account will not be deleted. | Konti yawe ntizasibwa. |  |  |
| `deletion.bannerCountdownDays` | It will be erased in about {{count}} days. | Izasibwa mu minsi {{count}} nka gutyo. |  |  |
| `deletion.bannerCountdownDays_one` | It will be erased in about {{count}} day. | Izasibwa mu munsi {{count}} nka gutyo. |  |  |
| `deletion.bannerCountdownDays_other` | It will be erased in about {{count}} days. | Izasibwa mu minsi {{count}} nka gutyo. |  |  |
| `deletion.bannerCountdownHours` | It will be erased in about {{count}} hours. | Izasibwa mu masaha {{count}} nka gutyo. |  |  |
| `deletion.bannerCountdownHours_one` | It will be erased in about {{count}} hour. | Izasibwa mu isaha {{count}} nka gutyo. |  |  |
| `deletion.bannerCountdownHours_other` | It will be erased in about {{count}} hours. | Izasibwa mu masaha {{count}} nka gutyo. |  |  |
| `deletion.bannerCountdownImminent` | It will be erased any moment now. | Igiye gusibwa ako kanya. |  |  |
| `deletion.bannerCountdownMinutes` | It will be erased in about {{count}} minutes. | Izasibwa mu minota {{count}} nka gutyo. |  |  |
| `deletion.bannerCountdownMinutes_one` | It will be erased in about {{count}} minute. | Izasibwa mu munota {{count}} nka gutyo. |  |  |
| `deletion.bannerCountdownMinutes_other` | It will be erased in about {{count}} minutes. | Izasibwa mu minota {{count}} nka gutyo. |  |  |
| `deletion.bannerDeferredTitle` | Your deletion is waiting on one thing | Gusiba konti yawe gutegereje ikintu kimwe |  |  |
| `deletion.bannerRidesNote` | You can keep using Bimoto until then. Rides you take between now and then are erased along with everything else. | Ushobora gukomeza gukoresha Bimoto kugeza icyo gihe. Ingendo uzakora hagati aha na cyo zizasibwa hamwe n'ibindi byose. |  |  |
| `deletion.bannerTitle` | Your account is being deleted | Konti yawe iri gusibwa |  |  |
| `deletion.deferredAccountFrozen` | Your account is frozen, so it cannot be deleted yet. Contact Bimoto support to settle the freeze and the deletion will go ahead. | Konti yawe irahagaritswe, bityo ntishobora gusibwa ubu. Vugana na serivisi z'abakiriya za Bimoto kugira ngo iryo hagarikwa rikemuke, hanyuma gusiba bizakomeza. |  |  |
| `deletion.deferredInFlightPayout` | A payout to you is on its way. It ends when the transfer settles. | Amafaranga yawe ari mu nzira. Bizarangira igihe kohereza birangiye. |  |  |
| `deletion.deferredLiveEscrow` | We cannot delete your account while the payment for one of your rides is still being settled. It will be deleted once that payment is finished. | Ntidushobora gusiba konti yawe mu gihe kwishyura kw'urugendo rwawe bikiri gukorwa. Izasibwa iyo kwishyura birangiye. |  |  |
| `deletion.deferredNonTerminalJourney` | We cannot delete your account while a ride is still going. It will be deleted once that ride ends. | Ntidushobora gusiba konti yawe mu gihe urugendo rukiri mu nzira. Izasibwa iyo urwo rugendo rurangiye. |  |  |
| `deletion.deferredOpenBid` | You have an offer out on a ride. It ends when the passenger accepts, you withdraw it, or it expires. | Ufite igiciro watanze ku rugendo. Bizarangira igihe umugenzi acyemeye, ucyikuyeho, cyangwa igihe cyacyo kirangiye. |  |  |
| `deletion.deferredPositiveDriverBalance` | We still owe you money for your rides. We cannot delete your account before paying you — it will be deleted once you have been paid. | Turacyakubereyemo amafaranga y'ingendo zawe. Ntidushobora gusiba konti yawe tutarayaguha — izasibwa iyo umaze kuyahabwa. |  |  |
| `deletion.deferredScheduledPayout` | A payout to you is scheduled. It ends when the payout is sent. | Amafaranga yawe yateganyijwe koherezwa. Bizarangira igihe azaba yoherejwe. |  |  |
| `deletion.deferredUnresolvedEmergency` | We cannot delete your account while an emergency you raised is still open. Our team is working on it, and your account will be deleted once it is closed. | Ntidushobora gusiba konti yawe mu gihe ikibazo cy'ubutabazi watanze kitarakemuka. Ikipe yacu irakikoraho, kandi konti yawe izasibwa iyo gikemutse. |  |  |
| `deletion.exportCopied` | Your data was copied. Paste it somewhere to keep it. | Amakuru yawe yarakoporowe. Yomeke ahantu kugira ngo uyabike. |  |  |
| `deletion.exportDownloaded` | Your data has been downloaded. | Amakuru yawe yaramanuwe. |  |  |
| `deletion.exportFailed` | We could not prepare your data. Please try again. | Ntitwashoboye gutegura amakuru yawe. Ongera ugerageze. |  |  |
| `deletion.exportNotice` | This export contains the records Bimoto holds about you as a rider, a driver, and a party to your own rides. It deliberately leaves out our fraud-prevention and investigation records about this account — anti-money-laundering flags, administrator actions taken about you, name-mismatch checks, driver conflict overrides, and the tombstone kept after an account is deleted. Those are withheld so that a fraud check cannot be read by the person it is about. You can ask for them, and for the reasons behind them, by making a request to Bimoto support. | Iyi dosiye irimo amakuru Bimoto ifite kuri wowe nk’umugenzi, nk’umumotari, no nk’umwe mu bagize urugendo rwawe. Ku bushake ntirimo inyandiko zacu zo kurwanya uburiganya n’izo iperereza kuri iyi konti: ibimenyetso byo kurwanya iyezandonke, ibyemezo by’ubuyobozi byafashwe kuri wowe, igenzura ry’amazina atahuye, ibyemezo byihariye ku makimbirane y’umumotari, n’inyandiko isigara konti imaze gusibwa. Ibyo ntibitangwa kugira ngo igenzura ry’uburiganya ritasomwa n’uwo rireba. Ushobora kubisaba, hamwe n’impamvu zabyo, wandikira ubufasha bwa Bimoto. |  |  |
| `deletion.exportPreparing` | Preparing your data… | Gutegura amakuru yawe… |  |  |
| `deletion.exportShared` | Your data is ready to share. | Amakuru yawe yiteguye gusangirwa. |  |  |
| `deletion.step1Back` | Go back | Subira inyuma |  |  |
| `deletion.step1Continue` | Continue | Komeza |  |  |
| `deletion.step1ErasedContacts` | Your emergency contacts | Abo uhamagara mu bihe by'ubutabazi |  |  |
| `deletion.step1ErasedDocuments` | Your licence, insurance and other documents | Uruhushya rwawe, ubwishingizi n'izindi nyandiko zawe |  |  |
| `deletion.step1ErasedName` | Your name and your profile | Izina ryawe n'umwirondoro wawe |  |  |
| `deletion.step1ErasedPhone` | Your phone number | Nimero yawe ya telefone |  |  |
| `deletion.step1ErasedTitle` | What is erased | Ibisibwa |  |  |
| `deletion.step1Intro` | Read this first. Once the deletion goes through, it cannot be undone. | Banza usome ibi. Iyo gusiba bimaze gukorwa, ntibisubirwaho. |  |  |
| `deletion.step1KeptPayments` | Payment and receipt records for those rides | Inyandiko z'ubwishyu n'inyemezabwishyu z'izo ngendo |  |  |
| `deletion.step1KeptRides` | The record that each ride happened — where it went and when | Inyandiko y'uko buri rugendo rwabaye — aho rwagiye n'igihe |  |  |
| `deletion.step1KeptSafety` | Safety and dispute records, where a ride had one | Inyandiko z'umutekano n'iz'amakimbirane, iyo urugendo rwarwo rwazigize |  |  |
| `deletion.step1KeptTitle` | What is kept, with your name taken off it | Ibibikwa, izina ryawe rikuweho |  |  |
| `deletion.step1KeptWhy` | The law requires us to keep these records, and other people were on those rides too. They stay, but nothing in them points back to you. | Amategeko adusaba kubika izi nyandiko, kandi n'abandi bantu bari muri izo ngendo. Zirabikwa, ariko nta na kimwe kirimo kigaruka kuri wowe. |  |  |
| `deletion.step1Title` | Delete my account | Siba konti yanjye |  |  |
| `deletion.step1Window` | Nothing happens straight away. You have 72 hours to change your mind, and Bimoto works normally for the whole of it. | Nta kintu kibaho ako kanya. Ufite amasaha 72 yo guhindura umwanzuro, kandi Bimoto ikora nk'ubusanzwe muri ayo masaha yose. |  |  |
| `deletion.step2Back` | No, keep my account | Oya, ngumane konti yanjye |  |  |
| `deletion.step2Hold` | Hold to delete my account | Fata kugira ngo usibe konti yanjye |  |  |
| `deletion.step2HoldInstruction` | Press and hold the button below for two seconds to confirm. | Kanda ubuto buri hasi ubufate amasegonda abiri kugira ngo wemeze. |  |  |
| `deletion.step2Holding` | Keep holding… | Komeza gufata… |  |  |
| `deletion.step2Submitting` | Starting… | Biratangira… |  |  |
| `deletion.step2Title` | Are you sure? | Urabyemeje? |  |  |
| `deletion.step2Warning` | This starts the 72-hour countdown. After that, your name, phone number, contacts and documents are erased for good. | Ibi bitangiza kubara amasaha 72. Nyuma yayo, izina ryawe, nimero yawe ya telefone, abo uhamagara n'inyandiko zawe bizasibwa burundu. |  |  |
| `delivery.blockedByChild` | You're travelling with a child on this ride — book a separate ride to send a package. | Ugenda n'umwana kuri uru rugendo — saba urundi rugendo niba wohereza ipaki. |  |  |
| `delivery.speedExpress` | Express | Byihuse (Vuba vuba) |  |  |
| `delivery.speedExpressDesc` | Faster than standard. There is no fixed extra charge — drivers see that you want it fast and bid their price, and you choose the one you want. | Byihuta kurusha ibisanzwe. Nta kiguzi cy'inyongera gihoraho — abamotari babona ko ushaka ko byihuta bakagutanga igiciro cyabo, ukahitamo icyo ushaka. |  |  |
| `delivery.speedLabel` | Delivery speed | Umuvuduko wo gutanga |  |  |
| `delivery.speedStandard` | Standard | Bisanzwe |  |  |
| `delivery.speedStandardDesc` | Delivered the same day. Choose an hour window below if you need one. | Bigezwa kuri uwo munsi. Hitamo igihe hepfo niba ubikeneye. |  |  |
| `delivery.standardHoursAny` | Any time | Igihe icyo ari cyo cyose |  |  |
| `delivery.standardHoursLabel` | Deliver within (optional) | Gutanga mu gihe kitarenze (si ngombwa) |  |  |
| `delivery.standardHoursN` | {{count}} h | amasaha {{count}} |  |  |
| `delivery.standardHoursNote` | This does not change the price — the driver still bids their own fare. | Ibi ntibihindura igiciro — motari akomeza gutanga igiciro cye. |  |  |
| `delivery.standardHoursWithin` | within {{count}} h | mu masaha {{count}} |  |  |
| `diagnostics.appBuild` | App build | Verisiyo ya porogaramu |  |  |
| `diagnostics.buildsMatch` | Builds match | Verisiyo zirahuye |  |  |
| `diagnostics.clearLog` | Clear log | Siba urutonde |  |  |
| `diagnostics.errorCount` | Errors recorded | Amakosa yanditswe |  |  |
| `diagnostics.errorLog` | Error log | Urutonde rw'amakosa |  |  |
| `diagnostics.errorLogEmpty` | No errors recorded on this phone. | Nta kosa ryanditswe kuri iyi telefoni. |  |  |
| `diagnostics.feedStatus` | Last feed reply | Igisubizo giheruka cy'urutonde |  |  |
| `diagnostics.feedViewAs` | Feed sent viewAs | viewAs yoherejwe n'urutonde |  |  |
| `diagnostics.intro` | A snapshot of what this phone and the server currently agree on. Take a screenshot and send it to us if something is not working. | Incamake y'ibyo iyi telefoni na seriveri bemeranyaho ubu. Fata ifoto y'ecran uyitwoherereze igihe hari ikitagenda neza. |  |  |
| `diagnostics.lastLocation` | Last position sent | Aho waherukira kohereza |  |  |
| `diagnostics.open` | Diagnostics | Isuzuma |  |  |
| `diagnostics.rideTraceNote` | Ride traces: recorded during rides and deliveries, kept 14 days, longer only under dispute. Never visible live to anyone, except our safety team during an emergency, until it is closed. | Inzira z'ingendo: zandikwa mu gihe cy'ingendo n'ubwikorezi, zibikwa iminsi 14, zikarenzaho gusa iyo hari ikibazo. Nta muntu uzireba mu buryo buhita, keretse itsinda ryacu ry'umutekano mu gihe cy'ubutabazi, kugeza ubutabazi bufunzwe. |  |  |
| `diagnostics.role` | Signed in as | Winjiye nka |  |  |
| `diagnostics.sendConsent` | The report contains only what is shown above: the time, the app build, the screen you were on, and the error text — with phone numbers and sign-in codes already removed. It goes to the Bimoto team in Kigali. It is sent automatically unless you turn that off in Settings, and Send report sends it now either way. | Raporo irimo gusa ibigaragara hejuru: isaha, verisiyo ya porogaramu, urupapuro wari uriho, n'ubutumwa bw'ikosa — nimero za telefoni n'imibare yo kwinjira byamaze gukurwamo. Ijya ku ikipe ya Bimoto i Kigali. Yoherezwa mu buryo bwikora keretse ubihagaritse muri Settings, kandi Ohereza raporo iyohereza ubu uko byaba biri kose. |  |  |
| `diagnostics.sendFailed` | not sent | ntiyoherejwe |  |  |
| `diagnostics.sendReport` | Send report | Ohereza raporo |  |  |
| `diagnostics.sendStatus` | Report sent | Raporo yoherejwe |  |  |
| `diagnostics.serverBuild` | Server build | Verisiyo ya seriveri |  |  |
| `diagnostics.serverOnline` | Online (per server) | Kuri interineti (nk'uko seriveri ibivuga) |  |  |
| `diagnostics.socket` | Live connection | Umurandasi uhoraho |  |  |
| `diagnostics.socketTransport` | Live connection type | Ubwoko bw’umurongo uhoraho |  |  |
| `diagnostics.title` | Diagnostics | Isuzuma |  |  |
| `diagnostics.transportPollingOnly` | Polling only — degraded ({{transport}}) | Kubaza gusa — bidakora neza ({{transport}}) |  |  |
| `diagnostics.transportWebsocket` | Websocket (fast) | Websocket (byihuse) |  |  |
| `driver.cancelledTrips.entryHint` | If a customer was marked absent by mistake, say so here. An admin reviews every dispute. | Niba urugendo rwanditswe nk'aho umukiriya atari ahari ari uko atari byo, bivuge hano. Umuyobozi asuzuma buri kirego. |  |  |
| `driver.cancelledTrips.entryLabel` | Dispute a no-show | Kujurira ku kudahari |  |  |
| `driverNav.locating` | Finding your location… | Turashaka aho uri… |  |  |
| `driverNav.mapLabelDestination` | Map to the destination | Ikarita igana aho ugiye |  |  |
| `driverNav.mapLabelPickup` | Map to the pickup | Ikarita igana aho batwara |  |  |
| `emergency.adminBannerTitleDriver` | Emergency — driver needs help | Ubutabazi — umumotari akeneye ubufasha |  |  |
| `emergency.adminBannerTitleDriverParcel` | Emergency — driver carrying a parcel needs help | Ubutabazi — umumotari utwaye umuzigo akeneye ubufasha |  |  |
| `emergency.adminBannerTitleSender` | Emergency — parcel sender needs help | Ubutabazi — uwohereza umuzigo akeneye ubufasha |  |  |
| `emergency.adminDriverPhone` | Driver phone | Telefone y'umumotari |  |  |
| `emergency.adminFollow` | Follow | Kurikirana |  |  |
| `emergency.adminPlate` | plate | plaka |  |  |
| `emergency.adminSenderPhone` | Sender phone | Telefoni y'uwohereza umuzigo |  |  |
| `emergency.alertReceivedParcel` | Emergency alert on this parcel delivery | Hari ubutabazi mu gutwara umuzigo |  |  |
| `emergency.cancelSend` | Sending to Bimoto in {{seconds}} — tap to cancel | Byoherezwa kuri Bimoto mu masegonda {{seconds}} — kanda uhagarike |  |  |
| `emergency.followingLive` | Our safety team is following this ride until the emergency is closed. | Itsinda ryacu ry'umutekano rikurikirana uru rugendo kugeza ubutabazi bufunzwe. |  |  |
| `emergency.followingLiveParcel` | Our safety team is following this delivery until the emergency is closed. | Itsinda ryacu ry'umutekano rikurikirana ubu bwikorezi kugeza ubutabazi bufunzwe. |  |  |
| `emergency.holdHint` | Press and hold this button to send an emergency alert. If you are using a keyboard or a screen reader, press Enter instead. | Kanda uhagarare kuri iyi buto kugira ngo wohereze ubutumwa bw'ubutabazi. Niba ukoresha klavye cyangwa igisomyi cy'ecran, kanda Enter. |  |  |
| `emergency.opsAgeHours` | {{hours}} h | amasaha {{hours}} |  |  |
| `emergency.opsAgeMinutes` | {{minutes}} min | iminota {{minutes}} |  |  |
| `emergency.opsAgeSeconds` | {{seconds}} s | amasegonda {{seconds}} |  |  |
| `emergency.opsClosedBy` | Closed by {{name}} | Byafunzwe na {{name}} |  |  |
| `emergency.opsIntro` | Open emergencies can be followed live until they are closed. Every alert is closed by an operator with a note, or by the system after 60 minutes. | Ubutabazi bufunguye bushobora gukurikiranwa ako kanya kugeza bufunzwe. Buri mpuruza ifungwa n'umukozi atanga inyandiko, cyangwa na sisitemu nyuma y'iminota 60. |  |  |
| `emergency.opsLastPosition` | last position {{age}} ago | aho baheruka kuba hamaze {{age}} |  |  |
| `emergency.opsLoadFailed` | Could not load emergency alerts — check the connection and try again. | Ntibyakunze gupakira impuruza z'ubutabazi — reba umurongo hanyuma wongere ugerageze. |  |  |
| `emergency.opsNoFramesYet` | No live position yet — call the numbers on the alert. | Nta hantu haramenyekana ako kanya — hamagara nimero ziri ku mpuruza. |  |  |
| `emergency.opsNoPosition` | No position for this alert. | Nta hantu hazwi kuri iyi mpuruza. |  |  |
| `emergency.opsNoneActive` | No emergency is open. | Nta butabazi bufunguye. |  |  |
| `emergency.opsNoneClosed` | No emergency has been closed yet. | Nta butabazi burafungwa. |  |  |
| `emergency.opsOpenFor` | open {{age}} | bumaze {{age}} |  |  |
| `emergency.opsRaisedByCustomer` | Passenger | Umugenzi |  |  |
| `emergency.opsRaisedByDriver` | Driver | Umushoferi |  |  |
| `emergency.opsResolve` | Close this emergency | Funga ubu butabazi |  |  |
| `emergency.opsResolveFailed` | Could not close this alert — it may already be closed. Reload the page. | Ntibyakunze gufunga iyi mpuruza — birashoboka ko yamaze gufungwa. Ongera upakire urupapuro. |  |  |
| `emergency.opsResolveNoteLabel` | What happened | Ibyabaye |  |  |
| `emergency.opsResolveNotePlaceholder` | Spoke to the driver, he is safe and the ride ended normally. | Twavuganye n'umushoferi, ari amahoro kandi urugendo rwarangiye neza. |  |  |
| `emergency.opsResolveNoteTooShort` | Write at least {{min}} characters — this note is the record of what happened. | Andika nibura inyuguti {{min}} — iyi nyandiko ni yo nyandiko y'ibyabaye. |  |  |
| `emergency.opsStatusExpired` | Timed out | Igihe cyarangiye |  |  |
| `emergency.opsStatusResolved` | Closed by ops | Byafunzwe n'abakozi |  |  |
| `emergency.opsTabActive` | Open ({{count}}) | Bufunguye ({{count}}) |  |  |
| `emergency.opsTabHistory` | History | Amateka |  |  |
| `emergency.opsTitle` | Emergency alerts | Impuruza z'ubutabazi |  |  |
| `errors.alreadyBid` | You have already made an offer on this ride. | Wamaze gutanga ituro kuri uru rugendo. |  |  |
| `errors.alreadyDeclined` | You have already declined this offer. | Wamaze kwanga iki cyifuzo. |  |  |
| `errors.alreadyRated` | You have already rated this ride. | Wamaze gutanga amanota kuri uru rugendo. |  |  |
| `errors.alreadyReported` | You have already reported this ride. | Wamaze gutanga ikibazo kuri uru rugendo. |  |  |
| `errors.bidWindowClosed` | Offers have closed for this ride. | Igihe cyo gutanga amaturo kuri uru rugendo cyarangiye. |  |  |
| `errors.bidWindowNotYetOpen` | Offers haven't opened for this ride yet. | Igihe cyo gutanga amaturo kuri uru rugendo ntikiratangira. |  |  |
| `errors.boundaryClearHint` | Keeps you signed in. Removes the downloaded map and locally cached ride data. | Uguma winjiye. Bisiba ikarita yakuruwe n'amakuru y'ingendo abitswe kuri telefoni. |  |  |
| `errors.boundaryClearRetry` | Clear cached data and retry | Siba amakuru abitswe hanyuma wongere ugerageze |  |  |
| `errors.boundaryLogoutReset` | Log out and start over | Sohoka hanyuma utangire bundi bushya |  |  |
| `errors.contactsNotLoaded` | Your emergency contacts have not loaded yet. Check your connection and try again. | Abo wahamagara mu byihutirwa ntibarapakirwa. Reba interineti yawe hanyuma wongere ugerageze. |  |  |
| `errors.counterAlreadyAnswered` | This price suggestion was already answered. | Icyo giciro cyasabwe cyamaze gusubizwa. |  |  |
| `errors.counterAlreadyExists` | You have already suggested a price for this offer. | Wamaze gusaba igiciro kuri iki giciro cyatanzwe. |  |  |
| `errors.counterDisabled` | Suggesting a price is not available yet. | Gusaba igiciro ntibiraboneka. |  |  |
| `errors.counterEqualsBidPrice` | That is the price already offered. | Icyo ni cyo giciro cyari cyatanzwe. |  |  |
| `errors.counterNoLongerOpen` | This offer was already matched. | Iki giciro cyamaze guhabwa undi. |  |  |
| `errors.counterNotFound` | There is no price suggestion on this offer. | Nta giciro cyasabwe kuri iki giciro cyatanzwe. |  |  |
| `errors.counterOutOfBounds` | That price is outside the allowed range. | Icyo giciro kiri hanze y’ibipimo byemewe. |  |  |
| `errors.deletionAlreadyPending` | Your account is already scheduled for deletion. | Konti yawe isanzwe iteganyijwe gusibwa. |  |  |
| `errors.disputeWindowClosed` | The time to dispute this ride has passed. | Igihe cyo kuburanisha uru rugendo cyarangiye. |  |  |
| `errors.driverIncompleteCompliance` | Some of your documents are still missing, so you can't make offers yet. | Hari inyandiko zawe zikibura, ntushobora gutanga amaturo. |  |  |
| `errors.driverRevoked` | Your driver account was revoked. Contact support to apply again. | Konti yawe y'umushoferi yakuweho. Vugana na serivisi z'abakiriya kugira ngo wongere usabe. |  |  |
| `errors.driverSuspended` | Your account is suspended, so you can't make offers right now. | Konti yawe yahagaritswe by'agateganyo, ntushobora gutanga amaturo ubu. |  |  |
| `errors.emergencyAlertNotActive` | This emergency alert is not open. | Iyi mpuruza y'ubutabazi ntabwo ifunguye. |  |  |
| `errors.escrowNotAdoptable` | This ride's payment is already being processed. | Kwishyura kw'uru rugendo kuri gutunganywa. |  |  |
| `errors.fileTooLarge` | That file is too large. The limit is 10 MB. | Iyi dosiye ni nini cyane. Ntirenge 10 MB. |  |  |
| `errors.geocodeQueryTooShort` | Type a little more so we can find the place. | Andika andi magambo make kugira ngo tubone aho hantu. |  |  |
| `errors.geocodingFailed` | That address search didn't work. Try again, or pick your point on the map. | Gushakisha iyo aderesi ntibyagenze. Ongera ugerageze, cyangwa uhitemo ahantu ku ikarita. |  |  |
| `errors.geocodingUnavailable` | Address search isn't available right now. Pick your point on the map instead. | Gushakisha aderesi ntibiraboneka ubu. Hitamo ahantu ku ikarita. |  |  |
| `errors.goHome` | Go to home screen | Subira ku ipaji y'itangiriro |  |  |
| `errors.invalidEmergencyContact` | That is not a phone number we can call. Use 07XX XXX XXX, or a country code like +250 or +44. | Iyi si nimero ya telefone dushobora guhamagara. Koresha 07XX XXX XXX, cyangwa kode y'igihugu nka +250 cyangwa +44. |  |  |
| `errors.invalidPreference` | That payout schedule isn't valid. | Iyo gahunda yo kwishyurwa ntabwo yemewe. |  |  |
| `errors.invalidRating` | Please choose between 1 and 5 stars. | Hitamo kuva ku nyenyeri 1 kugeza kuri 5. |  |  |
| `errors.journeyNotAcceptingBids` | This ride is no longer taking offers. | Uru rugendo ntirwakira amaturo ukundi. |  |  |
| `errors.journeyNotCompleted` | This ride is not finished yet. | Uru rugendo ntirurarangira. |  |  |
| `errors.journeyNotEnded` | This ride is not finished yet. | Uru rugendo ntirurarangira. |  |  |
| `errors.lateCancelNotAllowed` | It's too close to your pickup time to cancel here. Call your driver. | Igihe cyo kugufata kiri hafi cyane ngo uhagarike hano. Hamagara umushoferi wawe. |  |  |
| `errors.messageTooLong` | That message is too long. Keep it under 500 characters. | Ubwo butumwa ni burebure cyane. Ntiburenze inyuguti 500. |  |  |
| `errors.moneyPinAlreadySet` | You already have a money PIN. | Usanzwe ufite kode y'amafaranga. |  |  |
| `errors.moneyPinEnrollmentRequired` | Set a money PIN to open this screen. | Shyiraho kode y'amafaranga kugira ngo ufungure uru rupapuro. |  |  |
| `errors.moneyPinInvalid` | Wrong PIN. Try again. | Kode ntiyemewe. Ongera ugerageze. |  |  |
| `errors.moneyPinInvalidFormat` | A money PIN is 4 digits. | Kode y'amafaranga igizwe n'imibare 4. |  |  |
| `errors.moneyPinLocked` | Too many wrong tries. Wait a little, then try again. | Wagerageje inshuro nyinshi. Tegereza gato, ubone kongera kugerageza. |  |  |
| `errors.moneyPinNotSet` | You have not set a money PIN yet. | Ntabwo urashyiraho kode y'amafaranga. |  |  |
| `errors.moneyStepUpRequired` | Enter your money PIN to continue. | Andika kode y'amafaranga kugira ngo ukomeze. |  |  |
| `errors.noDeletionPending` | There is no deletion request to cancel. | Nta cyifuzo cyo gusiba konti gihari cyo kureka. |  |  |
| `errors.notBidOwner` | That offer belongs to a different account. | Iryo turo ni irya konti indi. |  |  |
| `errors.notJourneyDriver` | You did not drive this ride. | Ntabwo ari wowe watwaye uru rugendo. |  |  |
| `errors.notShiftEndMode` | Your current schedule pays you automatically — no need to request it. | Gahunda yawe y'ubu yishyura mu buryo bwikora — ntukeneye kubisaba. |  |  |
| `errors.otpInvalid` | That code is not right. Check the SMS and enter it again. | Uwo mubare si wo. Reba SMS wongere uwandike. |  |  |
| `errors.otpRequired` | Enter the code we sent you by SMS. | Andika kode twaguhereje kuri SMS. |  |  |
| `errors.outsideOperationArea` | That place is not in our operation area. Bimoto serves Kigali for now. | Ahantu hatari mu karere dukoreramo. Bimoto ikorera i Kigali kugeza ubu. |  |  |
| `errors.parcelTooHeavyForVehicle` | That is too heavy for the vehicle you chose. Pick a lighter parcel or a different vehicle. | Ibyo biraremereye kuri iyo modoka wahisemo. Hitamo ipaki yoroshye cyangwa indi modoka. |  |  |
| `errors.parcelTooLargeForVehicle` | That parcel is too big for a moto on its own — a moto alone takes envelope-size items. Choose a bicycle, or send it with a passenger ride. | Iyo paki ni nini kuri moto yonyine — moto yonyine itwara ibintu bingana n'ibahasha. Hitamo igare, cyangwa uyoherereze mu rugendo rw'umugenzi. |  |  |
| `errors.pickupCoordsInvalid` | That pickup point isn't valid. Choose it again on the map. | Aho uva ntabwo ari ho. Hongere uhitemo ku ikarita. |  |  |
| `errors.pickupCoordsOutOfBounds` | That pickup point is not in our operation area. Bimoto serves Kigali for now. | Aho uva ntabwo ari mu gace dukoreramo. Bimoto ikorera i Kigali kugeza ubu. |  |  |
| `errors.preferenceChangeRateLimited` | You already changed your payout schedule today. Try again tomorrow. | Wamaze guhindura gahunda yo kwishyurwa uyu munsi. Ongera ugerageze ejo. |  |  |
| `errors.roleNotSelfAssignable` | That account type cannot be set here. | Ubwo bwoko bwa konti ntibushobora guhindurirwa hano. |  |  |
| `errors.scheduledPastDeletion` | That pickup time is after your account is deleted. Choose an earlier time, or cancel the deletion. | Icyo gihe cyo gufatwa kiri nyuma y'uko konti yawe isibwa. Hitamo igihe cya mbere, cyangwa ureke gusiba konti. |  |  |
| `errors.screenCrashTitle` | This screen hit a problem | Iyi paji yagize ikibazo |  |  |
| `errors.tooFarFromDestination` | You're too far from the destination to finish this ride. Get closer and try again. | Uri kure cyane y'aho ujya ngo urangize uru rugendo. Egera hafi wongere ugerageze. |  |  |
| `errors.tooFarFromPickup` | You're too far from the pickup point to start this ride. Get closer and try again. | Uri kure cyane y'aho uva ngo utangire uru rugendo. Egera hafi wongere ugerageze. |  |  |
| `errors.unsupportedFileType` | That file type isn't accepted. Send a photo (JPEG or PNG) or a PDF. | Ubwo bwoko bw'idosiye ntibwemewe. Ohereza ifoto (JPEG cyangwa PNG) cyangwa PDF. |  |  |
| `errors.upgradeRequired` | This version of Bimoto is out of date. Please update the app to continue. | Iyi verisiyo ya Bimoto yarashaje. Nyamuneka vugurura porogaramu kugira ngo ukomeze. |  |  |
| `errors.uploadRejected` | That upload was not accepted. Try a different file. | Iyi dosiye ntiyemewe. Gerageza indi dosiye. |  |  |
| `errors.vehicleMismatch` | This ride asked for a different vehicle than the one on your account. | Uru rugendo rusaba ikinyabiziga gitandukanye n'icyo ufite kuri konti yawe. |  |  |
| `errors.vehicleNotLoaded` | Your vehicle details have not loaded yet. Check your connection and try again. | Amakuru y’ikinyabiziga cyawe ntiyarapakirwa. Reba interineti yawe hanyuma wongere ugerageze. |  |  |
| `goods.wishPriceHelper` | Set a price for the parcel, or wait for the driver's price | Igiciro cy'umuzigo (Shyiramo igiciro cyangwa utegereze igiciro cy'umumotari/umunyonzi) |  |  |
| `goodsPickup.resumed` | Resumed where you left off | Twakomeje aho wari ugeze |  |  |
| `guide.children.body` | Children under 12 are not an independent booking option on Bimoto — a child travels with a responsible adult, who makes the booking. When you book a ride you can tick 'Travelling with a child?' so the driver knows before they arrive. | Abana bari munsi y'imyaka 12 ntibashobora gutumiza urugendo ubwabo kuri Bimoto — umwana agendana n'umuntu mukuru ubishinzwe, ari na we utumiza urugendo. Igihe utumiza urugendo, ushobora gushyiraho akamenyetso ka 'Uri kugendana n'umwana?' kugira ngo umumotari abimenye mbere yo kugera aho uri. |  |  |
| `guide.children.title` | Travelling with children | Kugendana n'abana |  |  |
| `guide.trace.body` | During your ride, the driver's phone records the route — for safety, and so that any dispute can be settled with facts rather than memory. It is deleted after 14 days unless a dispute is open, in which case it is kept until the dispute is settled. It is never visible live to anyone — except our safety team during an emergency, until the emergency is closed. | Mu gihe cy'urugendo rwawe, telefoni y'umumotari yandika inzira munyuzemo — ku mutekano, no kugira ngo ikibazo cyose gishobore gukemurwa hashingiwe ku byabaye aho gushingira ku kwibuka. Isibwa nyuma y'iminsi 14 keretse hari ikibazo cyafunguwe; icyo gihe ibikwa kugeza igihe gikemukiye. Nta muntu n'umwe uyireba mu buryo buhita — keretse itsinda ryacu ry'umutekano mu gihe cy'ubutabazi, kugeza ubutabazi bufunzwe. |  |  |
| `guide.trace.title` | The route is recorded | Inzira yandikwa |  |  |
| `guide.welcomeLink` | User guide | Amabwiriza |  |  |
| `history.sectionAsMotari` | As motari | Nk'umumotari |  |  |
| `history.sectionAsPassenger` | As passenger | Nk'umugenzi |  |  |
| `intel.cell.noMarginals` | This tier publishes no attribute splits. | Uru rwego ntirutangaza uko ibiranga bitandukanye. |  |  |
| `intel.cell.tapPrompt` | Tap a hexagon to see what it carries. | Kanda ku kazu k'impande esheshatu urebe ibikarimo. |  |  |
| `intel.cell.threshold` | This cell exists because at least {{k}} movements lit it. | Aka kazu kabaho kubera ko byibuze ingendo {{k}} zakamurikiye. |  |  |
| `intel.cell.window` | {{from}} — {{to}} | {{from}} — {{to}} |  |  |
| `intel.empty` | No cells cleared the privacy threshold here. | Nta kazu (cell) kanyuze ku rugero rw'ibanga hano. |  |  |
| `intel.export.csv` | Export this view (CSV) | Sohora iyi paji (CSV) |  |  |
| `intel.export.failed` | Could not export. | Ntibyakunze gusohora. |  |  |
| `intel.export.heading` | Export ({{lines}} lines) | Ibyasohotse (imirongo {{lines}}) |  |  |
| `intel.export.jsonl` | Export (JSONL) | Sohora (JSONL) |  |  |
| `intel.export.working` | Exporting… | Birimo gusohorwa… |  |  |
| `intel.filter.from` | From | Kuva |  |  |
| `intel.filter.tier` | Tier | Urwego |  |  |
| `intel.filter.to` | To | Kugeza |  |  |
| `intel.flows.count` | Journeys | Ingendo |  |  |
| `intel.flows.destination` | Destination cell | Akazu k'aho bagiye |  |  |
| `intel.flows.empty` | No origin–destination pair cleared the stricter endpoint's threshold in this window. | Nta gice cy'aho batangiriye n'aho bagiye cyanyuze ku rugero rukomeye muri iki gihe. |  |  |
| `intel.flows.origin` | Origin cell | Akazu k'aho batangiriye |  |  |
| `intel.flows.share` | Share | Igipimo |  |  |
| `intel.flows.window` | Window | Igihe |  |  |
| `intel.grainNote` | Cells of {{metres}} m, buckets of {{minutes}} min, and at least {{k}} movements per cell before it exists at all. | Utuzu twa metero {{metres}}, ibice by'iminota {{minutes}}, kandi byibuze ingendo {{k}} kuri buri kazu mbere y'uko kabaho. |  |  |
| `intel.loadFailed` | Could not load aggregates. | Ntibyakunze gupakira imibare yateranyijwe. |  |  |
| `intel.loading` | Loading… | Birimo gupakirwa… |  |  |
| `intel.marginal.fareDeciles` | Fare band | Urwego rw'igiciro |  |  |
| `intel.marginal.hourBuckets` | Hour of day | Isaha y'umunsi |  |  |
| `intel.marginal.other` | other (folded) | ibindi (byahurijwe hamwe) |  |  |
| `intel.marginal.vehicleTypes` | Vehicle | Ikinyabiziga |  |  |
| `intel.ops.attributes` | Attributes | Ibiranga |  |  |
| `intel.ops.bucket` | Bucket | Igice |  |  |
| `intel.ops.cellSize` | Cell | Akazu |  |  |
| `intel.ops.cells` | Cells | Utuzu |  |  |
| `intel.ops.classificationVersion` | Tier classification version {{version}} | Verisiyo y'ishyirwa mu byiciro {{version}} |  |  |
| `intel.ops.kThreshold` | k | k |  |  |
| `intel.ops.points` | Movements | Ingendo |  |  |
| `intel.ops.rangeClear` | Clear range | Siba igihe |  |  |
| `intel.ops.rangeFrom` | From | Kuva |  |  |
| `intel.ops.rangeIncomplete` | Give both dates, or leave both empty. | Shyiramo amatariki yombi, cyangwa usige yombi ubusa. |  |  |
| `intel.ops.rangeOutOfOrder` | The end date has to come after the start date. | Itariki yo kurangiriraho igomba kuza nyuma y’iyo watangiriyeho. |  |  |
| `intel.ops.rangeTo` | To | Kugeza |  |  |
| `intel.ops.rangeTooLarge` | That range is longer than the {{days}}-day maximum. | Icyo gihe kirenze iminsi {{days}} yemewe. |  |  |
| `intel.ops.rangeUnparseable` | That is not a date the server can read. | Iyi si itariki seriveri ishobora gusoma. |  |  |
| `intel.ops.reload` | Reload tier classification | Ongera upakire ishyirwa mu byiciro |  |  |
| `intel.ops.reloadFailed` | Could not reload the classification file. | Ntibyakunze kongera gupakira dosiye y'ishyirwa mu byiciro. |  |  |
| `intel.ops.reloaded` | Reloaded — version {{version}}. | Byongeye gupakirwa — verisiyo {{version}}. |  |  |
| `intel.ops.reloading` | Reloading… | Birimo kongera gupakirwa… |  |  |
| `intel.ops.runAccepted` | Accepted — the run is happening in the background. | Byemewe — birimo gukorwa inyuma. |  |  |
| `intel.ops.runAcceptedRange` | Accepted — re-building {{from}} to {{to}} in the background. | Byakiriwe — kwongera kubaka kuva {{from}} kugeza {{to}} birimo gukorwa. |  |  |
| `intel.ops.runFailed` | Could not start the run. | Ntibyakunze gutangira. |  |  |
| `intel.ops.runNow` | Run aggregation now | Teranya nonaha |  |  |
| `intel.ops.runNowNote` | Leave the dates empty to run the same lookback window as the nightly job. Give a range to re-build the aggregates for those days instead. | Siga amatariki ubusa kugira ngo ukoreshe igihe kimwe n'akazi ko nijoro. Shyiramo igihe kugira ngo wongere wubake imibare y'iyo minsi. |  |  |
| `intel.ops.runNowNoteCapped` | Leave the dates empty to run the same lookback window as the nightly job. Give a range of up to {{days}} days to re-build the aggregates for those days instead. | Siga amatariki ubusa kugira ngo ukoreshe igihe kimwe n'akazi ko nijoro. Shyiramo igihe kitarenze iminsi {{days}} kugira ngo wongere wubake imibare y'iyo minsi. |  |  |
| `intel.ops.running` | Starting… | Birimo gutangira… |  |  |
| `intel.ops.subtitle` | What the aggregation is configured to do, and what it produced in this range. | Icyo guteranya kwagenewe gukora, n'icyo kwakoze muri iki gihe. |  |  |
| `intel.ops.tier` | Tier | Urwego |  |  |
| `intel.ops.title` | Pipeline | Uburyo bwo guteranya |  |  |
| `intel.subtitle` | Aggregated, k-anonymised movement. This surface cannot show you a person, only a city. | Ingendo zateranyijwe kandi zihishwe amazina (k-anonymised). Iyi paji ntishobora kukwereka umuntu, yerekana umujyi gusa. |  |  |
| `intel.title` | Mobility intelligence | Ubwenge ku migendere |  |  |
| `intel.view.density` | Density | Ubwinshi |  |  |
| `intel.view.flows` | Flows | Ingendo |  |  |
| `journey.addressClear` | Clear | Siba |  |  |
| `journey.describePlaceHelp` | Anything that helps the driver find the exact spot | Ibintu byose byafasha motari kubona neza aho hantu |  |  |
| `journey.describePlaceLabel` | Describe the place (optional) | Sobanura aho hantu (ntibisabwa) |  |  |
| `journey.describePlacePlaceholder` | e.g. Kuwa Mudugudu | urugero: Kuwa Mudugudu |  |  |
| `journey.destinationDescriptionShown` | Destination notes | Ibisobanuro by’aho ujya |  |  |
| `journey.estimateDurationRange` | {{min}}–{{max}} min | iminota {{min}}–{{max}} |  |  |
| `journey.estimateLabel` | Estimates — the real price is what a motari offers | Ibigereranyo — igiciro nyacyo ni icyo umumotari atanga |  |  |
| `journey.estimateTypicalPrice` | about {{price}} RWF | nka {{price}} RWF |  |  |
| `journey.landmarkNeedsPin` | Tap the map to show where this is | Kanda ku ikarita werekane aho hantu hari |  |  |
| `journey.pickupDescriptionShown` | Pickup notes | Ibisobanuro by’aho uva |  |  |
| `layout.appHeader` | App header | Umutwe wa porogaramu |  |  |
| `layout.logoHome` | Go to home screen | Jya ku rupapuro rwa mbere |  |  |
| `legal.diagnosticsConsent` | When the app hits an error, this phone records what happened — the time, the app version, the screen you were on, and the error text. Phone numbers and sign-in codes are removed before it is saved. To help us fix problems quickly, these error records are sent automatically to the Bimoto team in Kigali. You can see exactly what would be sent on the Diagnostics screen, and you can turn automatic sending off at any time in Settings. Your messages, your trips and your location are never part of it. | Iyo porogaramu ihuye n'ikibazo, iyi telefoni yandika ibyabaye: isaha, verisiyo ya porogaramu, urupapuro wari uriho, n'ubutumwa bw'ikosa. Nimero za telefoni n'imibare yo kwinjira bikurwamo mbere yo kubikwa. Kugira ngo dukemure ibibazo vuba, izo nyandiko z'amakosa zoherezwa mu buryo bwikora ku ikipe ya Bimoto i Kigali. Ushobora kureba neza ibyoherezwa ku rupapuro rwa Diagnostics, kandi ushobora guhagarika kohereza kwikora igihe icyo ari cyo cyose muri Settings. Ubutumwa bwawe, ingendo zawe n'aho uri ntibijyanwa na rimwe. |  |  |
| `legal.rideTraceNotice` | Your position is recorded during rides and deliveries — for safety, and to settle disputes with facts. Traces are kept for 14 days and then deleted; if a ride is under dispute, its trace is kept until the dispute is settled. Nobody can watch your rides live — except our safety team during an emergency, until it is closed. | Aho uri handikwa mu gihe cy'ingendo n'ubwikorezi bw'ibintu — ku mutekano, no gukemura amakimbirane hashingiwe ku byabaye. Inzira zibikwa iminsi 14 hanyuma zigasibwa; niba urugendo rufite ikibazo, inzira yarwo ibikwa kugeza ikibazo gikemutse. Nta muntu ushobora kureba ingendo zawe mu buryo buhita — keretse itsinda ryacu ry'umutekano mu gihe cy'ubutabazi, kugeza ubutabazi bufunzwe. |  |  |
| `legal.safetyAckAgree` | I have read and accept these three safety rules | Nasomye kandi nemera aya mategeko atatu y’umutekano |  |  |
| `legal.safetyAckDriverRefuse` | As a driver, you also accept that you will refuse any ride that would break these rules, even if the passenger insists. | Nka umushoferi, wemera kandi ko uzanga urugendo rwose rwaba runyuranyije n’aya mategeko, n’ubwo umugenzi yabyifuza cyane. |  |  |
| `legal.safetyAckMinimumAge` | Anyone below the legal minimum age for a moto passenger may not be carried. | Umuntu wese utaragera ku myaka ngombwa yemewe n’amategeko yo kuba umugenzi wa moto ntashobora gutwarwa. |  |  |
| `legal.safetyAckNoInfants` | No babies or infants may ever be carried on a moto. This has no exception. | Nta mwana muto cyangwa uruhinja rwigeze rushobora gutwarwa kuri moto. Nta gahonzu na kamwe. |  |  |
| `legal.safetyAckOnePassenger` | A moto carries exactly one passenger. Never two, never a child in addition to an adult. | Moto itwara umugenzi umwe gusa. Ntibabiri, kandi nta mwana wiyongera ku muntu mukuru. |  |  |
| `legal.safetyAckTitle` | Safety rules you must accept | Amategeko y’umutekano ugomba kwemera |  |  |
| `legal.termsChildPolicy` | Children: children under 12 are not an independent booking option. A child travels with a responsible adult, who makes the booking and stays with the child for the whole trip. | Abana: abana bari munsi y'imyaka 12 ntibashobora gutumiza urugendo ubwabo. Umwana agendana n'umuntu mukuru ubishinzwe, ari na we utumiza urugendo kandi agumana n'umwana urugendo rwose. |  |  |
| `map.offline.chipDone` | The {{region}} map is on this phone — it works without internet now. | Ikarita ya {{region}} iri kuri iyi telefoni — ubu ikora nta internet. |  |  |
| `map.offline.chipOffer` | Download the {{region}} map ({{mb}} MB) so this works without internet | Kuramo ikarita ya {{region}} ({{mb}} MB) kugira ngo ibi bikore nta internet |  |  |
| `map.offline.chipProgress` | Downloading the {{region}} map… | Kuramo ikarita ya {{region}}… |  |  |
| `map.offline.deleteConfirmNamed` | Delete the offline map for {{region}}? Without it that area needs a connection again. | Gusiba ikarita ya {{region}} ikora nta murandasi? Idahari, ako karere kazongera gukenera umurandasi. |  |  |
| `map.offline.discard` | Discard | Siba |  |  |
| `map.offline.intro` | Keep maps on this phone so they show instantly, even with no connection. | Bika amakarita kuri iyi telefoni kugira ngo agaragare ako kanya, n'iyo nta murandasi uhari. |  |  |
| `map.offline.noSpace` | There isn't enough space on this phone for the offline map. Free some space and try again. | Nta mwanya uhagije uri kuri iyi telefone kugira ngo ikarita yo hanze ya interineti ibike. Sohora umwanya hanyuma wongere ugerageze. |  |  |
| `map.offline.paused` | Download paused | Gukurura byahagaritswe |  |  |
| `map.offline.resume` | Resume download | Komeza gukurura |  |  |
| `map.offline.resumeMeta` | {{mb}} MB already downloaded — it will carry on from there. | Miliyoni {{mb}} MB zamaze gukururwa — bizakomereza aho byagejeje. |  |  |
| `map.offline.size` | {{mb}} MB | MB {{mb}} |  |  |
| `map.offline.tierCountry` | The whole country | Igihugu cyose |  |  |
| `map.offline.tierDistrict` | Districts | Uturere |  |  |
| `map.offline.tierProvince` | Provinces | Intara |  |  |
| `map.regions.east` | Eastern Province | Iburasirazuba |  |  |
| `map.regions.kigali` | Kigali City | Umujyi wa Kigali |  |  |
| `map.regions.north` | Northern Province | Amajyaruguru |  |  |
| `map.regions.rwanda` | All of Rwanda | U Rwanda rwose |  |  |
| `map.regions.south` | Southern Province | Amajyepfo |  |  |
| `map.regions.west` | Western Province | Iburengerazuba |  |  |
| `map.routeChoiceHint` | Preview only — your driver may take a different road. | Ni icyitegererezo gusa — umumotari ashobora kunyura mu yindi nzira. |  |  |
| `map.routeOption` | Route {{n}} | Inzira ya {{n}} |  |  |
| `map.routeOptionsLabel` | Route options | Amahitamo y'inzira |  |  |
| `map.routeUnavailable` | Route unavailable — showing direct line | Inzira ntibonetse — hagaragajwe umurongo utaziguye |  |  |
| `moneyPin.alreadySet` | You already have a money PIN. | Usanzwe ufite kode y'amafaranga. |  |  |
| `moneyPin.backspace` | Delete last digit | Siba umubare wa nyuma |  |  |
| `moneyPin.badFormat` | A money PIN is 4 digits. | Kode y'amafaranga igizwe n'imibare 4. |  |  |
| `moneyPin.changeCta` | Change my PIN | Hindura kode yanjye |  |  |
| `moneyPin.changed` | Your money PIN was changed. | Kode y'amafaranga yawe yahinduwe. |  |  |
| `moneyPin.chooseNew` | Choose 4 new digits | Hitamo imibare 4 mishya |  |  |
| `moneyPin.confirmNew` | Enter the same 4 digits again | Ongera wandike iyo mibare 4 imwe |  |  |
| `moneyPin.digitsEntered` | {{count}} of {{total}} digits entered | Wanditse imibare {{count}} kuri {{total}} |  |  |
| `moneyPin.enrollTitle` | Set your money PIN | Shyiraho kode y'amafaranga |  |  |
| `moneyPin.enrollWhy` | Choose 4 digits. From now on Bimoto asks for them before showing your balance or changing where your money goes. Nowhere else. | Hitamo imibare 4. Guhera ubu Bimoto izayisaba mbere yo kukwereka amafaranga yawe cyangwa guhindura aho ajya. Ahandi hose ntacyo. |  |  |
| `moneyPin.enterCurrent` | Enter your current PIN | Andika kode usanzwe ukoresha |  |  |
| `moneyPin.forgotCta` | I forgot my PIN | Nibagiwe kode yanjye |  |  |
| `moneyPin.genericError` | That did not work. Try again. | Ntibyakunze. Ongera ugerageze. |  |  |
| `moneyPin.lockedShort` | Too many wrong tries. Wait a little, then try again. | Wagerageje inshuro nyinshi. Tegereza gato, ubone kongera kugerageza. |  |  |
| `moneyPin.lockedTitle` | Too many wrong tries | Wagerageje inshuro nyinshi |  |  |
| `moneyPin.lockedUntil` | Too many wrong tries. You can try again after {{time}}. | Wagerageje inshuro nyinshi. Ushobora kongera kugerageza nyuma ya {{time}}. |  |  |
| `moneyPin.mismatch` | Those did not match. Start again. | Ntabwo zihuye. Ongera utangire. |  |  |
| `moneyPin.notNow` | Not now | Ubu si ubu |  |  |
| `moneyPin.padLabel` | Money PIN keypad | Ahanditse kode y'amafaranga |  |  |
| `moneyPin.pendingWarning` | Someone asked to change your money PIN. The new one starts working on {{time}}. If this was not you, change your PIN now with the one you know — that cancels it. | Hari usabye guhindura kode y'amafaranga yawe. Iyo nshya izatangira {{time}}. Niba atari wowe, hindura kode yawe ubu ukoresheje iyo uzi — ibyo birabihagarika. |  |  |
| `moneyPin.resetDoneTitle` | Your new PIN starts tomorrow | Kode nshya itangira ejo |  |  |
| `moneyPin.resetExplain` | Your new PIN will work from {{time}} — about a day from now. | Kode yawe nshya izatangira gukora kuva {{time}} — nka nyuma y'umunsi umwe. |  |  |
| `moneyPin.resetOldStillWorks` | Your old PIN keeps working until then. If you remember it, use it — that cancels this change straight away. | Kode yawe ya kera iracyakora kugeza icyo gihe. Niba uyibuka, yikoreshe — ibyo bihagarika iri hinduka ako kanya. |  |  |
| `moneyPin.resetSmsSent` | We sent a code to your phone. | Twoherereje kode kuri telefone yawe. |  |  |
| `moneyPin.resetTitle` | Reset your money PIN | Hindura kode y'amafaranga |  |  |
| `moneyPin.resetWhy` | We wait a day because anyone holding your phone can also read your SMS. The wait gives you time to notice. We have just sent you a message about this change. | Dutegereza umunsi kuko ufashe telefone yawe ashobora no gusoma SMS zawe. Uwo munsi uguha umwanya wo kubimenya. Turakoherereje ubutumwa kuri iri hinduka. |  |  |
| `moneyPin.settingsHelp` | The 4 digits Bimoto asks for before showing your balance or changing where your money goes. | Imibare 4 Bimoto isaba mbere yo kukwereka amafaranga yawe cyangwa guhindura aho ajya. |  |  |
| `moneyPin.settingsTitle` | Money PIN | Kode y'amafaranga |  |  |
| `moneyPin.smsCodeLabel` | Code from the SMS | Kode yo muri SMS |  |  |
| `moneyPin.verifyTitle` | Enter your money PIN | Andika kode y'amafaranga |  |  |
| `moneyPin.verifyWhy` | This screen shows your money. | Uru rupapuro rwerekana amafaranga yawe. |  |  |
| `moneyPin.wrongPin` | Wrong PIN. Try again. | Kode ntiyemewe. Ongera ugerageze. |  |  |
| `notify.bidCountered` | A passenger suggested {{amount}} RWF for your offer | Umugenzi yasabye {{amount}} RWF ku giciro watanze |  |  |
| `notify.counterAccepted` | Your price of {{amount}} RWF was accepted | Igiciro cyawe cya {{amount}} RWF cyemewe |  |  |
| `notify.counterDeclined` | Your price was not accepted — the offer of {{price}} RWF still stands | Igiciro cyawe nticyemewe — igiciro cya {{price}} RWF kiracyahari |  |  |
| `notify.disputeClosed` | Your dispute was closed with no action | Ikirego cyawe cyafunzwe nta cyakozwe |  |  |
| `notify.disputeRejected` | Your dispute was not upheld | Ikirego cyawe nticyemewe |  |  |
| `notify.disputeUpheld` | Your dispute was upheld | Ikirego cyawe cyemewe |  |  |
| `notify.escrowRefunded` | {{amount}} RWF has been returned to you | {{amount}} RWF wagarujwe |  |  |
| `notify.escrowReleased` | You were paid {{amount}} RWF | Wishyuwe {{amount}} RWF |  |  |
| `notify.noShowWarning` | No-show warning ({{count}}) — this affects your account | Umuburo wo kutitaba ({{count}}) — bigira ingaruka kuri konti yawe |  |  |
| `notify.ratingReceived` | You received a {{count}}-star rating | Wahawe amanyenyeri {{count}} |  |  |
| `notify.verificationApproved` | Your account is verified — you can start working | Konti yawe yemejwe — ushobora gutangira gukora |  |  |
| `notify.verificationRejected` | Your verification was not approved — check your documents | Kwemeza konti yawe ntibyakunze — reba inyandiko zawe |  |  |
| `outbox.cancel` | Cancel this booking | Hagarika iri tegeko |  |  |
| `outbox.cancelled` | Booking cancelled | Itegeko ryahagaritswe |  |  |
| `outbox.dismiss` | Dismiss | Funga |  |  |
| `outbox.done` | Done | Byarangiye |  |  |
| `outbox.empty` | Nothing is waiting to be sent. | Nta kintu gitegereje koherezwa. |  |  |
| `outbox.rejectedGeneric` | The server did not accept this booking. | Seriveri ntiyemeye iri tegeko. |  |  |
| `outbox.rejectedLabel` | Saved booking | Itegeko ryabitswe |  |  |
| `outbox.savedBody` | You have no connection right now. We will send this booking the moment you are back online. | Nta murandasi ufite ubu. Tuzohereza iri tegeko ako kanya nimugarukira kuri murandasi. |  |  |
| `outbox.savedRoute` | {{from}} → {{to}} | {{from}} → {{to}} |  |  |
| `outbox.savedTitle` | Saved on this phone | Byabitswe kuri iyi telefone |  |  |
| `outbox.savedToast` | Saved on this phone — it will go out when there is signal | Byabitswe kuri iyi telefoni — bizohereza igihe umurandasi uzagaruka |  | CHROME-C: the toast shown the moment a booking is held on the phone. Same job and same tone as the strip it replaces — calm statement of fact, never an apology or a warning — but it now has to work as a sentence that appears and leaves on its own, so it must be complete and readable at a glance. |
| `outbox.sentTitle` | Your saved booking was sent | Itegeko ryawe ryabitswe ryoherejwe |  |  |
| `outbox.view` | View the ride | Reba urugendo |  |  |
| `outbox.waitingCount` | {{count}} bookings saved on this phone | Amategeko {{count}} yabitswe kuri iyi telefone |  |  |
| `outbox.waitingCount_one` | {{count}} booking saved on this phone — tap to review | Itegeko {{count}} ryabitswe kuri iyi telefone — kanda urebe |  |  |
| `outbox.waitingCount_other` | {{count}} bookings saved on this phone — tap to review | Amategeko {{count}} yabitswe kuri iyi telefone — kanda urebe |  |  |
| `outbox.waitingTitle` | Waiting to send | Bitegereje koherezwa |  |  |
| `parcel.badge` | PARCEL | UMUZIGO |  |  |
| `parcel.badgeAriaLabel` | Parcel delivery | Kohereza umuzigo |  |  |
| `parcel.weightKg` | {{weight}} kg | {{weight}} kg |  |  |
| `parcelWeight.bicycleAlone` | A bicycle carrying only a parcel can take up to {{max}} kg. | Igare ritwaye gusa ipaki rishobora gutwara kugeza ku biro {{max}}. |  |  |
| `parcelWeight.bicycleWithPassenger` | A bicycle carrying a passenger can take a parcel up to {{max}} kg. | Igare ritwaye umugenzi rishobora gutwara ipaki y'ibiro {{max}} nibura. |  |  |
| `parcelWeight.label` | Weight | Ibiro |  |  |
| `parcelWeight.motoAlone` | A moto carrying only a parcel takes envelope-size items. | Moto itwaye gusa ipaki itwara ibintu bingana n'ibahasha. |  |  |
| `parcelWeight.motoWithPassenger` | A moto carrying a passenger can take a parcel up to {{max}} kg. | Moto itwaye umugenzi ishobora gutwara ipaki y'ibiro {{max}} nibura. |  |  |
| `parcelWeight.placeholder` | How heavy is it? | Bifite ibiro bingana bite? |  |  |
| `payment.reason.declined` | Your Mobile Money provider refused the payment. | Uwo utanga Mobile Money yanze kwishyura. |  |  |
| `payment.reason.gatewayDown` | Payments are having trouble right now. Try again in a moment. | Kwishyura birimo ikibazo muri iki gihe. Ongera ugerageze nyuma gato. |  |  |
| `payment.reason.insufficientFunds` | Not enough money on your Mobile Money account. Top up, then try again. | Nta mafaranga ahagije kuri konti yawe ya Mobile Money. Yongeremo, hanyuma ugerageze. |  |  |
| `payment.reason.invalidWallet` | That Mobile Money number was not accepted. Check the number on your account. | Iyi nomero ya Mobile Money ntiyemewe. Reba nomero ya konti yawe. |  |  |
| `payment.reason.timeout` | Mobile Money did not answer in time. You were not charged. | Mobile Money ntiyasubije ku gihe. Nta mafaranga yakuweho. |  |  |
| `payment.reason.unknown` | The payment did not go through. You were not charged. | Kwishyura ntibyagenze. Nta mafaranga yakuweho. |  |  |
| `payment.recover.checkPhone` | Check your phone and approve the Mobile Money request. | Reba kuri telefone yawe wemeze icyifuzo cya Mobile Money. |  |  |
| `payment.recover.driverHeld` | Your driver is still holding this ride. Pay again and you keep them. | Umumotari wawe aracyakubitseho urugendo. Ongera wishyure, agume ari uwawe. |  |  |
| `payment.recover.iApproved` | I approved it | Nabyemeje |  |  |
| `payment.recover.payByCard` | Pay by card instead | Wishyure ukoresheje ikarita |  |  |
| `payment.recover.seeMyRide` | See my ride | Reba urugendo rwanjye |  |  |
| `payment.recover.stillWaiting` | Still waiting for your Mobile Money approval. | Turacyategereje ko wemeza Mobile Money. |  |  |
| `payment.recover.title` | Payment didn't go through | Kwishyura ntibyagenze |  |  |
| `payment.recover.tooManyAttempts` | Too many attempts. Wait a minute, then try again. | Wagerageje kenshi cyane. Tegereza umunota, ongere ugerageze. |  |  |
| `payment.recover.tryMomo` | Try Mobile Money again | Ongera ugerageze Mobile Money |  |  |
| `payout.costImmediateWithdrawal` | If you ask to be paid immediately, outside your schedule, the {{fee}} RWF transfer fee comes out of your money. | Nusaba kwishyurwa ako kanya, hanze y'igihe wihitiyemo, amafaranga yo kohereza {{fee}} RWF akurwa ku mafaranga yawe. |  |  |
| `payout.costScheduled` | Costs you nothing — Bimoto pays the {{fee}} RWF transfer fee. | Nta kiguzi ubona — Bimoto ni yo yishyura amafaranga yo kohereza {{fee}} RWF. |  |  |
| `profile.adminDashboard` | Admin dashboard | Ikibaho cy'ubuyobozi |  |  |
| `rating.detailsLabel` | Anything else? (optional) | Hari ikindi? (si ngombwa) |  |  |
| `rating.detailsPlaceholder` | In your own words | Mu magambo yawe bwite |  |  |
| `rating.rateYourRide` | How was your ride? | Urugendo rwawe rwagenze rute? |  |  |
| `rating.reason.OTHER` | Something else | Ikindi kintu |  |  |
| `rating.reason.PRICE_DISAGREEMENT` | Disagreement about the price | Kutumvikana ku giciro |  |  |
| `rating.reason.RUDE_BEHAVIOUR` | Rude behaviour | Imyitwarire mibi |  |  |
| `rating.reason.UNSAFE_DRIVING` | Unsafe driving | Gutwara nabi bishobora guteza impanuka |  |  |
| `rating.reason.VEHICLE_CONDITION` | Condition of the motorcycle | Imiterere ya moto |  |  |
| `rating.reason.WRONG_ROUTE` | Took the wrong route | Yanyuze inzira itari yo |  |  |
| `rating.reasonGiven` | Reason: | Impamvu: |  |  |
| `rating.reasonLabel` | What went wrong? (optional) | Ni iki kitagenze neza? (si ngombwa) |  |  |
| `rating.reasonNone` | Rather not say | Sinshaka kubivuga |  |  |
| `rating.reasonOptional` | Both are optional. Your stars are sent either way. | Byombi si ngombwa. Inyenyeri zawe zoherezwa uko byagenda kose. |  |  |
| `rating.submit` | Send rating | Ohereza amanota |  |  |
| `rating.thankYou` | Thank you — your rating helps other passengers. | Murakoze — amanota yawe afasha abandi bagenzi. |  |  |
| `rating.yourRating` | Your rating | Amanota yawe |  |  |
| `register.useDifferentNumber` | Use a different number | Koresha indi nimero |  |  |
| `report.alreadyFiled` | You have reported this ride. | Wamaze gutanga ikibazo kuri uru rugendo. |  |  |
| `report.detailsLabel` | Anything else? (optional) | Hari ikindi? (si ngombwa) |  |  |
| `report.detailsPlaceholder` | In your own words | Mu magambo yawe bwite |  |  |
| `report.filed` | Report sent. Thank you. | Ikibazo cyoherejwe. Murakoze. |  |  |
| `report.openLink` | Report a problem with this ride | Tanga ikibazo kuri uru rugendo |  |  |
| `report.reason.NO_SHOW_OR_LATE` | Passenger did not come, or kept me waiting | Umugenzi ntiyaje, cyangwa yantegereje igihe kirekire |  |  |
| `report.reason.OTHER` | Something else | Ikindi kintu |  |  |
| `report.reason.REFUSED_AGREED_PRICE` | Refused to pay the agreed price | Yanze kwishyura igiciro twumvikanyeho |  |  |
| `report.reason.RUDE_BEHAVIOUR` | Rude behaviour | Imyitwarire mibi |  |  |
| `report.reason.UNSAFE_REQUEST` | Asked me to do something unsafe | Yansabye gukora ikintu gishobora guteza akaga |  |  |
| `report.reasonLabel` | What happened? | Ni iki cyabaye? |  |  |
| `report.reasonNone` | Choose one | Hitamo kimwe |  |  |
| `report.reviewNote` | This goes to the Bimoto team to look at. The passenger is not scored, and is not told who reported. | Ibi bijya ku itsinda rya Bimoto kugira ngo babisuzume. Umugenzi ntahabwa amanota, kandi ntabwo amenyeshwa uwatanze ikibazo. |  |  |
| `report.submit` | Send report | Ohereza ikibazo |  |  |
| `report.title` | Report a problem with this ride | Tanga ikibazo kuri uru rugendo |  |  |
| `scheduled.commitmentAssigned` | Confirmed — this ride is yours | Byemejwe — uru rugendo ni urwawe |  |  |
| `scheduled.commitmentBidPending` | Your offer is waiting for the passenger | Igiciro watanze gitegereje umugenzi |  |  |
| `scheduled.viewOffers` | View offers | Reba ibyifuzo |  |  |
| `scheduled.yourOffer` | Your offer | Igiciro watanze |  |  |
| `settings.contactFormatHint` | 07XX XXX XXX, or with a country code (+250, +44…) | 07XX XXX XXX, cyangwa hamwe na kode y'igihugu (+250, +44…) |  |  |
| `settings.diagnosticsUpload` | Send error reports automatically | Kohereza raporo z'amakosa mu buryo bwikora |  |  |
| `settings.diagnosticsUploadHelp` | Lets the Bimoto team see errors this phone hits, without you having to report them. Only the error records shown on the Diagnostics screen are sent — never your messages, trips or location. Turn this off and nothing is sent unless you tap Send report yourself. | Bituma ikipe ya Bimoto ibona amakosa iyi telefoni ihura na yo, utagombye kubimenyesha. Hoherezwa gusa inyandiko z'amakosa zigaragara ku rupapuro rwa Diagnostics — ntabwo ari ubutumwa bwawe, ingendo zawe cyangwa aho uri. Nubihagarika nta kintu kizoherezwa keretse wikanze Ohereza raporo ubwawe. |  |  |
| `settings.mapsOffline` | Maps & offline | Amakarita no gukora nta internet |  |  |
| `settings.mapsOfflineHelp` | Keep maps on this phone so they show instantly, even with no connection. | Bika amakarita kuri iyi telefoni kugira ngo agaragare ako kanya, ndetse nta murandasi. |  |  |
| `settings.mapsOfflineOpen` | Manage offline maps | Gucunga amakarita yo gukoresha nta internet |  |  |
| `settings.notificationSounds` | Notification sounds | Amajwi y'ubutumwa |  |  |
| `settings.notificationSoundsHelp` | Play the Bimoto sound when something happens — an offer, a ride, a payment. Turning this off keeps the messages on screen; only the sound stops. | Kuvuza ijwi rya Bimoto iyo hari ikibaye — igiciro, urugendo, ubwishyu. Iyo uhagaritse, ubutumwa buguma ku kizamini; ijwi ryonyine ni ryo rihagarara. |  |  |
| `toast.more` | +{{count}} more | +{{count}} ibindi |  |  |
| `transparency.customerFeeWaived` | Platform fee waived during the pilot. | Amafaranga ya porogaramu yarasonewe mu gihe cy’igerageza. |  |  |
| `transparency.customerTierLine` | Your tier: {{tier}} | Urwego rwawe: {{tier}} |  |  |
| `transparency.totalPlatformFeeExact` | Platform fee: {{rate}}% | Amafaranga ya porogaramu: {{rate}}% |  |  |
| `vehicleTypeInfo.any.label` | Any vehicle | Ikinyabiziga icyo ari cyo cyose |  |  |
| `vehicleTypeInfo.any.whoCanOffer` | Offers may come from bicycles, motos and e-motos. | Ibiciro bishobora guturuka ku magare, kuri moto no kuri e-moto. |  |  |
| `vehicleTypeInfo.any.youChoose` | You choose from the offers that arrive. | Uhitamo mu biciro byaje. |  |  |
| `verification.dashboardBannerBody` | Add your licence, authorization and insurance so you can be approved. | Ongeraho uruhushya rwo gutwara, uburenganzira n'ubwishingizi kugira ngo wemererwe. |  |  |
| `verification.dashboardBannerTitle` | Finish your driver documents | Uzuza impapuro zawe z'umumotari |  |  |
| `verification.myDocuments` | My documents | Impapuro zanjye |  |  |

## Review first: Kinyarwanda identical to English

| Key | Value (identical in both) | Reason | Reviewer's RW | Note |
|-----|---------------------------|--------|---------------|------|
| `app.name` | Bimoto | `brand` |  |  |
| `auth.phone_placeholder` | +250 7XX XXX XXX | `placeholder` |  |  |
| `autoBid.vehicleMoto` | Moto | `needs-decision` |  |  |
| `common.ok` | OK | `needs-decision` |  |  |
| `driverApproach.driverLabel` | {{driverName}} | `placeholder` |  |  |
| `goods.recipientPhonePlaceholder` | +250 7XX XXX XXX | `placeholder` |  |  |
| `intel.cell.window` | {{from}} — {{to}} | `placeholder` |  |  |
| `intel.ops.kThreshold` | k | `needs-decision` |  |  |
| `journey.distance` | {{distance}} km | `placeholder` |  |  |
| `journey.ebike` | E-Bike | `needs-decision` |  |  |
| `journey.emoto` | E-Moto | `needs-decision` |  |  |
| `journey.moto` | Moto | `needs-decision` |  |  |
| `login.phonePlaceholder` | 7XX XXX XXX | `placeholder` |  |  |
| `outbox.savedRoute` | {{from}} → {{to}} | `placeholder` |  |  |
| `parcel.weightKg` | {{weight}} kg | `placeholder` |  |  |
| `payment.method.cardHint` | Visa, Mastercard, Apple Pay, Google Pay | `brand` |  |  |
| `payment.method.momo` | Mobile Money | `brand` |  |  |
| `payout.codePlaceholder` | 000000 | `placeholder` |  |  |
| `profile.contactPhonePlaceholder` | +250 7XX XXX XXX | `placeholder` |  |  |
| `scheduled.conflictRide` | {{time}} · {{pickup}} → {{destination}} | `placeholder` |  | Interpolated line: time · pickup → destination |
| `settings.contactPlaceholder` | +250 7XX XXX XXX | `placeholder` |  |  |
| `urgent.recipientPhonePlaceholder` | +250 7XX XXX XXX | `placeholder` |  |  |
| `vehicle.eBike` | E-Bike | `needs-decision` |  |  |
| `vehicle.eMoto` | E-Moto | `needs-decision` |  |  |
| `vehicle.e_bike` | E-Bike | `needs-decision` |  |  |
| `vehicle.e_moto` | E-Moto | `needs-decision` |  |  |
| `vehicle.moto` | Moto | `needs-decision` |  |  |
| `welcome.languageEn` | English | `proper-noun` |  |  |
| `welcome.languageFr` | Français | `proper-noun` |  |  |
| `welcome.languageRw` | Kinyarwanda | `proper-noun` |  |  |

## Review first: stub values

Kinyarwanda values that are markers rather than translations.

| Key | English | Current RW | Reviewer's RW |
|-----|---------|------------|---------------|
| `errors.invalid_transition` | Invalid status transition. | [RW] Invalid status transition. |  |

---

# `translation.json` — every key, side by side

## Namespace: `account`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `account.cancellationCount` |  | Cancellations | Annulations | Ihagarikwa |  |  |
| `account.deleteAccount` |  | Delete My Account | Supprimer mon compte | Siba konti yanjye |  |  |
| `account.disputeClosedNoAction` |  | Closed — no action | Clôturée — aucune action | Cyafunzwe — nta gikorwa |  |  |
| `account.disputePending` |  | Pending review | En attente d’examen | Bitegerejwe iperereza |  |  |
| `account.disputeRejected` |  | Rejected — original stands | Rejetée — décision initiale maintenue | Cyanzwe — icyemezo cya mbere kiracyahari |  |  |
| `account.disputeUpheld` |  | Upheld — no-show removed | Acceptée — absence retirée | Cyemewe — kudahari kwakuwe |  |  |
| `account.driverInitiatedCancellationCount` |  | Honest withdrawals | Retraits honnêtes | Kwivana mu rugendo |  |  |
| `account.exportButton` |  | Download My Data (JSON) | Télécharger mes données (JSON) | Kuramo amakuru yanjye (JSON) |  |  |
| `account.exportData` |  | Export My Data | Exporter mes données | Kuramo amakuru yanjye |  |  |
| `account.fetchFailed` |  | Could not load account status | Impossible de charger le statut du compte | Ntibyashobotse gufungura imimerere ya konti |  |  |
| `account.flagThreshold` |  | Admin review | Examen administrateur | Iperereza ry'umuyobozi |  |  |
| `account.frozenBody` |  | Your account has been frozen — contact support. | Votre compte a été gelé — contactez l’assistance. | Konti yawe yahagaritswe — vugana n’ubufasha. |  | Body of the blocking freeze notice; acknowledging logs the user out |
| `account.frozenTitle` |  | Account frozen | Compte gelé | Konti yahagaritswe burundu |  | Title of the blocking freeze notice |
| `account.lateMarkCount` |  | Late marks | Retards | Gukererwa |  |  |
| `account.noRecentDisputes` |  | No disputes filed yet | Aucune contestation déposée | Nta kibazo cyatanzwe |  |  |
| `account.noShowCount` |  | No-shows | Absences | Kudahari |  |  |
| `account.recentDisputes` |  | Recent disputes | Contestations récentes | Ibibazo bya vuba |  |  |
| `account.statusActive` |  | Active | Actif | Irakora |  |  |
| `account.statusFlagged` |  | Flagged for review | Signalé pour examen | Yamenyekanyeshejwe kuri iperereza |  |  |
| `account.statusSuspended` |  | Suspended until {{until}} | Suspendu jusqu’au {{until}} | Yahagaritswe kugeza {{until}} |  |  |
| `account.suspensionThreshold` |  | 24h suspension | Suspension 24 h | Guhagarikwa amasaha 24 |  |  |
| `account.title` |  | Account status | Statut du compte | Imimerere ya konti |  |  |
| `account.viewAccount` |  | View account status | Voir le statut du compte | Reba imiterere ya konti |  |  |
| `account.warningThreshold` |  | Warning | Avertissement | Iburira |  |  |
| `account.wrongVehicleCount` |  | Wrong-vehicle reports | Mauvais véhicule | Ikinyabiziga kitari cyo |  |  |

## Namespace: `activeJourney`

> TODO(rw): native review required for the 'activeJourney' keys.

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `activeJourney.inProgressDelivery` | **NEW** | Delivery in progress | Livraison en cours | Kohereza birakomeje |  |  |
| `activeJourney.inProgressRide` | **NEW** | Ride in progress | Course en cours | Urugendo rurakomeje |  |  |
| `activeJourney.matchedCustomer` | **NEW** | Driver on the way | Chauffeur en route | Umumotari ari mu nzira |  |  |
| `activeJourney.matchedDriver` | **NEW** | Matched — head to the pickup | Course attribuée — allez au point de départ | Wabonye urugendo — jya aho bagutegereje |  |  |
| `activeJourney.resume` | **NEW** | Tap to return | Touchez pour revenir | Kanda usubireyo |  |  |
| `activeJourney.titleDelivery` | **NEW** | Active delivery | Livraison active | Kohereza birimo gukorwa |  |  |
| `activeJourney.titleRide` | **NEW** | Active ride | Course active | Urugendo rurimo gukorwa |  |  |
| `activeJourney.waitingForOffers` | **NEW** | Waiting for offers | En attente d’offres | Gutegereza ibiciro |  |  |

## Namespace: `activeRide`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `activeRide.duration` |  | Duration | Durée | Igihe |  |  |
| `activeRide.endConfirm` |  | End this journey now? | Terminer cette course maintenant ? | Gusoza uru rugendo nonaha? |  |  |
| `activeRide.endFailed` |  | Could not end the journey | Impossible de terminer la course | Ntibyakunze gusoza urugendo |  |  |
| `activeRide.endJourney` |  | End journey | Terminer la course | Soza urugendo |  |  |
| `activeRide.ended` |  | Journey ended | Course terminée | Urugendo rurangiye |  |  |
| `activeRide.fetchFailed` |  | Could not load the ride | Impossible de charger la course | Ntibyakunze gufungura urugendo |  |  |
| `activeRide.readySubtitle` |  | Start the journey when your passenger is ready | Démarrez la course quand votre passager est prêt | Tangira urugendo iyo umugenzi yiteguye |  |  |
| `activeRide.readyToStart` |  | Ready to start | Prêt à démarrer | Witeguye gutangira |  |  |
| `activeRide.recording` |  | GPS recording | Enregistrement GPS | GPS irakora |  |  |
| `activeRide.startFailed` |  | Could not start the journey | Impossible de démarrer la course | Ntibyakunze gutangira urugendo |  |  |
| `activeRide.startJourney` |  | Start journey | Démarrer la course | Tangira urugendo |  |  |
| `activeRide.started` |  | Journey started | Course démarrée | Urugendo rwatangiye |  |  |

## Namespace: `admin`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `admin.funnel.actions.exportCsv` |  | Export CSV | Exporter en CSV | Sohora CSV |  |  |
| `admin.funnel.cityBands.bugesera_corridor` |  | Bugesera Corridor | Corridor Bugesera | Inzira ya Bugesera |  |  |
| `admin.funnel.cityBands.kigali_dense` |  | Kigali Dense | Kigali dense | Kigali rwagati |  |  |
| `admin.funnel.cityBands.kigali_periphery` |  | Kigali Periphery | Kigali périphérie | Kigali hanze |  |  |
| `admin.funnel.cityBands.other` |  | Other | Autre | Ahandi |  |  |
| `admin.funnel.filters.allCityBands` |  | All city bands | Toutes les zones | Uturere twose |  |  |
| `admin.funnel.filters.allCooperatives` |  | All cooperatives | Toutes les coopératives | Koperative zose |  |  |
| `admin.funnel.filters.cityBand` |  | City band | Zone de la ville | Akarere k'umujyi |  |  |
| `admin.funnel.filters.cooperative` |  | Cooperative ID | ID coopérative | ID ya koperative |  |  |
| `admin.funnel.filters.weekOf` |  | Week | Semaine | Icyumweru |  |  |
| `admin.funnel.metrics.acceptanceRate` |  | Acceptance rate | Taux d'acceptation | Igipimo cyo kwemera |  |  |
| `admin.funnel.metrics.bidsPerRide` |  | Bids per ride (mean) | Offres par course (moyenne) | Ibyciro kuri buri rugendo (impuzandengo) |  |  |
| `admin.funnel.metrics.cancellationRate` |  | Cancellation rate | Taux d'annulation | Igipimo cyo guhagarika |  |  |
| `admin.funnel.metrics.offlineSyncSuccess` |  | Offline-sync success rate | Taux de réussite de synchro hors-ligne | Igipimo cy'intsinzi ya sync ya offline |  |  |
| `admin.funnel.metrics.parcelRecipientConfirmation` |  | Parcel recipient SMS-confirm rate | Taux de confirmation SMS destinataire | Igipimo cyo kwemeza ako pasiti na SMS |  |  |
| `admin.funnel.metrics.timeToFirstBid` |  | Time-to-first-bid (median) | Délai jusqu'à la première offre (médiane) | Igihe cy'iya mbere y'igiciro (median) |  |  |
| `admin.funnel.stages.active` |  | Active | Actifs | Bakora |  |  |
| `admin.funnel.stages.onboarded` |  | Onboarded | Intégrés | Bashyizwemo |  |  |
| `admin.funnel.stages.registered` |  | Registered | Inscrits | Banditse |  |  |
| `admin.funnel.stages.screenerQualified` |  | Screener-qualified | Qualifiés par questionnaire | Bemejwe n'ibibazo |  |  |
| `admin.funnel.states.empty` |  | No drivers registered for this filter yet. | Aucun chauffeur inscrit pour ce filtre. | Nta moderi yanditse muri iyi filitiri. |  |  |
| `admin.funnel.states.errorRetry` |  | Could not load funnel metrics. Tap to retry. | Impossible de charger les indicateurs. Toucher pour réessayer. | Ntibyashobotse kupakira ibipimo. Kanda usubiremo. |  |  |
| `admin.funnel.states.loading` |  | Loading funnel metrics… | Chargement des indicateurs… | Birapakira ibipimo… |  |  |
| `admin.funnel.subtitle` |  | 4-stage funnel + operational metrics for the 500-driver pilot. | Entonnoir à 4 étapes + indicateurs opérationnels pour le pilote de 500 chauffeurs. | Igisingi cy'ibyiciro 4 + ibipimo by'imikorere by'abamotari 500 ba pilote. |  |  |
| `admin.funnel.title` |  | Pilot Funnel | Entonnoir pilote | Igisingi cya pilote |  |  |

## Namespace: `app`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `app.name` | same-as-EN: brand | Bimoto | Bimoto | Bimoto |  |  |
| `app.tagline` |  | Your ride, your price | Votre course, votre prix | Urugendo rwawe, igiciro cyawe |  |  |

## Namespace: `appLock`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `appLock.call112` | **NEW** | Call 112 | Appeler le 112 | Hamagara 112 |  |  |
| `appLock.chooseCode` | **NEW** | Choose a code of at least {{min}} digits | Choisissez un code d'au moins {{min}} chiffres | Hitamo kode y'imibare itari munsi ya {{min}} |  |  |
| `appLock.confirmCode` | **NEW** | Enter the same code again | Entrez le meme code a nouveau | Ongera wandike iyo kode imwe |  |  |
| `appLock.disableCta` | **NEW** | Turn off app lock | Desactiver le verrou | Hagarika urufunguzo |  |  |
| `appLock.disabled` | **NEW** | App lock is off. | Le verrou est desactive. | Urufunguzo rwahagaritswe. |  |  |
| `appLock.enableCta` | **NEW** | Turn on app lock | Activer le verrou | Fungura urufunguzo |  |  |
| `appLock.enabled` | **NEW** | App lock is on. It will ask next time you open the app. | Le verrou est actif. Il sera demande a la prochaine ouverture. | Urufunguzo rurakora. Ruzasabwa ubutaha ufunguye porogaramu. |  |  |
| `appLock.enterCodeToDisable` | **NEW** | Enter your app code | Entrez votre code d'application | Andika kode ya porogaramu |  |  |
| `appLock.forgotHelp` | **NEW** | Forgot your code? Log out and log back in with an SMS code. Logging out removes the app lock. | Code oublie ? Deconnectez-vous et reconnectez-vous avec un code SMS. La deconnexion enleve le verrou. | Wibagiwe kode? Sohoka wongere winjire ukoresheje kode ya SMS. Gusohoka bikuraho urufunguzo rwa porogaramu. |  |  |
| `appLock.formatHelp` | **NEW** | At least {{min}} digits — longer than your 4-digit money PIN, so the two can never be the same. | Au moins {{min}} chiffres — plus long que votre code argent a 4 chiffres, pour que les deux ne soient jamais identiques. | Nibura imibare {{min}} — ndende kurusha kode y'amafaranga y'imibare 4, kugira ngo zitigere zisa. |  |  |
| `appLock.logoutCta` | **NEW** | Log out | Se deconnecter | Sohoka |  |  |
| `appLock.mismatch` | **NEW** | Those did not match. Start again. | Ils ne correspondent pas. Recommencez. | Ntabwo zihuye. Ongera utangire. |  |  |
| `appLock.padLabel` | **NEW** | App lock keypad | Clavier du verrou d'application | Ahanditse kode ya porogaramu |  |  |
| `appLock.recommendDriver` | **NEW** | If you sometimes hand your phone to other people, an app lock is worth turning on. | Si vous confiez parfois votre telephone a d'autres personnes, le verrou d'application vaut la peine d'etre active. | Niba rimwe na rimwe uha abandi telefone yawe, urufunguzo rwa porogaramu rufite akamaro. |  |  |
| `appLock.rejectMoneyPinLength` | **NEW** | That is 4 digits, which is a money PIN. Your app code needs at least {{min}}, so you can never mix the two up. | Cela fait 4 chiffres, c'est un code argent. Votre code d'application doit en avoir au moins {{min}}, pour que vous ne puissiez jamais les confondre. | Iyo ni imibare 4, ni kode y'amafaranga. Kode ya porogaramu isaba nibura imibare {{min}}, kugira ngo utazivanga. |  |  |
| `appLock.rejectNotDigits` | **NEW** | Digits only. | Chiffres uniquement. | Imibare gusa. |  |  |
| `appLock.rejectTooShort` | **NEW** | Too short. Use at least {{min}} digits. | Trop court. Utilisez au moins {{min}} chiffres. | Ni ngufi cyane. Koresha nibura imibare {{min}}. |  |  |
| `appLock.settingsHelp` | **NEW** | Lock the whole app behind a code of your own. Off unless you turn it on. Calling 112 always works, locked or not. | Verrouillez toute l'application avec un code a vous. Desactive sauf si vous l'activez. Appeler le 112 marche toujours, verrouille ou non. | Funga porogaramu yose ukoresheje kode yawe bwite. Ntikora keretse uyifunguye. Guhamagara 112 bihora bikora, ifunze cyangwa ifunguye. |  |  |
| `appLock.settingsTitle` | **NEW** | App lock | Verrou d'application | Urufunguzo rwa porogaramu |  |  |
| `appLock.sosOnRide` | **NEW** | You have a ride in progress. You can still raise an alert. | Vous avez une course en cours. Vous pouvez toujours donner l'alerte. | Ufite urugendo rukomeje. Uracyashobora gutabaza. |  |  |
| `appLock.subtitle` | **NEW** | This phone is locked. | Ce telephone est verrouille. | Iyi telefone irafunze. |  |  |
| `appLock.timeoutHelp` | **NEW** | By default the app only locks when you restart it. You can also have it lock after you have been away for a while. | Par defaut l'application se verrouille seulement au redemarrage. Vous pouvez aussi la verrouiller apres une absence. | Muri rusange porogaramu ifunga gusa iyo wongeye kuyifungura. Ushobora no gutuma ifunga numara igihe utayikoresha. |  |  |
| `appLock.timeoutLabel` | **NEW** | Also lock after being away | Verrouiller aussi apres une absence | Nanone ifunge numara igihe utayikoresha |  |  |
| `appLock.timeoutMinutes` | **NEW** | {{count}} min | {{count}} min | Iminota {{count}} |  |  |
| `appLock.timeoutOff` | **NEW** | Only on restart | Seulement au redemarrage | Iyo wongeye gufungura gusa |  |  |
| `appLock.title` | **NEW** | Enter your app code | Entrez votre code d'application | Andika kode ya porogaramu |  |  |
| `appLock.unlock` | **NEW** | Unlock | Deverrouiller | Fungura |  |  |
| `appLock.wrongCode` | **NEW** | Wrong code. Try again. | Code incorrect. Reessayez. | Kode ntiyemewe. Ongera ugerageze. |  |  |

## Namespace: `approach`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `approach.cantMakeTrip` |  | I cannot make this trip | Je ne peux pas faire cette course | Sinshobora gukora uru rugendo |  |  |
| `approach.cantMakeTripConfirm` |  | The customer will be notified and able to request another driver. Are you sure? | Le client sera informé et pourra demander un autre chauffeur. Êtes-vous sûr ? | Umukiriya azamenyeshwa kandi ashobore gusaba undi mumotari. Urabyemera? |  |  |
| `approach.cantMakeTripTitle` |  | Cannot make this trip? | Vous ne pouvez pas faire cette course ? | Ntushobora gukora uru rugendo? |  |  |
| `approach.chat` |  | Chat | Discussion | Ikiganiro |  |  |
| `approach.fetchFailed` |  | Could not load the pickup details | Impossible de charger les détails | Ntibyakunze gufungura amakuru |  |  |
| `approach.paymentConfirmed` | **NEW** | Fare paid — this ride is covered. | Course payée — ce trajet est couvert. | Ikiguzi cyishyuwe — uru rugendo rwishyuwe. |  |  |
| `approach.paymentSettling` | **NEW** | Fare not confirmed yet. Keep going — if it is not paid within {{minutes}} minutes, we release you and tell you here. | Paiement pas encore confirmé. Continuez — s'il n'est pas payé sous {{minutes}} minutes, nous vous libérons et vous prévenons ici. | Ikiguzi ntikiremezwa. Komeza — nikidashyurwa mu minota {{minutes}}, turagufungura tukakubwira hano. |  |  |
| `approach.pickingUp` |  | Picking up {{name}} | Prise en charge de {{name}} | Ugiye gufata {{name}} |  |  |
| `approach.pickupAt` |  | Pickup at | Prise en charge à | Ahafatirwa umugenzi |  |  |
| `approach.title` |  | Heading to pickup | En route vers le client | Uri mu nzira ujya ku mugenzi |  |  |
| `approach.withdrawFailed` |  | Could not withdraw. Please try again. | Impossible de se retirer. Veuillez réessayer. | Ntibyashobotse kwivanaho. Ongera ugerageze. |  |  |
| `approach.withdrawSuccess` |  | Trip released. Thank you for letting us know. | Course libérée. Merci de nous avoir prévenus. | Urugendo rwarekuwe. Murakoze kutumenyesha. |  |  |

## Namespace: `attribution`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `attribution.searchBy` |  | Search by | Recherche par | Gushakisha bikorwa na |  | Prefix of the required "Search by LocationIQ" credit under address-search results and on the pick-on-map overlay. "LocationIQ" is a proper noun and stays untranslated; the phrase must read naturally in front of it |

## Namespace: `auth`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `auth.choose_role` |  | Choose your role | Choisissez votre rôle | Hitamo uruhare rwawe |  |  |
| `auth.enter_otp` |  | Enter verification code | Entrez le code de vérification | Andika kode yo kwemeza |  |  |
| `auth.language_label` |  | Language | Langue | Ururimi |  |  |
| `auth.login` |  | Log In | Se connecter | Injira |  |  |
| `auth.nickname_label` |  | Nickname | Surnom | Izina rikuriho |  |  |
| `auth.phone_label` |  | Phone Number | Numéro de téléphone | Nomero ya telefoni |  |  |
| `auth.phone_placeholder` | same-as-EN: placeholder | +250 7XX XXX XXX | +250 7XX XXX XXX | +250 7XX XXX XXX |  |  |
| `auth.register` |  | Register | S'inscrire | Iyandikishe |  |  |
| `auth.role_both` |  | Both | Les deux | Byombi |  |  |
| `auth.role_customer` |  | Customer | Client | Umukiriya |  |  |
| `auth.role_driver` |  | Driver | Chauffeur | Umumotari |  |  |
| `auth.send_otp` |  | Send Code | Envoyer le code | Ohereza kode |  |  |
| `auth.verify` |  | Verify | Vérifier | Emeza |  |  |

## Namespace: `autoBid`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `autoBid.addRule` | **NEW** | Write a rule | Écrire une règle | Andika itegeko |  |  |
| `autoBid.amountFlatLabel` | **NEW** | Your price | Votre prix | Igiciro cyawe |  |  |
| `autoBid.amountHelp` | **NEW** | Between {{min}} and {{max}}. | Entre {{min}} et {{max}}. | Hagati ya {{min}} na {{max}}. |  |  |
| `autoBid.amountModeLabel` | **NEW** | What do you bid? | Que proposez-vous ? | Utanga igiciro ki? |  |  |
| `autoBid.amountPercentLabel` | **NEW** | Percent of the fair price | Pourcentage du prix juste | Ijanisha ry'igiciro gikwiye |  |  |
| `autoBid.atCap` | **NEW** | You have all {{max}} rules. Delete one to write another. | Vous avez vos {{max}} règles. Supprimez-en une pour en écrire une autre. | Ufite amategeko {{max}} yose. Siba rimwe kugira ngo wandike irindi. |  |  |
| `autoBid.capNote` | **NEW** | You are using {{used}} of {{max}} rules. | Vous utilisez {{used}} règles sur {{max}}. | Ukoresha amategeko {{used}} kuri {{max}}. |  |  |
| `autoBid.deleteRule` | **NEW** | Delete this rule | Supprimer cette règle | Siba iri tegeko |  |  |
| `autoBid.enabledLabel` | **NEW** | Rule status when saved | État de la règle à l'enregistrement | Uko itegeko rizaba rimeze igihe ribitswe |  |  |
| `autoBid.entryHint` | **NEW** | Write your rules now. They stay off until Bimoto turns this on. | Écrivez vos règles dès maintenant. Elles restent inactives jusqu'à ce que Bimoto active cette fonction. | Andika amategeko yawe ubu. Ntazakora kugeza Bimoto ibikoresheje. |  |  |
| `autoBid.entryLabel` | **NEW** | Set up automatic bidding | Configurer les offres automatiques | Shyiraho gutanga igiciro byikora |  |  |
| `autoBid.intro` | **NEW** | A rule tells Bimoto which jobs you would take and what you would charge, so a bid can go out without you touching the phone. | Une règle indique à Bimoto quelles courses vous accepteriez et à quel prix, pour qu'une offre parte sans que vous touchiez au téléphone. | Itegeko ribwira Bimoto ingendo wakwakira n'igiciro wasaba, kugira ngo igiciro gitangwe utakoze kuri telefone. |  |  |
| `autoBid.maxPickupHelp` | **NEW** | Up to {{max}} km. | Jusqu'à {{max}} km. | Kugeza kuri km {{max}}. |  |  |
| `autoBid.maxPickupLabel` | **NEW** | How far will you go to collect? | Jusqu’où allez-vous pour prendre en charge ? | Ugenda kure kangahe kugira ngo ufate umukiriya? |  |  |
| `autoBid.maxRideHelp` | **NEW** | Up to {{max}} km from pickup to destination. | Jusqu'à {{max}} km du départ à la destination. | Kugeza kuri km {{max}} uhereye aho ufatira ukageza aho ugana. |  |  |
| `autoBid.maxRideLabel` | **NEW** | How long a job will you take? | Quelle longueur de course acceptez-vous ? | Urugendo rungana iki wakwakira? |  |  |
| `autoBid.modeFlat` | **NEW** | A fixed price | Un prix fixe | Igiciro gihoraho |  |  |
| `autoBid.modePercent` | **NEW** | A share of the fair price | Une part du prix juste | Igice cy'igiciro gikwiye |  |  |
| `autoBid.newRule` | **NEW** | New rule | Nouvelle règle | Itegeko rishya |  |  |
| `autoBid.noRules` | **NEW** | You have not written any rules yet. | Vous n'avez encore écrit aucune règle. | Nta tegeko urandika kugeza ubu. |  |  |
| `autoBid.offBody` | **NEW** | You can write your rules and they are saved. Nothing bids on your behalf until Bimoto turns this on — every job still needs you to bid yourself. | Vous pouvez écrire vos règles, elles sont enregistrées. Rien ne propose d'offre à votre place tant que Bimoto n'a pas activé cette fonction — chaque course demande encore votre propre offre. | Ushobora kwandika amategeko yawe akabikwa. Nta kintu na kimwe gitanga igiciro mu izina ryawe kugeza Bimoto ibikoresheje — buri rugendo rugusaba gutanga igiciro wowe ubwawe. |  |  |
| `autoBid.offTitle` | **NEW** | Automatic bidding is off during the pilot. | Les offres automatiques sont désactivées pendant le pilote. | Gutanga igiciro byikora ntibikora muri iki gihe cy’igerageza. |  |  |
| `autoBid.pauseAll` | **NEW** | Pause all my rules | Suspendre toutes mes règles | Hagarika amategeko yanjye yose |  |  |
| `autoBid.resumeAll` | **NEW** | Turn all my rules back on | Réactiver toutes mes règles | Subiza amategeko yanjye yose |  |  |
| `autoBid.resumeAllBlocked` | **NEW** | Available once Bimoto turns automatic bidding on. | Disponible dès que Bimoto activera les offres automatiques. | Bizaboneka Bimoto nimara gukoresha gutanga igiciro byikora. |  |  |
| `autoBid.ruleOrder` | **NEW** | Rule {{n}} | Règle {{n}} | Itegeko {{n}} |  |  |
| `autoBid.saveRule` | **NEW** | Save rule | Enregistrer la règle | Bika itegeko |  |  |
| `autoBid.stateActive` | **NEW** | Active | Active | Rirakora |  |  |
| `autoBid.stateWaiting` | **NEW** | Saved, not active | Enregistrée, inactive | Ryabitswe, ntirikora |  |  |
| `autoBid.summaryDistances` | **NEW** | Up to {{pickupKm}} km to collect, jobs up to {{rideKm}} km. | Jusqu'à {{pickupKm}} km pour prendre en charge, courses jusqu'à {{rideKm}} km. | Kugeza km {{pickupKm}} kugira ngo ufate, ingendo kugeza km {{rideKm}}. |  |  |
| `autoBid.summaryFlat` | **NEW** | Bids {{amount}} RWF. | Propose {{amount}} RWF. | Itanga {{amount}} RWF. |  |  |
| `autoBid.summaryPercent` | **NEW** | Bids {{percent}}% of the fair price. | Propose {{percent}} % du prix juste. | Itanga {{percent}}% by'igiciro gikwiye. |  |  |
| `autoBid.summaryVehicle` | **NEW** | Machine: {{vehicle}}. | Engin : {{vehicle}}. | Ikinyabiziga: {{vehicle}}. |  |  |
| `autoBid.title` | **NEW** | Automatic bidding | Offres automatiques | Gutanga igiciro byikora |  |  |
| `autoBid.vehicleAny` | **NEW** | Any machine | Tout engin | Ikinyabiziga icyo ari cyo cyose |  |  |
| `autoBid.vehicleBike` | **NEW** | Bicycle | Vélo | Igare |  |  |
| `autoBid.vehicleEbike` | **NEW** | Electric bicycle | Vélo électrique | Igare ry'amashanyarazi |  |  |
| `autoBid.vehicleEmoto` | **NEW** | Electric moto | Moto électrique | Moto y'amashanyarazi |  |  |
| `autoBid.vehicleLabel` | **NEW** | Which jobs? | Quelles courses ? | Ingendo zihe? |  |  |
| `autoBid.vehicleMoto` | **NEW**<br>same-as-EN: needs-decision | Moto | Moto | Moto |  |  |

## Namespace: `bid`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `bid.backToDashboard` |  | Back to dashboard | Retour au tableau de bord | Subira ahabanza |  |  |
| `bid.bid_pending` |  | Offer pending... | Offre en attente... | Ituro ritegereje... |  |  |
| `bid.bid_sent` |  | Offer sent! | Offre envoyée ! | Ituro ryoherejwe! |  |  |
| `bid.bid_too_late` |  | Too late - ride already matched | Trop tard - course déjà attribuée | Birarangiye - urugendo rusanzwe rufite umumotari |  |  |
| `bid.counterAcceptButton` | **NEW** | Accept price | Accepter ce prix | Emera igiciro |  |  |
| `bid.counterAccepted` | **NEW** | Price accepted — the ride is yours | Prix accepté — la course est à vous | Igiciro cyemewe — urugendo ni urwawe |  |  |
| `bid.counterDeclineButton` | **NEW** | Keep my price | Garder mon prix | Guma ku giciro cyanjye |  |  |
| `bid.counterDeclineNote` | **NEW** | If you decline, your offer of {{price}} RWF stays on their screen. | Si vous refusez, votre offre de {{price}} RWF reste affichée. | Nutemera, igiciro cyawe cya {{price}} RWF kiguma ku kigaragaza cyabo. |  |  |
| `bid.counterDeclined` | **NEW** | Your offer stands at your own price | Votre offre reste à votre prix | Igiciro cyawe kiracyahari nk’uko wagitanze |  |  |
| `bid.counterTheirPrice` | **NEW** | They suggest {{amount}} RWF | Le passager propose {{amount}} RWF | Basaba {{amount}} RWF |  |  |
| `bid.counterTitle` | **NEW** | A different price was suggested | Un autre prix a été proposé | Hatanzwe ikindi giciro |  |  |
| `bid.counterYourPrice` | **NEW** | Your offer: {{price}} RWF | Votre offre : {{price}} RWF | Igiciro watanze: {{price}} RWF |  |  |
| `bid.driver_rating` |  | Rating: {{rating}}/5 | Note : {{rating}}/5 | Amanota: {{rating}}/5 |  |  |
| `bid.etaLabel` |  | Your arrival: {{min}} min | Votre arrivée : {{min}} min | Uzahagera mu minota {{min}} |  |  |
| `bid.etaMinutesLabel` |  | Minutes to pickup | Minutes jusqu'à la prise en charge | Iminota usigaje ngo ugere ku mugenzi |  |  |
| `bid.etaPlaceholder` |  | e.g. 5 | ex. 5 | urugero: 5 |  |  |
| `bid.etaRequired` |  | Enter your minutes to pickup | Indiquez vos minutes jusqu'à la prise en charge | Andika iminota usigaje |  |  |
| `bid.fetchFailed` |  | Could not load the request | Impossible de charger la demande | Ntibyakunze gufungura ubusabe |  |  |
| `bid.journeyDetails` |  | Journey details | Détails de la course | Amakuru y'urugendo |  |  |
| `bid.makeOffer` |  | Make your offer | Faites votre offre | Tanga igiciro cyawe |  |  |
| `bid.new_driver` |  | New driver | Nouveau chauffeur | Umumotari mushya |  |  |
| `bid.offerSent` |  | Offer sent | Offre envoyée | Igiciro cyoherejwe |  |  |
| `bid.pricePlaceholder` |  | e.g. 1500 | ex. 1500 | urugero: 1500 |  |  |
| `bid.priceRequired` |  | Enter your price | Indiquez votre prix | Andika igiciro cyawe |  |  |
| `bid.sort_eta` |  | Sort by ETA | Trier par temps d'arrivée | Shyira ku gihe cyo kugera |  |  |
| `bid.sort_price` |  | Sort by price | Trier par prix | Shyira ku giciro |  |  |
| `bid.sort_rating` |  | Sort by rating | Trier par note | Shyira ku manota |  |  |
| `bid.submitFailed` |  | Could not send the offer | Impossible d'envoyer l'offre | Ntibyakunze kohereza igiciro |  |  |
| `bid.submitOffer` |  | Submit offer | Envoyer l'offre | Ohereza igiciro |  |  |
| `bid.submit_bid` |  | Submit Offer | Soumettre l'offre | Ohereza ituro |  |  |
| `bid.submitted` |  | Offer sent to the customer | Offre envoyée au client | Igiciro cyoherejwe ku mukiriya |  |  |
| `bid.waitingForCustomer` |  | Waiting for the customer to choose… | En attente du choix du client… | Tegereza umukiriya ahitemo… |  |  |
| `bid.wishPrice` |  | Customer's price: {{price}} RWF | Prix du client : {{price}} RWF | Igiciro cy'umukiriya: {{price}} RWF |  |  |
| `bid.withdraw` |  | Withdraw Offer | Retirer l'offre | Kuraho ituro |  |  |
| `bid.yourPrice` |  | Your price (RWF) | Votre prix (RWF) | Igiciro cyawe (RWF) |  |  |
| `bid.your_price` |  | Your price (RWF) | Votre prix (RWF) | Igiciro cyawe (RWF) |  |  |

## Namespace: `bidList`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `bidList.request.offersBody` | **NEW** | {{count}} so far. Take one, or wait for more. | {{count}} pour l'instant. Choisissez-en une ou attendez. | {{count}} kugeza ubu. Hitamo kimwe, cyangwa utegereze ibindi. |  |  |
| `bidList.request.offersTitle` | **NEW** | Offers have arrived | Des offres sont arrivées | Ibiciro byaje |  |  |
| `bidList.request.sentBody` | **NEW** | Drivers nearby are being asked now. Offers appear here on their own. | Les conducteurs à proximité sont sollicités. Les offres apparaissent ici automatiquement. | Abamotari bari hafi barabazwa ubu. Ibiciro bizigaragaza hano ubwabyo. |  |  |
| `bidList.request.sentTitle` | **NEW** | Request sent — waiting for offers | Demande envoyée — en attente d'offres | Icyifuzo cyoherejwe — gutegereza ibiciro |  |  |
| `bidList.request.sentToast` | **NEW** | Request sent — we are asking drivers now | Demande envoyée — nous sollicitons les conducteurs | Icyifuzo cyoherejwe — turimo kubaza abamotari |  |  |
| `bidList.state.expiredBody` | **NEW** | No driver took this ride in time. You can ask again — it only takes a moment. | Aucun chauffeur n'a pris cette course à temps. Vous pouvez redemander — cela ne prend qu'un instant. | Nta motari wafashe uru rugendo ku gihe. Ushobora kongera gusaba — ni akanya gato. |  |  |
| `bidList.state.expiredTitle` | **NEW** | This request is closed | Cette demande est close | Ubu busabe bwarafunzwe |  |  |
| `bidList.state.fetching` | **NEW** | Looking for offers… | Recherche d'offres… | Turashakisha ibiciro… |  |  |
| `bidList.state.liveHint` | **NEW** | Offers appear here instantly — you don't need to refresh. | Les offres s'affichent ici instantanément — inutile d'actualiser. | Igiciro kigaragara aha. Nta mpamvu yo gusubira inyuma. |  |  |
| `bidList.state.offlineBody` | **NEW** | Your phone can't reach Bimoto right now. Offers already sent are safe; this page will fill in as soon as the connection is back. | Votre téléphone n'arrive pas à joindre Bimoto pour le moment. Les offres déjà envoyées sont conservées ; cette page se remplira dès le retour de la connexion. | Telefoni yawe ntiribashije kugera kuri Bimoto ubu. Ibiciro byamaze koherezwa birakomeza kubaho; uru rupapuro ruzuzura umurandasi nugaruka. |  |  |
| `bidList.state.offlineTitle` | **NEW** | Connection lost — still trying | Connexion perdue — nouvelle tentative en cours | Umurandasi wacitse — turacyagerageza |  |  |
| `bidList.state.requestAgain` | **NEW** | Request a ride again | Redemander une course | Ongera usabe urugendo |  |  |
| `bidList.withdraw` | **NEW** | Withdraw my request | Retirer ma demande | Kuraho icyifuzo cyanjye |  |  |
| `bidList.withdrawConfirm` | **NEW** | Yes, withdraw | Oui, retirer | Yego, kuraho |  |  |
| `bidList.withdrawConfirmBody` | **NEW** | Your request will be closed and any offers on it will end. You can book again at any time. | Votre demande sera fermée et les offres reçues prendront fin. Vous pouvez réserver à nouveau à tout moment. | Icyifuzo cyawe kizafungwa kandi ibiciro byatanzwe bizarangira. Ushobora kongera gusaba igihe icyo ari cyo cyose. |  |  |
| `bidList.withdrawConfirmTitle` | **NEW** | Withdraw this request? | Retirer cette demande ? | Kuraho iki cyifuzo? |  |  |
| `bidList.withdrawKeep` | **NEW** | Keep waiting | Continuer à attendre | Komeza gutegereza |  |  |
| `bidList.withdrawn` | **NEW** | Your request was withdrawn | Votre demande a été retirée | Icyifuzo cyawe cyavanyweho |  |  |

## Namespace: `bids`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `bids.accept` |  | Accept | Accepter | Emera |  |  |
| `bids.acceptFailed` |  | Could not accept the offer | Impossible d'accepter l'offre | Ntibyakunze kwemera igiciro |  |  |
| `bids.accepted` |  | Offer accepted | Offre acceptée | Igiciro cyemewe |  |  |
| `bids.anonymousDriver` |  | Driver | Chauffeur | Umumotari |  |  |
| `bids.anyVehicleWaiting` | **NEW** | Offers can come from bicycles, motos and e-motos. | Les offres peuvent venir de vélos, de motos et d’e-motos. | Ibiciro bishobora guturuka ku magare, kuri moto no kuri e-moto. |  |  |
| `bids.autoBidPlaced` |  | Auto-bid placed on a nearby request | Enchère automatique placée sur une demande à proximité | Igiciro cyatanzwe mu buryo bwikora ku busabe buri hafi |  | Toast when a stored auto-bid rule fires server-side |
| `bids.cheapestOfKind` | **NEW** | Cheapest here | Le moins cher ici | Gihendutse hano |  |  |
| `bids.counterDeclinedState` | **NEW** | Your price was not accepted. This offer still stands at {{price}} RWF. | Votre prix n'a pas été accepté. Cette offre tient toujours à {{price}} RWF. | Igiciro cyawe nticyemewe. Iki giciro kiracyari {{price}} RWF. |  |  |
| `bids.counterEqualsPrice` | **NEW** | That is the price already offered. | C'est le prix déjà proposé. | Icyo ni cyo giciro cyari cyatanzwe. |  |  |
| `bids.counterIntro` | **NEW** | {{driver}} offered {{price}} RWF. What would you like to pay? | {{driver}} propose {{price}} RWF. Combien souhaitez-vous payer ? | {{driver}} yatanze {{price}} RWF. Wifuza kwishyura angahe? |  |  |
| `bids.counterLabel` | **NEW** | Your price (RWF) | Votre prix (RWF) | Igiciro cyawe (RWF) |  |  |
| `bids.counterLapsedState` | **NEW** | This offer expired before your price was answered. | Cette offre a expiré avant que votre prix ne reçoive une réponse. | Iki giciro cyarangiye igihe mbere y’uko igiciro cyawe gisubizwa. |  |  |
| `bids.counterOnce` | **NEW** | You can suggest a price once per offer. | Vous pouvez proposer un prix une seule fois par offre. | Ushobora gusaba igiciro rimwe gusa kuri buri giciro cyatanzwe. |  |  |
| `bids.counterOutOfBounds` | **NEW** | Enter a price between {{min}} and {{max}} RWF. | Entrez un prix entre {{min}} et {{max}} RWF. | Andika igiciro kiri hagati ya {{min}} na {{max}} RWF. |  |  |
| `bids.counterPendingState` | **NEW** | You suggested {{amount}} RWF — waiting for an answer | Vous avez proposé {{amount}} RWF — en attente de réponse | Wasabye {{amount}} RWF — utegereje igisubizo |  |  |
| `bids.counterSend` | **NEW** | Send | Envoyer | Ohereza |  |  |
| `bids.counterSent` | **NEW** | Your price was sent to the driver | Votre prix a été envoyé au chauffeur | Igiciro cyawe cyoherejwe umushoferi |  |  |
| `bids.decline` | **NEW** | Decline | Refuser | Wanga |  |  |
| `bids.declineConfirm` | **NEW** | Decline this offer? Your request stays open and the other offers stay live. | Refuser cette offre ? Votre demande reste ouverte et les autres offres restent valables. | Wanga iki cyifuzo? Icyifuzo cyawe gikomeza gufunguye, n’ibindi byifuzo bigakomeza. |  |  |
| `bids.declined` | **NEW** | Offer declined. | Offre refusée. | Icyifuzo cyanzwe. |  |  |
| `bids.distance` |  | {{km}} km | {{km}} km | Kilometero {{km}} |  |  |
| `bids.eta` |  | {{min}} min away | À {{min}} min | Asigaje iminota {{min}} |  |  |
| `bids.fairPrice` |  | Fair price: {{price}} RWF | Prix indicatif : {{price}} RWF | Igiciro gikwiriye: {{price}} RWF |  |  |
| `bids.fetchFailed` |  | Could not load offers | Impossible de charger les offres | Ntibyakunze gufungura ibiciro |  |  |
| `bids.newBidReceived` |  | New offer received! | Nouvelle offre reçue ! | Igiciro gishya cyageze! |  | Toast when a new offer arrives live (was hardcoded English) |
| `bids.rides` |  | rides | courses | ingendo |  |  |
| `bids.sectionHeader` | **NEW** | {{vehicle}} · {{count}} offer | {{vehicle}} · {{count}} offre | {{vehicle}} · igiciro {{count}} |  |  |
| `bids.sectionHeader_other` | **NEW** | {{vehicle}} · {{count}} offers | {{vehicle}} · {{count}} offres | {{vehicle}} · ibiciro {{count}} |  |  |
| `bids.sortEta` |  | Arrival | Arrivée | Kuhagera |  |  |
| `bids.sortPrice` |  | Price | Prix | Igiciro |  |  |
| `bids.sortRating` |  | Rating | Note | Ikigereranyo |  |  |
| `bids.suggestPrice` | **NEW** | Suggest another price | Proposer un autre prix | Saba ikindi giciro |  |  |
| `bids.waitingForDrivers` |  | Waiting for drivers to make offers… | En attente des offres des chauffeurs… | Tegereza umumotari/umunyonzi atange igiciro… |  |  |
| `bids.yourBidAccepted` | **NEW** | Your offer was accepted — the passenger is waiting | Votre offre a été acceptée — le passager vous attend | Igiciro wasabye cyemewe — umugenzi arakutegereje |  |  |
| `bids.yourBidDeclined` | **NEW** | The passenger did not take this offer | Le passager n'a pas retenu cette offre | Umugenzi ntiyemeye iki cyifuzo |  |  |

## Namespace: `chat`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `chat.fetchFailed` |  | Could not load messages | Impossible de charger les messages | Ntibyakunze gufungura ubutumwa |  |  |
| `chat.inputPlaceholder` |  | Type a message… | Écrivez un message… | Andika ubutumwa… |  |  |
| `chat.noMessages` |  | No messages yet | Pas encore de messages | Nta butumwa burahari |  |  |
| `chat.placeholder` |  | Type a message... | Écrire un message... | Andika ubutumwa... |  |  |
| `chat.quickMessages` |  | Quick messages | Messages rapides | Ubutumwa bwihuse |  |  |
| `chat.quick_5_minutes` |  | Give me 5 minutes | Donnez-moi 5 minutes | Ndageraho iminota 5 |  |  |
| `chat.quick_almost_there` |  | Almost there | Presque là | Ndi hafi |  |  |
| `chat.quick_arrived` |  | I have arrived | Je suis arrivé | Nagezeho |  |  |
| `chat.quick_call_me` |  | Call me | Appelez-moi | Mpamagara |  |  |
| `chat.quick_cancel_please` |  | Please cancel the ride | Veuillez annuler la course | Hagarika urugendo |  |  |
| `chat.quick_on_my_way` |  | On my way | J'arrive | Ndaje |  |  |
| `chat.quick_stuck_traffic` |  | Stuck in traffic | Coincé dans le trafic | Mpagaze mu modoka nyinshi |  |  |
| `chat.quick_thank_you` |  | Thank you | Merci | Urakoze |  |  |
| `chat.quick_waiting` |  | I am waiting | J'attends | Ndategereje |  |  |
| `chat.quick_where_are_you` |  | Where are you? | Où êtes-vous ? | Uri he? |  |  |
| `chat.send` |  | Send | Envoyer | Ohereza |  |  |
| `chat.sendFailed` |  | Could not send the message | Impossible d'envoyer le message | Ntibyakunze kohereza ubutumwa |  |  |
| `chat.sentAt` |  | Sent at {{time}} | Envoyé à {{time}} | Bwoherejwe {{time}} |  |  |
| `chat.title` |  | Chat | Discussion | Ikiganiro |  |  |

## Namespace: `checkDriver`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `checkDriver.active` |  | Active Bimoto driver | Chauffeur Bimoto actif | Umumotari wa Bimoto ukora |  |  |
| `checkDriver.error` |  | Could not check right now. Please try again. | Vérification impossible pour le moment. Veuillez réessayer. | Ntibishoboye kugenzura ubu. Ongera ugerageze. |  |  |
| `checkDriver.inactive` |  | This number is not an active Bimoto driver | Ce numéro ne correspond pas à un chauffeur Bimoto actif | Iyi nomero si iy'umumotari wa Bimoto ukora |  |  |
| `checkDriver.inputLabel` |  | Driver number | Numéro du chauffeur | Nomero y'umumotari |  |  |
| `checkDriver.inputPlaceholder` |  | e.g. RURA-12345 | ex. RURA-12345 | urugero: RURA-12345 |  |  |
| `checkDriver.submit` |  | Check | Vérifier | Genzura |  |  |
| `checkDriver.subtitle` |  | Enter the driver number from a jacket or vest. Only this live check confirms a driver — printed numbers alone do not. | Saisissez le numéro du chauffeur figurant sur la veste ou le gilet. Seule cette vérification en direct confirme un chauffeur — un numéro imprimé ne suffit pas. | Andika nomero y'umumotari iri ku ikoti cyangwa ku gilet. Iri genzura rikorwa ako kanya ni ryo ryonyine ryemeza umumotari — nomero yanditse ntihagije. |  |  |
| `checkDriver.title` |  | Check a Bimoto driver | Vérifier un chauffeur Bimoto | Genzura Umumotari/Umunyonzi wa Bimoto |  |  |

## Namespace: `child`

> TODO(GAP-P4) Kinyarwanda native review for R3-CHILD strings (machine-translated placeholders).

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `child.ackCancel` |  | Cancel | Annuler | Hagarika |  |  |
| `child.ackConfirm` |  | I understand and accept these conditions | Je comprends et j'accepte ces conditions | Mbyumvise kandi nemera ibi bisabwa |  |  |
| `child.ackSafety1` |  | I will drive slower than for adult passengers | Je conduirai plus lentement qu'avec un adulte | Nzagenda buhoro kurusha igihe nfite umugenzi mukuru |  |  |
| `child.ackSafety2` |  | I will refuse the trip if I do not have a child-appropriate helmet | Je refuserai le trajet si je n'ai pas de casque adapté à un enfant | Nzanga urugendo niba ntafite ingofero y'umwana |  |  |
| `child.ackSafety3` |  | I will not exceed urban speed limits | Je ne dépasserai pas les limites de vitesse en ville | Sinzarengera umuvuduko utemewe mu mujyi |  |  |
| `child.ackTitle` |  | This trip carries a child passenger | Ce trajet transporte un enfant | Uru rugendo rufite umwana |  |  |
| `child.ageHelp` |  | Children under 12 cannot ride on motos | Les enfants de moins de 12 ans ne peuvent pas monter à moto | Abana batarengeje imyaka 12 ntibemerewe kuri pikipiki |  |  |
| `child.ageLabel` |  | Child's age (years) | Âge de l'enfant (années) | Imyaka y'umwana |  |  |
| `child.agePlaceholder` |  | e.g., 8 | ex. 8 | urugero, 8 |  |  |
| `child.badgeLabel` |  | Child passenger | Enfant passager | Umwana ugiye mu rugendo |  |  |
| `child.blockedAgeRequired` |  | Child age is required when travelling with a child. | L'âge de l'enfant est requis lors d'un voyage avec un enfant. | Imyaka y'umwana irasabwa iyo ugendana n'umwana. |  |  |
| `child.blockedGuardian` |  | Guardian phone number required for unaccompanied minors. | Numéro de téléphone du parent requis pour les mineurs non accompagnés. | Numero ya telefoni y'umubyeyi irasabwa ku bana bari bonyine. |  |  |
| `child.blockedHelmet` |  | Helmet confirmation is required for child passengers on motos. | Confirmation du casque obligatoire pour les enfants passagers à moto. | Kwemeza ingofero ni ngombwa ku bana bagenzi kuri pikipiki. |  |  |
| `child.blockedMoto` |  | Children under {{minAge}} cannot ride on motorcycles in Rwanda. Please choose a bicycle. | Les enfants de moins de {{minAge}} ans ne peuvent pas monter à moto au Rwanda. Veuillez choisir un vélo. | Abana batarengeje imyaka {{minAge}} ntibemerewe kuri pikipiki mu Rwanda. Nyamuneka hitamo igare. |  |  |
| `child.blockedUnaccompanied` |  | Unaccompanied minor trips are not yet supported in the pilot. | Les trajets de mineurs non accompagnés ne sont pas encore pris en charge. | Ingendo z'abana bari bonyine ntizirakora muri pilote. |  |  |
| `child.guardianPhoneHelp` |  | Required for unaccompanied minors. Pilot v1 does not yet support unaccompanied minor trips. | Requis pour les mineurs non accompagnés. Le pilote v1 ne prend pas encore en charge les trajets de mineurs non accompagnés. | Bisabwa ku bana bari bonyine. Pilote v1 ntirakora ingendo z'abana bari bonyine. |  |  |
| `child.guardianPhoneLabel` |  | Guardian's phone number | Numéro de téléphone du parent | Numero ya telefoni y'umubyeyi |  |  |
| `child.helmetHelp` |  | Adult helmets are dangerous for small children | Les casques d'adultes sont dangereux pour les jeunes enfants | Ingofero z'abakuru zigira ingaruka ku bana bato |  |  |
| `child.helmetToggle` |  | I will provide a child-sized helmet | Je fournirai un casque de taille enfant | Nzatanga ingofero y'umwana |  |  |
| `child.travellingToggle` |  | I am travelling with a child passenger | Je voyage avec un enfant passager | Ndi kumwe n'umwana muto |  |  |
| `child.unaccompaniedToggle` |  | This is an unaccompanied minor (parent booking) | Mineur non accompagné (réservation parentale) | Umwana ari wenyine (umubyeyi arikuranura) |  |  |

## Namespace: `childTravel`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `childTravel.blockedByParcel` | **NEW** | You're sending a package on this ride — book a separate ride to travel with a child. | Vous envoyez un colis sur cette course — réservez une course séparée pour voyager avec un enfant. | Uri kohereza ipaki kuri uru rugendo — saba urundi rugendo niba ugenda n'umwana. |  |  |
| `childTravel.noticeToDriver` | **NEW** | The passenger is travelling with a child. | Le passager voyage avec un enfant. | Umugenzi ari kugendana n'umwana. |  |  |
| `childTravel.toggle` | **NEW** | Travelling with a child? | Vous voyagez avec un enfant ? | Uri kugendana n'umwana? |  |  |
| `childTravel.toggleHelper` | **NEW** | Tick this and the driver sees it before accepting, so they know a child is coming. | Cochez cette case et le chauffeur la voit avant d'accepter : il saura qu'un enfant voyage. | Nushyiraho aka kamenyetso, umumotari arakabona mbere yo kwemera, akamenya ko hari umwana ugiye kugenda. |  |  |

## Namespace: `common`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `common.back` |  | Back | Retour | Subira inyuma |  |  |
| `common.backToHome` |  | Back to home | Retour à l'accueil | Subira ahabanza |  | Escape hatch on every creation screen |
| `common.cancel` |  | Cancel | Annuler | Hagarika |  |  |
| `common.close` |  | Close | Fermer | Funga |  |  |
| `common.confirm` |  | Confirm | Confirmer | Emeza |  |  |
| `common.dismiss` |  | Dismiss | Fermer | Funga |  |  |
| `common.goBack` |  | Go back | Retour | Subira inyuma |  |  |
| `common.loading` |  | Loading... | Chargement... | Gutegereza... |  |  |
| `common.no` |  | No | Non | Oya |  |  |
| `common.off` | **NEW** | Off | Désactivé | Birafunze |  |  |
| `common.ok` | same-as-EN: needs-decision | OK | OK | OK |  |  |
| `common.on` | **NEW** | On | Activé | Birafunguye |  |  |
| `common.refresh` | **NEW** | Refresh | Actualiser | Ongera ufungure |  |  |
| `common.remove` |  | Remove | Supprimer | Kuraho |  |  |
| `common.retry` |  | Retry | Réessayer | Ongera ugerageze |  |  |
| `common.save` |  | Save | Enregistrer | Bika |  |  |
| `common.yes` |  | Yes | Oui | Yego |  |  |

## Namespace: `confirm`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `confirm.goHome` |  | Go home | Retour à l'accueil | Subira ahabanza |  |  |

## Namespace: `confirmArrival`

> TEAM-ANSWERS G6 — the passenger confirms the ride is done (item 16b). AI-generated draft pending native review. `confirmArrival.fallback` is the load-bearing line: it says that if she does nothing the ride confirms itself after two hours AND THE MOTARI IS PAID EITHER WAY. That is the honest fact and it must survive translation — a passenger who reads this as 'the motari is only paid if I tap' has been told something false, and one who reads it as a deadline she can miss will worry about money that is not at risk.

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `confirmArrival.confirm` | **NEW** | Confirm arrival | Confirmer l'arrivée | Emeza ko wageze |  |  |
| `confirmArrival.done` | **NEW** | Arrival confirmed. Thank you. | Arrivée confirmée. Merci. | Kugera kwemejwe. Murakoze. |  |  |
| `confirmArrival.fallback` | **NEW** | If you do not, it confirms itself after 2 hours and your motari is paid either way. | Sans confirmation de votre part, elle se confirme seule après 2 heures et votre motari est payé dans tous les cas. | Nutabikora, rwiyemeza nyuma y’amasaha 2 kandi umumotari wawe agahembwa uko byagenda kose. |  |  |
| `confirmArrival.prompt` | **NEW** | Your motari says the ride is done. Confirm you have arrived. | Votre motari indique que la course est terminée. Confirmez votre arrivée. | Umumotari wawe avuga ko urugendo rurangiye. Emeza ko wageze. |  |  |
| `confirmArrival.title` | **NEW** | Ride finished | Course terminée | Urugendo rurangiye |  |  |

## Namespace: `connection`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `connection.backOnline` |  | Back online | De nouveau en ligne | Wongeye kuba ku murongo |  | Brief flash when the connection recovers |
| `connection.detailTitle` | **NEW** | Connection & saved bookings | Connexion et réservations enregistrées | Umurongo n’ibyabitswe |  | CHROME-C: title of the sheet the status pill opens. Covers BOTH the connection and anything saved on the phone waiting to go out, so it must not name only one of them. |
| `connection.offline` |  | You're offline — reconnecting when network returns | Vous êtes hors ligne — reconnexion dès le retour du réseau | Nta murandasi ufite — tuzasubira ku murongo umurandasi nugaruka |  | Persistent banner while the device has no network |
| `connection.openDetail` | **NEW** | open details | ouvrir les détails | fungura ibisobanuro |  | CHROME-C: screen-reader-only tail on the status pill's label, e.g. 'Offline — open details'. A verb phrase, lower case, never shown visually. |
| `connection.retryCountdown` |  | Retrying in {{seconds}}s | Nouvel essai dans {{seconds}} s | Tuzongera kugerageza mu masegonda {{seconds}} |  | Live countdown to the next automatic retry; {{seconds}} interpolated |
| `connection.retryNow` |  | Try now | Réessayer maintenant | Gerageza nonaha |  | Manual retry button on the banner |
| `connection.shortNoServer` | **NEW** | No server | Pas de serveur | Nta seriveri |  | CHROME-C: the header status pill's word for network-up-but-Bimoto-unreachable. Short, as above; `connection.unreachable` is the same state's full sentence in the detail sheet. This is the one state that turns the whole header red, so the word must carry that weight in two or three syllables. |
| `connection.shortOffline` | **NEW** | Offline | Hors ligne | Nta murandasi |  | CHROME-C: the header status pill's word for a device with no network. MUST be short — it sits in a pill beside the back control, not in a banner. `connection.offline` is the same state's full sentence and stays as it is, inside the detail sheet. |
| `connection.unreachable` |  | Can't reach Bimoto — retrying… | Impossible de joindre Bimoto — nouvelle tentative… | Ntibishoboka kugera kuri Bimoto — turongera kugerageza… |  | Banner when network is up but Bimoto is unreachable (dead tunnel) |

## Namespace: `dashboard`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `dashboard.fetchFailed` |  | Could not load requests | Impossible de charger les demandes | Ntibyakunze gufungura ubusabe |  |  |
| `dashboard.finishCurrentRide` | **NEW** | Finish your current ride first | Terminez d'abord votre course en cours | Banza urangize urugendo urimo |  |  |
| `dashboard.finishCurrentRideSubtitle` | **NEW** | New requests come back as soon as you complete the ride you have. | Les nouvelles demandes reviennent dès que vous terminez la course que vous avez. | Ibisabwa bishya bizagaruka umaze kurangiza urugendo ufite. |  |  |
| `dashboard.goOfflineFailed` |  | We couldn't tell the server you're offline — customers may still see you as online. | Impossible d'indiquer au serveur que vous êtes hors ligne — les clients peuvent encore vous voir en ligne. | Ntibyakunze kubwira seriveri ko utakiri ku kazi — abakiriya bashobora gukomeza kukubona nk'uri ku kazi. |  | Driver banner when the going-offline write fails; honesty matters — the server may still list the driver as available |
| `dashboard.goOnline` |  | Go online to see nearby requests | Passez en ligne pour voir les demandes proches | Jya ku murongo kugira ngo ubone ubusabe buri hafi |  |  |
| `dashboard.goOnlineFailed` |  | We couldn't put you online — the server didn't get your position. You're still offline. | Impossible de vous mettre en ligne — le serveur n'a pas reçu votre position. Vous êtes toujours hors ligne. | Ntibyakunze kugushyira ku kazi — seriveri ntiyabonye aho uri. Ntabwo uri ku kazi. |  | Driver banner when going online fails; sits next to a Retry button. "ku kazi" follows dashboard.imOnline vocabulary — please confirm |
| `dashboard.hoursAgo` |  | {{n}}h ago | il y a {{n}} h | Hashize amasaha {{n}} |  |  |
| `dashboard.imOffline` |  | I'm offline | Je suis hors ligne | Si ndi ku murongo |  |  |
| `dashboard.imOnline` |  | I'm online | Je suis en ligne | Ndi ku murongo |  |  |
| `dashboard.justNow` |  | just now | à l'instant | vuba aha |  |  |
| `dashboard.locationSyncLost` |  | Your position isn't being sent right now — new requests may not reach you. | Votre position n'est plus envoyée pour le moment — les nouvelles demandes pourraient ne pas vous parvenir. | Aho uri ntihakohererezwa seriveri ubu — ubusabe bushya bushobora kutakugeraho. |  | Driver banner when the periodic location update starts failing while online |
| `dashboard.minutesAgo` |  | {{n}} min ago | il y a {{n}} min | Hashize iminota {{n}} |  |  |
| `dashboard.nearbyRequests` |  | Nearby requests ({{count}}) | Demandes à proximité ({{count}}) | Ubusabe buri hafi ({{count}}) |  |  |
| `dashboard.newRequestNearby` |  | New request nearby | Nouvelle demande à proximité | Hari ubusabe bushya hafi yawe |  | Subtle cue on the driver dashboard when a journey arrives live |
| `dashboard.noRequests` |  | No requests right now | Aucune demande pour le moment | Nta busabe buhari ubu |  |  |
| `dashboard.noRequestsSubtitle` |  | New requests will appear here | Les nouvelles demandes s'afficheront ici | Ubusabe bushya buzagaragara hano |  |  |
| `dashboard.onlineSubtitle` |  | You'll be notified of nearby requests | Vous serez averti des demandes proches | Uzamenyeshwa ubusabe buri hafi |  |  |
| `dashboard.reopenedUnpaid` | **NEW** | Back in the list: the passenger’s payment did not complete, so this ride is open to everyone again. | De retour dans la liste : le paiement du passager n’a pas abouti, cette course est donc à nouveau ouverte à tous. | Yagarutse ku rutonde: kwishyura k’umugenzi ntibyakunze, bityo uru rugendo rwongeye gufungurirwa bose. |  |  |

## Namespace: `deletion`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `deletion.bannerCancel` | **NEW** | Keep my account | Garder mon compte | Gumana konti yanjye |  |  |
| `deletion.bannerCancelFailed` | **NEW** | We could not stop the deletion. Please try again. | Nous n'avons pas pu arrêter la suppression. Veuillez réessayer. | Ntitwashoboye guhagarika gusiba. Ongera ugerageze. |  |  |
| `deletion.bannerCancelPending` | **NEW** | Keeping your account… | Conservation de votre compte… | Kugumana konti yawe… |  |  |
| `deletion.bannerCancelled` | **NEW** | Your account will not be deleted. | Votre compte ne sera pas supprimé. | Konti yawe ntizasibwa. |  |  |
| `deletion.bannerCountdownDays` | **NEW** | It will be erased in about {{count}} days. | Il sera effacé dans environ {{count}} jours. | Izasibwa mu minsi {{count}} nka gutyo. |  |  |
| `deletion.bannerCountdownDays_one` | **NEW** | It will be erased in about {{count}} day. | Il sera effacé dans environ {{count}} jour. | Izasibwa mu munsi {{count}} nka gutyo. |  |  |
| `deletion.bannerCountdownDays_other` | **NEW** | It will be erased in about {{count}} days. | Il sera effacé dans environ {{count}} jours. | Izasibwa mu minsi {{count}} nka gutyo. |  |  |
| `deletion.bannerCountdownHours` | **NEW** | It will be erased in about {{count}} hours. | Il sera effacé dans environ {{count}} heures. | Izasibwa mu masaha {{count}} nka gutyo. |  |  |
| `deletion.bannerCountdownHours_one` | **NEW** | It will be erased in about {{count}} hour. | Il sera effacé dans environ {{count}} heure. | Izasibwa mu isaha {{count}} nka gutyo. |  |  |
| `deletion.bannerCountdownHours_other` | **NEW** | It will be erased in about {{count}} hours. | Il sera effacé dans environ {{count}} heures. | Izasibwa mu masaha {{count}} nka gutyo. |  |  |
| `deletion.bannerCountdownImminent` | **NEW** | It will be erased any moment now. | Il sera effacé d'un instant à l'autre. | Igiye gusibwa ako kanya. |  |  |
| `deletion.bannerCountdownMinutes` | **NEW** | It will be erased in about {{count}} minutes. | Il sera effacé dans environ {{count}} minutes. | Izasibwa mu minota {{count}} nka gutyo. |  |  |
| `deletion.bannerCountdownMinutes_one` | **NEW** | It will be erased in about {{count}} minute. | Il sera effacé dans environ {{count}} minute. | Izasibwa mu munota {{count}} nka gutyo. |  |  |
| `deletion.bannerCountdownMinutes_other` | **NEW** | It will be erased in about {{count}} minutes. | Il sera effacé dans environ {{count}} minutes. | Izasibwa mu minota {{count}} nka gutyo. |  |  |
| `deletion.bannerDeferredTitle` | **NEW** | Your deletion is waiting on one thing | Votre suppression attend une seule chose | Gusiba konti yawe gutegereje ikintu kimwe |  |  |
| `deletion.bannerRidesNote` | **NEW** | You can keep using Bimoto until then. Rides you take between now and then are erased along with everything else. | Vous pouvez continuer à utiliser Bimoto jusque-là. Les courses effectuées d'ici là seront effacées avec tout le reste. | Ushobora gukomeza gukoresha Bimoto kugeza icyo gihe. Ingendo uzakora hagati aha na cyo zizasibwa hamwe n'ibindi byose. |  |  |
| `deletion.bannerTitle` | **NEW** | Your account is being deleted | Votre compte est en cours de suppression | Konti yawe iri gusibwa |  |  |
| `deletion.deferredAccountFrozen` | **NEW** | Your account is frozen, so it cannot be deleted yet. Contact Bimoto support to settle the freeze and the deletion will go ahead. | Votre compte est gelé, il ne peut donc pas encore être supprimé. Contactez l'assistance Bimoto pour régler le gel et la suppression se poursuivra. | Konti yawe irahagaritswe, bityo ntishobora gusibwa ubu. Vugana na serivisi z'abakiriya za Bimoto kugira ngo iryo hagarikwa rikemuke, hanyuma gusiba bizakomeza. |  |  |
| `deletion.deferredInFlightPayout` | **NEW** | A payout to you is on its way. It ends when the transfer settles. | Un versement vous est en route. Cela se termine lorsque le transfert est réglé. | Amafaranga yawe ari mu nzira. Bizarangira igihe kohereza birangiye. |  |  |
| `deletion.deferredLiveEscrow` | **NEW** | We cannot delete your account while the payment for one of your rides is still being settled. It will be deleted once that payment is finished. | Nous ne pouvons pas supprimer votre compte tant que le paiement de l'une de vos courses est en cours de règlement. Il sera supprimé dès que ce paiement sera terminé. | Ntidushobora gusiba konti yawe mu gihe kwishyura kw'urugendo rwawe bikiri gukorwa. Izasibwa iyo kwishyura birangiye. |  |  |
| `deletion.deferredNonTerminalJourney` | **NEW** | We cannot delete your account while a ride is still going. It will be deleted once that ride ends. | Nous ne pouvons pas supprimer votre compte pendant qu'une course est en cours. Il sera supprimé dès la fin de cette course. | Ntidushobora gusiba konti yawe mu gihe urugendo rukiri mu nzira. Izasibwa iyo urwo rugendo rurangiye. |  |  |
| `deletion.deferredOpenBid` | **NEW** | You have an offer out on a ride. It ends when the passenger accepts, you withdraw it, or it expires. | Vous avez une offre en cours sur une course. Cela se termine lorsque le passager l'accepte, que vous la retirez ou qu'elle expire. | Ufite igiciro watanze ku rugendo. Bizarangira igihe umugenzi acyemeye, ucyikuyeho, cyangwa igihe cyacyo kirangiye. |  |  |
| `deletion.deferredPositiveDriverBalance` | **NEW** | We still owe you money for your rides. We cannot delete your account before paying you — it will be deleted once you have been paid. | Nous vous devons encore de l'argent pour vos courses. Nous ne pouvons pas supprimer votre compte avant de vous avoir payé — il sera supprimé une fois que vous aurez été payé. | Turacyakubereyemo amafaranga y'ingendo zawe. Ntidushobora gusiba konti yawe tutarayaguha — izasibwa iyo umaze kuyahabwa. |  |  |
| `deletion.deferredScheduledPayout` | **NEW** | A payout to you is scheduled. It ends when the payout is sent. | Un versement vous est programmé. Cela se termine lorsque le versement est envoyé. | Amafaranga yawe yateganyijwe koherezwa. Bizarangira igihe azaba yoherejwe. |  |  |
| `deletion.deferredUnresolvedEmergency` | **NEW** | We cannot delete your account while an emergency you raised is still open. Our team is working on it, and your account will be deleted once it is closed. | Nous ne pouvons pas supprimer votre compte tant qu'une urgence que vous avez signalée reste ouverte. Notre équipe s'en occupe, et votre compte sera supprimé dès sa clôture. | Ntidushobora gusiba konti yawe mu gihe ikibazo cy'ubutabazi watanze kitarakemuka. Ikipe yacu irakikoraho, kandi konti yawe izasibwa iyo gikemutse. |  |  |
| `deletion.exportCopied` | **NEW** | Your data was copied. Paste it somewhere to keep it. | Vos données ont été copiées. Collez-les quelque part pour les conserver. | Amakuru yawe yarakoporowe. Yomeke ahantu kugira ngo uyabike. |  |  |
| `deletion.exportDownloaded` | **NEW** | Your data has been downloaded. | Vos données ont été téléchargées. | Amakuru yawe yaramanuwe. |  |  |
| `deletion.exportFailed` | **NEW** | We could not prepare your data. Please try again. | Nous n'avons pas pu préparer vos données. Veuillez réessayer. | Ntitwashoboye gutegura amakuru yawe. Ongera ugerageze. |  |  |
| `deletion.exportNotice` | **NEW** | This export contains the records Bimoto holds about you as a rider, a driver, and a party to your own rides. It deliberately leaves out our fraud-prevention and investigation records about this account — anti-money-laundering flags, administrator actions taken about you, name-mismatch checks, driver conflict overrides, and the tombstone kept after an account is deleted. Those are withheld so that a fraud check cannot be read by the person it is about. You can ask for them, and for the reasons behind them, by making a request to Bimoto support. | Cette exportation contient les données que Bimoto détient à votre sujet en tant que passager, en tant que motard et en tant que partie à vos propres courses. Elle laisse délibérément de côté nos dossiers de prévention de la fraude et d’enquête concernant ce compte : signalements de lutte contre le blanchiment, mesures administratives prises à votre égard, contrôles de non-concordance de nom, dérogations en cas de conflit avec un motard, et la fiche conservée après la suppression d’un compte. Ces éléments sont retenus afin qu’un contrôle antifraude ne puisse pas être lu par la personne qu’il vise. Vous pouvez les demander, ainsi que les motifs qui les sous-tendent, en adressant une demande au support Bimoto. | Iyi dosiye irimo amakuru Bimoto ifite kuri wowe nk’umugenzi, nk’umumotari, no nk’umwe mu bagize urugendo rwawe. Ku bushake ntirimo inyandiko zacu zo kurwanya uburiganya n’izo iperereza kuri iyi konti: ibimenyetso byo kurwanya iyezandonke, ibyemezo by’ubuyobozi byafashwe kuri wowe, igenzura ry’amazina atahuye, ibyemezo byihariye ku makimbirane y’umumotari, n’inyandiko isigara konti imaze gusibwa. Ibyo ntibitangwa kugira ngo igenzura ry’uburiganya ritasomwa n’uwo rireba. Ushobora kubisaba, hamwe n’impamvu zabyo, wandikira ubufasha bwa Bimoto. |  |  |
| `deletion.exportPreparing` | **NEW** | Preparing your data… | Préparation de vos données… | Gutegura amakuru yawe… |  |  |
| `deletion.exportShared` | **NEW** | Your data is ready to share. | Vos données sont prêtes à être partagées. | Amakuru yawe yiteguye gusangirwa. |  |  |
| `deletion.step1Back` | **NEW** | Go back | Retour | Subira inyuma |  |  |
| `deletion.step1Continue` | **NEW** | Continue | Continuer | Komeza |  |  |
| `deletion.step1ErasedContacts` | **NEW** | Your emergency contacts | Vos contacts d'urgence | Abo uhamagara mu bihe by'ubutabazi |  |  |
| `deletion.step1ErasedDocuments` | **NEW** | Your licence, insurance and other documents | Votre permis, votre assurance et vos autres documents | Uruhushya rwawe, ubwishingizi n'izindi nyandiko zawe |  |  |
| `deletion.step1ErasedName` | **NEW** | Your name and your profile | Votre nom et votre profil | Izina ryawe n'umwirondoro wawe |  |  |
| `deletion.step1ErasedPhone` | **NEW** | Your phone number | Votre numéro de téléphone | Nimero yawe ya telefone |  |  |
| `deletion.step1ErasedTitle` | **NEW** | What is erased | Ce qui est effacé | Ibisibwa |  |  |
| `deletion.step1Intro` | **NEW** | Read this first. Once the deletion goes through, it cannot be undone. | Lisez ceci d'abord. Une fois la suppression effectuée, elle est irréversible. | Banza usome ibi. Iyo gusiba bimaze gukorwa, ntibisubirwaho. |  |  |
| `deletion.step1KeptPayments` | **NEW** | Payment and receipt records for those rides | Les paiements et les reçus de ces courses | Inyandiko z'ubwishyu n'inyemezabwishyu z'izo ngendo |  |  |
| `deletion.step1KeptRides` | **NEW** | The record that each ride happened — where it went and when | La trace de chaque course — son trajet et sa date | Inyandiko y'uko buri rugendo rwabaye — aho rwagiye n'igihe |  |  |
| `deletion.step1KeptSafety` | **NEW** | Safety and dispute records, where a ride had one | Les dossiers de sécurité et de litige, lorsqu'une course en a eu un | Inyandiko z'umutekano n'iz'amakimbirane, iyo urugendo rwarwo rwazigize |  |  |
| `deletion.step1KeptTitle` | **NEW** | What is kept, with your name taken off it | Ce qui est conservé, sans votre nom | Ibibikwa, izina ryawe rikuweho |  |  |
| `deletion.step1KeptWhy` | **NEW** | The law requires us to keep these records, and other people were on those rides too. They stay, but nothing in them points back to you. | La loi nous oblige à conserver ces dossiers, et d'autres personnes étaient aussi sur ces courses. Ils restent, mais plus rien dedans ne renvoie à vous. | Amategeko adusaba kubika izi nyandiko, kandi n'abandi bantu bari muri izo ngendo. Zirabikwa, ariko nta na kimwe kirimo kigaruka kuri wowe. |  |  |
| `deletion.step1Title` | **NEW** | Delete my account | Supprimer mon compte | Siba konti yanjye |  |  |
| `deletion.step1Window` | **NEW** | Nothing happens straight away. You have 72 hours to change your mind, and Bimoto works normally for the whole of it. | Rien ne se passe immédiatement. Vous avez 72 heures pour changer d'avis, et Bimoto fonctionne normalement pendant tout ce temps. | Nta kintu kibaho ako kanya. Ufite amasaha 72 yo guhindura umwanzuro, kandi Bimoto ikora nk'ubusanzwe muri ayo masaha yose. |  |  |
| `deletion.step2Back` | **NEW** | No, keep my account | Non, garder mon compte | Oya, ngumane konti yanjye |  |  |
| `deletion.step2Hold` | **NEW** | Hold to delete my account | Maintenir pour supprimer mon compte | Fata kugira ngo usibe konti yanjye |  |  |
| `deletion.step2HoldInstruction` | **NEW** | Press and hold the button below for two seconds to confirm. | Appuyez sur le bouton ci-dessous et maintenez-le deux secondes pour confirmer. | Kanda ubuto buri hasi ubufate amasegonda abiri kugira ngo wemeze. |  |  |
| `deletion.step2Holding` | **NEW** | Keep holding… | Continuez à maintenir… | Komeza gufata… |  |  |
| `deletion.step2Submitting` | **NEW** | Starting… | Démarrage… | Biratangira… |  |  |
| `deletion.step2Title` | **NEW** | Are you sure? | Êtes-vous sûr ? | Urabyemeje? |  |  |
| `deletion.step2Warning` | **NEW** | This starts the 72-hour countdown. After that, your name, phone number, contacts and documents are erased for good. | Ceci lance le compte à rebours de 72 heures. Ensuite, votre nom, votre numéro de téléphone, vos contacts et vos documents seront effacés définitivement. | Ibi bitangiza kubara amasaha 72. Nyuma yayo, izina ryawe, nimero yawe ya telefone, abo uhamagara n'inyandiko zawe bizasibwa burundu. |  |  |

## Namespace: `delivery`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `delivery.addStopButton` |  | + Add a goods stop | + Ajouter un arrêt colis | + Ongeraho aho uhagarara |  |  |
| `delivery.addStopToggle` |  | Drop a package on the way | Déposer un colis en chemin | Siga umuzigo mu nzira |  |  |
| `delivery.blockedByChild` | **NEW** | You're travelling with a child on this ride — book a separate ride to send a package. | Vous voyagez avec un enfant sur cette course — réservez une course séparée pour envoyer un colis. | Ugenda n'umwana kuri uru rugendo — saba urundi rugendo niba wohereza ipaki. |  |  |
| `delivery.blockedParcelMissingForGoods` |  | Goods stops require a parcel size. | Les arrêts colis nécessitent une taille. | Aho uhagarara kw'ibintu bisaba ingano. |  |  |
| `delivery.blockedParcelOnNonGoods` |  | Only goods stops can have a parcel size. | Seuls les arrêts colis peuvent avoir une taille. | Aho uhagarara kw'ibintu gusa nibyo bishobora kugira ingano. |  |  |
| `delivery.cancelStop` |  | Cancel | Annuler | Hagarika |  |  |
| `delivery.contactNameLabel` |  | Recipient name (optional) | Nom du destinataire (facultatif) | Izina ry'uwakira (siyibikenewe) |  |  |
| `delivery.contactPhoneLabel` |  | Recipient phone (optional) | Téléphone du destinataire (facultatif) | Telefone y'uwakira (siyibikenewe) |  |  |
| `delivery.driverCompleteStop` |  | Complete this stop | Terminer cet arrêt | Soza aha uhagaze |  |  |
| `delivery.driverStopCompleted` |  | Completed at {{time}} | Terminé à {{time}} | Byasozwe ku {{time}} |  |  |
| `delivery.driverStopList` |  | Stops on the way | Arrêts en chemin | Aho uhagarara munzira |  |  |
| `delivery.driverStopPending` |  | Pending | En attente | Bitegerejwe |  |  |
| `delivery.imAtPickup` |  | I'm at pickup | Je suis au point de collecte | Ndi aho izajya ifata |  |  |
| `delivery.infoCardLine1` |  | Driver will drop your parcel between pickup and destination | Le chauffeur déposera votre colis entre la prise en charge et la destination | Umumotari azatanga ifunika ryawe hagati y'aho ufatwa n'aho ujya |  |  |
| `delivery.infoCardLine2` |  | Fare includes parcel-size premium (Small +0%, Medium +10%, Large +25%) | Le tarif inclut une majoration selon la taille (Petit +0%, Moyen +10%, Grand +25%) | Igiciro kirimo inyongera ku ngano (Gito +0%, Hagati +10%, Kinini +25%) |  |  |
| `delivery.infoCardTitle` |  | Delivery on the way | Livraison en chemin | Itangwa munzira |  |  |
| `delivery.languageEn` |  | English | Anglais | Icyongereza |  |  |
| `delivery.languageFr` |  | French | Français | Igifaransa |  |  |
| `delivery.languageRw` |  | Kinyarwanda | Kinyarwanda | Ikinyarwanda |  |  |
| `delivery.moveStopDown` |  | Move stop down | Déplacer l'arrêt vers le bas | Imura aho uhagarara hepfo |  |  |
| `delivery.moveStopUp` |  | Move stop up | Déplacer l'arrêt vers le haut | Imura aho uhagarara haruguru |  |  |
| `delivery.parcelCategoryDocuments` |  | Documents | Documents | Inyandiko |  |  |
| `delivery.parcelCategoryElectronics` |  | Electronics | Électronique | Ibikoresho bya elegitoroniki |  |  |
| `delivery.parcelCategoryFood` |  | Food | Nourriture | Ibiribwa |  |  |
| `delivery.parcelCategoryFragile` |  | Fragile | Fragile | Bishobora kumeneka |  |  |
| `delivery.parcelCategoryLabel` |  | Parcel contents | Contenu du colis | Ibiri mu ifunika |  |  |
| `delivery.parcelCategoryOther` |  | Other | Autre | Ibindi |  |  |
| `delivery.parcelSizeLabel` |  | Parcel size | Taille du colis | Ingano y'ifunika |  |  |
| `delivery.parcelSizeLarge` |  | Large (15–30 kg) | Grand (15–30 kg) | Kinini (15–30 kg) |  |  |
| `delivery.parcelSizeMedium` |  | Medium (5–15 kg) | Moyen (5–15 kg) | Hagati (5–15 kg) |  |  |
| `delivery.parcelSizeSmall` |  | Small (≤ 5 kg) | Petit (≤ 5 kg) | Gito (≤ 5 kg) |  |  |
| `delivery.recipientAutoConfirmed` |  | Auto-confirmed after 24h (no reply) at {{time}} | Confirmé automatiquement après 24h (sans réponse) à {{time}} | Byemejwe nyuma y'amasaha 24 (nta gisubizo) ku {{time}} |  |  |
| `delivery.recipientConfirmed` |  | Recipient confirmed receipt at {{time}} | Réception confirmée par le destinataire à {{time}} | Uwakira yemeje ko yakiriye ku {{time}} |  |  |
| `delivery.recipientDisputed` |  | Recipient disputed: {{reason}} | Réclamation du destinataire : {{reason}} | Uwakira yatanze ikibazo: {{reason}} |  |  |
| `delivery.recipientLanguageAuto` |  | Auto (use mine) | Auto (utiliser la mienne) | Bikora wenyine (koresha urwanjye) |  |  |
| `delivery.recipientLanguageLabel` |  | Recipient's preferred language (optional) | Langue préférée du destinataire (facultatif) | Ururimi uwakira ahitamo (si itegeko) |  |  |
| `delivery.removeStop` |  | Remove stop | Supprimer l'arrêt | Kuraho aho uhagarara |  |  |
| `delivery.saveStop` |  | Save stop | Enregistrer l'arrêt | Bika aho uhagarara |  |  |
| `delivery.speedExpress` | **NEW** | Express | Express | Byihuse (Vuba vuba) |  |  |
| `delivery.speedExpressDesc` | **NEW** | Faster than standard. There is no fixed extra charge — drivers see that you want it fast and bid their price, and you choose the one you want. | Plus rapide que le standard. Il n'y a pas de supplément fixe — les chauffeurs voient que vous êtes pressé et proposent leur prix, et vous choisissez celui qui vous convient. | Byihuta kurusha ibisanzwe. Nta kiguzi cy'inyongera gihoraho — abamotari babona ko ushaka ko byihuta bakagutanga igiciro cyabo, ukahitamo icyo ushaka. |  |  |
| `delivery.speedLabel` | **NEW** | Delivery speed | Vitesse de livraison | Umuvuduko wo gutanga |  |  |
| `delivery.speedStandard` | **NEW** | Standard | Standard | Bisanzwe |  |  |
| `delivery.speedStandardDesc` | **NEW** | Delivered the same day. Choose an hour window below if you need one. | Livré le jour même. Choisissez un créneau ci-dessous si nécessaire. | Bigezwa kuri uwo munsi. Hitamo igihe hepfo niba ubikeneye. |  |  |
| `delivery.standardHoursAny` | **NEW** | Any time | N’importe quand | Igihe icyo ari cyo cyose |  |  |
| `delivery.standardHoursLabel` | **NEW** | Deliver within (optional) | Livrer sous (facultatif) | Gutanga mu gihe kitarenze (si ngombwa) |  |  |
| `delivery.standardHoursN` | **NEW** | {{count}} h | {{count}} h | amasaha {{count}} |  |  |
| `delivery.standardHoursNote` | **NEW** | This does not change the price — the driver still bids their own fare. | Cela ne change pas le prix — le chauffeur propose toujours son propre tarif. | Ibi ntibihindura igiciro — motari akomeza gutanga igiciro cye. |  |  |
| `delivery.standardHoursWithin` | **NEW** | within {{count}} h | sous {{count}} h | mu masaha {{count}} |  |  |
| `delivery.stopNameLabel` |  | Address or landmark | Adresse ou point de repère | Aderesi cyangwa ahantu |  |  |
| `delivery.stopNamePlaceholder` |  | e.g., Post office near KCT | ex. Bureau de poste près de KCT | urugero, Posita hafi ya KCT |  |  |
| `delivery.stopOrderLabel` |  | Stop {{n}} | Arrêt {{n}} | Aho uhagarara {{n}} |  |  |
| `delivery.stopTypeGoodsDropoff` |  | Drop off a parcel | Déposer un colis | Tanga ifunika |  |  |
| `delivery.stopTypeGoodsPickup` |  | Pick up a parcel | Récupérer un colis | Korora ifunika |  |  |
| `delivery.stopTypeLabel` |  | Stop type | Type d'arrêt | Ubwoko bw'aho uhagarara |  |  |
| `delivery.stopTypeWait` |  | Wait briefly | Attente brève | Tegereza gato |  |  |

## Namespace: `diagnostics`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `diagnostics.appBuild` | **NEW** | App build | Version de l'app | Verisiyo ya porogaramu |  |  |
| `diagnostics.buildsMatch` | **NEW** | Builds match | Versions identiques | Verisiyo zirahuye |  |  |
| `diagnostics.clearLog` | **NEW** | Clear log | Effacer le journal | Siba urutonde |  |  |
| `diagnostics.errorCount` | **NEW** | Errors recorded | Erreurs enregistrées | Amakosa yanditswe |  |  |
| `diagnostics.errorLog` | **NEW** | Error log | Journal des erreurs | Urutonde rw'amakosa |  |  |
| `diagnostics.errorLogEmpty` | **NEW** | No errors recorded on this phone. | Aucune erreur enregistrée sur ce téléphone. | Nta kosa ryanditswe kuri iyi telefoni. |  |  |
| `diagnostics.feedStatus` | **NEW** | Last feed reply | Dernière réponse du flux | Igisubizo giheruka cy'urutonde |  |  |
| `diagnostics.feedViewAs` | **NEW** | Feed sent viewAs | viewAs envoyé par le flux | viewAs yoherejwe n'urutonde |  |  |
| `diagnostics.intro` | **NEW** | A snapshot of what this phone and the server currently agree on. Take a screenshot and send it to us if something is not working. | Un aperçu de ce sur quoi ce téléphone et le serveur sont d'accord actuellement. Faites une capture d'écran et envoyez-la-nous si quelque chose ne fonctionne pas. | Incamake y'ibyo iyi telefoni na seriveri bemeranyaho ubu. Fata ifoto y'ecran uyitwoherereze igihe hari ikitagenda neza. |  |  |
| `diagnostics.lastLocation` | **NEW** | Last position sent | Dernière position envoyée | Aho waherukira kohereza |  |  |
| `diagnostics.open` | **NEW** | Diagnostics | Diagnostic | Isuzuma |  |  |
| `diagnostics.rideTraceNote` | **NEW** | Ride traces: recorded during rides and deliveries, kept 14 days, longer only under dispute. Never visible live to anyone, except our safety team during an emergency, until it is closed. | Tracés des courses : enregistrés pendant les courses et les livraisons, conservés 14 jours, plus longtemps uniquement en cas de litige. Jamais visibles en direct par qui que ce soit, sauf par notre équipe de sécurité pendant une urgence, jusqu'à la clôture de celle-ci. | Inzira z'ingendo: zandikwa mu gihe cy'ingendo n'ubwikorezi, zibikwa iminsi 14, zikarenzaho gusa iyo hari ikibazo. Nta muntu uzireba mu buryo buhita, keretse itsinda ryacu ry'umutekano mu gihe cy'ubutabazi, kugeza ubutabazi bufunzwe. |  |  |
| `diagnostics.role` | **NEW** | Signed in as | Connecté en tant que | Winjiye nka |  |  |
| `diagnostics.sendConsent` | **NEW** | The report contains only what is shown above: the time, the app build, the screen you were on, and the error text — with phone numbers and sign-in codes already removed. It goes to the Bimoto team in Kigali. It is sent automatically unless you turn that off in Settings, and Send report sends it now either way. | Le rapport contient uniquement ce qui est affiché ci-dessus : l'heure, la version de l'application, l'écran où vous étiez, et le texte de l'erreur — les numéros de téléphone et les codes de connexion sont déjà retirés. Il va à l'équipe Bimoto à Kigali. Il est envoyé automatiquement sauf si vous désactivez cela dans les Réglages, et Envoyer le rapport l'envoie maintenant dans tous les cas. | Raporo irimo gusa ibigaragara hejuru: isaha, verisiyo ya porogaramu, urupapuro wari uriho, n'ubutumwa bw'ikosa — nimero za telefoni n'imibare yo kwinjira byamaze gukurwamo. Ijya ku ikipe ya Bimoto i Kigali. Yoherezwa mu buryo bwikora keretse ubihagaritse muri Settings, kandi Ohereza raporo iyohereza ubu uko byaba biri kose. |  |  |
| `diagnostics.sendFailed` | **NEW** | not sent | non envoyé | ntiyoherejwe |  |  |
| `diagnostics.sendReport` | **NEW** | Send report | Envoyer le rapport | Ohereza raporo |  |  |
| `diagnostics.sendStatus` | **NEW** | Report sent | Rapport envoyé | Raporo yoherejwe |  |  |
| `diagnostics.serverBuild` | **NEW** | Server build | Version du serveur | Verisiyo ya seriveri |  |  |
| `diagnostics.serverOnline` | **NEW** | Online (per server) | En ligne (selon le serveur) | Kuri interineti (nk'uko seriveri ibivuga) |  |  |
| `diagnostics.socket` | **NEW** | Live connection | Connexion en direct | Umurandasi uhoraho |  |  |
| `diagnostics.socketTransport` | **NEW** | Live connection type | Type de connexion en direct | Ubwoko bw’umurongo uhoraho |  |  |
| `diagnostics.title` | **NEW** | Diagnostics | Diagnostic | Isuzuma |  |  |
| `diagnostics.transportPollingOnly` | **NEW** | Polling only — degraded ({{transport}}) | Interrogation seule — dégradée ({{transport}}) | Kubaza gusa — bidakora neza ({{transport}}) |  |  |
| `diagnostics.transportWebsocket` | **NEW** | Websocket (fast) | Websocket (rapide) | Websocket (byihuse) |  |  |

## Namespace: `driver`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `driver.cancelledTrips.empty` |  | You have no cancelled trips marked as no-show. | Aucune course annulée pour absence. | Nta ngendo zahagaritswe ku mpamvu yo kudahari. |  |  |
| `driver.cancelledTrips.entryHint` | **NEW** | If a customer was marked absent by mistake, say so here. An admin reviews every dispute. | Si une course a été marquée « client absent » par erreur, dites-le ici. Un administrateur examine chaque contestation. | Niba urugendo rwanditswe nk'aho umukiriya atari ahari ari uko atari byo, bivuge hano. Umuyobozi asuzuma buri kirego. |  |  |
| `driver.cancelledTrips.entryLabel` | **NEW** | Dispute a no-show | Contester une absence | Kujurira ku kudahari |  |  |
| `driver.cancelledTrips.fetchFailed` |  | Could not load cancelled trips. | Impossible de charger les courses annulées. | Ntibyakunze gufungura ingendo zahagaritswe. |  |  |
| `driver.cancelledTrips.title` |  | Recent cancelled trips | Courses annulées récentes | Ingendo zahagaritswe vuba |  |  |
| `driver.disputeNoShow` |  | Dispute this no-show | Contester cette absence | Hakana kuba sinari mpari |  |  |
| `driver.disputeNoShowFailed` |  | Could not file dispute. Please try again. | Impossible de contester. Réessayez. | Ntibyakunze gutanga ikirego. Ongera ugerageze. |  |  |
| `driver.disputeNoShowSubmitted` |  | Dispute submitted — an admin will review. | Contestation envoyée — un admin va examiner. | Ikirego cyatanzwe — admin azakireba. |  |  |
| `driver.flaggedNotice` |  | Your account has been flagged for review | Votre compte a été signalé pour examen | Konti yawe yamenyekanyeshejwe |  |  |
| `driver.jacketNumber` |  | Jacket Nº {{number}} | Veste Nº {{number}} | Ikoti Nº {{number}} |  |  |
| `driver.plate` |  | Plate | Plaque | Purake |  |  |
| `driver.revokedNotice` |  | Your Bimoto driver account is no longer active. Any remaining earnings have been paid out or will be settled with support. Contact support with any question. | Votre compte chauffeur Bimoto n'est plus actif. Tout gain restant a été versé ou sera réglé avec le support. Contactez le support pour toute question. | Konti yawe y'umumotari ya Bimoto ntikiri gukora. Amafaranga yawe asigaye yamaze koherezwa cyangwa azishyurwa binyuze ku bafasha. Vugisha abafasha ku kibazo icyo ari cyo cyose. |  |  |
| `driver.stats.aboveCohortMedian` |  | {{pct}}% above cohort median | {{pct}}% au-dessus de la médiane de la cohorte | {{pct}}% hejuru y’ikigereranyo cy’itsinda |  |  |
| `driver.stats.acceptanceDenominator` |  | ({{n}} bids) | ({{n}} offres) | (ibyifuzo {{n}}) |  |  |
| `driver.stats.acceptanceRate` |  | Acceptance rate | Taux d’acceptation | Igipimo cyo kwemera gukora urugendo |  |  |
| `driver.stats.avgAcceptanceTime` |  | Avg acceptance time | Temps moyen d’acceptation | Impuzandengo y'igihe cyo kwemera gukora urugendo |  |  |
| `driver.stats.belowCohortMedian` |  | {{pct}}% below cohort median | {{pct}}% en dessous de la médiane de la cohorte | {{pct}}% munsi y’ikigereranyo cy’itsinda |  |  |
| `driver.stats.cancellationAria` |  | Cancellation reasons pie chart | Graphique circulaire des raisons d’annulation | Igishushanyo cy’impamvu zo guhagarika |  |  |
| `driver.stats.cancellationTitle` |  | Cancellation reasons ({{n}} cancelled) | Raisons d’annulation ({{n}} annulées) | Impamvu zo guhagarika ({{n}} byahagaritswe) |  |  |
| `driver.stats.cohortBreakdownTitle` |  | How you compare in your vehicle type | Votre position dans votre type de véhicule | Aho uhagaze ku bandi bafite ubwoko bw’ikinyabiziga/ikinyamitende nk’icyawe |  |  |
| `driver.stats.cohortSize` |  | {{n}} drivers in cohort | {{n}} chauffeurs dans la cohorte | abamotari {{n}} muri iri tsinda |  |  |
| `driver.stats.completionDenominator` |  | ({{n}} journeys) | ({{n}} courses) | (ingendo {{n}}) |  |  |
| `driver.stats.completionRate` |  | Completion rate | Taux de complétion | Igipimo cyo gusoza ingendo |  |  |
| `driver.stats.earningsTrendAria` |  | 4-week weekly-earnings trend chart | Graphique de tendance des revenus sur 4 semaines | Igishushanyo cy’inyungu z’ibyumweru 4 |  |  |
| `driver.stats.earningsTrendTitle` |  | 4-week earnings trend | Tendance des revenus sur 4 semaines | Ayinjiye mu byumweru 4 |  |  |
| `driver.stats.hideMore` |  | ▲ Hide | ▲ Masquer | ▲ Hisha |  |  |
| `driver.stats.minutesValue` |  | {{n}} min | {{n}} min | iminota {{n}} |  |  |
| `driver.stats.myRating` |  | Your rating | Votre note | Amanota yawe |  | Header of the own-rating tile on the driver stats card |
| `driver.stats.noData` |  | No data yet | Aucune donnée pour l’instant | Nta makuru arahari |  |  |
| `driver.stats.noRatingsYet` |  | No ratings yet | Pas encore de notes | Nta manota urahabwa |  | Shown in place of stars until the driver receives a first rating |
| `driver.stats.ratingDistAria` |  | Customer rating distribution histogram | Histogramme de la répartition des évaluations | Igishushanyo cy’amanota y’abakiriya |  |  |
| `driver.stats.ratingDistTitle` |  | Customer ratings ({{n}} total) | Évaluations des clients ({{n}} au total) | Amanota y’abakiriya ({{n}} muri rusange) |  |  |
| `driver.stats.showMore` |  | ▼ Show more stats | ▼ Voir plus de statistiques | ▼ Reba izindi raporo |  |  |
| `driver.stats.title` |  | Your stats — last {{windowDays}} days | Vos statistiques — {{windowDays}} derniers jours | Ibibara byawe — iminsi {{windowDays}} ishize |  |  |
| `driver.stats.weeklyEarnings` |  | Weekly earnings | Revenus hebdomadaires | Ayinjiye mu cyumweru |  |  |
| `driver.suspendedNotice` |  | Your account is suspended until {{until}} | Votre compte est suspendu jusqu’au {{until}} | Konti yawe yahagaritswe kugeza {{until}} |  |  |
| `driver.totalRides` |  | Rides | Courses | Ingendo |  |  |
| `driver.vehicle` |  | Vehicle | Véhicule | Ikinyabiziga |  |  |

## Namespace: `driverApproach`

> TODO Kinyarwanda native review — strings below are AI-generated approximations pending the same translator-packet review tracked in i18n.ts.

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `driverApproach.confidenceHigh` |  | live | en direct | ako kanya |  |  |
| `driverApproach.confidenceLow` |  | estimated (long range) | estimation (longue distance) | byagereranyijwe (intera ndende) |  |  |
| `driverApproach.confidenceMed` |  | estimated | estimation | byagereranyijwe |  |  |
| `driverApproach.driverLabel` | same-as-EN: placeholder | {{driverName}} | {{driverName}} | {{driverName}} |  |  |
| `driverApproach.etaMinutes` |  | ≈ {{minutes}} min away | ≈ {{minutes}} min | ≈ Iminota {{minutes}} ikigana |  |  |
| `driverApproach.etaUnknown` |  | Locating driver… | Localisation du chauffeur… | Turashaka umumotari… |  |  |
| `driverApproach.mapLabel` |  | Driver approach map | Carte d'approche du chauffeur | Ikarita y'umumotari uje |  |  |
| `driverApproach.permissionDenied` |  | Location permission denied. Enable in Settings. | Permission de localisation refusée. Activez-la dans les paramètres. | Uruhushya rwo gukurikirana aho uri rwanze. Rwemerera muri Settings. |  |  |
| `driverApproach.stale` |  | Driver location unavailable — last seen {{seconds}}s ago | Position du chauffeur indisponible — dernière vue il y a {{seconds}}s | Aho umumotari ari ntibizwi — yagaragaye bwa nyuma hashize amasegonda {{seconds}} |  |  |
| `driverApproach.youAreHere` |  | You | Vous | Wowe |  |  |

## Namespace: `driverNav`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `driverNav.locating` | **NEW** | Finding your location… | Recherche de votre position… | Turashaka aho uri… |  |  |
| `driverNav.mapLabelDestination` | **NEW** | Map to the destination | Carte vers la destination | Ikarita igana aho ugiye |  |  |
| `driverNav.mapLabelPickup` | **NEW** | Map to the pickup | Carte vers le point de départ | Ikarita igana aho batwara |  |  |

## Namespace: `emergency`

> SOS-FOLLOW G6 — the live-follow strings. SAFETY-CRITICAL TONE: these are the only strings in this file read by somebody who has just pressed a panic button, or by an operator deciding whether to act on one, so a rendering that reads well but lands wrong is worse than an awkward one that lands right. THREE LINES CARRY THE WEIGHT. (1) `emergency.followingLive` / `followingLiveParcel` are what the person who pressed the button reads on their own phone. They must land as REASSURANCE — somebody is watching, help knows where you are — never as surveillance and never as a warning. (2) The exception to that promise no longer has keys of its own: it now lives inside the closing clause of the three #176 ride-trace sentences themselves — `legal.rideTraceNotice`, `guide.trace.body` and `diagnostics.rideTraceNote`, reviewed under their own namespaces. Judge those closing clauses by the same standard the separate sentences were held to: the exception must read as a BOUNDED one — only during an emergency, only our safety team, and only until the emergency is closed — and it must read as part of the same breath as the promise it qualifies, not as an afterthought. A rendering that drops any of the three bounds, or that lets the promise land as final before the exception arrives, has told a driver something false about his own phone. (3) `emergency.ops*` are read by ops staff under time pressure. `opsLastPosition` and the `opsAge*` units must read as AN AGE — how long ago we last heard from this person — never as a current position: on this screen those are opposite facts and only one is true. `opsStatusExpired` must read as 'nobody closed this in time', not as an error and not as a resolution.

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `emergency.adminAcknowledge` |  | Acknowledged | Pris en compte | Byakiriwe |  | Only way to dismiss an admin emergency banner |
| `emergency.adminBannerTitle` |  | Emergency — passenger needs help | Urgence — un passager a besoin d'aide | Ubutabazi — umugenzi akeneye ubufasha |  | Title of the persistent red admin banner |
| `emergency.adminBannerTitleDriver` | **NEW** | Emergency — driver needs help | Urgence — un conducteur a besoin d'aide | Ubutabazi — umumotari akeneye ubufasha |  |  |
| `emergency.adminBannerTitleDriverParcel` | **NEW** | Emergency — driver carrying a parcel needs help | Urgence — un conducteur transportant un colis a besoin d'aide | Ubutabazi — umumotari utwaye umuzigo akeneye ubufasha |  |  |
| `emergency.adminBannerTitleSender` | **NEW** | Emergency — parcel sender needs help | Urgence — un expéditeur de colis a besoin d'aide | Ubutabazi — uwohereza umuzigo akeneye ubufasha |  |  |
| `emergency.adminDriverPhone` | **NEW** | Driver phone | Téléphone du conducteur | Telefone y'umumotari |  |  |
| `emergency.adminFollow` | **NEW** | Follow | Suivre | Kurikirana |  |  |
| `emergency.adminJourney` |  | Journey | Course | Urugendo |  | Admin banner field label |
| `emergency.adminPlate` | **NEW** | plate | plaque | plaka |  |  |
| `emergency.adminRiderPhone` |  | Passenger phone | Téléphone du passager | Telefoni y'umugenzi |  | Admin banner field label |
| `emergency.adminSenderPhone` | **NEW** | Sender phone | Téléphone de l'expéditeur | Telefoni y'uwohereza umuzigo |  |  |
| `emergency.alertReceived` |  | Emergency alert on this ride | Alerte d'urgence sur cette course | Hari ubutabazi kuri uru rugendo |  | Toast to journey participants (incl. the driver) when SOS fires |
| `emergency.alertReceivedParcel` | **NEW** | Emergency alert on this parcel delivery | Alerte d'urgence sur cette livraison de colis | Hari ubutabazi mu gutwara umuzigo |  |  |
| `emergency.button` |  | EMERGENCY | URGENCE | UBUTABAZI |  |  |
| `emergency.callEmergencyNumber` |  | Call 112 | Appeler le 112 | Hamagara 112 |  | Foremost action on the post-confirm SOS sheet (tel link) |
| `emergency.cancelSend` | **NEW** | Sending to Bimoto in {{seconds}} — tap to cancel | Envoi à Bimoto dans {{seconds}} — appuyez pour annuler | Byoherezwa kuri Bimoto mu masegonda {{seconds}} — kanda uhagarike |  |  |
| `emergency.confirm` |  | Send emergency alert to your contacts? | Envoyer une alerte d'urgence à vos contacts ? | Ohereza ubutumwa bw'ubutabazi ku bantu bawe? |  |  |
| `emergency.confirmMessage` |  | Send an emergency alert to your contacts and Bimoto? | Envoyer une alerte d'urgence à vos contacts et à Bimoto ? | Kohereza integuza y'ubutabazi ku bo wizeye na Bimoto? |  |  |
| `emergency.confirmTitle` |  | Emergency alert | Alerte d'urgence | Integuza y'ubutabazi |  |  |
| `emergency.followingLive` | **NEW** | Our safety team is following this ride until the emergency is closed. | Notre équipe de sécurité suit cette course jusqu'à la clôture de l'urgence. | Itsinda ryacu ry'umutekano rikurikirana uru rugendo kugeza ubutabazi bufunzwe. |  |  |
| `emergency.followingLiveParcel` | **NEW** | Our safety team is following this delivery until the emergency is closed. | Notre équipe de sécurité suit cette livraison jusqu'à la clôture de l'urgence. | Itsinda ryacu ry'umutekano rikurikirana ubu bwikorezi kugeza ubutabazi bufunzwe. |  |  |
| `emergency.holdHint` | **NEW** | Press and hold this button to send an emergency alert. If you are using a keyboard or a screen reader, press Enter instead. | Appuyez longuement sur ce bouton pour envoyer une alerte d'urgence. Si vous utilisez un clavier ou un lecteur d'écran, appuyez plutôt sur Entrée. | Kanda uhagarare kuri iyi buto kugira ngo wohereze ubutumwa bw'ubutabazi. Niba ukoresha klavye cyangwa igisomyi cy'ecran, kanda Enter. |  |  |
| `emergency.interrupt` |  | Interrupt Ride | Interrompre la course | Hagarika urugendo |  |  |
| `emergency.interrupt_confirm` |  | Are you sure you want to interrupt this ride? | Êtes-vous sûr de vouloir interrompre cette course ? | Uzi neza ko ushaka guhagarika uru rugendo? |  |  |
| `emergency.label` |  | Emergency | Urgence | Ubutabazi |  |  |
| `emergency.notified` |  | Bimoto has been notified | Bimoto a été notifié | Bimoto yamenyeshejwe |  | SOS sheet status on success |
| `emergency.notifyFailed` |  | Could not notify Bimoto — call 112 | Impossible de notifier Bimoto — appelez le 112 | Ntibyakunze kumenyesha Bimoto — hamagara 112 |  | SOS sheet offline/failure copy; 112 action stays foremost |
| `emergency.notifying` |  | Notifying Bimoto… | Notification de Bimoto… | Turimo kumenyesha Bimoto… |  | SOS sheet status while the POST is in flight |
| `emergency.opsAgeHours` | **NEW** | {{hours}} h | {{hours}} h | amasaha {{hours}} |  |  |
| `emergency.opsAgeMinutes` | **NEW** | {{minutes}} min | {{minutes}} min | iminota {{minutes}} |  |  |
| `emergency.opsAgeSeconds` | **NEW** | {{seconds}} s | {{seconds}} s | amasegonda {{seconds}} |  |  |
| `emergency.opsClosedBy` | **NEW** | Closed by {{name}} | Close par {{name}} | Byafunzwe na {{name}} |  |  |
| `emergency.opsIntro` | **NEW** | Open emergencies can be followed live until they are closed. Every alert is closed by an operator with a note, or by the system after 60 minutes. | Les urgences ouvertes peuvent être suivies en direct jusqu'à leur clôture. Chaque alerte est close par un opérateur avec une note, ou par le système après 60 minutes. | Ubutabazi bufunguye bushobora gukurikiranwa ako kanya kugeza bufunzwe. Buri mpuruza ifungwa n'umukozi atanga inyandiko, cyangwa na sisitemu nyuma y'iminota 60. |  |  |
| `emergency.opsLastPosition` | **NEW** | last position {{age}} ago | dernière position il y a {{age}} | aho baheruka kuba hamaze {{age}} |  |  |
| `emergency.opsLoadFailed` | **NEW** | Could not load emergency alerts — check the connection and try again. | Impossible de charger les alertes d'urgence — vérifiez la connexion et réessayez. | Ntibyakunze gupakira impuruza z'ubutabazi — reba umurongo hanyuma wongere ugerageze. |  |  |
| `emergency.opsNoFramesYet` | **NEW** | No live position yet — call the numbers on the alert. | Pas encore de position en direct — appelez les numéros de l'alerte. | Nta hantu haramenyekana ako kanya — hamagara nimero ziri ku mpuruza. |  |  |
| `emergency.opsNoPosition` | **NEW** | No position for this alert. | Aucune position pour cette alerte. | Nta hantu hazwi kuri iyi mpuruza. |  |  |
| `emergency.opsNoneActive` | **NEW** | No emergency is open. | Aucune urgence n'est ouverte. | Nta butabazi bufunguye. |  |  |
| `emergency.opsNoneClosed` | **NEW** | No emergency has been closed yet. | Aucune urgence n'a encore été close. | Nta butabazi burafungwa. |  |  |
| `emergency.opsOpenFor` | **NEW** | open {{age}} | ouverte depuis {{age}} | bumaze {{age}} |  |  |
| `emergency.opsRaisedByCustomer` | **NEW** | Passenger | Passager | Umugenzi |  |  |
| `emergency.opsRaisedByDriver` | **NEW** | Driver | Chauffeur | Umushoferi |  |  |
| `emergency.opsResolve` | **NEW** | Close this emergency | Clore cette urgence | Funga ubu butabazi |  |  |
| `emergency.opsResolveFailed` | **NEW** | Could not close this alert — it may already be closed. Reload the page. | Impossible de clore cette alerte — elle est peut-être déjà close. Rechargez la page. | Ntibyakunze gufunga iyi mpuruza — birashoboka ko yamaze gufungwa. Ongera upakire urupapuro. |  |  |
| `emergency.opsResolveNoteLabel` | **NEW** | What happened | Ce qui s'est passé | Ibyabaye |  |  |
| `emergency.opsResolveNotePlaceholder` | **NEW** | Spoke to the driver, he is safe and the ride ended normally. | Parlé au chauffeur, il est en sécurité et la course s'est terminée normalement. | Twavuganye n'umushoferi, ari amahoro kandi urugendo rwarangiye neza. |  |  |
| `emergency.opsResolveNoteTooShort` | **NEW** | Write at least {{min}} characters — this note is the record of what happened. | Écrivez au moins {{min}} caractères — cette note est le compte rendu de ce qui s'est passé. | Andika nibura inyuguti {{min}} — iyi nyandiko ni yo nyandiko y'ibyabaye. |  |  |
| `emergency.opsStatusExpired` | **NEW** | Timed out | Expirée | Igihe cyarangiye |  |  |
| `emergency.opsStatusResolved` | **NEW** | Closed by ops | Close par ops | Byafunzwe n'abakozi |  |  |
| `emergency.opsTabActive` | **NEW** | Open ({{count}}) | Ouvertes ({{count}}) | Bufunguye ({{count}}) |  |  |
| `emergency.opsTabHistory` | **NEW** | History | Historique | Amateka |  |  |
| `emergency.opsTitle` | **NEW** | Emergency alerts | Alertes d'urgence | Impuruza z'ubutabazi |  |  |
| `emergency.retry` |  | Try again | Réessayer | Ongera ugerageze |  | Manual retry of the platform notification |
| `emergency.sent` |  | Emergency contacts notified | Contacts d'urgence notifiés | Ubutumwa bwubutabazi bwoherejwe |  |  |

## Namespace: `errors`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `errors.account_frozen` |  | Your account is frozen — contact support. | Votre compte est gelé — contactez l'assistance. | Konti yawe yahagaritswe — vugana n'ubufasha. |  | Server rejection at login when the account is frozen |
| `errors.alreadyBid` | **NEW** | You have already made an offer on this ride. | Vous avez déjà fait une offre sur cette course. | Wamaze gutanga ituro kuri uru rugendo. |  |  |
| `errors.alreadyDeclined` | **NEW** | You have already declined this offer. | Vous avez déjà refusé cette offre. | Wamaze kwanga iki cyifuzo. |  |  |
| `errors.alreadyRated` | **NEW** | You have already rated this ride. | Vous avez déjà noté ce trajet. | Wamaze gutanga amanota kuri uru rugendo. |  |  |
| `errors.alreadyReported` | **NEW** | You have already reported this ride. | Vous avez déjà signalé cette course. | Wamaze gutanga ikibazo kuri uru rugendo. |  |  |
| `errors.bidNotFound` |  | This offer no longer exists. | Cette offre n'existe plus. | Iki cyifuzo nticikiriho. |  | Server rejection: offer no longer exists |
| `errors.bidNotPending` |  | This offer has already been answered. | Cette offre a déjà reçu une réponse. | Iki cyifuzo cyamaze gusubizwa. |  | Server rejection: offer already answered |
| `errors.bidWindowClosed` | **NEW** | Offers have closed for this ride. | Les offres sont closes pour cette course. | Igihe cyo gutanga amaturo kuri uru rugendo cyarangiye. |  |  |
| `errors.bidWindowNotOpen` |  | Bidding isn't open for this ride yet. | Les offres ne sont pas encore ouvertes pour cette course. | Gutanga ibiciro ntibirafungurwa kuri uru rugendo. |  | Server rejection: bidding not open yet (scheduled rides) |
| `errors.bidWindowNotYetOpen` | **NEW** | Offers haven't opened for this ride yet. | Les offres ne sont pas encore ouvertes pour cette course. | Igihe cyo gutanga amaturo kuri uru rugendo ntikiratangira. |  |  |
| `errors.bid_expired` |  | This offer has expired. | Cette offre a expiré. | Iri turo ryarashize. |  |  |
| `errors.boundaryClearHint` | **NEW** | Keeps you signed in. Removes the downloaded map and locally cached ride data. | Vous restez connecté. Supprime la carte téléchargée et les données de trajet en cache. | Uguma winjiye. Bisiba ikarita yakuruwe n'amakuru y'ingendo abitswe kuri telefoni. |  |  |
| `errors.boundaryClearRetry` | **NEW** | Clear cached data and retry | Effacer les données en cache et réessayer | Siba amakuru abitswe hanyuma wongere ugerageze |  |  |
| `errors.boundaryLogoutReset` | **NEW** | Log out and start over | Se déconnecter et recommencer | Sohoka hanyuma utangire bundi bushya |  |  |
| `errors.boundaryRetry` |  | Retry | Réessayer | Ongera ugerageze |  | Button reloads the app |
| `errors.boundaryTitle` |  | Something went wrong | Une erreur s'est produite | Habaye ikibazo |  | Shown on the boot-failure retry screen |
| `errors.chargeFailed` |  | Payment could not be processed. | Le paiement n'a pas pu être traité. | Kwishyura ntibyakunze. |  | Server rejection: payment failed |
| `errors.contactsNotLoaded` | **NEW** | Your emergency contacts have not loaded yet. Check your connection and try again. | Vos contacts d'urgence ne sont pas encore chargés. Vérifiez votre connexion et réessayez. | Abo wahamagara mu byihutirwa ntibarapakirwa. Reba interineti yawe hanyuma wongere ugerageze. |  |  |
| `errors.counterAlreadyAnswered` | **NEW** | This price suggestion was already answered. | Cette proposition de prix a déjà reçu une réponse. | Icyo giciro cyasabwe cyamaze gusubizwa. |  |  |
| `errors.counterAlreadyExists` | **NEW** | You have already suggested a price for this offer. | Vous avez déjà proposé un prix pour cette offre. | Wamaze gusaba igiciro kuri iki giciro cyatanzwe. |  |  |
| `errors.counterDisabled` | **NEW** | Suggesting a price is not available yet. | Proposer un prix n'est pas encore disponible. | Gusaba igiciro ntibiraboneka. |  |  |
| `errors.counterEqualsBidPrice` | **NEW** | That is the price already offered. | C'est le prix déjà proposé. | Icyo ni cyo giciro cyari cyatanzwe. |  |  |
| `errors.counterNoLongerOpen` | **NEW** | This offer was already matched. | Cette offre a déjà été attribuée. | Iki giciro cyamaze guhabwa undi. |  |  |
| `errors.counterNotFound` | **NEW** | There is no price suggestion on this offer. | Il n'y a aucune proposition de prix sur cette offre. | Nta giciro cyasabwe kuri iki giciro cyatanzwe. |  |  |
| `errors.counterOutOfBounds` | **NEW** | That price is outside the allowed range. | Ce prix est en dehors de la fourchette autorisée. | Icyo giciro kiri hanze y’ibipimo byemewe. |  |  |
| `errors.deletionAlreadyPending` | **NEW** | Your account is already scheduled for deletion. | La suppression de votre compte est déjà programmée. | Konti yawe isanzwe iteganyijwe gusibwa. |  |  |
| `errors.disputeWindowClosed` | **NEW** | The time to dispute this ride has passed. | Le délai pour contester cette course est écoulé. | Igihe cyo kuburanisha uru rugendo cyarangiye. |  |  |
| `errors.driverIncompleteCompliance` | **NEW** | Some of your documents are still missing, so you can't make offers yet. | Certains de vos documents manquent encore, vous ne pouvez pas encore faire d'offres. | Hari inyandiko zawe zikibura, ntushobora gutanga amaturo. |  |  |
| `errors.driverNotVerified` |  | Your driver account isn't verified yet. | Votre compte chauffeur n'est pas encore vérifié. | Konti yawe y'umumotari ntiremezwa. |  | Server rejection: driver account not verified |
| `errors.driverRevoked` | **NEW** | Your driver account was revoked. Contact support to apply again. | Votre compte chauffeur a été révoqué. Contactez le support pour postuler à nouveau. | Konti yawe y'umushoferi yakuweho. Vugana na serivisi z'abakiriya kugira ngo wongere usabe. |  |  |
| `errors.driverSuspended` | **NEW** | Your account is suspended, so you can't make offers right now. | Votre compte est suspendu, vous ne pouvez pas faire d'offres pour le moment. | Konti yawe yahagaritswe by'agateganyo, ntushobora gutanga amaturo ubu. |  |  |
| `errors.emergencyAlertNotActive` | **NEW** | This emergency alert is not open. | Cette alerte d'urgence n'est pas ouverte. | Iyi mpuruza y'ubutabazi ntabwo ifunguye. |  |  |
| `errors.escrowNotAdoptable` | **NEW** | This ride's payment is already being processed. | Le paiement de cette course est déjà en cours de traitement. | Kwishyura kw'uru rugendo kuri gutunganywa. |  |  |
| `errors.fileTooLarge` | **NEW** | That file is too large. The limit is 10 MB. | Ce fichier est trop volumineux. La limite est de 10 Mo. | Iyi dosiye ni nini cyane. Ntirenge 10 MB. |  |  |
| `errors.forbidden` |  | You don't have permission to do that. | Vous n'avez pas la permission de faire cela. | Ntabwo ufite uburenganzira bwo gukora ibyo. |  | Server rejection: no permission |
| `errors.generic` |  | Something went wrong. Please try again. | Une erreur est survenue. Veuillez réessayer. | Hari ikitagenze neza. Ongera ugerageze. |  |  |
| `errors.geocodeQueryTooShort` | **NEW** | Type a little more so we can find the place. | Saisissez un peu plus de texte pour que nous puissions trouver le lieu. | Andika andi magambo make kugira ngo tubone aho hantu. |  |  |
| `errors.geocodingFailed` | **NEW** | That address search didn't work. Try again, or pick your point on the map. | Cette recherche d'adresse n'a pas abouti. Réessayez, ou choisissez votre point sur la carte. | Gushakisha iyo aderesi ntibyagenze. Ongera ugerageze, cyangwa uhitemo ahantu ku ikarita. |  |  |
| `errors.geocodingUnavailable` | **NEW** | Address search isn't available right now. Pick your point on the map instead. | La recherche d'adresse n'est pas disponible pour le moment. Choisissez votre point sur la carte. | Gushakisha aderesi ntibiraboneka ubu. Hitamo ahantu ku ikarita. |  |  |
| `errors.goHome` | **NEW** | Go to home screen | Aller à l'écran d'accueil | Subira ku ipaji y'itangiriro |  |  |
| `errors.invalidBody` |  | Please check your input and try again. | Vérifiez votre saisie et réessayez. | Suzuma ibyo wanditse hanyuma wongere ugerageze. |  | Server rejection: invalid request body (same copy as invalidInput) |
| `errors.invalidDistance` |  | That route isn't valid — check pickup and destination. | Ce trajet n'est pas valide — vérifiez le départ et la destination. | Iyo nzira ntiyemewe — suzuma aho uhagurukira n'aho ujya. |  | Server rejection: route not valid |
| `errors.invalidEmergencyContact` | **NEW** | That is not a phone number we can call. Use 07XX XXX XXX, or a country code like +250 or +44. | Ce n'est pas un numéro que nous pouvons appeler. Utilisez 07XX XXX XXX, ou un indicatif comme +250 ou +44. | Iyi si nimero ya telefone dushobora guhamagara. Koresha 07XX XXX XXX, cyangwa kode y'igihugu nka +250 cyangwa +44. |  |  |
| `errors.invalidInput` |  | Please check your input and try again. | Vérifiez votre saisie et réessayez. | Suzuma ibyo wanditse hanyuma wongere ugerageze. |  | Server rejection: invalid input |
| `errors.invalidPreference` | **NEW** | That payout schedule isn't valid. | Ce calendrier de paiement n'est pas valide. | Iyo gahunda yo kwishyurwa ntabwo yemewe. |  |  |
| `errors.invalidRating` | **NEW** | Please choose between 1 and 5 stars. | Veuillez choisir entre 1 et 5 étoiles. | Hitamo kuva ku nyenyeri 1 kugeza kuri 5. |  |  |
| `errors.invalid_otp` |  | Invalid verification code. Please try again. | Code de vérification invalide. Veuillez réessayer. | Kode yo kwemeza ntabwo ari yo. Ongera ugerageze. |  |  |
| `errors.invalid_transition` | **STUB** | Invalid status transition. | Transition de statut invalide. | [RW] Invalid status transition. |  |  |
| `errors.journeyNotAcceptingBids` | **NEW** | This ride is no longer taking offers. | Cette course n'accepte plus d'offres. | Uru rugendo ntirwakira amaturo ukundi. |  |  |
| `errors.journeyNotAtPickup` |  | This ride hasn't reached the pickup point yet. | Cette course n'a pas encore atteint le point de départ. | Uru rugendo ntiruragera aho bahagurukira. |  | Server rejection: ride not at pickup yet |
| `errors.journeyNotCompleted` | **NEW** | This ride is not finished yet. | Ce trajet n’est pas encore terminé. | Uru rugendo ntirurarangira. |  |  |
| `errors.journeyNotEnded` | **NEW** | This ride is not finished yet. | Cette course n'est pas encore terminée. | Uru rugendo ntirurarangira. |  |  |
| `errors.journeyNotFound` |  | This ride could not be found. | Cette course est introuvable. | Uru rugendo ntirwabonetse. |  | Server rejection: ride does not exist |
| `errors.journey_already_matched` |  | This ride has already been matched. | Cette course a déjà été attribuée. | Uru rugendo rusanzwe rufite umumotari. |  |  |
| `errors.lateCancelNotAllowed` | **NEW** | It's too close to your pickup time to cancel here. Call your driver. | Il est trop tard pour annuler ici, l'heure de départ approche. Appelez votre chauffeur. | Igihe cyo kugufata kiri hafi cyane ngo uhagarike hano. Hamagara umushoferi wawe. |  |  |
| `errors.mapNotAvailable` |  | The offline map isn't available yet. | La carte hors ligne n'est pas encore disponible. | Ikarita ikora nta murandasi ntiraboneka. |  | Server error key for the 404 (rarely surfaced — UI stays calm) |
| `errors.messageTooLong` | **NEW** | That message is too long. Keep it under 500 characters. | Ce message est trop long. Restez sous 500 caractères. | Ubwo butumwa ni burebure cyane. Ntiburenze inyuguti 500. |  |  |
| `errors.moneyPinAlreadySet` | **NEW** | You already have a money PIN. | Vous avez deja un code argent. | Usanzwe ufite kode y'amafaranga. |  |  |
| `errors.moneyPinEnrollmentRequired` | **NEW** | Set a money PIN to open this screen. | Choisissez un code argent pour ouvrir cet ecran. | Shyiraho kode y'amafaranga kugira ngo ufungure uru rupapuro. |  |  |
| `errors.moneyPinInvalid` | **NEW** | Wrong PIN. Try again. | Code incorrect. Reessayez. | Kode ntiyemewe. Ongera ugerageze. |  |  |
| `errors.moneyPinInvalidFormat` | **NEW** | A money PIN is 4 digits. | Un code argent a 4 chiffres. | Kode y'amafaranga igizwe n'imibare 4. |  |  |
| `errors.moneyPinLocked` | **NEW** | Too many wrong tries. Wait a little, then try again. | Trop d'essais incorrects. Attendez un peu, puis reessayez. | Wagerageje inshuro nyinshi. Tegereza gato, ubone kongera kugerageza. |  |  |
| `errors.moneyPinNotSet` | **NEW** | You have not set a money PIN yet. | Vous n'avez pas encore de code argent. | Ntabwo urashyiraho kode y'amafaranga. |  |  |
| `errors.moneyStepUpRequired` | **NEW** | Enter your money PIN to continue. | Entrez votre code argent pour continuer. | Andika kode y'amafaranga kugira ngo ukomeze. |  |  |
| `errors.network` |  | Network error. Please check your connection. | Erreur réseau. Veuillez vérifier votre connexion. | Ikibazo cyo kumenyekanisha. Reba umuyoboro wawe. |  |  |
| `errors.noDeletionPending` | **NEW** | There is no deletion request to cancel. | Aucune demande de suppression à annuler. | Nta cyifuzo cyo gusiba konti gihari cyo kureka. |  |  |
| `errors.notAssignedDriver` |  | You're not the driver for this ride. | Vous n'êtes pas le chauffeur de cette course. | Ntabwo uri umumotari w'uru rugendo. |  | Server rejection: driver not assigned to the ride |
| `errors.notBidOwner` | **NEW** | That offer belongs to a different account. | Cette offre appartient à un autre compte. | Iryo turo ni irya konti indi. |  |  |
| `errors.notFound` |  | That item could not be found. | Cet élément est introuvable. | Icyo gintu nticyabonetse. |  | Server rejection: generic not-found |
| `errors.notJourneyCustomer` |  | This ride belongs to a different account. | Cette course appartient à un autre compte. | Uru rugendo ni urw'indi konti. |  | Server rejection: ride belongs to another customer |
| `errors.notJourneyDriver` | **NEW** | You did not drive this ride. | Vous n'avez pas conduit cette course. | Ntabwo ari wowe watwaye uru rugendo. |  |  |
| `errors.notJourneyParticipant` |  | You're not part of this ride. | Vous ne faites pas partie de cette course. | Ntabwo uri mu bagize uru rugendo. |  | Server rejection: user not part of the ride |
| `errors.notShiftEndMode` | **NEW** | Your current schedule pays you automatically — no need to request it. | Votre calendrier actuel vous paie automatiquement — pas besoin de le demander. | Gahunda yawe y'ubu yishyura mu buryo bwikora — ntukeneye kubisaba. |  |  |
| `errors.offlineQueued` |  | No connection — we'll keep your request ready and send it when you're back | Pas de connexion — votre demande est enregistrée et partira dès le retour du réseau | Nta murandasi — twabitse igisabo cyawe, kizoherezwa umurandasi nugaruka |  | Toast when an action was saved to the offline queue |
| `errors.offlineRetry` |  | No connection — check your connection and try again | Pas de connexion — vérifiez votre connexion et réessayez | Nta murandasi — reba umurandasi wawe hanyuma wongere ugerageze |  | Toast when an action failed with no connection and no queue |
| `errors.otpInvalid` | **NEW** | That code is not right. Check the SMS and enter it again. | Ce code n'est pas correct. Vérifiez le SMS et saisissez-le à nouveau. | Uwo mubare si wo. Reba SMS wongere uwandike. |  |  |
| `errors.otpRequired` | **NEW** | Enter the code we sent you by SMS. | Entrez le code que nous vous avons envoyé par SMS. | Andika kode twaguhereje kuri SMS. |  |  |
| `errors.outsideOperationArea` | **NEW** | That place is not in our operation area. Bimoto serves Kigali for now. | Ce lieu n'est pas dans notre zone d'opération. Bimoto dessert Kigali pour l'instant. | Ahantu hatari mu karere dukoreramo. Bimoto ikorera i Kigali kugeza ubu. |  |  |
| `errors.parcelTooHeavyForVehicle` | **NEW** | That is too heavy for the vehicle you chose. Pick a lighter parcel or a different vehicle. | C'est trop lourd pour le véhicule choisi. Choisissez un colis plus léger ou un autre véhicule. | Ibyo biraremereye kuri iyo modoka wahisemo. Hitamo ipaki yoroshye cyangwa indi modoka. |  |  |
| `errors.parcelTooLargeForVehicle` | **NEW** | That parcel is too big for a moto on its own — a moto alone takes envelope-size items. Choose a bicycle, or send it with a passenger ride. | Ce colis est trop grand pour une moto seule — une moto seule prend des articles de la taille d'une enveloppe. Choisissez un vélo, ou envoyez-le avec une course passager. | Iyo paki ni nini kuri moto yonyine — moto yonyine itwara ibintu bingana n'ibahasha. Hitamo igare, cyangwa uyoherereze mu rugendo rw'umugenzi. |  |  |
| `errors.pickupCoordsInvalid` | **NEW** | That pickup point isn't valid. Choose it again on the map. | Ce point de départ n'est pas valide. Choisissez-le à nouveau sur la carte. | Aho uva ntabwo ari ho. Hongere uhitemo ku ikarita. |  |  |
| `errors.pickupCoordsOutOfBounds` | **NEW** | That pickup point is not in our operation area. Bimoto serves Kigali for now. | Ce point de départ n'est pas dans notre zone de service. Bimoto dessert Kigali pour l'instant. | Aho uva ntabwo ari mu gace dukoreramo. Bimoto ikorera i Kigali kugeza ubu. |  |  |
| `errors.preferenceChangeRateLimited` | **NEW** | You already changed your payout schedule today. Try again tomorrow. | Vous avez déjà changé votre calendrier de paiement aujourd'hui. Réessayez demain. | Wamaze guhindura gahunda yo kwishyurwa uyu munsi. Ongera ugerageze ejo. |  |  |
| `errors.rate_limited` |  | Too many requests. Please wait a moment. | Trop de requêtes. Veuillez patienter un moment. | Ubusabe bwinshi. Tegereza akanya. |  |  |
| `errors.rejectedGeneric` |  | The request was not accepted | La demande n'a pas été acceptée | Igisabo nticyemewe |  | Fallback when the server rejects with an unknown message |
| `errors.roleNotSelfAssignable` | **NEW** | That account type cannot be set here. | Ce type de compte ne peut pas être défini ici. | Ubwo bwoko bwa konti ntibushobora guhindurirwa hano. |  |  |
| `errors.routeNotFound` |  | No road route found between these points. | Aucun itinéraire routier trouvé entre ces points. | Nta nzira y’umuhanda yabonetse hagati y’utu tudomo. |  | Server error key; client falls back to the straight line silently |
| `errors.scheduledForInvalid` |  | That pickup time isn't valid. | Cette heure de prise en charge n'est pas valide. | Icyo gihe cyo gufatwa si cyo. |  | SCHED-UI |
| `errors.scheduledForRequired` |  | Choose a pickup time for your scheduled ride. | Choisissez une heure de prise en charge pour votre course programmée. | Hitamo igihe cyo gufatwa ku rugendo rwagenwe. |  | SCHED-UI — client mirror of server validator |
| `errors.scheduledForTooFar` |  | Pickup time can be at most 30 days from now. | L'heure de prise en charge doit être au plus 30 jours dans le futur. | Igihe cyo gufatwa ntikirenze iminsi 30 uhereye ubu. |  | SCHED-UI — 30-day maximum lead |
| `errors.scheduledForTooSoon` |  | Pickup time must be at least 1 hour from now. | L'heure de prise en charge doit être au moins 1 heure dans le futur. | Igihe cyo gufatwa kigomba kuba nibura isaha 1 uhereye ubu. |  | SCHED-UI — 1-hour minimum lead |
| `errors.scheduledPastDeletion` | **NEW** | That pickup time is after your account is deleted. Choose an earlier time, or cancel the deletion. | Cette heure de prise en charge est postérieure à la suppression de votre compte. Choisissez une heure plus tôt ou annulez la suppression. | Icyo gihe cyo gufatwa kiri nyuma y'uko konti yawe isibwa. Hitamo igihe cya mbere, cyangwa ureke gusiba konti. |  |  |
| `errors.screenCrashTitle` | **NEW** | This screen hit a problem | Un problème est survenu sur cet écran | Iyi paji yagize ikibazo |  |  |
| `errors.serverProblem` |  | Bimoto has a problem, not your phone — try again in a moment | Bimoto a un problème, pas votre téléphone — réessayez dans un instant | Bimoto ifite ikibazo, si telefoni yawe — ongera ugerageze mu kanya |  | 5xx toast — must NOT blame the user's phone |
| `errors.tooFarFromDestination` | **NEW** | You're too far from the destination to finish this ride. Get closer and try again. | Vous êtes trop loin de la destination pour terminer cette course. Rapprochez-vous et réessayez. | Uri kure cyane y'aho ujya ngo urangize uru rugendo. Egera hafi wongere ugerageze. |  |  |
| `errors.tooFarFromPickup` | **NEW** | You're too far from the pickup point to start this ride. Get closer and try again. | Vous êtes trop loin du point de départ pour commencer cette course. Rapprochez-vous et réessayez. | Uri kure cyane y'aho uva ngo utangire uru rugendo. Egera hafi wongere ugerageze. |  |  |
| `errors.unauthorized` |  | Session expired. Please log in again. | Session expirée. Veuillez vous reconnecter. | Igihe cyawe cyarashize. Ongera winjire. |  |  |
| `errors.unsupportedFileType` | **NEW** | That file type isn't accepted. Send a photo (JPEG or PNG) or a PDF. | Ce type de fichier n'est pas accepté. Envoyez une photo (JPEG ou PNG) ou un PDF. | Ubwo bwoko bw'idosiye ntibwemewe. Ohereza ifoto (JPEG cyangwa PNG) cyangwa PDF. |  |  |
| `errors.upgradeRequired` | **NEW** | This version of Bimoto is out of date. Please update the app to continue. | Cette version de Bimoto n'est plus à jour. Veuillez mettre à jour l'application pour continuer. | Iyi verisiyo ya Bimoto yarashaje. Nyamuneka vugurura porogaramu kugira ngo ukomeze. |  |  |
| `errors.uploadRejected` | **NEW** | That upload was not accepted. Try a different file. | Cet envoi n'a pas été accepté. Essayez un autre fichier. | Iyi dosiye ntiyemewe. Gerageza indi dosiye. |  |  |
| `errors.userNotFound` |  | Account not found. | Compte introuvable. | Konti ntiyabonetse. |  | Server rejection: account not found |
| `errors.validation` |  | Please check your input and try again. | Veuillez vérifier vos informations et réessayer. | Reba amakuru yawe ugerageze nanone. |  |  |
| `errors.vehicleChangeBlocked` |  | Finish your current ride before changing your vehicle details. | Terminez votre course en cours avant de modifier les informations de votre véhicule. | Banza urangize urugendo urimo mbere yo guhindura amakuru y'ikinyabiziga cyawe. |  |  |
| `errors.vehicleMismatch` | **NEW** | This ride asked for a different vehicle than the one on your account. | Cette course demande un véhicule différent de celui de votre compte. | Uru rugendo rusaba ikinyabiziga gitandukanye n'icyo ufite kuri konti yawe. |  |  |
| `errors.vehicleNotLoaded` | **NEW** | Your vehicle details have not loaded yet. Check your connection and try again. | Les informations de votre véhicule ne sont pas encore chargées. Vérifiez votre connexion et réessayez. | Amakuru y’ikinyabiziga cyawe ntiyarapakirwa. Reba interineti yawe hanyuma wongere ugerageze. |  |  |

## Namespace: `goods`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `goods.confirm_goods` |  | Confirm goods received | Confirmer la réception des marchandises | Emeza ko ibintu byakiriwe |  |  |
| `goods.delivery_confirmed` |  | Delivery confirmed! | Livraison confirmée ! | Ibintu byatanzwe neza! |  |  |
| `goods.description` |  | Description | Description | Ubusobanuro |  |  |
| `goods.descriptionPlaceholder` |  | What is being sent? | Qu'envoyez-vous ? | Wohereje iki |  |  |
| `goods.descriptionRequired` |  | Please describe the goods | Veuillez décrire le colis | Sobanura icyo wohereza |  |  |
| `goods.description_label` |  | Goods description | Description des marchandises | Ibisobanuro by'ibintu |  |  |
| `goods.details` |  | Package details | Détails du colis | Ibigize umuzigo |  |  |
| `goods.fragile` |  | Fragile | Fragile | Birameneka |  |  |
| `goods.missingDescription` |  | Describe the goods | Décrivez le colis | Sobanura icyo wohereza |  | Same hint block on the parcel screen; mirrors goods.descriptionRequired vocabulary |
| `goods.recipientName` |  | Recipient name | Nom du destinataire | Izina ry'uwakira |  |  |
| `goods.recipientNamePlaceholder` |  | Write here | Écrivez ici | Andika hano |  |  |
| `goods.recipientNameRequired` |  | Please enter the recipient's name | Veuillez indiquer le nom du destinataire | Andika izina ry'uwakira |  |  |
| `goods.recipientPhone` |  | Recipient phone | Téléphone du destinataire | Telefoni y'uwakira |  |  |
| `goods.recipientPhonePlaceholder` | same-as-EN: placeholder | +250 7XX XXX XXX | +250 7XX XXX XXX | +250 7XX XXX XXX |  |  |
| `goods.recipientPhoneRequired` |  | Please enter the recipient's phone | Veuillez indiquer le téléphone du destinataire | Andika telefoni y'uwakira |  |  |
| `goods.recipient_name` |  | Recipient name | Nom du destinataire | Izina ry'uwakiriye |  |  |
| `goods.recipient_phone` |  | Recipient phone | Téléphone du destinataire | Telefoni y'uwakiriye |  |  |
| `goods.size` |  | Size | Taille | Ingano |  |  |
| `goods.size_large` |  | Large | Grand | Umuzigo munini |  |  |
| `goods.size_medium` |  | Medium | Moyen | Umuzigo uringaniye |  |  |
| `goods.size_small` |  | Small | Petit | Umuzigo muto |  |  |
| `goods.submit` |  | Request delivery | Demander la livraison | Saba kohereza |  |  |
| `goods.take_delivery_photo` |  | Take delivery photo | Prendre une photo à la livraison | Fata ifoto yo gutanga ibintu |  |  |
| `goods.take_pickup_photo` |  | Take pickup photo | Prendre une photo au ramassage | Fata ifoto yo gufata ibintu |  |  |
| `goods.tierLabel` |  | When do you need the package? | Quand avez-vous besoin du colis ? | Ukeneye umuzigo ryari? |  | Urgency tier group label in the parcel flow |
| `goods.tierNormal` |  | Not urgent · standard fare | Pas urgent · tarif standard | Ntabwo byihutirwa |  | Default tier option (also on urgent/priority page) |
| `goods.title` |  | Send package | Envoyer un colis | Kohereza umuzigo |  |  |
| `goods.wishPriceHelper` | **NEW** | Set a price for the parcel, or wait for the driver's price | Fixez un prix pour le colis, ou attendez le prix du chauffeur | Igiciro cy'umuzigo (Shyiramo igiciro cyangwa utegereze igiciro cy'umumotari/umunyonzi) |  |  |

## Namespace: `goodsPickup`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `goodsPickup.backToDashboard` |  | Back to dashboard | Retour au tableau de bord | Subira ahabanza |  |  |
| `goodsPickup.complete` |  | Delivery complete | Livraison terminée | Ibintu byagejejwe |  |  |
| `goodsPickup.completeDesc` |  | The delivery photos are saved | Les photos de livraison sont enregistrées | Amafoto yo kugeza ibintu yabitswe |  |  |
| `goodsPickup.confirmButton` |  | Confirm goods | Confirmer le colis | Emeza ibyoherezwa |  |  |
| `goodsPickup.confirmGoods` |  | Check the goods | Vérifiez le colis | Genzura ibyoherezwa |  |  |
| `goodsPickup.confirmGoodsDesc` |  | Confirm the goods match the description before starting | Confirmez que le colis correspond à la description avant de partir | Emeza ko ibintu bihuye n'ibisobanuro mbere yo gutangira |  |  |
| `goodsPickup.deliveryPhotoAlt` |  | Delivery photo | Photo de livraison | Ifoto yo kugeza |  |  |
| `goodsPickup.deliveryPhotoDesc` |  | Take a photo of the goods handed to the recipient | Prenez une photo du colis remis au destinataire | Fata ifoto y'ibintu wahaye uwakira |  |  |
| `goodsPickup.deliveryPhotoUploaded` |  | Delivery photo saved | Photo de livraison enregistrée | Ifoto yo kugeza yabitswe |  |  |
| `goodsPickup.fetchFailed` |  | Could not load the delivery | Impossible de charger la livraison | Ntibyakunze gufungura amakuru |  |  |
| `goodsPickup.fragileWarning` |  | Fragile — handle with care | Fragile — à manipuler avec précaution | Birashobora kumeneka — bifate neza |  |  |
| `goodsPickup.goodsDesc` |  | Goods | Colis | Ibyoherezwa |  |  |
| `goodsPickup.photoRequired` |  | A photo is required | Une photo est requise | Ifoto irakenewe |  |  |
| `goodsPickup.pickupPhotoAlt` |  | Pickup photo | Photo d'enlèvement | Ifoto yo gufata |  |  |
| `goodsPickup.pickupPhotoDesc` |  | Take a photo of the goods before starting | Prenez une photo du colis avant de partir | Fata ifoto y'ibintu mbere yo gutangira |  |  |
| `goodsPickup.pickupPhotoUploaded` |  | Pickup photo saved | Photo d'enlèvement enregistrée | Ifoto yo gufata yabitswe |  |  |
| `goodsPickup.resumed` | **NEW** | Resumed where you left off | Reprise là où vous en étiez | Twakomeje aho wari ugeze |  |  |
| `goodsPickup.size` |  | Size | Taille | Ingano |  |  |
| `goodsPickup.takeDeliveryPhoto` |  | Delivery photo | Photo de livraison | Ifoto yo kugeza |  |  |
| `goodsPickup.takePickupPhoto` |  | Pickup photo | Photo d'enlèvement | Ifoto yo gufata |  |  |
| `goodsPickup.tapToCapture` |  | Tap to take a photo | Touchez pour prendre une photo | Kanda ufate ifoto |  |  |
| `goodsPickup.uploadDeliveryPhoto` |  | Save delivery photo | Enregistrer la photo de livraison | Bika ifoto yo kugeza |  |  |
| `goodsPickup.uploadFailed` |  | Photo upload failed | Échec de l'envoi de la photo | Kohereza ifoto byanze |  |  |
| `goodsPickup.uploadPickupPhoto` |  | Save pickup photo | Enregistrer la photo d'enlèvement | Bika ifoto yo gufata |  |  |

## Namespace: `guide`

> TODO(rw): native review required for all 'guide' keys (AI draft).

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `guide.bidding.body` |  | After submitting your request, nearby drivers will respond with their fares. Compare their prices, ratings, and estimated arrival times, then accept your preferred offer. You can also suggest your own fare — use the fair-price hint to see what similar trips cost. | Après l'envoi de votre demande, les chauffeurs proches répondent avec leur tarif. Comparez les prix, les notes et les heures d'arrivée estimées, puis acceptez l'offre que vous préférez. Vous pouvez aussi proposer votre propre tarif — utilisez l'indication de prix équitable pour voir ce que coûtent des trajets similaires. | Numara kohereza ubusabe bwawe, abamotari bari hafi batanga ibiciro byabo. Gereranya ibiciro, ikigereranyo n'igihe bazagerera, hanyuma wemere igiciro wishimiye. Ushobora no gutanga igiciro cyawe — koresha akamenyetso k'igiciro gikwiye kugira ngo urebe icyo ingendo nk'iyi zitwara. |  | Explains the bidding model in customer terms |
| `guide.bidding.title` |  | Offers and choosing a driver | Offres et choix du chauffeur | Ibiciro no guhitamo umumotari |  | Guide section heading |
| `guide.children.body` | **NEW** | Children under 12 are not an independent booking option on Bimoto — a child travels with a responsible adult, who makes the booking. When you book a ride you can tick 'Travelling with a child?' so the driver knows before they arrive. | Les enfants de moins de 12 ans ne peuvent pas réserver seuls sur Bimoto — un enfant voyage avec un adulte responsable, qui effectue la réservation. Au moment de réserver une course, vous pouvez cocher « Vous voyagez avec un enfant ? » pour que le chauffeur le sache avant d'arriver. | Abana bari munsi y'imyaka 12 ntibashobora gutumiza urugendo ubwabo kuri Bimoto — umwana agendana n'umuntu mukuru ubishinzwe, ari na we utumiza urugendo. Igihe utumiza urugendo, ushobora gushyiraho akamenyetso ka 'Uri kugendana n'umwana?' kugira ngo umumotari abimenye mbere yo kugera aho uri. |  |  |
| `guide.children.title` | **NEW** | Travelling with children | Voyager avec des enfants | Kugendana n'abana |  |  |
| `guide.help.body` |  | During a trip, use the in-app chat to communicate with your driver. For anything else, contact the Bimoto support team at a pilot stand or through your local contact — they can review any trip with you. | Pendant un trajet, utilisez la discussion intégrée pour communiquer avec votre chauffeur. Pour tout le reste, contactez l'équipe d'assistance Bimoto à un stand pilote ou via votre contact local — ils peuvent revoir n'importe quel trajet avec vous. | Mu gihe cy'urugendo, koresha ikiganiro kiri muri app uvugane n'umumotari wawe. Ku bindi byose, vugisha ikipe ifasha abakoresha Bimoto ku ivuriro rya pilote cyangwa unyuze ku muhuza wawe — bashobora kugusubiriramo urugendo urwo ari rwo rwose. |  | Pilot-stand wording may need localising to how the team actually operates |
| `guide.help.title` |  | Where to get help | Où trouver de l'aide | Aho ubona ubufasha |  | Guide section heading |
| `guide.language.body` |  | Open Profile and pick English, Français, or Kinyarwanda under Language. The choice is saved and applied every time you open the app. | Ouvrez Profil et choisissez English, Français ou Kinyarwanda sous Langue. Le choix est enregistré et appliqué à chaque ouverture de l'application. | Fungura Umwirondoro uhitemo English, Français cyangwa Kinyarwanda ahanditse Ururimi. Ibyo uhisemo birabikwa bigakoreshwa buri gihe ufunguye porogaramu. |  | Language names stay untranslated by design |
| `guide.language.title` |  | Change language | Changer de langue | Guhindura ururimi |  | Guide section heading |
| `guide.parcel.body` |  | Tap 'Send a parcel', enter the pickup and drop-off locations, and provide details about the item and the recipient. The driver collects the parcel and delivers it — you do not travel with it. For faster delivery, pick the Express option. | Appuyez sur « Envoyer un colis », saisissez les lieux de retrait et de livraison, puis donnez les détails du colis et du destinataire. Le chauffeur récupère le colis et le livre — vous ne voyagez pas avec. Pour une livraison plus rapide, choisissez l'option Express. | Kanda 'Ohereza umuzigo', shyiramo aho ufatirwa n'aho ugezwa, hanyuma utange ibisobanuro ku muzigo no ku wakira. Umumotari afata umuzigo akawugeza aho woherejwe — wowe ntugenda nawo. Niba wifuza ko umuzigo ugera yo vuba, hitamo Byihuse. |  | Must make clear only the parcel travels |
| `guide.parcel.title` |  | Send a parcel | Envoyer un colis | Ohereza ipaki |  | Guide section heading |
| `guide.ride.body` |  | Tap 'Request a ride' on the home screen, enter your pickup location and destination, and submit your request. A driver will then come to pick you up. | Appuyez sur « Demander une course » sur l'écran d'accueil, saisissez votre point de départ et votre destination, puis envoyez votre demande. Un chauffeur viendra ensuite vous chercher. | Kanda 'Saba moto' ahabanza, shyiramo aho uherereye n'aho ugiye, maze wohereze ubusabe bwawe. Umumotari araza kugufata aho uri. |  | Must make clear the ride carries a person |
| `guide.ride.title` |  | Request a ride | Demander une course | Saba urugendo |  | Guide section heading |
| `guide.sos.body` |  | During a ride, the red SOS button alerts the Bimoto team and your emergency contacts, and keeps the emergency number 112 one tap away. Use it whenever you feel unsafe — it never cancels your ride by itself. Motari and passenger each have the same button: whoever presses it, it alerts that person's own emergency contacts. | Pendant une course, le bouton SOS rouge alerte l'équipe Bimoto et vos contacts d'urgence, et garde le numéro d'urgence 112 à portée de main. Utilisez-le dès que vous ne vous sentez pas en sécurité — il n'annule jamais votre course de lui-même. Le motari et le passager ont le même bouton : quelle que soit la personne qui l'utilise, il alerte les contacts d'urgence de cette personne-là. | Mu gihe cy'urugendo, akamenyetso gatukura ka SOS kohereza integuza ku ikipe ya Bimoto n'abantu washyizeho wakwiyambaza mu butabazi, kandi kakugumishiriza nimero y'ubutabazi ya 112 hafi ku buryo wayikanda rimwe gusa. Gakoreshe igihe cyose wumva utekanye. Umumotari n'umugenzi bafite buto imwe: uwayikanda wese, imenyesha abantu we ubwe yashyizeho yakwiyambaza mu butabazi. |  | Safety copy — accuracy matters more than style |
| `guide.sos.title` |  | The SOS button | Le bouton SOS | Buto ya SOS |  | Guide section heading |
| `guide.title` |  | User guide | Guide d'utilisation | Imfashanyigisho y'ukoresha ino service |  | Page title; also the entry label on Profile and the welcome screen |
| `guide.trace.body` | **NEW** | During your ride, the driver's phone records the route — for safety, and so that any dispute can be settled with facts rather than memory. It is deleted after 14 days unless a dispute is open, in which case it is kept until the dispute is settled. It is never visible live to anyone — except our safety team during an emergency, until the emergency is closed. | Pendant votre course, le téléphone du chauffeur enregistre le trajet — pour la sécurité, et pour qu'un éventuel litige puisse être réglé sur la base de faits plutôt que de souvenirs. Il est supprimé après 14 jours, sauf si un litige est ouvert : dans ce cas il est conservé jusqu'au règlement du litige. Il n'est jamais visible en direct par qui que ce soit — sauf par notre équipe de sécurité pendant une urgence, jusqu'à la clôture de celle-ci. | Mu gihe cy'urugendo rwawe, telefoni y'umumotari yandika inzira munyuzemo — ku mutekano, no kugira ngo ikibazo cyose gishobore gukemurwa hashingiwe ku byabaye aho gushingira ku kwibuka. Isibwa nyuma y'iminsi 14 keretse hari ikibazo cyafunguwe; icyo gihe ibikwa kugeza igihe gikemukiye. Nta muntu n'umwe uyireba mu buryo buhita — keretse itsinda ryacu ry'umutekano mu gihe cy'ubutabazi, kugeza ubutabazi bufunzwe. |  |  |
| `guide.trace.title` | **NEW** | The route is recorded | Le trajet est enregistré | Inzira yandikwa |  |  |
| `guide.welcomeLink` | **NEW** | User guide | Guide d'utilisation | Amabwiriza |  |  |

## Namespace: `history`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `history.empty` |  | No rides yet | Pas encore de courses | Nta ngendo zirabaho |  |  |
| `history.emptyHint` |  | Request your first ride and it will appear here. | Demandez votre première course et elle apparaîtra ici. | Saba urugendo rwawe rwa mbere maze ruzagaragara hano. |  | Second line of the empty "My rides" screen |
| `history.fetchFailed` |  | Could not load your rides | Impossible de charger vos courses | Ntibyakunze gufungura ingendo zawe |  |  |
| `history.sectionAsMotari` | **NEW** | As motari | En tant que motari | Nk'umumotari |  |  |
| `history.sectionAsPassenger` | **NEW** | As passenger | En tant que passager | Nk'umugenzi |  |  |
| `history.title` |  | My Journey | Mon trajet | Urugendo Rwajye |  |  |

## Namespace: `home`

> TODO(rw): native review required for the following 'home' + 'urgent' + 'priority' keys.

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `home.priorityDelivery` |  | Priority delivery | Livraison prioritaire | Kohereza by'ibanze |  |  |
| `home.priorityDeliveryHint` |  | Faster than normal, cheaper than urgent — 1.15× premium with a quicker driver match | Plus rapide que la normale, moins chère qu'urgente — supplément 1,15× et un appariement plus rapide | Byihuse kuruta ibisanzwe, hatari igiciro cyo kohereza byihuse — umusoro 1.15× n'umumotari avumbuwe vuba |  |  |
| `home.requestRide` |  | Request a ride | Demander une course | Saba urugendo |  | Fork tile |
| `home.requestRideHint` |  | You travel as the passenger — a driver picks you up and takes you there | Vous voyagez comme passager — un chauffeur vient vous chercher et vous emmène | Ukoresha app nk'umugenzi — umumotari/umunyonzi aza kugufata akakugeza aho ugiye |  | Was "A driver comes to pick you up" — must say the PERSON travels |
| `home.sendParcel` |  | Send a package | Envoyer un colis | Ohereza umuzigo |  | Fork tile |
| `home.sendParcelHint` |  | Only the package travels — a driver picks it up and delivers it | Seul le colis voyage — un chauffeur le récupère et le livre | Umuzigo ni wo wonyine wohereza — umumotari/umunyonzi afata umuzigo akawugeza aho woherejwe |  | Was "A driver picks it up and delivers it" — must say only the parcel travels |
| `home.title` |  | What do you need today? | De quoi avez-vous besoin aujourd'hui ? | Turagufasha iki uyu munsi |  | Heading on the home sheet |
| `home.urgentDelivery` |  | Urgent delivery | Livraison urgente | Kohereza byihuse |  |  |
| `home.urgentDeliveryHint` |  | Send a parcel right now — broadcast to every nearby driver instantly | Envoyez un colis maintenant — diffusé immédiatement à tous les chauffeurs proches | Ohereza ipaki ubu — yegeranywa ako kanya ku bamotari bose bari hafi |  |  |

## Namespace: `inProgress`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `inProgress.duration` |  | Duration | Durée | Igihe |  |  |
| `inProgress.emergency` |  | Emergency | Urgence | Ubutabazi |  |  |
| `inProgress.emergencyConfirm` |  | Send an emergency alert? | Envoyer une alerte d'urgence ? | Kohereza integuza y'ubutabazi? |  |  |
| `inProgress.fetchFailed` |  | Could not load the ride | Impossible de charger la course | Ntibyakunze gufungura urugendo |  |  |
| `inProgress.interrupt` |  | Stop the ride | Arrêter la course | Hagarika urugendo |  |  |
| `inProgress.interruptConfirm` |  | Stop this ride now? | Arrêter cette course maintenant ? | Guhagarika urugendo nonaha? |  |  |
| `inProgress.interruptFailed` |  | Could not stop the ride | Impossible d'arrêter la course | Ntibyakunze guhagarika urugendo |  |  |
| `inProgress.interrupted` |  | Ride stopped | Course arrêtée | Urugendo rwahagaritswe |  |  |
| `inProgress.mapPlaceholder` |  | Map view | Vue de la carte | Ikarita |  |  |
| `inProgress.recording` |  | GPS recording | Enregistrement GPS | GPS irakora |  |  |
| `inProgress.title` |  | On the way | En route | Uri mu nzira |  |  |

## Namespace: `intel`

> INTEL-DECK G5 — the analyst reading room (/intel). These strings are read by a data analyst rather than by a rider, and the tooling is EN-first by agreement, so RW/FR renderings here are lower priority than any passenger- or driver-facing namespace. Two lines carry real weight and should be reviewed even if the rest waits: `intel.empty` ("No cells cleared the privacy threshold here.") must read as a statement about the privacy rule, never as an error or an empty database — an analyst who reads it as a failure will draw the wrong conclusion about Kigali; and `intel.marginal.other` ("other (folded)") must read as a REMAINDER the platform declined to break down, not as a vehicle type called "other". `intel.subtitle` is the promise the whole surface makes and should stay plain: this cannot show you a person, only a city.

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `intel.cell.noMarginals` | **NEW** | This tier publishes no attribute splits. | Ce niveau ne publie aucune répartition d'attributs. | Uru rwego ntirutangaza uko ibiranga bitandukanye. |  |  |
| `intel.cell.tapPrompt` | **NEW** | Tap a hexagon to see what it carries. | Touchez un hexagone pour voir ce qu'il contient. | Kanda ku kazu k'impande esheshatu urebe ibikarimo. |  |  |
| `intel.cell.threshold` | **NEW** | This cell exists because at least {{k}} movements lit it. | Cette cellule existe parce qu'au moins {{k}} déplacements l'ont éclairée. | Aka kazu kabaho kubera ko byibuze ingendo {{k}} zakamurikiye. |  |  |
| `intel.cell.window` | **NEW**<br>same-as-EN: placeholder | {{from}} — {{to}} | {{from}} — {{to}} | {{from}} — {{to}} |  |  |
| `intel.empty` | **NEW** | No cells cleared the privacy threshold here. | Aucune cellule n'a franchi le seuil de confidentialité ici. | Nta kazu (cell) kanyuze ku rugero rw'ibanga hano. |  |  |
| `intel.export.csv` | **NEW** | Export this view (CSV) | Exporter cette vue (CSV) | Sohora iyi paji (CSV) |  |  |
| `intel.export.failed` | **NEW** | Could not export. | Impossible d'exporter. | Ntibyakunze gusohora. |  |  |
| `intel.export.heading` | **NEW** | Export ({{lines}} lines) | Export ({{lines}} lignes) | Ibyasohotse (imirongo {{lines}}) |  |  |
| `intel.export.jsonl` | **NEW** | Export (JSONL) | Exporter (JSONL) | Sohora (JSONL) |  |  |
| `intel.export.working` | **NEW** | Exporting… | Export en cours… | Birimo gusohorwa… |  |  |
| `intel.filter.from` | **NEW** | From | Du | Kuva |  |  |
| `intel.filter.tier` | **NEW** | Tier | Niveau | Urwego |  |  |
| `intel.filter.to` | **NEW** | To | Au | Kugeza |  |  |
| `intel.flows.count` | **NEW** | Journeys | Trajets | Ingendo |  |  |
| `intel.flows.destination` | **NEW** | Destination cell | Cellule de destination | Akazu k'aho bagiye |  |  |
| `intel.flows.empty` | **NEW** | No origin–destination pair cleared the stricter endpoint's threshold in this window. | Aucune paire origine–destination n'a franchi le seuil du côté le plus strict dans cette fenêtre. | Nta gice cy'aho batangiriye n'aho bagiye cyanyuze ku rugero rukomeye muri iki gihe. |  |  |
| `intel.flows.origin` | **NEW** | Origin cell | Cellule d'origine | Akazu k'aho batangiriye |  |  |
| `intel.flows.share` | **NEW** | Share | Part | Igipimo |  |  |
| `intel.flows.window` | **NEW** | Window | Fenêtre | Igihe |  |  |
| `intel.grainNote` | **NEW** | Cells of {{metres}} m, buckets of {{minutes}} min, and at least {{k}} movements per cell before it exists at all. | Cellules de {{metres}} m, tranches de {{minutes}} min, et au moins {{k}} déplacements par cellule avant qu'elle n'existe. | Utuzu twa metero {{metres}}, ibice by'iminota {{minutes}}, kandi byibuze ingendo {{k}} kuri buri kazu mbere y'uko kabaho. |  |  |
| `intel.loadFailed` | **NEW** | Could not load aggregates. | Impossible de charger les agrégats. | Ntibyakunze gupakira imibare yateranyijwe. |  |  |
| `intel.loading` | **NEW** | Loading… | Chargement… | Birimo gupakirwa… |  |  |
| `intel.marginal.fareDeciles` | **NEW** | Fare band | Tranche tarifaire | Urwego rw'igiciro |  |  |
| `intel.marginal.hourBuckets` | **NEW** | Hour of day | Heure de la journée | Isaha y'umunsi |  |  |
| `intel.marginal.other` | **NEW** | other (folded) | autres (regroupés) | ibindi (byahurijwe hamwe) |  |  |
| `intel.marginal.vehicleTypes` | **NEW** | Vehicle | Véhicule | Ikinyabiziga |  |  |
| `intel.ops.attributes` | **NEW** | Attributes | Attributs | Ibiranga |  |  |
| `intel.ops.bucket` | **NEW** | Bucket | Tranche | Igice |  |  |
| `intel.ops.cellSize` | **NEW** | Cell | Cellule | Akazu |  |  |
| `intel.ops.cells` | **NEW** | Cells | Cellules | Utuzu |  |  |
| `intel.ops.classificationVersion` | **NEW** | Tier classification version {{version}} | Version de la classification des niveaux {{version}} | Verisiyo y'ishyirwa mu byiciro {{version}} |  |  |
| `intel.ops.kThreshold` | **NEW**<br>same-as-EN: needs-decision | k | k | k |  |  |
| `intel.ops.points` | **NEW** | Movements | Déplacements | Ingendo |  |  |
| `intel.ops.rangeClear` | **NEW** | Clear range | Effacer la période | Siba igihe |  |  |
| `intel.ops.rangeFrom` | **NEW** | From | Du | Kuva |  |  |
| `intel.ops.rangeIncomplete` | **NEW** | Give both dates, or leave both empty. | Indiquez les deux dates, ou laissez-les vides toutes les deux. | Shyiramo amatariki yombi, cyangwa usige yombi ubusa. |  |  |
| `intel.ops.rangeOutOfOrder` | **NEW** | The end date has to come after the start date. | La date de fin doit être postérieure à la date de début. | Itariki yo kurangiriraho igomba kuza nyuma y’iyo watangiriyeho. |  |  |
| `intel.ops.rangeTo` | **NEW** | To | Au | Kugeza |  |  |
| `intel.ops.rangeTooLarge` | **NEW** | That range is longer than the {{days}}-day maximum. | Cette période dépasse le maximum de {{days}} jours. | Icyo gihe kirenze iminsi {{days}} yemewe. |  |  |
| `intel.ops.rangeUnparseable` | **NEW** | That is not a date the server can read. | Ce n’est pas une date lisible par le serveur. | Iyi si itariki seriveri ishobora gusoma. |  |  |
| `intel.ops.reload` | **NEW** | Reload tier classification | Recharger la classification des niveaux | Ongera upakire ishyirwa mu byiciro |  |  |
| `intel.ops.reloadFailed` | **NEW** | Could not reload the classification file. | Impossible de recharger le fichier de classification. | Ntibyakunze kongera gupakira dosiye y'ishyirwa mu byiciro. |  |  |
| `intel.ops.reloaded` | **NEW** | Reloaded — version {{version}}. | Rechargé — version {{version}}. | Byongeye gupakirwa — verisiyo {{version}}. |  |  |
| `intel.ops.reloading` | **NEW** | Reloading… | Rechargement… | Birimo kongera gupakirwa… |  |  |
| `intel.ops.runAccepted` | **NEW** | Accepted — the run is happening in the background. | Accepté — l'exécution se déroule en arrière-plan. | Byemewe — birimo gukorwa inyuma. |  |  |
| `intel.ops.runAcceptedRange` | **NEW** | Accepted — re-building {{from}} to {{to}} in the background. | Accepté — reconstruction du {{from}} au {{to}} en arrière-plan. | Byakiriwe — kwongera kubaka kuva {{from}} kugeza {{to}} birimo gukorwa. |  |  |
| `intel.ops.runFailed` | **NEW** | Could not start the run. | Impossible de démarrer l'exécution. | Ntibyakunze gutangira. |  |  |
| `intel.ops.runNow` | **NEW** | Run aggregation now | Lancer l'agrégation maintenant | Teranya nonaha |  |  |
| `intel.ops.runNowNote` | **NEW** | Leave the dates empty to run the same lookback window as the nightly job. Give a range to re-build the aggregates for those days instead. | Laissez les dates vides pour exécuter la même fenêtre que la tâche nocturne. Indiquez une période pour reconstruire les agrégats de ces jours-là. | Siga amatariki ubusa kugira ngo ukoreshe igihe kimwe n'akazi ko nijoro. Shyiramo igihe kugira ngo wongere wubake imibare y'iyo minsi. |  |  |
| `intel.ops.runNowNoteCapped` | **NEW** | Leave the dates empty to run the same lookback window as the nightly job. Give a range of up to {{days}} days to re-build the aggregates for those days instead. | Laissez les dates vides pour exécuter la même fenêtre que la tâche nocturne. Indiquez une période d'au plus {{days}} jours pour reconstruire les agrégats de ces jours-là. | Siga amatariki ubusa kugira ngo ukoreshe igihe kimwe n'akazi ko nijoro. Shyiramo igihe kitarenze iminsi {{days}} kugira ngo wongere wubake imibare y'iyo minsi. |  |  |
| `intel.ops.running` | **NEW** | Starting… | Démarrage… | Birimo gutangira… |  |  |
| `intel.ops.subtitle` | **NEW** | What the aggregation is configured to do, and what it produced in this range. | Ce que l'agrégation est configurée pour faire, et ce qu'elle a produit sur cette période. | Icyo guteranya kwagenewe gukora, n'icyo kwakoze muri iki gihe. |  |  |
| `intel.ops.tier` | **NEW** | Tier | Niveau | Urwego |  |  |
| `intel.ops.title` | **NEW** | Pipeline | Pipeline | Uburyo bwo guteranya |  |  |
| `intel.subtitle` | **NEW** | Aggregated, k-anonymised movement. This surface cannot show you a person, only a city. | Déplacements agrégés et k-anonymisés. Cette surface ne peut pas vous montrer une personne, seulement une ville. | Ingendo zateranyijwe kandi zihishwe amazina (k-anonymised). Iyi paji ntishobora kukwereka umuntu, yerekana umujyi gusa. |  |  |
| `intel.title` | **NEW** | Mobility intelligence | Intelligence de mobilité | Ubwenge ku migendere |  |  |
| `intel.view.density` | **NEW** | Density | Densité | Ubwinshi |  |  |
| `intel.view.flows` | **NEW** | Flows | Flux | Ingendo |  |  |

## Namespace: `interrupt`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `interrupt.button` |  | Stop ride | Arrêter la course | Hagarika urugendo |  |  |
| `interrupt.confirm` |  | Yes, stop | Oui, arrêter | Yego, hagarika |  |  |
| `interrupt.confirmMessage` |  | The ride will be marked as interrupted and both sides will be notified. | La course sera marquée comme interrompue et les deux parties seront averties. | Urugendo ruzandikwa nk'urwahagaritswe kandi impande zombi zimenyeshwe. |  |  |
| `interrupt.confirmTitle` |  | Stop this ride? | Arrêter cette course ? | Guhagarika urugendo? |  |  |
| `interrupt.label` |  | Stop | Arrêter | Hagarika |  |  |

## Namespace: `journey`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `journey.addressClear` | **NEW** | Clear | Effacer | Siba |  |  |
| `journey.addressNoResults` |  | No matching places found | Aucun lieu correspondant trouvé | Nta hantu hahuye n'ibyo washatse habonetse |  | GEOCODE — empty suggestion list |
| `journey.addressSearchUnavailable` |  | Address search is unavailable right now — use GPS or the map | La recherche d'adresse est indisponible pour le moment — utilisez le GPS ou la carte | Gushakisha aderesi ntibishoboka ubu — koresha GPS cyangwa ikarita |  | GEOCODE — shown when LOCATIONIQ_API_KEY is unset or server says 503 |
| `journey.addressSearching` |  | Searching addresses… | Recherche d'adresses… | Turimo gushakisha aderesi… |  | GEOCODE — live autocomplete loading state |
| `journey.addressSuggestions` |  | Address suggestions | Suggestions d'adresses | Ibyifuzo by'aderesi |  | GEOCODE — accessibility label for the dropdown |
| `journey.any_vehicle` |  | Any vehicle | Tout véhicule | Ikinyabiziga icyo ari cyo cyose |  |  |
| `journey.bike` |  | Bicycle | Vélo | Igare |  |  |
| `journey.createFailed` |  | Could not create the ride | Impossible de créer la course | Ntibyakunze gutangiza urugendo |  |  |
| `journey.currentLocation` |  | Current location | Position actuelle | Aho uri ubu |  |  |
| `journey.describePlaceHelp` | **NEW** | Anything that helps the driver find the exact spot | Tout ce qui aide le chauffeur à trouver l'endroit exact | Ibintu byose byafasha motari kubona neza aho hantu |  |  |
| `journey.describePlaceLabel` | **NEW** | Describe the place (optional) | Décrivez le lieu (facultatif) | Sobanura aho hantu (ntibisabwa) |  |  |
| `journey.describePlacePlaceholder` | **NEW** | e.g. Kuwa Mudugudu | ex. Kuwa Mudugudu | urugero: Kuwa Mudugudu |  |  |
| `journey.destination` |  | Destination | Destination | Aho Ugana |  |  |
| `journey.destinationDescriptionShown` | **NEW** | Destination notes | Précisions sur l'arrivée | Ibisobanuro by’aho ujya |  |  |
| `journey.destinationPlaceholder` |  | Where are you going to? | Où allez-vous ? | Ugiye he? |  |  |
| `journey.destinationRequired` |  | Please choose a destination | Veuillez choisir une destination | Hitamo aho ugiye |  |  |
| `journey.distance` | same-as-EN: placeholder | {{distance}} km | {{distance}} km | {{distance}} km |  |  |
| `journey.ebike` | same-as-EN: needs-decision | E-Bike | E-Bike | E-Bike |  |  |
| `journey.emoto` | same-as-EN: needs-decision | E-Moto | E-Moto | E-Moto |  |  |
| `journey.estimateDurationRange` | **NEW** | {{min}}–{{max}} min | {{min}}–{{max}} min | iminota {{min}}–{{max}} |  |  |
| `journey.estimateLabel` | **NEW** | Estimates — the real price is what a motari offers | Estimations — le vrai prix est celui qu’un motari propose | Ibigereranyo — igiciro nyacyo ni icyo umumotari atanga |  |  |
| `journey.estimateTypicalPrice` | **NEW** | about {{price}} RWF | environ {{price}} RWF | nka {{price}} RWF |  |  |
| `journey.fair_price` |  | Fair price for this route: {{price}} RWF | Prix équitable pour ce trajet : {{price}} RWF | Igiciro gikwiye kuri iri zira: {{price}} RWF |  |  |
| `journey.findDrivers` |  | Find drivers | Trouver des chauffeurs | Shakisha umumotari/umunyonzi |  |  |
| `journey.geoFailed` |  | Could not get your location | Impossible d'obtenir votre position | Ntibyakunze kubona aho uri |  |  |
| `journey.geoNotSupported` |  | Location is not available on this device | La localisation n'est pas disponible sur cet appareil | Iyi telefoni ntishobora kubona aho uri |  |  |
| `journey.landmarkNeedsPin` | **NEW** | Tap the map to show where this is | Touchez la carte pour indiquer où se trouve ce lieu | Kanda ku ikarita werekane aho hantu hari |  |  |
| `journey.missingDestination` |  | Set your destination | Indiquez votre destination | Shyiraho aho ugiye |  | Same hint block, destination line |
| `journey.missingPickup` |  | Set your pickup point | Indiquez votre point de départ | Shyiraho aho uzafatirwa |  | Shown above the disabled request button naming what is still missing |
| `journey.moto` | same-as-EN: needs-decision | Moto | Moto | Moto |  |  |
| `journey.new` |  | New Ride | Nouvelle course | Urugendo rushya |  |  |
| `journey.newRide` |  | New ride | Nouvelle course | Urugendo rushya rw'umugenzi |  | Ride-screen title; was "New ride" — now names the passenger |
| `journey.new_goods` |  | Send Goods | Envoyer des marchandises | Ohereza ibintu |  |  |
| `journey.new_offers` |  | {{count}} new offer(s) | {{count}} nouvelle(s) offre(s) | Amaturo mashya {{count}} |  |  |
| `journey.no_bids_yet` |  | No offers yet | Aucune offre pour le moment | Nta maturo arahari |  |  |
| `journey.offlineWarning` |  | You're offline — requests will be sent when you reconnect | Vous êtes hors ligne — les demandes seront envoyées à la reconnexion | Nta interineti — ubusabe buzoherezwa umaze kuyibona |  |  |
| `journey.pickOnMap` |  | Choose on map | Choisir sur la carte | Hitamo ku ikarita |  | Button under each address field that opens pick-on-map; becomes the primary control when address search is unavailable |
| `journey.pickup` |  | Departure Point | Point de départ | Hitamo aho uva |  |  |
| `journey.pickupDescriptionShown` | **NEW** | Pickup notes | Précisions sur le départ | Ibisobanuro by’aho uva |  |  |
| `journey.pickupPlaceholder` |  | Search pickup point | Recherchez le point de départ | Shakisha aho uzafatirwa |  |  |
| `journey.pickupRequired` |  | Please choose a pickup point | Veuillez choisir un point de départ | Hitamo aho uzafatirwa |  |  |
| `journey.searching` |  | Searching for drivers... | Recherche de chauffeurs... | Gushaka abamotari... |  |  |
| `journey.status.awaitingConfirmation` |  | Awaiting confirmation | En attente de confirmation | Rutegereje kwemezwa |  |  |
| `journey.status.awaiting_confirmation` |  | Awaiting Confirmation | En attente de confirmation | Bitegereje kwemezwa |  |  |
| `journey.status.cancelled` |  | Cancelled | Annulée | Byahagaritswe |  |  |
| `journey.status.completed` |  | Completed | Terminée | Byarangiye |  |  |
| `journey.status.disputed` |  | Disputed | Contestée | Biraburanishwa |  |  |
| `journey.status.expired` |  | Expired | Expirée | Byarashize |  |  |
| `journey.status.inProgress` |  | In progress | En cours | Ruragenda |  |  |
| `journey.status.in_progress` |  | In Progress | En cours | Birimo gukorwa |  |  |
| `journey.status.interrupted` |  | Interrupted | Interrompue | Byavuyemo |  |  |
| `journey.status.matched` |  | Matched | Attribuée | Byahurijwe |  |  |
| `journey.status.requested` |  | Requested | Demandée | Byasabwe |  |  |
| `journey.status.scheduled` |  | Scheduled | Programmée | Yagenwe |  | SCHED-UI — waiting-for-bid-window status |
| `journey.submit` |  | Submit Request | Soumettre la demande | Ohereza ubusabe |  |  |
| `journey.useMyLocation` |  | Use my location | Utiliser ma position | Koresha aho ndi |  |  |
| `journey.useSuggestedPrice` |  | Use this price | Utiliser ce prix | Koresha iki giciro |  | One-tap button next to the suggested-fare hint; fills the wish-price field with the suggested amount |
| `journey.use_gps` |  | Use my current location | Utiliser ma position actuelle | Koresha aho ndi ubu |  |  |
| `journey.vehicleType` |  | Preferred Vehicle | Véhicule souhaité | Ikinyabiziga/Ikinyamitende ushaka kugendaho |  |  |
| `journey.vehicle_pref` |  | Vehicle preference | Préférence de véhicule | Icyifuzo cy'ikinyabiziga |  |  |
| `journey.will_go_live` |  | Your request will go live to nearby drivers | Votre demande sera visible par les chauffeurs à proximité | Ubusabe bwawe buzagaragarira abamotari bari hafi |  |  |
| `journey.wishPrice` |  | Your price (RWF) | Votre prix (RWF) | Igiciro cyawe (RWF) |  |  |
| `journey.wishPriceHelper` |  | Drivers see this as your suggested price | Les chauffeurs voient ce prix comme votre proposition | Igiciro umumotari/umunyonzi abona |  |  |
| `journey.wishPricePlaceholder` |  | Write here | Écrivez ici | Andika hano |  |  |
| `journey.wish_price` |  | Your price | Votre prix | Igiciro cyawe |  |  |
| `journey.wish_price_hint` |  | Enter the price you want to pay (RWF) | Entrez le prix que vous souhaitez payer (RWF) | Andika igiciro ushaka kwishyura (RWF) |  |  |

## Namespace: `journeyHistory`

> TODO Kinyarwanda native review (R3-N-5).

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `journeyHistory.badgeDisputeOverturned` |  | Admin reversed — we apologise | Décision inversée — nous nous excusons | Umuyobozi yahinduye icyemezo — turabasaba imbabazi |  |  |
| `journeyHistory.badgeDisputeUpheld` |  | Dispute reviewed — your refund stands | Contestation examinée — votre remboursement est maintenu | Ikibazo cyarebwe — amafaranga yawe ntiyahindutse |  |  |
| `journeyHistory.badgeDriverDisputed` |  | Driver disputed — admin reviewing | Chauffeur a contesté — examen administrateur | Umumotari yatanze ikibazo — umuyobozi araba |  |  |
| `journeyHistory.badgeNoDriverDispute` |  | Reported, driver did not dispute | Signalé, le chauffeur n’a pas contesté | Byatanzwe, umumotari nta cyo yatanze |  |  |
| `journeyHistory.badgePendingReview` |  | Reported, under review | Signalé, en cours d’examen | Byatanzwe, biri kurebwa |  |  |

## Namespace: `layout`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `layout.appHeader` | **NEW** | App header | En-tête de l'application | Umutwe wa porogaramu |  |  |
| `layout.logoHome` | **NEW** | Go to home screen | Aller à l'écran d'accueil | Jya ku rupapuro rwa mbere |  |  |
| `layout.mainContent` |  | Main content | Contenu principal | Ibikubiyemo |  |  |

## Namespace: `legal`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `legal.diagnosticsConsent` | **NEW** | When the app hits an error, this phone records what happened — the time, the app version, the screen you were on, and the error text. Phone numbers and sign-in codes are removed before it is saved. To help us fix problems quickly, these error records are sent automatically to the Bimoto team in Kigali. You can see exactly what would be sent on the Diagnostics screen, and you can turn automatic sending off at any time in Settings. Your messages, your trips and your location are never part of it. | Quand l'application rencontre une erreur, ce téléphone enregistre ce qui s'est passé : l'heure, la version de l'application, l'écran où vous étiez, et le texte de l'erreur. Les numéros de téléphone et les codes de connexion sont retirés avant l'enregistrement. Pour nous aider à corriger vite, ces enregistrements sont envoyés automatiquement à l'équipe Bimoto à Kigali. Vous pouvez voir exactement ce qui serait envoyé sur l'écran Diagnostics, et vous pouvez désactiver l'envoi automatique à tout moment dans les Réglages. Vos messages, vos trajets et votre position n'en font jamais partie. | Iyo porogaramu ihuye n'ikibazo, iyi telefoni yandika ibyabaye: isaha, verisiyo ya porogaramu, urupapuro wari uriho, n'ubutumwa bw'ikosa. Nimero za telefoni n'imibare yo kwinjira bikurwamo mbere yo kubikwa. Kugira ngo dukemure ibibazo vuba, izo nyandiko z'amakosa zoherezwa mu buryo bwikora ku ikipe ya Bimoto i Kigali. Ushobora kureba neza ibyoherezwa ku rupapuro rwa Diagnostics, kandi ushobora guhagarika kohereza kwikora igihe icyo ari cyo cyose muri Settings. Ubutumwa bwawe, ingendo zawe n'aho uri ntibijyanwa na rimwe. |  |  |
| `legal.driverTermsAgree` |  | I Accept the Driver Terms | J'accepte les conditions chauffeur | Nemera amasezerano y'umumotari |  |  |
| `legal.driverTermsText` |  | As a Bimoto driver, you agree to: offer only fixed prices, provide safe transport, follow traffic laws, wear and provide helmets, maintain valid RURA authorization and insurance, and allow GPS tracking during rides. | En tant que chauffeur Bimoto, vous acceptez de : proposer uniquement des prix fixes, fournir un transport sûr, respecter le code de la route, porter et fournir des casques, maintenir une autorisation RURA et une assurance valides, et permettre le suivi GPS pendant les courses. | Nk'umumotari wa Bimoto, wemera: gutanga ibiciro bihamye gusa, gutanga ubwikorezi bwizewe, gukurikiza amategeko y'umuhanda, kwambara no gutanga ingofero, kugira uruhushya rwa RURA n'ubwishingizi byemewe, no kwemerera GPS mu gihe cy'ingendo. |  |  |
| `legal.driverTermsTitle` |  | Driver Agreement | Accord chauffeur | Amasezerano y'umumotari |  |  |
| `legal.privacyAgree` |  | I Understand and Agree | Je comprends et j'accepte | Ndabyumva kandi ndemera |  |  |
| `legal.privacyText` |  | Bimoto collects your phone number, location (only when you share it), and ride history to match you with drivers and process payments. We encrypt your data and never share it with third parties except as needed to complete rides. You can delete your account and all data at any time. | Bimoto collecte votre numéro de téléphone, votre localisation (uniquement lorsque vous la partagez) et votre historique de courses pour vous mettre en relation avec des chauffeurs et traiter les paiements. Nous chiffrons vos données et ne les partageons jamais avec des tiers sauf pour effectuer les courses. Vous pouvez supprimer votre compte et toutes vos données à tout moment. | Bimoto ikusanya nomero ya telefoni yawe, aho uherereye (gusa iyo ubisabye) kugira ngo uguhuzwe n'umumotari/umunyonzi no kwishyura cyangwa kwishyurwa. Tubika amakuru yawe kandi ntituyasangiza abandi keretse bikenewe mu gukora ingendo. Ushobora gusiba konti yawe n'amakuru yose igihe icyo ari cyo cyose. |  |  |
| `legal.privacyTitle` |  | Your Data, Your Privacy | Vos données, votre vie privée | Amakuru yawe, umutekano wawe |  |  |
| `legal.rideTraceNotice` | **NEW** | Your position is recorded during rides and deliveries — for safety, and to settle disputes with facts. Traces are kept for 14 days and then deleted; if a ride is under dispute, its trace is kept until the dispute is settled. Nobody can watch your rides live — except our safety team during an emergency, until it is closed. | Votre position est enregistrée pendant les courses et les livraisons — pour la sécurité, et pour régler les litiges sur la base de faits. Les tracés sont conservés 14 jours puis supprimés ; si une course fait l'objet d'un litige, son tracé est conservé jusqu'au règlement du litige. Personne ne peut suivre vos courses en direct — sauf notre équipe de sécurité pendant une urgence, jusqu'à ce qu'elle soit close. | Aho uri handikwa mu gihe cy'ingendo n'ubwikorezi bw'ibintu — ku mutekano, no gukemura amakimbirane hashingiwe ku byabaye. Inzira zibikwa iminsi 14 hanyuma zigasibwa; niba urugendo rufite ikibazo, inzira yarwo ibikwa kugeza ikibazo gikemutse. Nta muntu ushobora kureba ingendo zawe mu buryo buhita — keretse itsinda ryacu ry'umutekano mu gihe cy'ubutabazi, kugeza ubutabazi bufunzwe. |  |  |
| `legal.safetyAckAgree` | **NEW** | I have read and accept these three safety rules | J'ai lu et j'accepte ces trois règles de sécurité | Nasomye kandi nemera aya mategeko atatu y’umutekano |  |  |
| `legal.safetyAckDriverRefuse` | **NEW** | As a driver, you also accept that you will refuse any ride that would break these rules, even if the passenger insists. | En tant que conducteur, vous acceptez également de refuser toute course qui enfreindrait ces règles, même si le passager insiste. | Nka umushoferi, wemera kandi ko uzanga urugendo rwose rwaba runyuranyije n’aya mategeko, n’ubwo umugenzi yabyifuza cyane. |  |  |
| `legal.safetyAckMinimumAge` | **NEW** | Anyone below the legal minimum age for a moto passenger may not be carried. | Toute personne n'ayant pas l'âge minimum légal pour être passager à moto ne peut pas être transportée. | Umuntu wese utaragera ku myaka ngombwa yemewe n’amategeko yo kuba umugenzi wa moto ntashobora gutwarwa. |  |  |
| `legal.safetyAckNoInfants` | **NEW** | No babies or infants may ever be carried on a moto. This has no exception. | Aucun bébé ni nourrisson ne peut jamais être transporté à moto. Cette règle est sans exception. | Nta mwana muto cyangwa uruhinja rwigeze rushobora gutwarwa kuri moto. Nta gahonzu na kamwe. |  |  |
| `legal.safetyAckOnePassenger` | **NEW** | A moto carries exactly one passenger. Never two, never a child in addition to an adult. | Une moto transporte exactement un passager. Jamais deux, jamais un enfant en plus d'un adulte. | Moto itwara umugenzi umwe gusa. Ntibabiri, kandi nta mwana wiyongera ku muntu mukuru. |  |  |
| `legal.safetyAckTitle` | **NEW** | Safety rules you must accept | Règles de sécurité que vous devez accepter | Amategeko y’umutekano ugomba kwemera |  |  |
| `legal.termsAgree` |  | I Accept the Terms | J'accepte les conditions | Nemera amabwiriza |  |  |
| `legal.termsChildPolicy` | **NEW** | Children: children under 12 are not an independent booking option. A child travels with a responsible adult, who makes the booking and stays with the child for the whole trip. | Enfants : les enfants de moins de 12 ans ne peuvent pas réserver seuls. Un enfant voyage avec un adulte responsable, qui effectue la réservation et reste avec l'enfant pendant tout le trajet. | Abana: abana bari munsi y'imyaka 12 ntibashobora gutumiza urugendo ubwabo. Umwana agendana n'umuntu mukuru ubishinzwe, ari na we utumiza urugendo kandi agumana n'umwana urugendo rwose. |  |  |
| `legal.termsTitle` |  | Terms and Services | Conditions d'utilisation | Amabwiriza y'ikoreshwa |  |  |

## Namespace: `location`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `location.currentLocation` |  | Current location | Position actuelle | Aho uri ubu |  |  |
| `location.gpsError` |  | Could not get your location | Impossible d'obtenir votre position | Ntibyakunze kubona aho uri |  |  |
| `location.gpsNotSupported` |  | Location is not available on this device | La localisation n'est pas disponible sur cet appareil | Iyi telefoni ntishobora kubona aho uri |  |  |
| `location.noResults` |  | No places found | Aucun lieu trouvé | Nta hantu habonetse |  |  |
| `location.searchPlaceholder` |  | Search for a place | Recherchez un lieu | Shakisha ahantu |  |  |
| `location.useMyLocation` |  | Use my location | Utiliser ma position | Koresha aho ndi |  |  |

## Namespace: `login`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `login.changePhone` |  | Change phone number | Changer de numéro | Hindura numero ya telefone |  |  |
| `login.codeExpired` |  | This code has expired. Request a new one below. | Ce code a expiré. Demandez-en un nouveau ci-dessous. | Iyi kode yarangiye. Saba indi hano hepfo. |  | Replaces the OTP inputs when the 5-minute validity is over — must point at the resend button |
| `login.codeExpiresIn` |  | Code expires in {{time}} | Le code expire dans {{time}} | Kode izarangira mu {{time}} |  | Live countdown under the OTP inputs; {{time}} is m:ss (e.g. 4:59) |
| `login.invalidPhone` |  | Please enter a valid phone number | Veuillez entrer un numéro de téléphone valide | Andika numero ya telefone yemewe |  |  |
| `login.otpDigit` |  | Digit {{n}} | Chiffre {{n}} | Umubare wa {{n}} |  |  |
| `login.otpFailed` |  | Could not send code. Please try again. | Impossible d'envoyer le code. Veuillez réessayer. | Ntibyashobotse kohereza kode. Ongera ugerageze. |  |  |
| `login.otpPrompt` |  | We sent a 6-digit code to {{phone}}. | Nous avons envoyé un code à 6 chiffres au {{phone}}. | Twohereje kode y'imibare 6 kuri {{phone}}. |  |  |
| `login.otpSent` |  | Code sent. Check your messages. | Code envoyé. Vérifiez vos messages. | Kode yoherejwe. Reba ubutumwa bwawe. |  |  |
| `login.phoneLabel` |  | Phone number | Numéro de téléphone | Andika numero ya telefone hano |  |  |
| `login.phonePlaceholder` | same-as-EN: placeholder | 7XX XXX XXX | 7XX XXX XXX | 7XX XXX XXX |  |  |
| `login.resendCode` |  | Resend code | Renvoyer le code | Ohereza kode indi |  | Resend button once the 60s cooldown has passed |
| `login.resendIn` |  | Resend in {{seconds}}s | Renvoyer dans {{seconds}}s | Kohereza indi mu masegonda {{seconds}} |  | Disabled resend button during the cooldown; {{seconds}} interpolated |
| `login.sendCode` |  | Send code | Envoyer le code | Ohereza kode |  |  |
| `login.subtitle` |  | Bimoto connects passengers with moto drivers and bicycle riders | Bimoto met en relation les passagers avec les conducteurs de moto et les cyclistes | Bimoto ihuza abagenzi n’abamotari n’abagendera ku magare |  |  |
| `login.verify` |  | Verify | Vérifier | Emeza |  |  |
| `login.verifyFailed` |  | Invalid code. Please try again. | Code invalide. Veuillez réessayer. | Kode si yo. Ongera ugerageze. |  |  |

## Namespace: `map`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `map.offline.chipDone` | **NEW** | The {{region}} map is on this phone — it works without internet now. | La carte {{region}} est sur ce téléphone — elle marche sans internet désormais. | Ikarita ya {{region}} iri kuri iyi telefoni — ubu ikora nta internet. |  |  |
| `map.offline.chipOffer` | **NEW** | Download the {{region}} map ({{mb}} MB) so this works without internet | Téléchargez la carte {{region}} ({{mb}} Mo) pour que cela marche sans internet | Kuramo ikarita ya {{region}} ({{mb}} MB) kugira ngo ibi bikore nta internet |  |  |
| `map.offline.chipProgress` | **NEW** | Downloading the {{region}} map… | Téléchargement de la carte {{region}}… | Kuramo ikarita ya {{region}}… |  |  |
| `map.offline.delete` |  | Delete | Supprimer | Gusiba |  | Button; frees the storage |
| `map.offline.deleteConfirm` |  | Delete the offline map? Without it the map needs a connection again. | Supprimer la carte hors ligne ? Sans elle, la carte nécessitera à nouveau une connexion. | Gusiba ikarita ikora nta murandasi? Idahari, ikarita izongera gukenera umurandasi. |  | Confirm-modal body before deleting |
| `map.offline.deleteConfirmNamed` | **NEW** | Delete the offline map for {{region}}? Without it that area needs a connection again. | Supprimer la carte hors ligne de {{region}} ? Sans elle, cette zone nécessitera à nouveau une connexion. | Gusiba ikarita ya {{region}} ikora nta murandasi? Idahari, ako karere kazongera gukenera umurandasi. |  |  |
| `map.offline.description` |  | Keep the Kigali map on this phone (about {{mb}} MB) so it shows instantly, even with no connection. | Gardez la carte de Kigali sur ce téléphone (environ {{mb}} Mo) pour l'afficher instantanément, même sans connexion. | Bika ikarita muri telefoni yawe (urasabwa ububiko bwa MB {{mb}} byibura muri telefoni yawe) kugira ngo ujye uyibona n'iyo waba nta internet ufite. Wayibona byihuse ukoresheje Wi-Fi. |  | {{mb}} is the size estimate (e.g. 40) |
| `map.offline.discard` | **NEW** | Discard | Supprimer | Siba |  |  |
| `map.offline.download` |  | Download | Télécharger | Kurura |  | Button; starts the ~40 MB download |
| `map.offline.downloadedMeta` |  | Downloaded {{date}} · {{mb}} MB | Téléchargée le {{date}} · {{mb}} Mo | Yakuruwe {{date}} · MB {{mb}} |  | {{date}} localized date, {{mb}} actual size |
| `map.offline.downloading` |  | Downloading… | Téléchargement… | Irakururwa… |  | Progress state; a percent figure may follow |
| `map.offline.failed` |  | The download didn't finish — check your connection and try again. | Le téléchargement ne s'est pas terminé — vérifiez votre connexion et réessayez. | Gukurura ntibyarangiye — suzuma umurandasi wawe hanyuma wongere ugerageze. |  | Shown after a failed/cancelled download; restart is the recovery |
| `map.offline.intro` | **NEW** | Keep maps on this phone so they show instantly, even with no connection. | Gardez des cartes sur ce téléphone pour les afficher instantanément, même sans connexion. | Bika amakarita kuri iyi telefoni kugira ngo agaragare ako kanya, n'iyo nta murandasi uhari. |  |  |
| `map.offline.noSpace` | **NEW** | There isn't enough space on this phone for the offline map. Free some space and try again. | Il n'y a pas assez d'espace sur ce téléphone pour la carte hors ligne. Libérez de l'espace et réessayez. | Nta mwanya uhagije uri kuri iyi telefone kugira ngo ikarita yo hanze ya interineti ibike. Sohora umwanya hanyuma wongere ugerageze. |  |  |
| `map.offline.notAvailable` |  | Not available on this server yet. | Pas encore disponible sur ce serveur. | Ntiraboneka kuri iyi seriveri. |  | Calm line when the pilot server has no extract yet (404) |
| `map.offline.paused` | **NEW** | Download paused | Téléchargement en pause | Gukurura byahagaritswe |  |  |
| `map.offline.resume` | **NEW** | Resume download | Reprendre le téléchargement | Komeza gukurura |  |  |
| `map.offline.resumeMeta` | **NEW** | {{mb}} MB already downloaded — it will carry on from there. | {{mb}} Mo déjà téléchargés — le téléchargement reprendra à partir de là. | Miliyoni {{mb}} MB zamaze gukururwa — bizakomereza aho byagejeje. |  |  |
| `map.offline.size` | **NEW** | {{mb}} MB | {{mb}} Mo | MB {{mb}} |  |  |
| `map.offline.tierCountry` | **NEW** | The whole country | Tout le pays | Igihugu cyose |  |  |
| `map.offline.tierDistrict` | **NEW** | Districts | Districts | Uturere |  |  |
| `map.offline.tierProvince` | **NEW** | Provinces | Provinces | Intara |  |  |
| `map.offline.title` |  | Offline map | Carte hors ligne | Ikarita ikora nta murandasi |  | Profile card title for the downloadable Kigali map |
| `map.offline.update` |  | Update | Mettre à jour | Kuvugurura |  | Button; re-downloads a newer extract |
| `map.offline.wifiHint` |  | Best downloaded over Wi-Fi. | Téléchargement recommandé en Wi-Fi. | Byiza kuyikurura ukoresheje Wi-Fi. |  | Small hint under the description — the file is large |
| `map.offlineHint` |  | The map can't load right now — set your locations with GPS or the search below. | La carte ne peut pas se charger pour le moment — définissez vos lieux avec le GPS ou la recherche ci-dessous. | Ikarita ntishobora gufunguka ubu — shyiraho aho uva n'aho ujya ukoresheje GPS cyangwa gushakisha hano hepfo. |  | Calm hint when tiles can't load / offline |
| `map.regions.east` | **NEW** | Eastern Province | Province de l'Est | Iburasirazuba |  |  |
| `map.regions.kigali` | **NEW** | Kigali City | Ville de Kigali | Umujyi wa Kigali |  |  |
| `map.regions.north` | **NEW** | Northern Province | Province du Nord | Amajyaruguru |  |  |
| `map.regions.rwanda` | **NEW** | All of Rwanda | Tout le Rwanda | U Rwanda rwose |  |  |
| `map.regions.south` | **NEW** | Southern Province | Province du Sud | Amajyepfo |  |  |
| `map.regions.west` | **NEW** | Western Province | Province de l'Ouest | Iburengerazuba |  |  |
| `map.routeChoiceHint` | **NEW** | Preview only — your driver may take a different road. | Aperçu seulement — votre chauffeur peut prendre une autre route. | Ni icyitegererezo gusa — umumotari ashobora kunyura mu yindi nzira. |  |  |
| `map.routeOption` | **NEW** | Route {{n}} | Itinéraire {{n}} | Inzira ya {{n}} |  |  |
| `map.routeOptionsLabel` | **NEW** | Route options | Options d'itinéraire | Amahitamo y'inzira |  |  |
| `map.routeUnavailable` | **NEW** | Route unavailable — showing direct line | Itinéraire indisponible — ligne directe affichée | Inzira ntibonetse — hagaragajwe umurongo utaziguye |  |  |

## Namespace: `match`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `match.cancel_ride` |  | Cancel ride | Annuler la course | Hagarika urugendo |  |  |
| `match.choose_another` |  | Choose another driver | Choisir un autre chauffeur | Hitamo undi mumotari |  |  |
| `match.description` |  | Description | Description | Ibisobanuro |  |  |
| `match.driver_coming` |  | Your driver is on the way! | Votre chauffeur est en route ! | Umumotari wawe ari mu nzira! |  |  |
| `match.eta` |  | Arrives in {{minutes}} min | Arrivée dans {{minutes}} min | Agera mu minota {{minutes}} |  |  |
| `match.plate` |  | Plate | Plaque | Ipurake |  |  |
| `match.vehicle` |  | Vehicle | Véhicule | Ikinyabiziga |  |  |

## Namespace: `matched`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `matched.approach.approaching` |  | Driver is approaching | Le chauffeur arrive | Umumotari araza |  |  |
| `matched.approach.arrived` |  | Driver has arrived | Le chauffeur est arrivé | Umumotari yageze |  |  |
| `matched.approach.etaShort` |  | ~{{minutes}} min | ~{{minutes}} min | ~iminota {{minutes}} |  |  |
| `matched.approach.lost` |  | Driver appears to be lost | Le chauffeur semble perdu | Umumotari asa nk'utazi inzira |  |  |
| `matched.approach.silent` |  | Driver hasn't started moving yet | Le chauffeur n'a pas encore démarré | Umumotari ntiyatangiye kugenda |  |  |
| `matched.cancelChangedPlans` |  | I changed my mind | J'ai changé d'avis | Nahinduye ibitekerezo |  |  |
| `matched.cancelDriverLate` |  | Driver is too late, cancel | Chauffeur en retard, annuler | Umumotari atinze, hagarika |  |  |
| `matched.cancelDriverNoShow` |  | Driver did not show up | Le chauffeur n'est pas venu | Umumotari ntiyaje |  |  |
| `matched.cancelFailed` |  | Could not cancel the ride | Impossible d'annuler la course | Ntibyakunze guhagarika urugendo |  |  |
| `matched.cancelReasonPrompt` |  | Why are you cancelling? | Pourquoi annulez-vous ? | Kuki uhagarika? |  |  |
| `matched.cancelRide` |  | Cancel ride | Annuler la course | Hagarika urugendo |  |  |
| `matched.cancelSafety` |  | I have a safety concern | J'ai un problème de sécurité | Mfite ikibazo cy'umutekano |  |  |
| `matched.cancelTitle` |  | Cancel ride | Annuler la course | Hagarika urugendo |  |  |
| `matched.cancelled` |  | Ride cancelled | Course annulée | Urugendo rwahagaritswe |  |  |
| `matched.chat` |  | Chat | Discussion | Ikiganiro |  |  |
| `matched.chooseAnother` |  | Choose another driver | Choisir un autre chauffeur | Hitamo undi mumotari |  |  |
| `matched.driver` |  | Driver | Chauffeur | Umumotari |  |  |
| `matched.driverDidntShow` |  | Your driver didn't show up. | Votre chauffeur n'est pas venu. | Umumotari wawe ntiyaje. |  |  |
| `matched.driverOnTheWay` |  | Your driver is on the way | Votre chauffeur est en route | Umumotari wawe ari mu nzira |  |  |
| `matched.fetchFailed` |  | Could not load the ride | Impossible de charger la course | Ntibyakunze gufungura urugendo |  |  |
| `matched.findAnotherDriver` |  | Find another driver | Trouver un autre chauffeur | Shaka undi mumotari |  |  |
| `matched.liveTracking` |  | Live driver tracking on map | Suivi du chauffeur en direct sur la carte | Kurikirana umumotari/umunyonzi ku ikarita |  | Heading over the live approach map on the customer's matched screen — names the tracking feature |
| `matched.pickupVerify.failed` |  | Could not record your answer. You can try again or close this. | Impossible d'enregistrer votre réponse. Réessayez ou fermez. | Ntibyakunze kwandika igisubizo cyawe. Ongera ugerageze cyangwa ubifunge. |  |  |
| `matched.pickupVerify.no` |  | No / not sure | Non / pas sûr | Oya / sinzi neza |  |  |
| `matched.pickupVerify.notSure` |  | I'm not sure | Je ne suis pas sûr(e) | Sinzi neza |  |  |
| `matched.pickupVerify.reasonDifferentPerson` |  | Different person | C'est une autre personne | Ni undi muntu |  |  |
| `matched.pickupVerify.reasonNoVest` |  | No vest / jacket | Pas de veste / gilet | Nta koti yambaye |  |  |
| `matched.pickupVerify.reasonPrompt` |  | What doesn't match? | Qu'est-ce qui ne correspond pas ? | Ni iki kidahuye? |  |  |
| `matched.pickupVerify.reasonWrongNumber` |  | Jacket number doesn't match | Le numéro de veste ne correspond pas | Nomero y'ikoti ntihuye |  |  |
| `matched.pickupVerify.thanks` |  | Thanks — your answer was recorded. | Merci — votre réponse a été enregistrée. | Murakoze — igisubizo cyawe cyanditswe. |  |  |
| `matched.pickupVerify.title` |  | Is this your driver? | Est-ce bien votre chauffeur ? | Uyu ni we mumotari wawe? |  |  |
| `matched.pickupVerify.yes` |  | Yes, that's my driver | Oui, c'est mon chauffeur | Yego, ni we mumotari wanjye |  |  |
| `matched.redispatchFailed` |  | Could not request another driver. Please try again. | Impossible de demander un autre chauffeur. Réessayez. | Ntibyakunze gusaba undi mumotari. Ongera ugerageze. |  |  |

## Namespace: `moneyPin`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `moneyPin.alreadySet` | **NEW** | You already have a money PIN. | Vous avez deja un code argent. | Usanzwe ufite kode y'amafaranga. |  |  |
| `moneyPin.backspace` | **NEW** | Delete last digit | Effacer le dernier chiffre | Siba umubare wa nyuma |  |  |
| `moneyPin.badFormat` | **NEW** | A money PIN is 4 digits. | Un code argent a 4 chiffres. | Kode y'amafaranga igizwe n'imibare 4. |  |  |
| `moneyPin.changeCta` | **NEW** | Change my PIN | Changer mon code | Hindura kode yanjye |  |  |
| `moneyPin.changed` | **NEW** | Your money PIN was changed. | Votre code argent a ete change. | Kode y'amafaranga yawe yahinduwe. |  |  |
| `moneyPin.chooseNew` | **NEW** | Choose 4 new digits | Choisissez 4 nouveaux chiffres | Hitamo imibare 4 mishya |  |  |
| `moneyPin.confirmNew` | **NEW** | Enter the same 4 digits again | Entrez les memes 4 chiffres a nouveau | Ongera wandike iyo mibare 4 imwe |  |  |
| `moneyPin.digitsEntered` | **NEW** | {{count}} of {{total}} digits entered | {{count}} chiffres sur {{total}} saisis | Wanditse imibare {{count}} kuri {{total}} |  |  |
| `moneyPin.enrollTitle` | **NEW** | Set your money PIN | Choisissez votre code argent | Shyiraho kode y'amafaranga |  |  |
| `moneyPin.enrollWhy` | **NEW** | Choose 4 digits. From now on Bimoto asks for them before showing your balance or changing where your money goes. Nowhere else. | Choisissez 4 chiffres. Bimoto les demandera avant d'afficher votre solde ou de changer ou va votre argent. Nulle part ailleurs. | Hitamo imibare 4. Guhera ubu Bimoto izayisaba mbere yo kukwereka amafaranga yawe cyangwa guhindura aho ajya. Ahandi hose ntacyo. |  |  |
| `moneyPin.enterCurrent` | **NEW** | Enter your current PIN | Entrez votre code actuel | Andika kode usanzwe ukoresha |  |  |
| `moneyPin.forgotCta` | **NEW** | I forgot my PIN | J'ai oublie mon code | Nibagiwe kode yanjye |  |  |
| `moneyPin.genericError` | **NEW** | That did not work. Try again. | Cela n'a pas marche. Reessayez. | Ntibyakunze. Ongera ugerageze. |  |  |
| `moneyPin.lockedShort` | **NEW** | Too many wrong tries. Wait a little, then try again. | Trop d'essais incorrects. Attendez un peu, puis reessayez. | Wagerageje inshuro nyinshi. Tegereza gato, ubone kongera kugerageza. |  |  |
| `moneyPin.lockedTitle` | **NEW** | Too many wrong tries | Trop d'essais incorrects | Wagerageje inshuro nyinshi |  |  |
| `moneyPin.lockedUntil` | **NEW** | Too many wrong tries. You can try again after {{time}}. | Trop d'essais incorrects. Vous pourrez reessayer apres {{time}}. | Wagerageje inshuro nyinshi. Ushobora kongera kugerageza nyuma ya {{time}}. |  |  |
| `moneyPin.mismatch` | **NEW** | Those did not match. Start again. | Ils ne correspondent pas. Recommencez. | Ntabwo zihuye. Ongera utangire. |  |  |
| `moneyPin.notNow` | **NEW** | Not now | Pas maintenant | Ubu si ubu |  |  |
| `moneyPin.padLabel` | **NEW** | Money PIN keypad | Clavier du code argent | Ahanditse kode y'amafaranga |  |  |
| `moneyPin.pendingWarning` | **NEW** | Someone asked to change your money PIN. The new one starts working on {{time}}. If this was not you, change your PIN now with the one you know — that cancels it. | Quelqu'un a demande a changer votre code argent. Le nouveau commencera le {{time}}. Si ce n'etait pas vous, changez votre code maintenant avec celui que vous connaissez — cela l'annule. | Hari usabye guhindura kode y'amafaranga yawe. Iyo nshya izatangira {{time}}. Niba atari wowe, hindura kode yawe ubu ukoresheje iyo uzi — ibyo birabihagarika. |  |  |
| `moneyPin.resetDoneTitle` | **NEW** | Your new PIN starts tomorrow | Votre nouveau code commence demain | Kode nshya itangira ejo |  |  |
| `moneyPin.resetExplain` | **NEW** | Your new PIN will work from {{time}} — about a day from now. | Votre nouveau code fonctionnera a partir du {{time}} — dans environ un jour. | Kode yawe nshya izatangira gukora kuva {{time}} — nka nyuma y'umunsi umwe. |  |  |
| `moneyPin.resetOldStillWorks` | **NEW** | Your old PIN keeps working until then. If you remember it, use it — that cancels this change straight away. | Votre ancien code fonctionne jusque-la. Si vous vous en souvenez, utilisez-le — cela annule ce changement immediatement. | Kode yawe ya kera iracyakora kugeza icyo gihe. Niba uyibuka, yikoreshe — ibyo bihagarika iri hinduka ako kanya. |  |  |
| `moneyPin.resetSmsSent` | **NEW** | We sent a code to your phone. | Nous avons envoye un code a votre telephone. | Twoherereje kode kuri telefone yawe. |  |  |
| `moneyPin.resetTitle` | **NEW** | Reset your money PIN | Reinitialiser votre code argent | Hindura kode y'amafaranga |  |  |
| `moneyPin.resetWhy` | **NEW** | We wait a day because anyone holding your phone can also read your SMS. The wait gives you time to notice. We have just sent you a message about this change. | Nous attendons un jour parce que celui qui tient votre telephone peut aussi lire vos SMS. Cette attente vous laisse le temps de vous en rendre compte. Nous venons de vous envoyer un message a ce sujet. | Dutegereza umunsi kuko ufashe telefone yawe ashobora no gusoma SMS zawe. Uwo munsi uguha umwanya wo kubimenya. Turakoherereje ubutumwa kuri iri hinduka. |  |  |
| `moneyPin.settingsHelp` | **NEW** | The 4 digits Bimoto asks for before showing your balance or changing where your money goes. | Les 4 chiffres que Bimoto demande avant d'afficher votre solde ou de changer ou va votre argent. | Imibare 4 Bimoto isaba mbere yo kukwereka amafaranga yawe cyangwa guhindura aho ajya. |  |  |
| `moneyPin.settingsTitle` | **NEW** | Money PIN | Code argent | Kode y'amafaranga |  |  |
| `moneyPin.smsCodeLabel` | **NEW** | Code from the SMS | Code recu par SMS | Kode yo muri SMS |  |  |
| `moneyPin.verifyTitle` | **NEW** | Enter your money PIN | Entrez votre code argent | Andika kode y'amafaranga |  |  |
| `moneyPin.verifyWhy` | **NEW** | This screen shows your money. | Cet ecran montre votre argent. | Uru rupapuro rwerekana amafaranga yawe. |  |  |
| `moneyPin.wrongPin` | **NEW** | Wrong PIN. Try again. | Code incorrect. Reessayez. | Kode ntiyemewe. Ongera ugerageze. |  |  |

## Namespace: `nav`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `nav.home` |  | Home | Accueil | Ahabanza |  |  |
| `nav.main` |  | Main navigation | Navigation principale | Ibice by'urubuga |  |  |
| `nav.myRides` |  | My Journey | Mon trajet | Urugendo Rwajye |  |  |
| `nav.profile` |  | Profile | Profil | Umwirondoro |  |  |
| `nav.requests` |  | Book | Réserver | Ubusabe |  |  |
| `nav.rides` |  | Rides | Courses | Ingendo |  |  |
| `nav.scheduled` |  | Scheduled rides | Courses programmées | Ibyateganyijwe |  | SCHED-UI — driver bottom-nav tab |
| `nav.settings` |  | Settings | Paramètres | Igenamiterere |  |  |

## Namespace: `notFound`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `notFound.goHome` |  | Go home | Retour à l'accueil | Subira ahabanza |  |  |
| `notFound.message` |  | This page does not exist | Cette page n'existe pas | Iyi paji ntibaho |  |  |

## Namespace: `notify`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `notify.bidCountered` | **NEW** | A passenger suggested {{amount}} RWF for your offer | Un passager propose {{amount}} RWF pour votre offre | Umugenzi yasabye {{amount}} RWF ku giciro watanze |  |  |
| `notify.counterAccepted` | **NEW** | Your price of {{amount}} RWF was accepted | Votre prix de {{amount}} RWF a été accepté | Igiciro cyawe cya {{amount}} RWF cyemewe |  |  |
| `notify.counterDeclined` | **NEW** | Your price was not accepted — the offer of {{price}} RWF still stands | Votre prix n'a pas été accepté — l'offre de {{price}} RWF tient toujours | Igiciro cyawe nticyemewe — igiciro cya {{price}} RWF kiracyahari |  |  |
| `notify.disputeClosed` | **NEW** | Your dispute was closed with no action | Votre contestation a été close sans suite | Ikirego cyawe cyafunzwe nta cyakozwe |  |  |
| `notify.disputeRejected` | **NEW** | Your dispute was not upheld | Votre contestation n'a pas été acceptée | Ikirego cyawe nticyemewe |  |  |
| `notify.disputeUpheld` | **NEW** | Your dispute was upheld | Votre contestation a été acceptée | Ikirego cyawe cyemewe |  |  |
| `notify.escrowRefunded` | **NEW** | {{amount}} RWF has been returned to you | {{amount}} RWF vous ont été remboursés | {{amount}} RWF wagarujwe |  |  |
| `notify.escrowReleased` | **NEW** | You were paid {{amount}} RWF | Vous avez été payé {{amount}} RWF | Wishyuwe {{amount}} RWF |  |  |
| `notify.noShowWarning` | **NEW** | No-show warning ({{count}}) — this affects your account | Avertissement d'absence ({{count}}) — cela affecte votre compte | Umuburo wo kutitaba ({{count}}) — bigira ingaruka kuri konti yawe |  |  |
| `notify.ratingReceived` | **NEW** | You received a {{count}}-star rating | Vous avez reçu une note de {{count}} étoiles | Wahawe amanyenyeri {{count}} |  |  |
| `notify.verificationApproved` | **NEW** | Your account is verified — you can start working | Votre compte est vérifié — vous pouvez commencer à travailler | Konti yawe yemejwe — ushobora gutangira gukora |  |  |
| `notify.verificationRejected` | **NEW** | Your verification was not approved — check your documents | Votre vérification n'a pas été approuvée — vérifiez vos documents | Kwemeza konti yawe ntibyakunze — reba inyandiko zawe |  |  |

## Namespace: `outbox`

> TODO(rw): native review required for all 'outbox' keys (AI draft). These are read by a passenger who has just lost signal, so tone is the whole job: 'saved on this phone' must land as reassurance, never as an error or a warning. Check `kubika`/`kohereza` usage against the glossary, and confirm the waiting-count plural reads naturally for 1 and for many.

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `outbox.cancel` | **NEW** | Cancel this booking | Annuler cette réservation | Hagarika iri tegeko |  |  |
| `outbox.cancelled` | **NEW** | Booking cancelled | Réservation annulée | Itegeko ryahagaritswe |  |  |
| `outbox.dismiss` | **NEW** | Dismiss | Fermer | Funga |  |  |
| `outbox.done` | **NEW** | Done | Terminé | Byarangiye |  |  |
| `outbox.empty` | **NEW** | Nothing is waiting to be sent. | Rien n'est en attente d'envoi. | Nta kintu gitegereje koherezwa. |  |  |
| `outbox.rejectedGeneric` | **NEW** | The server did not accept this booking. | Le serveur n'a pas accepté cette réservation. | Seriveri ntiyemeye iri tegeko. |  |  |
| `outbox.rejectedLabel` | **NEW** | Saved booking | Réservation enregistrée | Itegeko ryabitswe |  |  |
| `outbox.savedBody` | **NEW** | You have no connection right now. We will send this booking the moment you are back online. | Vous n'avez pas de connexion pour le moment. Nous enverrons cette réservation dès que vous serez de nouveau en ligne. | Nta murandasi ufite ubu. Tuzohereza iri tegeko ako kanya nimugarukira kuri murandasi. |  |  |
| `outbox.savedRoute` | **NEW**<br>same-as-EN: placeholder | {{from}} → {{to}} | {{from}} → {{to}} | {{from}} → {{to}} |  |  |
| `outbox.savedTitle` | **NEW** | Saved on this phone | Enregistré sur ce téléphone | Byabitswe kuri iyi telefone |  |  |
| `outbox.savedToast` | **NEW** | Saved on this phone — it will go out when there is signal | Enregistré sur ce téléphone — envoi dès le retour du réseau | Byabitswe kuri iyi telefoni — bizohereza igihe umurandasi uzagaruka |  | CHROME-C: the toast shown the moment a booking is held on the phone. Same job and same tone as the strip it replaces — calm statement of fact, never an apology or a warning — but it now has to work as a sentence that appears and leaves on its own, so it must be complete and readable at a glance. |
| `outbox.sentTitle` | **NEW** | Your saved booking was sent | Votre réservation enregistrée a été envoyée | Itegeko ryawe ryabitswe ryoherejwe |  |  |
| `outbox.view` | **NEW** | View the ride | Voir la course | Reba urugendo |  |  |
| `outbox.waitingCount` | **NEW** | {{count}} bookings saved on this phone | {{count}} réservations enregistrées sur ce téléphone | Amategeko {{count}} yabitswe kuri iyi telefone |  |  |
| `outbox.waitingCount_one` | **NEW** | {{count}} booking saved on this phone — tap to review | {{count}} réservation enregistrée sur ce téléphone — touchez pour vérifier | Itegeko {{count}} ryabitswe kuri iyi telefone — kanda urebe |  |  |
| `outbox.waitingCount_other` | **NEW** | {{count}} bookings saved on this phone — tap to review | {{count}} réservations enregistrées sur ce téléphone — touchez pour vérifier | Amategeko {{count}} yabitswe kuri iyi telefone — kanda urebe |  |  |
| `outbox.waitingTitle` | **NEW** | Waiting to send | En attente d'envoi | Bitegereje koherezwa |  |  |

## Namespace: `parcel`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `parcel.badge` | **NEW** | PARCEL | COLIS | UMUZIGO |  |  |
| `parcel.badgeAriaLabel` | **NEW** | Parcel delivery | Livraison de colis | Kohereza umuzigo |  |  |
| `parcel.weightKg` | **NEW**<br>same-as-EN: placeholder | {{weight}} kg | {{weight}} kg | {{weight}} kg |  |  |

## Namespace: `parcelWeight`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `parcelWeight.bicycleAlone` | **NEW** | A bicycle carrying only a parcel can take up to {{max}} kg. | Un vélo transportant uniquement un colis peut porter jusqu'à {{max}} kg. | Igare ritwaye gusa ipaki rishobora gutwara kugeza ku biro {{max}}. |  |  |
| `parcelWeight.bicycleWithPassenger` | **NEW** | A bicycle carrying a passenger can take a parcel up to {{max}} kg. | Un vélo transportant un passager peut porter un colis jusqu'à {{max}} kg. | Igare ritwaye umugenzi rishobora gutwara ipaki y'ibiro {{max}} nibura. |  |  |
| `parcelWeight.label` | **NEW** | Weight | Poids | Ibiro |  |  |
| `parcelWeight.motoAlone` | **NEW** | A moto carrying only a parcel takes envelope-size items. | Une moto transportant uniquement un colis prend des articles de la taille d'une enveloppe. | Moto itwaye gusa ipaki itwara ibintu bingana n'ibahasha. |  |  |
| `parcelWeight.motoWithPassenger` | **NEW** | A moto carrying a passenger can take a parcel up to {{max}} kg. | Une moto transportant un passager peut porter un colis jusqu'à {{max}} kg. | Moto itwaye umugenzi ishobora gutwara ipaki y'ibiro {{max}} nibura. |  |  |
| `parcelWeight.placeholder` | **NEW** | How heavy is it? | Quel est son poids ? | Bifite ibiro bingana bite? |  |  |

## Namespace: `payment`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `payment.card.cancelled` |  | Card payment cancelled | Paiement par carte annulé | Kwishyura ukoresheje ikarita byahagaritswe |  |  |
| `payment.card.opening` |  | Opening card payment... | Ouverture du paiement par carte… | Gufungura kwishyura ukoresheje ikarita... |  |  |
| `payment.card.unavailable` |  | Card payment is not available right now — please use Mobile Money | Le paiement par carte n'est pas disponible pour le moment — veuillez utiliser Mobile Money | Kwishyura ukoresheje ikarita ntibishoboka ubu — koresha Mobile Money |  |  |
| `payment.card.unexpectedResponse` |  | Unexpected payment response — please try again | Réponse de paiement inattendue — veuillez réessayer | Igisubizo cyo kwishyura kitateganijwe — ongera ugerageze |  |  |
| `payment.card.verifyFailed` |  | Card payment verification failed | Échec de la vérification du paiement | Kugenzura kwishyura ukoresheje ikarita byanze |  |  |
| `payment.card.verifying` |  | Verifying payment... | Vérification du paiement… | Kugenzura kwishyura... |  |  |
| `payment.failed` |  | Payment failed. Please check your MoMo balance and try again. | Le paiement a echoue. Veuillez verifier votre solde MoMo et reessayer. | Kwishyura ntibyagenze neza. Reba umutungo wawe wa MoMo ugerageze nanone. |  |  |
| `payment.insufficientFunds` |  | Insufficient funds. Please top up your MoMo account. | Fonds insuffisants. Veuillez recharger votre compte MoMo. | Amafaranga ntahagije. Ongera amafaranga kuri konti yawe ya MoMo. |  |  |
| `payment.method.card` |  | Card | Carte | Ikarita |  |  |
| `payment.method.cardHint` | same-as-EN: brand | Visa, Mastercard, Apple Pay, Google Pay | Visa, Mastercard, Apple Pay, Google Pay | Visa, Mastercard, Apple Pay, Google Pay |  |  |
| `payment.method.confirmCard` |  | Confirm and pay by card | Confirmer et payer par carte | Emeza wishyure ukoresheje ikarita |  |  |
| `payment.method.label` |  | Payment method | Mode de paiement | Uburyo bwo kwishyura |  |  |
| `payment.method.momo` | same-as-EN: brand | Mobile Money | Mobile Money | Mobile Money |  |  |
| `payment.method.momoHint` |  | MTN MoMo or Airtel Money | MTN MoMo ou Airtel Money | MTN MoMo cyangwa Airtel Money |  |  |
| `payment.reason.declined` | **NEW** | Your Mobile Money provider refused the payment. | Votre opérateur Mobile Money a refusé le paiement. | Uwo utanga Mobile Money yanze kwishyura. |  |  |
| `payment.reason.gatewayDown` | **NEW** | Payments are having trouble right now. Try again in a moment. | Les paiements rencontrent un problème en ce moment. Réessayez dans un instant. | Kwishyura birimo ikibazo muri iki gihe. Ongera ugerageze nyuma gato. |  |  |
| `payment.reason.insufficientFunds` | **NEW** | Not enough money on your Mobile Money account. Top up, then try again. | Solde Mobile Money insuffisant. Rechargez, puis réessayez. | Nta mafaranga ahagije kuri konti yawe ya Mobile Money. Yongeremo, hanyuma ugerageze. |  |  |
| `payment.reason.invalidWallet` | **NEW** | That Mobile Money number was not accepted. Check the number on your account. | Ce numéro Mobile Money n'a pas été accepté. Vérifiez le numéro de votre compte. | Iyi nomero ya Mobile Money ntiyemewe. Reba nomero ya konti yawe. |  |  |
| `payment.reason.timeout` | **NEW** | Mobile Money did not answer in time. You were not charged. | Mobile Money n'a pas répondu à temps. Vous n'avez pas été débité. | Mobile Money ntiyasubije ku gihe. Nta mafaranga yakuweho. |  |  |
| `payment.reason.unknown` | **NEW** | The payment did not go through. You were not charged. | Le paiement n'est pas passé. Vous n'avez pas été débité. | Kwishyura ntibyagenze. Nta mafaranga yakuweho. |  |  |
| `payment.recover.checkPhone` | **NEW** | Check your phone and approve the Mobile Money request. | Vérifiez votre téléphone et approuvez la demande Mobile Money. | Reba kuri telefone yawe wemeze icyifuzo cya Mobile Money. |  |  |
| `payment.recover.driverHeld` | **NEW** | Your driver is still holding this ride. Pay again and you keep them. | Votre chauffeur garde cette course. Payez à nouveau et il reste le vôtre. | Umumotari wawe aracyakubitseho urugendo. Ongera wishyure, agume ari uwawe. |  |  |
| `payment.recover.iApproved` | **NEW** | I approved it | J'ai approuvé | Nabyemeje |  |  |
| `payment.recover.payByCard` | **NEW** | Pay by card instead | Payer par carte à la place | Wishyure ukoresheje ikarita |  |  |
| `payment.recover.seeMyRide` | **NEW** | See my ride | Voir ma course | Reba urugendo rwanjye |  |  |
| `payment.recover.stillWaiting` | **NEW** | Still waiting for your Mobile Money approval. | En attente de votre approbation Mobile Money. | Turacyategereje ko wemeza Mobile Money. |  |  |
| `payment.recover.title` | **NEW** | Payment didn't go through | Le paiement n'est pas passé | Kwishyura ntibyagenze |  |  |
| `payment.recover.tooManyAttempts` | **NEW** | Too many attempts. Wait a minute, then try again. | Trop de tentatives. Attendez une minute, puis réessayez. | Wagerageje kenshi cyane. Tegereza umunota, ongere ugerageze. |  |  |
| `payment.recover.tryMomo` | **NEW** | Try Mobile Money again | Réessayer avec Mobile Money | Ongera ugerageze Mobile Money |  |  |
| `payment.retry` |  | Try Again | Reessayer | Ongera ugerageze |  |  |
| `payment.timeout` |  | Payment timed out. Your money was not charged. Please try again. | Le paiement a expire. Votre argent n'a pas ete debite. Veuillez reessayer. | Igihe cyo kwishyura cyarashize. Amafaranga yawe ntiyakuweho. Ongera ugerageze. |  |  |

## Namespace: `payments`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `payments.activeTitle` |  | Current ride | Trajet en cours | Urugendo rurimo |  | Section heading over the active ride's payment state |
| `payments.empty` |  | No payments yet | Aucun paiement pour le moment | Nta bwishyu burabaho |  | Empty-state title |
| `payments.emptyHint` |  | When you complete a ride, what you paid appears here. | Quand vous terminez un trajet, ce que vous avez payé apparaît ici. | Nurangiza urugendo, ibyo wishyuye bizagaragara hano. |  | Empty-state body |
| `payments.howItWorks` |  | You choose how to pay when you accept a driver's offer: Mobile Money or card. The money is held safely and given to the driver only after you confirm you arrived. | Vous choisissez comment payer au moment d'accepter l'offre d'un chauffeur : Mobile Money ou carte. L'argent est gardé en sécurité et versé au chauffeur seulement après que vous confirmez être arrivé. | Uhitamo uko wishyura igihe wemera igiciro cy'umumotari: Mobile Money cyangwa ikarita. Amafaranga abikwa neza agahabwa umumotari ari uko wemeje ko wageze. |  | Explains the end-of-bidding payment moment and escrow in plain words — no persisted method preference exists |
| `payments.recentTitle` |  | Recent payments | Paiements récents | Ubwishyu buheruka |  | Section heading over the completed-rides list |
| `payments.status.FAILED` |  | Payment failed | Échec du paiement | Ubwishyu ntibwakunze |  |  |
| `payments.status.FROZEN` |  | On hold while we review | En attente pendant notre vérification | Buhagaritswe mu gihe turi kubisuzuma |  | Admin freeze — must not sound like the customer's fault |
| `payments.status.HELD` |  | Paid — held safely until arrival is confirmed | Payé — gardé en sécurité jusqu'à la confirmation d'arrivée | Bwishyuwe — bubitswe neza kugeza wemeje ko wageze |  | The escrow promise in customer terms |
| `payments.status.PENDING` |  | Waiting for payment | En attente de paiement | Ubwishyu burategerejwe |  | Escrow state labels — plain words, no banking jargon |
| `payments.status.REFUNDED` |  | Refunded | Remboursé | Bwasubijwe |  |  |
| `payments.status.RELEASED` |  | Paid to the driver | Versé au chauffeur | Bwahawe umumotari |  |  |
| `payments.statusFetchFailed` |  | Could not check the payment status. | Impossible de vérifier le statut du paiement. | Ntibyakunze kureba aho ubwishyu bugeze. |  | Inline failure line for the escrow-status check; sits next to a retry link |
| `payments.title` |  | Payments | Paiements | Ubwishyu |  | Page title and the Profile entry label for customers |

## Namespace: `payout`

> PAYOUT-C — the driver money screen. These strings tell a driver how
> much they earned today and exactly when it reaches their MoMo wallet;
> plain, reassuring wording matters more than literal fidelity.

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `payout.balanceLabel` |  | earned, waiting to be paid | gagné, en attente de paiement | Ayo wakoreye, agomba kwishyurwa |  |  |
| `payout.changeLimitNote` |  | You can change this once every 24 hours. | Vous pouvez changer cela une fois toutes les 24 heures. | Ushobora guhindura ibi rimwe mu masaha 24. |  |  |
| `payout.codeInputLabel` |  | SMS verification code | Code de vérification SMS | Kode yo kwemeza ya SMS |  |  |
| `payout.codePlaceholder` | same-as-EN: placeholder | 000000 | 000000 | 000000 |  |  |
| `payout.codeSent` |  | We sent a 6-digit code to your phone by SMS. | Nous avons envoyé un code à 6 chiffres à votre téléphone par SMS. | Twohereje kode y'imibare 6 kuri telefoni yawe kuri SMS. |  |  |
| `payout.confirmChange` |  | Confirm change | Confirmer le changement | Emeza ihinduka |  |  |
| `payout.cooldownNote` |  | After a change, any money you're owed follows in about 30 minutes. | Après un changement, l'argent qui vous est dû suit dans environ 30 minutes. | Nyuma yo guhindura, amafaranga ategereje akurikira mu minota igera kuri 30. |  |  |
| `payout.costImmediateWithdrawal` | **NEW** | If you ask to be paid immediately, outside your schedule, the {{fee}} RWF transfer fee comes out of your money. | Si vous demandez à être payé immédiatement, en dehors de votre horaire, les frais de transfert de {{fee}} RWF sont retenus sur votre argent. | Nusaba kwishyurwa ako kanya, hanze y'igihe wihitiyemo, amafaranga yo kohereza {{fee}} RWF akurwa ku mafaranga yawe. |  |  |
| `payout.costScheduled` | **NEW** | Costs you nothing — Bimoto pays the {{fee}} RWF transfer fee. | Ne vous coûte rien — Bimoto paie les frais de transfert de {{fee}} RWF. | Nta kiguzi ubona — Bimoto ni yo yishyura amafaranga yo kohereza {{fee}} RWF. |  |  |
| `payout.currentChoice` |  | Current | Actuel | Ikoreshwa ubu |  |  |
| `payout.emptyBalance` |  | Nothing yet today — money from completed rides shows up here. | Rien pour l'instant — l'argent des courses terminées apparaît ici. | Nta mafaranga arageramo — amafaranga y'ingendo zarangiye agaragara hano. |  |  |
| `payout.endShiftSuccess` |  | {{amount}} RWF is on its way — it should reach your MoMo wallet by {{time}}. | {{amount}} RWF est en route — il devrait arriver sur votre portefeuille MoMo vers {{time}}. | {{amount}} RWF ari mu nzira — agomba kugera kuri konti yawe ya MoMo bitarenze {{time}}. |  |  |
| `payout.fetchFailed` |  | Could not load your money info. Please try again. | Impossible de charger vos informations d'argent. Veuillez réessayer. | Ntibyashobotse gufungura amakuru y'amafaranga yawe. Ongera ugerageze. |  |  |
| `payout.frozenNotice` |  | Your payouts are paused while we review your account. Your balance is safe. Questions? Contact support. | Vos paiements sont en pause pendant que nous examinons votre compte. Votre solde est en sécurité. Des questions ? Contactez l'assistance. | Kwishyurwa kwawe guhagaritswe by'agateganyo mu gihe turi gusuzuma konti yawe. Amafaranga yawe ari mu mutekano. Ufite ikibazo? Vugana n'abashinzwe ubufasha. |  |  |
| `payout.landsAt` |  | Lands in your MoMo wallet at {{time}} | Arrive sur votre portefeuille MoMo à {{time}} | Amafaranga yoherezwa kuri konti yawe ya MoMo saa {{time}} |  |  |
| `payout.payMeNow` |  | Pay me now | Payez-moi maintenant | Nyishyura nonaha |  |  |
| `payout.pendingFollows` |  | Your pending money will follow at about {{time}}. | Votre argent en attente suivra vers {{time}}. | Amafaranga yawe ategereje azakurikira ahagana {{time}}. |  |  |
| `payout.prefAtShiftEnd` |  | When I end my shift | Quand je termine ma journée | Igihe ndangije akazi |  |  |
| `payout.prefAtShiftEndDesc` |  | You tap “Pay me now” on your dashboard when you finish. | Vous appuyez sur « Payez-moi maintenant » sur votre tableau de bord quand vous terminez. | Ukanda “Nyishyura nonaha” ku rubuga rwawe igihe urangije. |  |  |
| `payout.prefChangeSuccess` |  | Done — your payout schedule is updated. | C'est fait — votre calendrier de paiement est à jour. | Byakozwe — gahunda yawe yo kwishyurwa yahinduwe. |  |  |
| `payout.prefDaily22h` |  | Once a day | Une fois par jour | Rimwe ku munsi |  |  |
| `payout.prefDaily22hDesc` |  | Every night at 22:00, automatically. | Chaque soir à 22h00, automatiquement. | Buri joro ku isaha ya 22:00, mu buryo bwikora. |  |  |
| `payout.prefSectionTitle` |  | When do you get paid? | Quand êtes-vous payé ? | Wishyurwa ryari? |  |  |
| `payout.prefTwiceDaily` |  | Twice a day | Deux fois par jour | Kabiri ku munsi |  |  |
| `payout.prefTwiceDailyDesc` |  | Morning (06:00) and evening (18:00), automatically. | Matin (06h00) et soir (18h00), automatiquement. | Mu gitondo (06:00) no mu mugoroba (18:00), mu buryo bwikora. |  |  |
| `payout.scheduleAtShiftEnd` |  | You get paid when you end your shift — tap the button below. | Vous êtes payé quand vous terminez votre journée — appuyez sur le bouton ci-dessous. | Wishyurwa igihe urangije akazi kawe — kanda buto iri hepfo. |  |  |
| `payout.scheduleDaily22h` |  | You get paid every night at 22:00. | Vous êtes payé chaque soir à 22h00. | Wishyurwa buri joro ku isaha ya 22:00. |  |  |
| `payout.scheduleTwiceDaily` |  | You get paid twice a day, at 06:00 and 18:00. | Vous êtes payé deux fois par jour, à 06h00 et 18h00. | Wishyurwa kabiri ku munsi: 06:00 na 18:00. |  |  |
| `payout.sendCode` |  | Send me a code by SMS | Envoyez-moi un code par SMS | Nyoherereza kode kuri SMS |  |  |
| `payout.smsFallback` |  | No smartphone? Send BALANCE by SMS to check your money from any phone. | Pas de smartphone ? Envoyez BALANCE par SMS pour vérifier votre argent depuis n'importe quel téléphone. | Ntufite terefone igezweho? Ohereza BALANCE kuri SMS urebe amafaranga yawe kuri terefone iyo ari yo yose. |  |  |
| `payout.title` |  | Your money today | Votre argent aujourd'hui | Amafaranga winjije uyu munsi |  |  |
| `payout.trainingWheelsExplainer` |  | Your first payouts arrive automatically twice a day ({{count}}/3 shifts done). After 3 shifts your own choice takes over. | Vos premiers paiements arrivent automatiquement deux fois par jour ({{count}}/3 journées faites). Après 3 journées, votre propre choix s'applique. | Ubwishyu bwawe bwa mbere buza mu buryo bwikora kabiri ku munsi ({{count}}/3 by'imirimo irangiye). Nyuma y'imirimo 3, amahitamo yawe bwite azakurikizwa. |  |  |
| `payout.waiverLifetime` |  | No Bimoto commission on your rides — you keep 100% of every fare. | Aucune commission Bimoto sur vos courses — vous gardez 100 % de chaque course. | Nta mafaranga ya Bimoto ku ngendo zawe — ubika 100% bya buri giciro. |  |  |
| `payout.waiverTemporary` |  | No Bimoto commission until {{date}} — you keep 100% of every fare until then. | Aucune commission Bimoto jusqu'au {{date}} — vous gardez 100 % de chaque course jusque-là. | Nta mafaranga ya Bimoto kugeza {{date}} — ubika 100% bya buri giciro kugeza icyo gihe. |  |  |

## Namespace: `picker`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `picker.confirmDestination` |  | Set destination here | Définir la destination ici | Shyiraho aho ujya hano |  | Confirm button over the map |
| `picker.confirmPickup` |  | Set pickup here | Définir le départ ici | Shyiraho aho uva hano |  | Confirm button over the map |
| `picker.destination` |  | Destination | Destination | Aho njya |  | Mode chip; mirrors `journey.destination` |
| `picker.modeLabel` |  | What a tap on the map sets | Ce que définit un appui sur la carte | Icyo gukanda ku ikarita bishyiraho |  | Accessibility label on the chip row |
| `picker.pickup` |  | Pickup | Départ | Aho unsanga |  | Mode chip; mirrors `journey.pickup` phrasing |
| `picker.routeSummary` |  | {{km}} km · {{min}} min | {{km}} km · {{min}} min | km {{km}} · iminota {{min}} |  | Distance/time chip over the map when a road route is drawn |
| `picker.tapHint` |  | Tap the map to drop a pin | Touchez la carte pour placer un repère | Kanda ku ikarita ushyireho akamenyetso |  |  |

## Namespace: `priority`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `priority.badge` |  | PRIORITY | PRIORITAIRE | IBANZE |  |  |
| `priority.badgeAriaLabel` |  | Priority delivery | Livraison prioritaire | Kohereza by'ibanze |  |  |
| `priority.badgeLabel` |  | Priority | Prioritaire | Iby'ibanze |  |  |
| `priority.waitingMinutes` |  | waiting {{minutes}}m | en attente {{minutes}} min | ategereje iminota {{minutes}} |  |  |

## Namespace: `profile`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `profile.addContact` |  | Add contact | Ajouter un contact | Ongeraho kontaki |  |  |
| `profile.addContactButton` |  | Add contact | Ajouter le contact | Ongeraho kontaki |  |  |
| `profile.add_contact` |  | Add Contact | Ajouter un contact | Ongeraho umuntu |  |  |
| `profile.adminDashboard` | **NEW** | Admin dashboard | Tableau de bord admin | Ikibaho cy'ubuyobozi |  |  |
| `profile.contactAdded` |  | Contact added | Contact ajouté | Kontaki yongeweho |  |  |
| `profile.contactPhone` |  | Contact phone | Téléphone du contact | Telefoni ya kontaki |  |  |
| `profile.contactPhonePlaceholder` | same-as-EN: placeholder | +250 7XX XXX XXX | +250 7XX XXX XXX | +250 7XX XXX XXX |  |  |
| `profile.contactRemoved` |  | Contact removed | Contact supprimé | Kontaki yakuweho |  |  |
| `profile.edit` |  | Edit Profile | Modifier le profil | Hindura umwirondoro |  |  |
| `profile.editProfile` |  | Edit profile | Modifier le profil | Hindura umwirondoro |  |  |
| `profile.emergencyContacts` |  | Emergency contacts | Contacts d'urgence | Uwahamagarwa mu gihe havutse ikibazo |  |  |
| `profile.emergency_contacts` |  | Emergency Contacts | Contacts d'urgence | Uwahamagarwa mu gihe havutse ikibazo |  |  |
| `profile.idNotVerified` |  | ID not verified | Pièce d'identité non vérifiée | Indangamuntu ntiremezwa |  |  |
| `profile.idVerified` |  | ID verified | Pièce d'identité vérifiée | Indangamuntu yemejwe |  |  |
| `profile.licenseNotVerified` |  | Licence not verified | Permis non vérifié | Uruhushya ntiruremezwa |  |  |
| `profile.licenseVerified` |  | Licence verified | Permis vérifié | Uruhushya rwemejwe |  |  |
| `profile.maxContacts` |  | You can add up to {{max}} contacts | Vous pouvez ajouter jusqu'à {{max}} contacts | Ushobora kongeraho kontaki zitarenze {{max}} |  |  |
| `profile.member_since` |  | Member since | Membre depuis | Umunyamuryango kuva |  |  |
| `profile.nicknameRequired` |  | Please enter a nickname | Veuillez saisir un pseudonyme | Andika izina ukoresha |  |  |
| `profile.noContacts` |  | No emergency contacts yet | Pas encore de contacts d'urgence | Nta kontaki z'ubutabazi zirabaho |  |  |
| `profile.not_verified` |  | Not verified | Non vérifié | Ntibiranemezwa |  |  |
| `profile.rating` |  | Rating | Note | Amanota |  |  |
| `profile.removeContact` |  | Remove contact | Supprimer le contact | Kuraho kontaki |  |  |
| `profile.ridesCompleted` |  | Rides completed | Courses effectuées | Ingendo zarangiye |  |  |
| `profile.rides_completed` |  | Rides completed | Courses effectuées | Ingendo zarangiye |  |  |
| `profile.saveFailed` |  | Could not save | Enregistrement impossible | Ntibyakunze kubikwa |  |  |
| `profile.saved` |  | Profile saved | Profil enregistré | Umwirondoro wabitswe |  |  |
| `profile.title` |  | Profile | Profil | Umwirondoro |  |  |
| `profile.vehicle_info` |  | Vehicle Information | Informations sur le véhicule | Amakuru y'ikinyabiziga |  |  |
| `profile.verified` |  | Verified | Vérifié | Byemejwe |  |  |

## Namespace: `rating`

> TEAM-ANSWERS G6 — the low-star reason keys (`rating.reason.*`, item 15). Same standing as `report.reason.*`: CATEGORY LABELS, a starter set the Kigali team is expected to edit, with only the underlying keys fixed. Render them the way a passenger in Kigali would name the problem. `rating.reasonOptional` must read as reassurance — the stars are sent whether or not she says anything — never as an instruction to fill the fields in.

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `rating.detailsLabel` | **NEW** | Anything else? (optional) | Autre chose ? (facultatif) | Hari ikindi? (si ngombwa) |  |  |
| `rating.detailsPlaceholder` | **NEW** | In your own words | Avec vos propres mots | Mu magambo yawe bwite |  |  |
| `rating.label` |  | Rating: {{value}} | Note : {{value}} | Amanota: {{value}} |  |  |
| `rating.rateYourRide` | **NEW** | How was your ride? | Comment s’est passé votre trajet ? | Urugendo rwawe rwagenze rute? |  |  |
| `rating.reason.OTHER` | **NEW** | Something else | Autre chose | Ikindi kintu |  |  |
| `rating.reason.PRICE_DISAGREEMENT` | **NEW** | Disagreement about the price | Désaccord sur le prix | Kutumvikana ku giciro |  |  |
| `rating.reason.RUDE_BEHAVIOUR` | **NEW** | Rude behaviour | Comportement impoli | Imyitwarire mibi |  |  |
| `rating.reason.UNSAFE_DRIVING` | **NEW** | Unsafe driving | Conduite dangereuse | Gutwara nabi bishobora guteza impanuka |  |  |
| `rating.reason.VEHICLE_CONDITION` | **NEW** | Condition of the motorcycle | État de la moto | Imiterere ya moto |  |  |
| `rating.reason.WRONG_ROUTE` | **NEW** | Took the wrong route | A pris le mauvais itinéraire | Yanyuze inzira itari yo |  |  |
| `rating.reasonGiven` | **NEW** | Reason: | Raison : | Impamvu: |  |  |
| `rating.reasonLabel` | **NEW** | What went wrong? (optional) | Qu'est-ce qui n'a pas marché ? (facultatif) | Ni iki kitagenze neza? (si ngombwa) |  |  |
| `rating.reasonNone` | **NEW** | Rather not say | Je préfère ne rien dire | Sinshaka kubivuga |  |  |
| `rating.reasonOptional` | **NEW** | Both are optional. Your stars are sent either way. | Les deux sont facultatifs. Vos étoiles sont envoyées dans tous les cas. | Byombi si ngombwa. Inyenyeri zawe zoherezwa uko byagenda kose. |  |  |
| `rating.star` |  | {{n}} stars | {{n}} étoiles | Inyenyeri {{n}} |  |  |
| `rating.submit` | **NEW** | Send rating | Envoyer la note | Ohereza amanota |  |  |
| `rating.thankYou` | **NEW** | Thank you — your rating helps other passengers. | Merci — votre note aide les autres passagers. | Murakoze — amanota yawe afasha abandi bagenzi. |  |  |
| `rating.yourRating` | **NEW** | Your rating | Votre note | Amanota yawe |  |  |

## Namespace: `receipt`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `receipt.missingMoneyData` |  | Some payment details are not available for this ride. | Certains détails du paiement ne sont pas disponibles pour ce trajet. | Bimwe mu bisobanuro by'ubwishyu ntibiboneka kuri uru rugendo. |  | Honest gap line — shown instead of fake zeros when a ride has no money data |
| `receipt.paymentStatus` |  | Payment status | Statut du paiement | Aho ubwishyu bugeze |  | Label above the escrow state on the receipt |
| `receipt.vehicle` |  | Vehicle | Véhicule | Ikinyabiziga |  | Label on the receipt's vehicle line |
| `receipt.viewReceipt` |  | View receipt | Voir le reçu | Reba inyemezabuguzi |  | Button on completed rides in History and on the ride-completion screen |

## Namespace: `register`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `register.createAccount` |  | Create account | Créer le compte | Fungura konti |  |  |
| `register.driverProfileFailed` |  | Could not create the driver profile | Impossible de créer le profil chauffeur | Ntibyakunze gukora umwirondoro w'umumotari |  |  |
| `register.language` |  | Language | Langue | Ururimi |  |  |
| `register.nickname` |  | Nickname | Pseudonyme | Izina ukoresha |  |  |
| `register.nicknamePlaceholder` |  | e.g. Eric | ex. Eric | urugero: Eric |  |  |
| `register.nicknameRequired` |  | Please enter a nickname | Veuillez saisir un pseudonyme | Andika izina ukoresha |  |  |
| `register.plate` |  | Registration plate | Plaque d'immatriculation | Purake y'ikinyabiziga |  |  |
| `register.platePlaceholder` |  | e.g. RA 123 A | ex. RA 123 A | urugero: RA 123 A |  |  |
| `register.plateRequired` |  | A registration plate is required for this vehicle | Une plaque est requise pour ce véhicule | Iki kinyabiziga gisaba purake |  |  |
| `register.roleBoth` |  | Both | Les deux | Byombi |  |  |
| `register.roleCustomer` |  | As passenger | En tant que passager | Nk'umugenzi |  |  |
| `register.roleDriver` |  | As a driver | En tant que chauffeur | Nk'umumotari/Nk'umunyonzi |  |  |
| `register.roleLabel` |  | How will you use Bimoto? | Comment utiliserez-vous Bimoto ? | Uzakoresha Bimoto ute? |  |  |
| `register.roleRequired` |  | Please choose a role | Veuillez choisir un rôle | Hitamo uko uzayikoresha |  |  |
| `register.subtitle` |  | Tell us a little about you | Parlez-nous un peu de vous | Tubwire make kuri wowe |  |  |
| `register.success` |  | Welcome to Bimoto! | Bienvenue sur Bimoto ! | Murakaza neza kuri Bimoto! |  |  |
| `register.title` |  | Create your account | Créez votre compte | Fungura konti yawe |  |  |
| `register.updateFailed` |  | Could not save your details | Impossible d'enregistrer vos informations | Ntibyakunze kubika amakuru yawe |  |  |
| `register.useDifferentNumber` | **NEW** | Use a different number | Utiliser un autre numéro | Koresha indi nimero |  |  |
| `register.vehicleDescription` |  | Vehicle description | Description du véhicule | Ibisobanuro by'ikinyabiziga |  |  |
| `register.vehicleDescriptionPlaceholder` |  | Colour, model… | Couleur, modèle… | Ibara, ubwoko… |  |  |
| `register.vehicleInfo` |  | Vehicle info | Informations du véhicule | Amakuru y'ikinyabiziga |  |  |
| `register.vehicleType` |  | Vehicle type | Type de véhicule | Ubwoko bw'ikinyabiziga/ikinyamitende |  |  |

## Namespace: `reliability`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `reliability.newDriver` |  | New driver | Nouveau chauffeur | Umumotari mushya |  |  |
| `reliability.rides` |  | {{count}} rides | {{count}} courses | Ingendo {{count}} |  |  |

## Namespace: `report`

> TEAM-ANSWERS G6 — the driver's incident report (OPEN DECISIONS item 15, driver side). AI-generated draft pending native review. TWO THINGS CARRY THE WEIGHT HERE. (1) `report.reason.*` are CATEGORY LABELS the Kigali team is expected to edit: the five keys are a starter set chosen on 18 August, and the words are the team's to change freely — only the underlying keys are fixed (changing one is a database migration). Translate for how a motari would actually name the trouble, not literally from the English. (2) `report.reviewNote` is the promise the whole surface makes and must not drift: the passenger is NOT scored, and is NOT told who reported. A rendering that implies a rating, a mark against the passenger, or that the passenger will hear about it is wrong even if it reads well.

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `report.alreadyFiled` | **NEW** | You have reported this ride. | Vous avez déjà signalé cette course. | Wamaze gutanga ikibazo kuri uru rugendo. |  |  |
| `report.detailsLabel` | **NEW** | Anything else? (optional) | Autre chose ? (facultatif) | Hari ikindi? (si ngombwa) |  |  |
| `report.detailsPlaceholder` | **NEW** | In your own words | Avec vos propres mots | Mu magambo yawe bwite |  |  |
| `report.filed` | **NEW** | Report sent. Thank you. | Signalement envoyé. Merci. | Ikibazo cyoherejwe. Murakoze. |  |  |
| `report.openLink` | **NEW** | Report a problem with this ride | Signaler un problème sur cette course | Tanga ikibazo kuri uru rugendo |  |  |
| `report.reason.NO_SHOW_OR_LATE` | **NEW** | Passenger did not come, or kept me waiting | Le passager n'est pas venu, ou m'a fait attendre | Umugenzi ntiyaje, cyangwa yantegereje igihe kirekire |  |  |
| `report.reason.OTHER` | **NEW** | Something else | Autre chose | Ikindi kintu |  |  |
| `report.reason.REFUSED_AGREED_PRICE` | **NEW** | Refused to pay the agreed price | A refusé de payer le prix convenu | Yanze kwishyura igiciro twumvikanyeho |  |  |
| `report.reason.RUDE_BEHAVIOUR` | **NEW** | Rude behaviour | Comportement impoli | Imyitwarire mibi |  |  |
| `report.reason.UNSAFE_REQUEST` | **NEW** | Asked me to do something unsafe | M'a demandé quelque chose de dangereux | Yansabye gukora ikintu gishobora guteza akaga |  |  |
| `report.reasonLabel` | **NEW** | What happened? | Que s'est-il passé ? | Ni iki cyabaye? |  |  |
| `report.reasonNone` | **NEW** | Choose one | Choisissez une option | Hitamo kimwe |  |  |
| `report.reviewNote` | **NEW** | This goes to the Bimoto team to look at. The passenger is not scored, and is not told who reported. | Ceci est transmis à l'équipe Bimoto pour examen. Le passager n'est pas noté et n'apprend pas qui a signalé. | Ibi bijya ku itsinda rya Bimoto kugira ngo babisuzume. Umugenzi ntahabwa amanota, kandi ntabwo amenyeshwa uwatanze ikibazo. |  |  |
| `report.submit` | **NEW** | Send report | Envoyer le signalement | Ohereza ikibazo |  |  |
| `report.title` | **NEW** | Report a problem with this ride | Signaler un problème sur cette course | Tanga ikibazo kuri uru rugendo |  |  |

## Namespace: `ride`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `ride.confirm_arrival` |  | Have you arrived at your destination? | Êtes-vous arrivé à destination ? | Wagezeho aho ujya? |  |  |
| `ride.duration` |  | Duration: {{minutes}} min | Durée : {{minutes}} min | Igihe: iminota {{minutes}} |  |  |
| `ride.end_journey` |  | End Journey | Terminer le trajet | Rangiza urugendo |  |  |
| `ride.in_progress` |  | Ride in progress | Course en cours | Urugendo rurimo |  |  |
| `ride.rate_driver` |  | Rate your driver | Notez votre chauffeur | Ha amanota umumotari wawe |  |  |
| `ride.rate_hint` |  | How was your ride? | Comment était votre course ? | Urugendo rwagenze rute? |  |  |
| `ride.recording_gps` |  | Recording GPS track... | Enregistrement du tracé GPS... | Gufata inzira ya GPS... |  |  |
| `ride.report_problem` |  | Report a problem | Signaler un problème | Menyesha ikibazo |  |  |
| `ride.start_journey` |  | Start Journey | Démarrer le trajet | Tangira urugendo |  |  |
| `ride.submit_rating` |  | Submit Rating | Soumettre la note | Ohereza amanota |  |  |
| `ride.thanks` |  | Thank you for riding with Bimoto! | Merci d'avoir voyagé avec Bimoto ! | Urakoze gukorana na Bimoto! |  |  |
| `ride.yes_arrived` |  | Yes, I have arrived | Oui, je suis arrivé | Yego, nagezeho |  |  |

## Namespace: `scheduled`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `scheduled.acceptAnyway` |  | Accept anyway | Accepter quand même | Emera uko biri |  |  |
| `scheduled.acceptAnywayFailed` |  | Could not confirm this driver. Please choose another offer. | Impossible de confirmer ce chauffeur. Veuillez choisir une autre offre. | Ntibyakunze kwemeza uyu mumotari. Hitamo irindi ciro. |  |  |
| `scheduled.agreedPrice` |  | Agreed price | Prix convenu | Igiciro cyumvikanyweho |  |  |
| `scheduled.badgePickup` |  | Scheduled — pickup {{time}} | Programmée — départ {{time}} | Yagenwe — gufatwa {{time}} |  | Driver feed badge — brevity matters |
| `scheduled.biddingOpensAt` |  | Drivers can bid from {{time}} | Les chauffeurs peuvent faire des offres à partir de {{time}} | Abamotari bashobora gutanga ibiciro kuva {{time}} |  |  |
| `scheduled.bookingModeLabel` |  | When do you want to leave? | Quand voulez-vous partir ? | Urashaka kugenda ryari? |  |  |
| `scheduled.cancelConfirmBody` |  | Your scheduled pickup will be cancelled. | Votre prise en charge programmée sera annulée. | Urugendo rwawe rwagenwe ruzahagarikwa. |  |  |
| `scheduled.cancelConfirmTitle` |  | Cancel this scheduled ride? | Annuler cette course programmée ? | Guhagarika uru rugendo rwagenwe? |  |  |
| `scheduled.cancelRide` |  | Cancel scheduled ride | Annuler la course programmée | Hagarika urugendo rwagenwe |  |  |
| `scheduled.chooseAnotherDriver` |  | Choose another driver | Choisir un autre chauffeur | Hitamo undi mumotari |  |  |
| `scheduled.commitmentAssigned` | **NEW** | Confirmed — this ride is yours | Confirmée — cette course est la vôtre | Byemejwe — uru rugendo ni urwawe |  |  |
| `scheduled.commitmentBidPending` | **NEW** | Your offer is waiting for the passenger | Votre offre attend le passager | Igiciro watanze gitegereje umugenzi |  |  |
| `scheduled.conflictBody` |  | This driver has another scheduled ride close to your pickup time. You can choose another driver, or accept anyway. | Ce chauffeur a une autre course programmée proche de votre heure de prise en charge. Vous pouvez choisir un autre chauffeur, ou accepter quand même. | Uyu mumotari afite urundi rugendo rwagenwe hafi y'igihe cyawe cyo gufatwa. Ushobora guhitamo undi mumotari, cyangwa ukemera uko biri. |  |  |
| `scheduled.conflictRide` | same-as-EN: placeholder | {{time}} · {{pickup}} → {{destination}} | {{time}} · {{pickup}} → {{destination}} | {{time}} · {{pickup}} → {{destination}} |  | Interpolated line: time · pickup → destination |
| `scheduled.conflictTitle` |  | Driver already booked near this time | Chauffeur déjà réservé à cette heure | Umumotari asanzwe afite urugendo kuri iki gihe |  |  |
| `scheduled.driverListEmpty` |  | No scheduled rides yet | Aucune course programmée | Nta rugendo rwateganijwe |  |  |
| `scheduled.driverListEmptyHint` |  | Rides you commit to in advance appear here. Offers on a scheduled ride open 60 minutes before its pickup time. | Les courses que vous acceptez à l'avance apparaissent ici. Les offres sur une course programmée ouvrent 60 minutes avant l'heure de prise en charge. | Ingendo Wateganije zizagaragara hano. Gutanga igiciro ku rugendo rwateganijwe bifungurwa iminota 60 mbere y'isaha yo guhaguruka. |  |  |
| `scheduled.driverListTitle` |  | My scheduled rides | Mes courses programmées | Ingendo zanjye zagenwe |  |  |
| `scheduled.fallbackNote` |  | If you haven't chosen a driver 30 minutes before pickup, we'll automatically match you with the lowest-priced offer that can reach you in time. | Si vous n'avez pas choisi de chauffeur 30 minutes avant la prise en charge, nous vous attribuons automatiquement l'offre la moins chère pouvant arriver à temps. | Niba utarahitamo umumotari iminota 30 mbere yo gufatwa, tuzaguhitiramo igiciro gito gishoboka kigera ku gihe. |  | Must stay factually aligned with auto-fallback.ts (lowest-priced on-time offer) |
| `scheduled.leaveNow` |  | Leave now | Partir maintenant | Tugende Nonaha |  |  |
| `scheduled.pickupAt` |  | Pickup: {{time}} | Prise en charge : {{time}} | Gufatwa: {{time}} |  |  |
| `scheduled.pickupTimeHelper` |  | Between 1 hour and 30 days from now | Entre 1 heure et 30 jours à partir de maintenant | Hagati y'isaha 1 n'iminsi 30 uhereye ubu |  |  |
| `scheduled.pickupTimeLabel` |  | Departure Time | Heure de départ | Igihe cyo guhaguruka |  |  |
| `scheduled.scheduleLater` |  | Book for later | Réserver plus tard | Teganya urugendo |  |  |
| `scheduled.submit` |  | Confirm Ride | Confirmer la course | Emeza Urugendo |  |  |
| `scheduled.title` |  | Ride scheduled | Course programmée | Urugendo rwagenwe |  |  |
| `scheduled.upcomingTitle` |  | Upcoming rides | Courses à venir | Ingendo zitegereje |  |  |
| `scheduled.viewOffers` | **NEW** | View offers | Voir les offres | Reba ibyifuzo |  |  |
| `scheduled.waitingNote` |  | Nothing to do right now — your ride is booked. Bidding opens closer to pickup time by design. | Rien à faire pour l'instant — votre course est réservée. Les offres ouvrent à l'approche de l'heure de prise en charge, c'est normal. | Nta kibazo gihari — urugendo rwawe rwemejwe. Gutanga ibiciro bizatangira hafi y'igihe cyo gufatwa. |  | Reassurance line — calm, not a warning |
| `scheduled.yourOffer` | **NEW** | Your offer | Votre offre | Igiciro watanze |  |  |

## Namespace: `screener`

> `screener.help.*` — TODO Kinyarwanda native review (R3-SCREENER-HELP-LAYER, GAP-P26) — AI-generated, priority-1 batch.

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `screener.actions.continueAnyway` |  | Continue to vehicle verification | Continuer vers la vérification du véhicule | Komeza ku igenzurwa ry'ikinyabiziga |  |  |
| `screener.boolean.no` |  | No | Non | Oya |  |  |
| `screener.boolean.yes` |  | Yes | Oui | Yego |  |  |
| `screener.continue` |  | Continue | Continuer | Komeza |  |  |
| `screener.errors.submitFailed` |  | Couldn't save your answers. Please check your connection and try again. | Impossible d'enregistrer vos réponses. Vérifiez votre connexion et réessayez. | Ntibyashobotse kubika ibisubizo byawe. Reba ihuza ryawe ugerageze nanone. |  |  |
| `screener.help.cooperativeAffiliation` |  | Bimoto runs through transport cooperatives. If you're already in one, picking it speeds up onboarding because we have a relationship with your leader. If not, no problem — we'll match you. | Bimoto fonctionne via des coopératives de transport. Si vous êtes déjà membre, l'indiquer accélère votre intégration car nous avons une relation avec votre responsable. Sinon, pas de problème — nous vous mettrons en relation. | Bimoto ikorera binyuze mu makoperative y'ubwikorezi. Niba usanzwe uri muri rimwe, kurihitamo byihutisha kwinjira kuko dufitanye umubano n'umuyobozi wawe. Niba utari, nta kibazo — tuzaguhuza. |  |  |
| `screener.help.hasRuraAuthorisation` |  | RURA is Rwanda Utilities Regulatory Authority. Authorisation is required to transport passengers for hire. Don't worry if you don't have it yet — we can support your application. | RURA est l'Autorité de régulation des services publics du Rwanda. Une autorisation est requise pour transporter des passagers contre rémunération. Pas d'inquiétude si vous ne l'avez pas encore — nous pouvons soutenir votre demande. | RURA ni Urwego rw'u Rwanda rugenga imirimo ifitiye igihugu akamaro. Uruhushya rurakenewe kugira ngo utware abagenzi ku bwishyu. Ntutinde niba utararufite — dushobora gufasha mu busabe bwawe. |  |  |
| `screener.help.holdsDriversLicence` |  | We need a current Rwanda driver's licence valid for your vehicle category (A1 for motorcycle, A2 for general). 'In progress' means you've applied and have a receipt or test date booked. | Il vous faut un permis de conduire rwandais en cours de validité pour votre catégorie de véhicule (A1 pour moto, A2 pour usage général). « En cours » signifie que vous avez fait la demande et disposez d'un reçu ou d'une date d'examen. | Dukeneye uruhushya rwo gutwara rw'u Rwanda rufite agaciro ku bwoko bw'ikinyabiziga cyawe (A1 kuri moto, A2 muri rusange). « Biri mu nzira » bisobanura ko wasabye kandi ufite inyemezabuguzi cyangwa itariki y'ikizamini. |  |  |
| `screener.help.is18OrOlder` |  | Bimoto is for drivers and cyclists aged 18 and over. We can't onboard you below that age. Applicants under 18 can still join the venture-team cohort in a different role. | Bimoto est réservé aux chauffeurs et cyclistes de 18 ans et plus. Nous ne pouvons pas vous intégrer en dessous de cet âge. Les candidats de moins de 18 ans peuvent rejoindre l'équipe projet dans un autre rôle. | Bimoto igenewe abamotari bafite imyaka 18 cyangwa irenga. Ntidushobora kukwakira uri munsi y'iyo myaka. Abari munsi y'imyaka 18 bashobora kwinjira mu itsinda rishinga muri uruhare rutandukanye. |  |  |
| `screener.help.primaryCityBand` |  | Where will you usually pick up customers? Kigali Dense = central districts (Kacyiru, Nyamirambo, Kimironko). Kigali Periphery = suburbs and outskirts. Bugesera = the southern corridor toward Nyamata. | Où prendrez-vous habituellement vos clients ? Kigali dense = districts centraux (Kacyiru, Nyamirambo, Kimironko). Kigali périphérie = banlieues et abords. Bugesera = le corridor sud vers Nyamata. | Uzafata abakiriya he ahanini? Kigali rwagati = uturere two hagati (Kacyiru, Nyamirambo, Kimironko). Kigali hanze = inkengero. Bugesera = inzira y'amajyepfo igana Nyamata. |  |  |
| `screener.help.primaryVehicleType` |  | Pick the vehicle you'll use for 50% or more of your trips. You can update this later from your driver profile. | Choisissez le véhicule que vous utiliserez pour au moins 50 % de vos trajets. Vous pourrez le modifier plus tard depuis votre profil. | Hitamo ikinyabiziga uzakoresha kuri 50% cyangwa kurenga by'ingendo zawe. Ushobora kubihindura nyuma uhereye ku mwirondoro wawe. |  |  |
| `screener.help.priorPlatformExperience` |  | Yego, SafeMotos, or any similar dispatch app. Helps us understand how comfortable you are with smartphone-based dispatch. Not required. | Yego, SafeMotos ou toute application de réservation similaire. Cela nous aide à comprendre votre aisance avec la réservation sur smartphone. Non obligatoire. | Yego, SafeMotos, cyangwa indi porogaramu nk'izo. Bidufasha kumva uko umenyereye gukoresha telefoni igendanwa. Ntibisabwa. |  |  |
| `screener.help.toggle` |  | More info on this question | Plus d'infos sur cette question | Andi makuru kuri iki kibazo |  |  |
| `screener.help.weeklyAvailabilityHours` |  | Be realistic. Most active drivers commit 20+ hours per week. Lower availability is fine during soft launch and you can update this later. | Soyez réaliste. La plupart des chauffeurs actifs s'engagent sur 20 heures ou plus par semaine. Une disponibilité plus faible convient pendant le lancement et reste modifiable plus tard. | Vuga ukuri. Abamotari benshi bakora bakora amasaha 20 cyangwa arenga mu cyumweru. Igihe gito kiremewe mu gihe cyo gutangira kandi ushobora kubihindura nyuma. |  |  |
| `screener.options.cityBand.bugesera_corridor` |  | Bugesera corridor | Corridor de Bugesera | Inzira ya Bugesera |  |  |
| `screener.options.cityBand.kigali_dense` |  | Central Kigali | Kigali central | Kigali rwagati |  |  |
| `screener.options.cityBand.kigali_periphery` |  | Kigali periphery | Périphérie de Kigali | Kigali hanze |  |  |
| `screener.options.cityBand.other` |  | Other | Autre | Ahandi |  |  |
| `screener.options.licence.in_progress` |  | I'm in the process of getting one | Je suis en train de l'obtenir | Ndi mu nzira yo kuruhabwa |  |  |
| `screener.options.licence.in_progress_description` |  | Bring proof of application or a test date. | Apportez une preuve de demande ou une date d'examen. | Zana ikimenyetso cy'ubusabe cyangwa itariki y'ikizamini. |  |  |
| `screener.options.licence.no` |  | No | Non | Oya |  |  |
| `screener.options.licence.no_description` |  | You'll need one before you can drive on Bimoto. | Il vous en faudra un avant de conduire sur Bimoto. | Uzarukenera mbere yo gutwara kuri Bimoto. |  |  |
| `screener.options.licence.yes` |  | Yes, I have one | Oui, j'en ai un | Yego, ndafite |  |  |
| `screener.options.licence.yes_description` |  | Class A1 or A2, valid and not expired. | Catégorie A1 ou A2, valide et non expirée. | Icyiciro A1 cyangwa A2, gifite agaciro kandi kitarangiye. |  |  |
| `screener.options.rura.applying` |  | I'm applying for it | Je suis en train de la demander | Ndi mu kuruhabwa |  |  |
| `screener.options.rura.applying_description` |  | Bring your receipt or reference number. | Apportez votre reçu ou numéro de référence. | Zana inyemezabuguzi cyangwa nomero y'icyerekezo. |  |  |
| `screener.options.rura.have` |  | I have it | Je l'ai | Ndafite |  |  |
| `screener.options.rura.have_description` |  | Current authorisation document. We'll verify it. | Document d'autorisation en cours. Nous le vérifierons. | Inyandiko y'uruhushya igezweho. Tuzayisuzuma. |  |  |
| `screener.options.rura.not_yet` |  | Not yet | Pas encore | Ntabwo nararuhabwa |  |  |
| `screener.options.rura.not_yet_description` |  | We'll support your application. | Nous soutiendrons votre demande. | Tuzafasha mu busabe bwawe. |  |  |
| `screener.options.vehicleType.BIKE` |  | Bicycle | Vélo | Igare |  |  |
| `screener.options.vehicleType.BIKE_description` |  | Standard pedal bicycle. No motor. Fare tier 1. | Vélo classique à pédales. Sans moteur. Tarif niveau 1. | Igare risanzwe rikorwa n'amaguru. Nta moteri. Urwego rw'igiciro rwa 1. |  |  |
| `screener.options.vehicleType.E_BIKE` |  | Electric bicycle | Vélo électrique | Igare rikoresha amashanyarazi |  |  |
| `screener.options.vehicleType.E_BIKE_description` |  | Pedal-assist or full electric bicycle. Quiet, lower emissions. Fare tier 2. | Vélo à assistance électrique ou tout électrique. Silencieux, moins polluant. Tarif niveau 2. | Igare rifashwa n'amashanyarazi cyangwa rikoresha amashanyarazi yose. Ritituza, ryangiza bike. Urwego rw'igiciro rwa 2. |  |  |
| `screener.options.vehicleType.E_MOTO` |  | Electric motorcycle | Moto électrique | Pikipiki ikoresha amashanyarazi |  |  |
| `screener.options.vehicleType.E_MOTO_description` |  | Electric motorcycle. RURA category for moto-taxi authorisation. Fare tier 3 (small premium). | Moto électrique. Catégorie RURA pour l'autorisation moto-taxi. Tarif niveau 3 (léger supplément). | Pikipiki ikoresha amashanyarazi. Icyiciro cya RURA cy'uruhushya rwa moto-tagisi. Urwego rw'igiciro rwa 3 (inyongera ntoya). |  |  |
| `screener.options.vehicleType.MOTO` |  | Motorcycle | Moto | Pikipiki |  |  |
| `screener.options.vehicleType.MOTO_description` |  | Petrol motorcycle. The most common Kigali ride. Fare tier 2. | Moto à essence. La course la plus courante à Kigali. Tarif niveau 2. | Pikipiki ikoresha lisansi. Urugendo rukunze i Kigali. Urwego rw'igiciro rwa 2. |  |  |
| `screener.progress` |  | {{answered}} of {{total}} · ≈ {{minutes}} min | {{answered}} sur {{total}} · ≈ {{minutes}} min | {{answered}} ku {{total}} · ≈ iminota {{minutes}} |  |  |
| `screener.questions.cooperativeAffiliation` |  | Are you affiliated with a driver cooperative? (optional) | Êtes-vous affilié à une coopérative de chauffeurs ? (facultatif) | Muri muri kooperative y'abamotari? (bidategetswe) |  |  |
| `screener.questions.cooperativeNameProvided` |  | Cooperative name | Nom de la coopérative | Izina rya kooperative |  |  |
| `screener.questions.hasRuraAuthorisation` |  | Do you have RURA authorisation to drive commercially? | Disposez-vous d'une autorisation RURA pour conduire à titre commercial ? | Mufite uruhushya rwa RURA rwo gutwara mu bucuruzi? |  |  |
| `screener.questions.holdsDriversLicence` |  | Do you hold a valid driver's licence? | Possédez-vous un permis de conduire valide ? | Mufite uruhushya rwo gutwara ibinyabiziga? |  |  |
| `screener.questions.is18OrOlder` |  | Are you 18 or older? | Avez-vous 18 ans ou plus ? | Mufite imyaka 18 cyangwa irenga? |  |  |
| `screener.questions.primaryCityBand` |  | Where do you mainly operate? | Où exercez-vous principalement ? | Mukorera ahantu hahe ahanini? |  |  |
| `screener.questions.primaryVehicleType` |  | Which vehicle do you mainly use? | Quel véhicule utilisez-vous principalement ? | Ni ikinyabiziga ki mukoresha cyane? |  |  |
| `screener.questions.priorPlatformExperience` |  | Have you driven for another ride-hailing platform before? | Avez-vous déjà conduit pour une autre plateforme de VTC ? | Mwigeze gutwara muri pulatifomu indi yo gutumiza? |  |  |
| `screener.questions.priorPlatformMonths` |  | For how many months? | Pendant combien de mois ? | Mu mezi angahe? |  |  |
| `screener.questions.weeklyAvailabilityHours` |  | How many hours per week can you drive? | Combien d'heures par semaine pouvez-vous conduire ? | Ni amasaha angahe mu cyumweru mushobora gutwara? |  |  |
| `screener.results.ineligible.no_drivers_licence.body` |  | A valid driver's licence is required to drive for the pilot. Come back once you have one. | Un permis de conduire valide est requis pour participer au pilote. Revenez dès que vous l'aurez. | Uruhushya rwemewe rwo gutwara rurakenewe kugira ngo utware muri pilote. Garuka iyo uzaba urafite. |  |  |
| `screener.results.ineligible.no_drivers_licence.title` |  | Driver's licence required | Permis de conduire requis | Uruhushya rwo gutwara rurakenewe |  |  |
| `screener.results.ineligible.under_18.body` |  | You need to be 18 or older to drive for the pilot. We'll be in touch when that changes. | Vous devez avoir 18 ans ou plus pour participer au pilote. Nous reviendrons vers vous le moment venu. | Ugomba kuba ufite imyaka 18 cyangwa irenga kugira ngo utware muri pilote. Tuzakubwira igihe ibyo bizaba bihindutse. |  |  |
| `screener.results.ineligible.under_18.title` |  | Not yet eligible | Pas encore éligible | Ntushobora ubu |  |  |
| `screener.results.ineligibleFooter` |  | We'll save your contact so we can reach you when the pilot expands. | Nous garderons vos coordonnées pour vous contacter lors de l'élargissement du pilote. | Tuzabika imibanire yawe kugira ngo tubashe kugutumiza igihe pilote izaba yagutse. |  |  |
| `screener.results.needs_follow_up.low_availability.body` |  | We saw less than 5 hours per week. You can still continue, but rides may be sparse — we'll match harder when you have more time. | Moins de 5 heures par semaine indiquées. Vous pouvez continuer, mais les courses seront rares — nous chercherons plus fort quand vous aurez plus de temps. | Twabonye amasaha ari munsi ya 5 mu cyumweru. Ushobora gukomeza, ariko ingendo zizaba nke — tuzashaka cyane iyo uzagira igihe kirenze. |  |  |
| `screener.results.needs_follow_up.low_availability.title` |  | Low availability noted | Disponibilité limitée | Igihe gito |  |  |
| `screener.results.needs_follow_up.needs_rura_path.body` |  | Commercial driving in Rwanda requires RURA authorisation. You can keep going for now; we'll check in on your application before your first paid trip. | La conduite commerciale au Rwanda nécessite une autorisation RURA. Vous pouvez continuer pour le moment ; nous vérifierons votre demande avant votre première course payante. | Gutwara mu bucuruzi mu Rwanda bisaba uruhushya rwa RURA. Ushobora gukomeza ubu; tuzakurikirana ubusabe bwawe mbere y'urugendo rwawe rwa mbere rwishyurwa. |  |  |
| `screener.results.needs_follow_up.needs_rura_path.title` |  | RURA authorisation pending | Autorisation RURA en attente | Uruhushya rwa RURA rurategerejwe |  |  |
| `screener.subtitle` |  | Eight short questions to make sure the pilot is a good fit for you. | Huit courtes questions pour vérifier que le pilote vous convient. | Ibibazo umunani byihuse kugira ngo turebe niba pilote ikwiriye. |  |  |
| `screener.title` |  | Quick eligibility check | Vérification rapide d'éligibilité | Igenzura ryihuse ry'ubushobozi |  |  |

## Namespace: `settings`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `settings.add` |  | Add | Ajouter | Ongeraho |  |  |
| `settings.contactFormatHint` | **NEW** | 07XX XXX XXX, or with a country code (+250, +44…) | 07XX XXX XXX, ou avec un indicatif (+250, +44…) | 07XX XXX XXX, cyangwa hamwe na kode y'igihugu (+250, +44…) |  |  |
| `settings.contactPlaceholder` | same-as-EN: placeholder | +250 7XX XXX XXX | +250 7XX XXX XXX | +250 7XX XXX XXX |  |  |
| `settings.diagnosticsUpload` | **NEW** | Send error reports automatically | Envoyer les rapports d'erreur automatiquement | Kohereza raporo z'amakosa mu buryo bwikora |  |  |
| `settings.diagnosticsUploadHelp` | **NEW** | Lets the Bimoto team see errors this phone hits, without you having to report them. Only the error records shown on the Diagnostics screen are sent — never your messages, trips or location. Turn this off and nothing is sent unless you tap Send report yourself. | Permet à l'équipe Bimoto de voir les erreurs rencontrées par ce téléphone, sans que vous ayez à les signaler. Seuls les enregistrements affichés sur l'écran Diagnostics sont envoyés — jamais vos messages, vos trajets ni votre position. Désactivez ceci et rien n'est envoyé, sauf si vous appuyez vous-même sur Envoyer le rapport. | Bituma ikipe ya Bimoto ibona amakosa iyi telefoni ihura na yo, utagombye kubimenyesha. Hoherezwa gusa inyandiko z'amakosa zigaragara ku rupapuro rwa Diagnostics — ntabwo ari ubutumwa bwawe, ingendo zawe cyangwa aho uri. Nubihagarika nta kintu kizoherezwa keretse wikanze Ohereza raporo ubwawe. |  |  |
| `settings.emergencyContacts` |  | Emergency contacts | Contacts d'urgence | Uwahamagarwa mu gihe havutse ikibazo |  |  |
| `settings.language` |  | Language | Langue | Ururimi |  |  |
| `settings.languageChanged` |  | Language updated | Langue mise à jour | Ururimi rwahinduwe |  |  |
| `settings.logout` |  | Log Out | Se déconnecter | Sohokamo |  |  |
| `settings.logout_confirm` |  | Are you sure you want to log out? | Êtes-vous sûr de vouloir vous déconnecter ? | Uzi neza ko ushaka gusohoka? |  |  |
| `settings.mapsOffline` | **NEW** | Maps & offline | Cartes et hors ligne | Amakarita no gukora nta internet |  |  |
| `settings.mapsOfflineHelp` | **NEW** | Keep maps on this phone so they show instantly, even with no connection. | Gardez les cartes sur ce téléphone pour qu’elles s’affichent instantanément, même sans connexion. | Bika amakarita kuri iyi telefoni kugira ngo agaragare ako kanya, ndetse nta murandasi. |  |  |
| `settings.mapsOfflineOpen` | **NEW** | Manage offline maps | Gérer les cartes hors ligne | Gucunga amakarita yo gukoresha nta internet |  |  |
| `settings.notificationSounds` | **NEW** | Notification sounds | Sons de notification | Amajwi y'ubutumwa |  |  |
| `settings.notificationSoundsHelp` | **NEW** | Play the Bimoto sound when something happens — an offer, a ride, a payment. Turning this off keeps the messages on screen; only the sound stops. | Jouer le son Bimoto lorsqu'il se passe quelque chose — une offre, une course, un paiement. Désactiver n'enlève que le son ; les messages restent affichés. | Kuvuza ijwi rya Bimoto iyo hari ikibaye — igiciro, urugendo, ubwishyu. Iyo uhagaritse, ubutumwa buguma ku kizamini; ijwi ryonyine ni ryo rihagarara. |  |  |
| `settings.removeContact` |  | Remove contact | Supprimer le contact | Kuraho kontaki |  |  |
| `settings.saveFailed` |  | Could not save | Enregistrement impossible | Ntibyakunze kubikwa |  |  |
| `settings.saveVehicle` |  | Save vehicle | Enregistrer le véhicule | Bika ikinyabiziga |  |  |
| `settings.title` |  | Settings | Paramètres | Igenamiterere |  |  |
| `settings.vehicleInfo` |  | Vehicle info | Informations du véhicule | Amakuru y'ikinyabiziga |  |  |
| `settings.vehicleSaved` |  | Vehicle saved | Véhicule enregistré | Ikinyabiziga cyabitswe |  |  |

## Namespace: `sheet`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `sheet.dragHandle` |  | Drag to resize | Faites glisser pour redimensionner | Kurura kugira ngo uhindure ingano |  | Accessibility label on the sheet handle |

## Namespace: `simulation`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `simulation.banner` |  | SIMULATION — no real money is used | SIMULATION — aucun argent réel n'est utilisé | IGERAGEZWA — nta mafaranga nyayo |  |  |
| `simulation.dismiss` |  | Dismiss | Fermer | Funga |  |  |
| `simulation.inboxLink` |  | Inbox messages | Messages reçus | Ubutumwa Bugufi |  |  |
| `simulation.payConfirm` |  | Pay (simulated) | Payer (simulation) | Kwishyura (igeragezwa) |  |  |

## Namespace: `states`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `states.loadFailed` |  | This couldn't load | Le chargement a échoué | Ntibyashobotse gupakirwa |  | Shared error-state headline when a screen failed to load |
| `states.loadFailedHint` |  | It may be a connection problem — it's not your fault. Try again. | C'est peut-être un problème de connexion — ce n'est pas de votre faute. Réessayez. | Bishobora kuba ikibazo cy'umurandasi — si amakosa yawe. Ongera ugerageze. |  | Shared error-state hint; reassures the user it is not their fault |

## Namespace: `status`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `status.AWAITING_CONFIRMATION` |  | Awaiting confirmation | En attente de confirmation | Rutegereje kwemezwa |  |  |
| `status.CANCELLED` |  | Cancelled | Annulée | Rwahagaritswe |  |  |
| `status.COMPLETED` |  | Completed | Terminée | Rwarangiye |  |  |
| `status.DISPUTED` |  | Disputed | Contestée | Rufite impaka |  |  |
| `status.EXPIRED` |  | Expired | Expirée | Rwarengeje igihe |  |  |
| `status.INTERRUPTED` |  | Interrupted | Interrompue | Rwahagaritswe hagati |  |  |
| `status.IN_PROGRESS` |  | In progress | En cours | Ruragenda |  |  |
| `status.MATCHED` |  | Matched | Attribuée | Rwabonye umumotari |  |  |
| `status.REQUESTED` |  | Requested | Demandée | Rwasabwe |  |  |
| `status.SCHEDULED` |  | Scheduled | Planifiée | Ryateganyijwe |  |  |

## Namespace: `sync`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `sync.banner.discard` |  | Discard | Supprimer | Siba |  |  |
| `sync.banner.dismiss` |  | Dismiss | Fermer | Funga |  |  |
| `sync.banner.empty` |  | No failed events. | Aucun événement échoué. | Nta bikorwa byanze. |  |  |
| `sync.banner.failedCount` |  | {{count}} updates failed to sync | {{count}} mises à jour n'ont pas pu se synchroniser | Ibikorwa {{count}} ntibyoherejwe |  |  |
| `sync.banner.failedCount_one` |  | {{count}} sync event failed — tap to review | {{count}} événement de synchro a échoué — appuyez pour examiner | Igikorwa cyo guhuza {{count}} cyanze — kanda urebe |  |  |
| `sync.banner.failedCount_other` |  | {{count}} sync events failed — tap to review | {{count}} événements de synchro ont échoué — appuyez pour examiner | Ibikorwa byo guhuza {{count}} byanze — kanda urebe |  |  |
| `sync.banner.modalTitle` |  | Failed sync events | Événements de synchro échoués | Ibikorwa byo guhuza byanze |  |  |
| `sync.banner.retry` |  | Retry | Réessayer | Ongera ugerageze |  |  |
| `sync.connected` |  | Connected | Connecté | Ndi ku murongo |  |  |
| `sync.offline` |  | Offline - changes will sync when connected | Hors ligne - les modifications seront synchronisées une fois connecté | Ntabwo uri kuri interineti - ibihindutse bizahuzwa mugihe uzongeraho |  |  |
| `sync.online` |  | Online | En ligne | Kuri interineti |  |  |
| `sync.rejection.DUPLICATE_EVENT_ID` |  | Already sent to the server | Déjà envoyé au serveur | Byamaze koherezwa |  |  |
| `sync.rejection.FK_VIOLATION` |  | Referenced item was deleted | L'élément référencé a été supprimé | Ibyahuriwemo byasibwe |  |  |
| `sync.rejection.PERMISSION_DENIED` |  | No longer permitted | Action non autorisée | Nta burenganzira |  |  |
| `sync.rejection.STALE_TIMESTAMP` |  | Event is too old to apply | Événement trop ancien | Igikorwa cy'ishaje |  |  |
| `sync.rejection.UNKNOWN` |  | Unknown error | Erreur inconnue | Ikosa ridasobanutse |  |  |
| `sync.rejection.VALIDATION_ERROR` |  | Server rejected the data | Le serveur a rejeté les données | Seriveri yanze amakuru |  |  |
| `sync.syncing` |  | Syncing... | Synchronisation... | Guhuza... |  |  |

## Namespace: `tiers`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `tiers.commission` |  | Platform fee: {{rate}}% | Frais de plateforme : {{rate}}% | Amafaranga y'urubuga: {{rate}}% |  |  |
| `tiers.savings` |  | Your {{tier}} status saved you {{amount}} RWF on platform fees | Votre statut {{tier}} vous a fait économiser {{amount}} RWF sur les frais de plateforme | Urwego rwawe {{tier}} rwakuzigamiye {{amount}} RWF ku mafaranga y'urubuga |  |  |
| `tiers.yourTier` |  | Your tier: {{tier}} | Votre niveau : {{tier}} | Urwego rwawe: {{tier}} |  |  |

## Namespace: `toast`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `toast.more` | **NEW** | +{{count}} more | +{{count}} de plus | +{{count}} ibindi |  |  |

## Namespace: `transparency`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `transparency.atMaxTier` |  | You're at the highest tier! | Vous êtes au niveau le plus élevé ! | Uri ku rwego rwo hejuru cyane! |  |  |
| `transparency.bidAccepted` |  | Your bid was accepted! You will receive {{amount}} RWF for this ride. | Votre offre a été acceptée ! Vous recevrez {{amount}} RWF pour cette course. | Ituro ryawe ryemewe! Uzahabwa {{amount}} RWF kuri uru rugendo. |  |  |
| `transparency.commissionBreakdown` |  | Commission breakdown | Détail des commissions | Ibisobanuro by'amakomisiyo |  |  |
| `transparency.confirmAndPay` |  | Confirm & Pay | Confirmer et payer | Emeza wishyure |  |  |
| `transparency.confirmOffer` |  | Confirm your offer | Confirmer votre offre | Emeza ubusabe bwawe |  |  |
| `transparency.confirmRide` |  | Confirm ride | Confirmer la course | Emeza urugendo |  |  |
| `transparency.customerCommission` |  | Customer commission ({{tier}} {{rate}}%) | Commission client ({{tier}} {{rate}}%) | komisiyo y'umukiriya ({{tier}} {{rate}}%) |  |  |
| `transparency.customerCommissionUpTo` |  | Customer commission: up to {{rate}}% | Commission client : jusqu'à {{rate}}% | Amakomisiyo y'umukiriya: kugeza kuri {{rate}}% |  |  |
| `transparency.customerFeeWaived` | **NEW** | Platform fee waived during the pilot. | Frais de plateforme offerts pendant le pilote. | Amafaranga ya porogaramu yarasonewe mu gihe cy’igerageza. |  |  |
| `transparency.customerTierLine` | **NEW** | Your tier: {{tier}} | Votre niveau : {{tier}} | Urwego rwawe: {{tier}} |  |  |
| `transparency.driverCommission` |  | Driver commission ({{tier}} {{rate}}%) | Commission chauffeur ({{tier}} {{rate}}%) | komisiyo y'umumotari ({{tier}} {{rate}}%) |  |  |
| `transparency.driverReceives` |  | Driver receives: {{amount}} RWF | Le chauffeur reçoit : {{amount}} RWF | Umumotari/Umunyonzi ahabwa: {{amount}} RWF |  |  |
| `transparency.exactAmountDependsOnCustomer` |  | Exact amount depends on customer's tier. Minimum shown is guaranteed. | Le montant exact dépend du niveau du client. Le minimum affiché est garanti. | Amafaranga yishyurwa ashobora gutandukana bitewe n'urwego rw'umukiriya. Amafaranga y'ubwishingizi agaragazwa munsi y'ibiciro byerekanwe. |  |  |
| `transparency.fairPriceNote` |  | This is what you pay. Platform fees are deducted separately. | C'est ce que vous payez. Les frais de plateforme sont déduits séparément. | Iki nicyo wishyura. Amafaranga y'urubuga akurwa ukwayo. |  |  |
| `transparency.feeWaivedAmount` |  | 0 RWF — waived (normally {{amount}} RWF) | 0 RWF — exonérés (normalement {{amount}} RWF) | 0 RWF — yahagaritswe (ubusanzwe {{amount}} RWF) |  |  |
| `transparency.feeWaivedChip` |  | fee waived | frais exonérés | nta mafaranga ya Bimoto |  |  |
| `transparency.feeWaivedLine` |  | Platform fee: 0 RWF — waived during the pilot (normally {{amount}} RWF) | Frais de plateforme : 0 RWF — exonérés pendant le pilote (normalement {{amount}} RWF) | Amafaranga ya Bimoto: 0 RWF — yahagaritswe mu gihe cy'igerageza (ubusanzwe {{amount}} RWF) |  |  |
| `transparency.feeWaivedNote` |  | Pilot fee waiver — the driver keeps 100% of this fare. | Exonération pilote — le chauffeur garde 100 % de cette course. | Igerageza rya Bimoto — umumotari abika 100% y'iki giciro. |  |  |
| `transparency.guaranteedMinimum` |  | Guaranteed minimum: {{amount}} RWF | Minimum garanti : {{amount}} RWF | Munsi y'ibyo ntuzamanuka: {{amount}} RWF |  |  |
| `transparency.netReceived` |  | Net received | Net reçu | Amafaranga yahawe |  |  |
| `transparency.paymentHeldInEscrow` |  | Payment held in system until you confirm arrival. | Le paiement est conservé dans le système jusqu'à confirmation d'arrivée. | Ubwishyu bibikwa muri sisiteme kugeza urugendo rurangiye. |  |  |
| `transparency.platformFee` |  | Platform fee | Frais de plateforme | Amafaranga y'urubuga |  |  |
| `transparency.platformFeeAmount` |  | Platform fee: {{amount}} RWF ({{rate}}%) | Frais de plateforme : {{amount}} RWF ({{rate}}%) | Amafaranga y'urubuga: {{amount}} RWF ({{rate}}%) |  |  |
| `transparency.possibleMax` |  | Possible max: {{amount}} RWF | Maximum possible : {{amount}} RWF | Byinshi bishoboka: {{amount}} RWF |  |  |
| `transparency.priceBinding` |  | This price is fixed. If accepted, the trip will be completed at this price. | Ce prix est fixe. S'il est accepté, le trajet sera effectué à ce prix. | Iki giciro ni ntakuka. Niba cyemewe, urugendo rurakorwa kuri iki giciro. |  |  |
| `transparency.rideInProgress` |  | Ride in progress — You will receive {{amount}} RWF | Course en cours — Vous recevrez {{amount}} RWF | Urugendo rurimo — Uzahabwa {{amount}} RWF |  |  |
| `transparency.rideReceipt` |  | Ride Receipt | Reçu de course | Inyemezabwishyu y'urugendo |  |  |
| `transparency.ridesUntilNextTier` |  | {{count}} more rides to reach {{tier}} ({{rate}}%) | {{count}} courses de plus pour atteindre {{tier}} ({{rate}}%) | Ingendo {{count}} zisigaye kugera ku rwego {{tier}} ({{rate}}%) |  |  |
| `transparency.submitOffer` |  | Submit Offer | Soumettre l'offre | Ohereza igiciro |  |  |
| `transparency.tierSavings` |  | Your {{tier}} tier saves you {{amount}} RWF | Votre niveau {{tier}} vous économise {{amount}} RWF | Urwego rwawe {{tier}} rukuzigamira {{amount}} RWF |  |  |
| `transparency.tierSavingsPerRide` |  | You save {{rate}}% vs new users on every ride | Vous économisez {{rate}}% par rapport aux nouveaux utilisateurs sur chaque course | Uzigama {{rate}}% ugereranyije n'abakoresha bashya kuri buri rugendo |  |  |
| `transparency.totalPaid` |  | Total paid | Total payé | Igiteranyo cyishyuwe |  |  |
| `transparency.totalPlatformFeeExact` | **NEW** | Platform fee: {{rate}}% | Frais de plateforme : {{rate}} % | Amafaranga ya porogaramu: {{rate}}% |  |  |
| `transparency.totalPlatformFeeRange` |  | Total platform fee: {{min}}% – {{max}}% | Frais de plateforme total : {{min}}% – {{max}}% | Amafaranga yose y'urubuga: {{min}}% – {{max}}% |  |  |
| `transparency.whatYoullReceive` |  | What you'll receive | Ce que vous recevrez | Ibyo uzahabwa |  |  |
| `transparency.youWillReceive` |  | You will receive | Vous recevrez | Urakira |  |  |
| `transparency.youWillReceiveExact` |  | You will receive: {{amount}} RWF | Vous recevrez : {{amount}} RWF | Uzahabwa: {{amount}} RWF |  |  |
| `transparency.youWillReceiveRange` |  | You will receive: {{min}} – {{max}} RWF | Vous recevrez : {{min}} – {{max}} RWF | Uzahabwa: {{min}} – {{max}} RWF |  |  |
| `transparency.yourTier` |  | Your tier: {{tier}} ({{rate}}%) | Votre niveau : {{tier}} ({{rate}}%) | Urwego rwawe: {{tier}} ({{rate}}%) |  |  |

## Namespace: `urgent`

> TODO(rw): native review required for the entire 'urgent' + 'priority' namespaces.

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `urgent.badge` |  | URGENT | URGENT | BYIHUSE |  |  |
| `urgent.badgeAriaLabel` |  | Urgent delivery | Livraison urgente | Kohereza byihuse |  |  |
| `urgent.badgeLabel` |  | Urgent | Urgent | Byihuse |  |  |
| `urgent.bannerDescription` |  | +30% premium · target completion within 30 minutes after pickup | +30 % de supplément · objectif d'achèvement dans les 30 minutes après la prise en charge | +30% byongeyeho · intego: kurangiza mu minota 30 nyuma yo gufata |  |  |
| `urgent.bannerTitle` |  | Urgent delivery | Livraison urgente | Kohereza byihuse |  |  |
| `urgent.broadcastNotice` |  | Showing your request to all nearby drivers immediately | Votre demande est immédiatement visible par tous les chauffeurs à proximité | Icyifuzo cyawe gihita kigaragara ku bamotari bose bari hafi |  |  |
| `urgent.descriptionLabel` |  | What is being sent? | Que faut-il envoyer ? | Ni iki uhereza? |  |  |
| `urgent.descriptionPlaceholder` |  | Document, medication, keys… | Document, médicament, clés… | Inyandiko, imiti, imfunguzo… |  |  |
| `urgent.escalationApproaching` |  | Approaching deadline | Approche de l'échéance | Igihe gisabwa kiregereje |  |  |
| `urgent.escalationFresh` |  | Within target window | Dans la fenêtre cible | Mu gihe gisabwa |  |  |
| `urgent.escalationOverdue` |  | Past target window | Hors fenêtre cible | Igihe gisabwa cyararenze |  |  |
| `urgent.fragileLabel` |  | Fragile (handle with care) | Fragile (à manipuler avec précaution) | Bisenyeka (bigomba kwitabwaho) |  |  |
| `urgent.infoCardSpeed` |  | Driver will be asked to prioritise this trip | Le chauffeur sera invité à prioriser ce trajet | Umumotari azasabwa guhita uru rugendo mbere |  |  |
| `urgent.packageSizeLabel` |  | Package size | Taille du colis | Ingano y'ipaki |  |  |
| `urgent.priceHint` |  | Estimated: {{min}}–{{max}} RWF (urgent + vehicle premium included) | Estimation : {{min}}–{{max}} RWF (supplément urgence + véhicule inclus) | Igereranya: {{min}}–{{max}} RWF (harimo umusoro w'ubwihutirwe + ikinyabiziga) |  |  |
| `urgent.priorityBannerDescription` |  | +15% premium · faster broadcast than normal, no SLA window | +15 % de supplément · diffusion plus rapide que la normale, sans fenêtre SLA | +15% byongeyeho · gutangaza byihuse kuruta ibisanzwe, hatari idirishya rya SLA |  |  |
| `urgent.priorityBannerTitle` |  | Priority delivery | Livraison prioritaire | Kohereza by'ibanze |  |  |
| `urgent.priorityBroadcastNotice` |  | Showing your request first as the cascade expands | Votre demande est mise en avant à mesure que la cascade s'étend | Icyifuzo cyawe kigaragara mbere uko cascade yaguka |  |  |
| `urgent.priorityPriceHint` |  | Estimated: {{min}}–{{max}} RWF (priority + vehicle premium included) | Estimation : {{min}}–{{max}} RWF (supplément prioritaire + véhicule inclus) | Igereranya: {{min}}–{{max}} RWF (harimo umusoro w'ibanze + ikinyabiziga) |  |  |
| `urgent.prioritySubmit` |  | Send priority delivery | Envoyer la livraison prioritaire | Ohereza by'ibanze |  |  |
| `urgent.priorityTitle` |  | Priority delivery | Livraison prioritaire | Kohereza by'ibanze |  |  |
| `urgent.recipientLabel` |  | Recipient name | Nom du destinataire | Izina ry'uwakiriye |  |  |
| `urgent.recipientNameRequired` |  | Recipient name is required | Le nom du destinataire est requis | Izina ry'uwakiriye rirakenewe |  |  |
| `urgent.recipientPhoneLabel` |  | Recipient phone | Téléphone du destinataire | Telefoni y'uwakiriye |  |  |
| `urgent.recipientPhonePlaceholder` | same-as-EN: placeholder | +250 7XX XXX XXX | +250 7XX XXX XXX | +250 7XX XXX XXX |  |  |
| `urgent.recipientPhoneRequired` |  | Recipient phone is required | Le téléphone du destinataire est requis | Telefoni y'uwakiriye irakenewe |  |  |
| `urgent.recipientPlaceholder` |  | Who receives the parcel? | Qui reçoit le colis ? | Ninde uzakira ipaki? |  |  |
| `urgent.submit` |  | Send urgent delivery | Envoyer la livraison urgente | Ohereza byihuse |  |  |
| `urgent.targetWindow` |  | Target: 30 min after pickup | Objectif : 30 min après la prise en charge | Intego: iminota 30 nyuma yo gufata |  |  |
| `urgent.tierToggleLabel` |  | Choose tier | Choisir le niveau | Hitamo urwego |  |  |
| `urgent.tierTogglePriority` |  | Priority · 1.15× · faster cascade | Prioritaire · 1,15× · cascade plus rapide | Iby'ibanze · 1.15× · cascade yihuse |  |  |
| `urgent.tierToggleUrgent` |  | Urgent · 1.3× · broadcast immediately | Urgent · 1,3× · diffusé immédiatement | Byihuse · 1.3× · gutangaza ako kanya |  |  |
| `urgent.title` |  | Urgent delivery | Livraison urgente | Kohereza byihuse |  |  |
| `urgent.waitingJustNow` |  | just now | à l'instant | ubu ubu |  |  |
| `urgent.waitingMinutes` |  | waiting {{minutes}}m | en attente {{minutes}} min | ategereje iminota {{minutes}} |  |  |

## Namespace: `vehicle`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `vehicle.any` |  | Any | Tout | Icyo ari cyo cyose |  |  |
| `vehicle.bike` |  | Bicycle | Vélo | Igare |  |  |
| `vehicle.eBike` | same-as-EN: needs-decision | E-Bike | E-Bike | E-Bike |  |  |
| `vehicle.eMoto` | same-as-EN: needs-decision | E-Moto | E-Moto | E-Moto |  |  |
| `vehicle.e_bike` | same-as-EN: needs-decision | E-Bike | E-Bike | E-Bike |  |  |
| `vehicle.e_moto` | same-as-EN: needs-decision | E-Moto | E-Moto | E-Moto |  |  |
| `vehicle.moto` | same-as-EN: needs-decision | Moto | Moto | Moto |  |  |

## Namespace: `vehicleTypeInfo`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `vehicleTypeInfo.any.label` | **NEW** | Any vehicle | Tout véhicule | Ikinyabiziga icyo ari cyo cyose |  |  |
| `vehicleTypeInfo.any.whoCanOffer` | **NEW** | Offers may come from bicycles, motos and e-motos. | Les offres peuvent venir de vélos, de motos et d’e-motos. | Ibiciro bishobora guturuka ku magare, kuri moto no kuri e-moto. |  |  |
| `vehicleTypeInfo.any.youChoose` | **NEW** | You choose from the offers that arrive. | Vous choisissez parmi les offres reçues. | Uhitamo mu biciro byaje. |  |  |
| `vehicleTypeInfo.bike.label` |  | Bicycle | Vélo | Igare |  |  |
| `vehicleTypeInfo.e_bike.label` |  | Electric bicycle | Vélo électrique | Igare ry'amashanyarazi |  |  |
| `vehicleTypeInfo.e_moto.label` |  | Electric motorcycle | Motocyclette électrique | Moto y'amashanyarazi |  |  |
| `vehicleTypeInfo.fareHint.bike` |  | Lower fare (~70% of motorcycle) | Tarif réduit (~70 % du tarif moto) | Igiciro gito (~70% cy'igiciro cya moto) |  |  |
| `vehicleTypeInfo.fareHint.e_bike` |  | Moderate fare (~85% of motorcycle) | Tarif modéré (~85 % du tarif moto) | Igiciro cy'agati (~85% cy'igiciro cya moto) |  |  |
| `vehicleTypeInfo.fareHint.e_moto` |  | Slightly above standard (~105%) | Légèrement au-dessus du standard (~105 %) | Gisumba gato igisanzwe (~105%) |  |  |
| `vehicleTypeInfo.fareHint.moto` |  | Standard fare | Tarif standard | Igiciro gisanzwe |  |  |
| `vehicleTypeInfo.helmetNotRequired` |  | No helmet needed | Pas de casque requis | Ntayo ngofero ikenewe |  |  |
| `vehicleTypeInfo.helmetRequired` |  | Helmet required | Casque requis | Ingofero irakenewe |  |  |
| `vehicleTypeInfo.moto.label` |  | Motorcycle | Motocyclette | Moto |  |  |
| `vehicleTypeInfo.packageSize.medium` |  | Medium packages (up to 15 kg) | Colis moyens (jusqu'à 15 kg) | Ibintu byo hagati (kugeza kg 15) |  |  |
| `vehicleTypeInfo.packageSize.small` |  | Small packages only (under 3 kg) | Petits colis uniquement (moins de 3 kg) | Ibintu bito gusa (munsi ya kg 3) |  |  |
| `vehicleTypeInfo.speedHint` |  | Typical speed: ~{{speed}} km/h | Vitesse typique : ~{{speed}} km/h | Umuvuduko usanzwe: ~{{speed}} km/h |  |  |

## Namespace: `vehicles`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `vehicles.bike` |  | Bicycle Taxi | Vélo Taxi | Igare |  |  |
| `vehicles.bikeRegistrationHint` |  | No documents required for bicycle taxis. You can start accepting rides once your profile is complete. | Aucun document requis pour les vélos-taxis. Vous pouvez commencer à accepter des courses une fois votre profil complété. | Nta nyandiko zisabwa ku bamotari b'amagare. Ushobora gutangira kwakira ingendo iyo umwirondoro wawe urangiye. |  |  |
| `vehicles.ebike` |  | E-Bike Taxi | E-Bike Taxi | Igare ry'amashanyarazi |  |  |
| `vehicles.ebikeRegistrationHint` |  | E-bike taxis are a new category. Helmets are recommended. No additional documents are currently required, but this may change as regulations develop. | Les e-bike taxis sont une nouvelle catégorie. Les casques sont recommandés. Aucun document supplémentaire n'est actuellement requis, mais cela peut changer avec l'évolution de la réglementation. | E-bike tagisi ni icyiciro gishya. Ingofero zirasabwa. Nta nyandiko zindi zisabwa ubu, ariko ibi bishobora guhinduka uko amategeko ahinduka. |  |  |
| `vehicles.emoto` |  | E-Moto Taxi | E-Moto Taxi | Moto y'amashanyarazi |  |  |
| `vehicles.emotoRegistrationHint` |  | E-moto drivers need the same documents as moto drivers: Category A license, RURA authorization, cooperative membership, and insurance. | Les chauffeurs d'e-moto ont besoin des mêmes documents que les chauffeurs de moto : permis catégorie A, autorisation RURA, adhésion à une coopérative et assurance. | Abamotari ba e-moto bakeneye inyandiko zimwe n'abamotari ba moto: Uruhushya rw'icyiciro A, uruhushya rwa RURA, ubunyamuryango bwa koperative, n'ubwishingizi. |  |  |
| `vehicles.moto` |  | Moto Taxi | Moto Taxi | Moto |  |  |
| `vehicles.motoRegistrationHint` |  | Moto-taxi driver requirements: Category A licence, RURA authorization, cooperative membership, and insurance. | Conditions requises pour les chauffeurs de moto-taxi : permis catégorie A, autorisation RURA, adhésion à une coopérative et assurance. | Umumotari akeneye: Uruhushya rwa Categori A, uruhushya rwa RURA, ubunyamuryango bwa koperative, n'ubwishingizi. |  |  |

## Namespace: `verification`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `verification.cooperative` |  | Cooperative Name | Nom de la coopérative | Izina rya koperative |  |  |
| `verification.cooperativeHint` |  | Select your registered moto-taxi cooperative | Sélectionnez votre coopérative de moto-taxi enregistrée | Hitamo koperative yawe y'amapikipiki yanditswe |  |  |
| `verification.dashboardBannerBody` | **NEW** | Add your licence, authorization and insurance so you can be approved. | Ajoutez votre permis, votre autorisation et votre assurance pour être approuvé. | Ongeraho uruhushya rwo gutwara, uburenganzira n'ubwishingizi kugira ngo wemererwe. |  |  |
| `verification.dashboardBannerTitle` | **NEW** | Finish your driver documents | Complétez vos documents de chauffeur | Uzuza impapuro zawe z'umumotari |  |  |
| `verification.driverNumber` |  | Bimoto driver number (jacket number) | Numéro de chauffeur Bimoto (numéro de veste) | Inomero y'umumotari ya Bimoto (inomero y'ikoti) |  |  |
| `verification.driverNumberHint` |  | The number on your Bimoto jacket, e.g. BM-1234 | Le numéro sur votre veste Bimoto, ex. BM-1234 | Inomero iri ku ikoti yawe ya Bimoto, urugero: BM-1234 |  |  |
| `verification.helmetConfirm` |  | Confirm both you and the passenger are wearing helmets (required by law) | Confirmez que vous et le passager portez des casques (obligatoire par la loi) | Emeza ko wowe n'umugenzi mwambaye ingofero (bisabwa n'amategeko) |  |  |
| `verification.helmetStart` |  | Confirm & Start Journey | Confirmer et démarrer le trajet | Emeza utangire urugendo |  |  |
| `verification.insurance` |  | I confirm my vehicle has valid third-party insurance | Je confirme que mon véhicule a une assurance responsabilité civile valide | Nemeza ko ikinyabiziga cyanjye gifite ubwishingizi bwemewe |  |  |
| `verification.iremboHint` |  | Don't have these? Apply at irembo.gov.rw | Vous n'avez pas ces documents ? Faites votre demande sur irembo.gov.rw | Ntufite ibi byangombwa? Bisabe kuri irembo.gov.rw |  |  |
| `verification.licenseNumber` |  | Driving License Number (Category A) | Numéro de permis de conduire (Catégorie A) | Inomero y'uruhushya rwo gutwara (Icyiciro A) |  |  |
| `verification.myDocuments` | **NEW** | My documents | Mes documents | Impapuro zanjye |  |  |
| `verification.ruraNumber` |  | RURA Transport Authorization Number | Numéro d'autorisation de transport RURA | Inomero y'uruhushya rwo gutwara rwa RURA |  |  |
| `verification.statusPending` |  | Verification pending — you can browse rides but cannot accept bids yet | Vérification en attente — vous pouvez parcourir les courses mais ne pouvez pas encore accepter d'offres | Kwemeza bitegereje — ushobora kureba ingendo ariko ntushobora kwemera amaturo |  |  |
| `verification.statusRejected` |  | Verification rejected: {{reason}} | Vérification rejetée : {{reason}} | Kwemeza byanzwe: {{reason}} |  |  |
| `verification.statusReview` |  | Documents under review | Documents en cours d'examen | Inyandiko zirimo gusuzumwa |  |  |
| `verification.statusVerified` |  | Verified! You can now accept ride requests | Vérifié ! Vous pouvez maintenant accepter des demandes de course | Byemejwe! Ubu ushobora kwemera ubusabe bw'ingendo |  |  |
| `verification.title` |  | Driver Verification | Vérification du chauffeur | Kwemeza umumotari |  |  |
| `verification.uploadInsurance` |  | Upload Insurance Document | Télécharger le document d'assurance | Ohereza inyandiko y'ubwishingizi |  |  |
| `verification.uploadLicense` |  | Upload License Photo | Télécharger la photo du permis | Ohereza ifoto y'uruhushya |  |  |
| `verification.uploadRura` |  | Upload RURA Authorization | Télécharger l'autorisation RURA | Ohereza uruhushya rwa RURA |  |  |

## Namespace: `wallet`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `wallet.title` |  | Wallet | Portefeuille | Igikwama |  | Driver's Profile entry to the existing money screen — the team asked for this vocabulary; please confirm Igikwama is the natural term (alternatives: konti, umufuka w'amafaranga) |

## Namespace: `welcome`

| Key | Flags | English | French | Current RW (AI) | Reviewer's RW | Note |
|-----|-------|---------|--------|-----------------|---------------|------|
| `welcome.carouselLabel` |  | Welcome to Bimoto | Bienvenue sur Bimoto | Murakaza neza kuri Bimoto |  |  |
| `welcome.continue` |  | Continue | Continuer | Komeza |  |  |
| `welcome.dotAria` |  | Screen {{n}} | Écran {{n}} | Urupapuro rwa {{n}} |  |  |
| `welcome.dotsLabel` |  | Carousel position | Position du carrousel | Aho uri kuri karuseli |  |  |
| `welcome.languageEn` | same-as-EN: proper-noun | English | English | English |  |  |
| `welcome.languageFr` | same-as-EN: proper-noun | Français | Français | Français |  |  |
| `welcome.languageLabel` |  | Choose your language | Choisissez votre langue | Hitamo ururimi rwawe |  |  |
| `welcome.languageRw` | same-as-EN: proper-noun | Kinyarwanda | Kinyarwanda | Kinyarwanda |  |  |
| `welcome.screen1.body` |  | Bimoto is the transport app that connects drivers, cyclists, passengers, and courier delivery. | Bimoto est l'application de transport qui met en relation chauffeurs, cyclistes, passagers et livraison de colis. | Bimoto ni app ihuza abagenzi, abamotari, abanyonzi, no kohereza imizigo. |  |  |
| `welcome.screen1.heading` |  | Welcome to Bimoto | Bienvenue sur Bimoto | Murakaza neza kuri Bimoto |  |  |
| `welcome.screen1.illustrationAlt` |  | A motorcycle and bicycle on a circle, representing rides across Rwanda | Une moto et un vélo sur un cercle, représentant les trajets à travers le Rwanda | Pikipiki n'igare ku ruziga, bigereranya ingendo mu Rwanda hose |  |  |
| `welcome.screen2.body` |  | You ride with drivers from your cooperative — and cooperative leaders are first-class users of the platform. | Vous voyagez avec des chauffeurs de votre coopérative — et les leaders de coopérative sont des utilisateurs à part entière de la plateforme. | Ugenda n'abamotari bo muri koperative yawe — kandi abayobozi b'amakoperative ni abakoresha bafite uburenganzira bwuzuye kuri iyi porogaramu. |  |  |
| `welcome.screen2.heading` |  | Powered by cooperatives | Propulsé par les coopératives | Bishyirwa mu bikorwa n'amakoperative |  |  |
| `welcome.screen2.illustrationAlt` |  | Three people connected in a triangle, representing the cooperative network | Trois personnes reliées en triangle, représentant le réseau coopératif | Abantu batatu bahujwe mu mpande eshatu, bigereranya urusobe rw'amakoperative |  |  |
| `welcome.screen3.body` |  | Every price is a binding offer from the driver. No surge. No hidden fees. You choose. | Chaque prix est une offre ferme du chauffeur. Pas de surtarif. Pas de frais cachés. À vous de choisir. | Buri giciro ni icyemezo gifite agaciro k'umumotari. Nta kuzamuka. Nta mafaranga ahishe. Wowe uhitamo. |  |  |
| `welcome.screen3.heading` |  | Fixed-price bidding | Enchères à prix fixe | Igiciro gihamye |  |  |
| `welcome.screen3.illustrationAlt` |  | A price tag with a checkmark and three bid offers, representing fixed-price bidding | Une étiquette de prix avec une coche et trois offres, représentant les enchères à prix fixe | Ikarito y'igiciro ifite akamenyetso n'ibyifuzo bitatu, bigereranya igiciro gihamye |  |  |
| `welcome.skip` |  | Skip | Passer | Simbuka |  |  |

---

# `QUICK_MESSAGES` (canned chat phrases)

> **Brevity matters** — these render as buttons on a small mobile screen.
> Prefer the shortest natural rendering.

| ID | forRole | English | French | Current RW (AI) | Reviewer's RW |
|----|---------|---------|--------|-----------------|---------------|
| `qm_on_my_way` | DRIVER | On my way | J'arrive | Ndaje |  |
| `qm_arrived` | DRIVER | I have arrived | Je suis arrivé | Nagezeho |  |
| `qm_waiting` | BOTH | I am waiting | J'attends | Ndategereje |  |
| `qm_where_are_you` | BOTH | Where are you? | Où êtes-vous ? | Uri he? |  |
| `qm_almost_there` | BOTH | Almost there | Presque là | Ndi hafi |  |
| `qm_stuck_traffic` | BOTH | Stuck in traffic | Coincé dans le trafic | Mpagaze mu modoka nyinshi |  |
| `qm_cancel_please` | CUSTOMER | Please cancel the ride | Veuillez annuler la course | Hagarika urugendo |  |
| `qm_thank_you` | BOTH | Thank you | Merci | Urakoze |  |
| `qm_5_minutes` | BOTH | Give me 5 minutes | Donnez-moi 5 minutes | Ndageraho iminota 5 |  |
| `qm_call_me` | BOTH | Call me | Appelez-moi | Mpamagara |  |
| `qm_at_pickup_cust` | CUSTOMER | I'm at the pickup, where are you? | Je suis au point de prise en charge, où êtes-vous ? | Ndi ahantu ho gufata, uri he? |  |
| `qm_late_5min_cust` | CUSTOMER | I'm 5 minutes late myself | Je suis moi-même en retard de 5 minutes | Nanjye nzatinda iminota 5 |  |
| `qm_at_gate_cust` | CUSTOMER | I'm at the gate | Je suis à la porte | Ndi ku irembo |  |
| `qm_floor_2_cust` | CUSTOMER | I'm on the 2nd floor — give me a minute | Je suis au 2e étage — donnez-moi une minute | Ndi ku gorofa ya 2 — mpa umunota |  |
| `qm_floor_3_cust` | CUSTOMER | I'm on the 3rd floor — give me a minute | Je suis au 3e étage — donnez-moi une minute | Ndi ku gorofa ya 3 — mpa umunota |  |
| `qm_are_you_really_coming_cust` | CUSTOMER | Are you really coming? Please respond | Venez-vous vraiment ? Veuillez répondre | Mu by'ukuri uraza? Nyamuneka subiza |  |
| `qm_will_cancel_soon_cust` | CUSTOMER | I will cancel if you don't arrive in 5 minutes | J'annulerai si vous n'arrivez pas dans 5 minutes | Nzahagarika niba utaza mu minota 5 |  |
| `qm_approaching_2min_drv` | DRIVER | Approaching, 2 minutes away | J'approche, à 2 minutes | Ndegera, ngiye kugera mu minota 2 |  |
| `qm_approaching_5min_drv` | DRIVER | Approaching, 5 minutes away | J'approche, à 5 minutes | Ndegera, ngiye kugera mu minota 5 |  |
| `qm_approaching_10min_drv` | DRIVER | Approaching, 10 minutes away | J'approche, à 10 minutes | Ndegera, ngiye kugera mu minota 10 |  |
| `qm_what_wearing_drv` | DRIVER | What are you wearing? It will help me find you | Que portez-vous ? Cela m'aidera à vous trouver | Wambaye iki? Bizamfasha kukubona |  |
| `qm_describe_landmark_drv` | DRIVER | I can't find this address — can you describe a landmark? | Je ne trouve pas cette adresse — pouvez-vous décrire un point de repère ? | Sinshobora kubona iyi aderesi — wasobanura ikimenyetso? |  |
| `qm_cant_make_trip_drv` | DRIVER | Sorry, my vehicle has a problem — I cannot make this trip | Désolé, mon véhicule a un problème — je ne peux pas faire ce trajet | Mbabarira, ikinyabiziga cyanjye gifite ikibazo — sinshobora gukora uru rugendo |  |
| `qm_drive_carefully_cust` | CUSTOMER | Please drive carefully | Veuillez conduire prudemment | Nyamuneka tware witonze |  |
| `qm_drive_slower_cust` | CUSTOMER | Please drive slower | Veuillez conduire plus lentement | Nyamuneka tware buhoro |  |
| `qm_different_route_cust` | CUSTOMER | Can we take a different route? | Pouvons-nous prendre un autre itinéraire ? | Twafata indi nzira? |  |
| `qm_quick_stop_cust` | CUSTOMER | Can we make a quick stop? | Pouvons-nous faire un arrêt rapide ? | Twahagarara akanya gato? |  |
| `qm_are_we_close_cust` | CUSTOMER | Are we close? | Sommes-nous proches ? | Tugiye kugera? |  |
| `qm_away_2min_drv` | DRIVER | 2 minutes away | Dans 2 minutes | Iminota 2 |  |
| `qm_away_5min_drv` | DRIVER | 5 minutes away | Dans 5 minutes | Iminota 5 |  |
| `qm_away_10min_drv` | DRIVER | 10 minutes away | Dans 10 minutes | Iminota 10 |  |
| `qm_traffic_ahead_drv` | DRIVER | There is traffic ahead | Il y a du trafic devant | Hari imodoka nyinshi imbere |  |
| `qm_safe_arrival` | BOTH | Safe arrival, thank you | Arrivée en sécurité, merci | Twageze amahoro, urakoze |  |
| `qm_confirm_in_app_drv` | DRIVER | Please confirm the trip in the app | Veuillez confirmer le trajet dans l'application | Nyamuneka emeza urugendo muri porogaramu |  |
| `qm_sorry_for_delay` | BOTH | Sorry for the delay | Désolé pour le retard | Mbabarira ku gutinda |  |
| `qm_cancel_no_show_cust` | CUSTOMER | I am cancelling because you did not come | J'annule parce que vous n'êtes pas venu | Ndahagaritse kuko utaje |  |
| `qm_cancel_changed_plans_cust` | CUSTOMER | I am cancelling because I changed my plans | J'annule parce que j'ai changé de plans | Ndahagaritse kuko nahinduye gahunda |  |
| `qm_cancel_safety_cust` | CUSTOMER | I am cancelling because of a safety concern | J'annule à cause d'un problème de sécurité | Ndahagaritse kubera ikibazo cy'umutekano |  |
| `qm_will_try_another_cust` | CUSTOMER | I will try another driver | Je vais essayer un autre chauffeur | Nzagerageza undi mushoferi |  |
| `qm_no_hard_feelings` | BOTH | No hard feelings | Sans rancune | Nta kibazo |  |
| `qm_flat_tyre_drv` | DRIVER | I had a flat tyre | J'ai eu un pneu crevé | Mfite ipine yashizemo umuyaga |  |
| `qm_package_ready_cust` | CUSTOMER | The package is ready | Le colis est prêt | Ipaki yiteguye |  |
| `qm_have_package_drv` | DRIVER | I have the package | J'ai le colis | Mfite ipaki |  |
| `qm_package_delivered_drv` | DRIVER | Package delivered | Colis livré | Ipaki yatanzwe |  |
| `qm_recipient_not_answering_drv` | DRIVER | The recipient is not answering | Le destinataire ne répond pas | Uwakira ntiyitabye |  |
| `qm_left_at_door_drv` | DRIVER | I left the package at the door | J'ai laissé le colis à la porte | Nasize ipaki ku muryango |  |
| `qm_help_needed` | BOTH | Help needed | Besoin d'aide | Nkeneye ubufasha |  |
| `qm_medical` | BOTH | Medical emergency | Urgence médicale | Ibyihutirwa by'ubuvuzi |  |
| `qm_police_needed` | BOTH | Police needed | Police nécessaire | Nkeneye polisi |  |
| `qm_drive_too_fast_cust` | CUSTOMER | You are driving too fast | Vous conduisez trop vite | Uratwara umuvuduko cyane |  |
| `qm_please_slow_down_cust` | CUSTOMER | Please slow down | Veuillez ralentir | Nyamuneka gabanya umuvuduko |  |
| `qm_please_stop_now_cust` | CUSTOMER | Please stop now | Veuillez vous arrêter maintenant | Nyamuneka hagarara nonaha |  |
| `qm_no_problem` | BOTH | No problem | Pas de problème | Nta kibazo |  |
| `qm_clothing_red` | CUSTOMER | I'm wearing red | Je porte du rouge | Nambaye umutuku |  |
| `qm_clothing_blue` | CUSTOMER | I'm wearing blue | Je porte du bleu | Nambaye ubururu |  |
| `qm_helmet_please_cust` | CUSTOMER | Please wear a helmet | Veuillez porter un casque | Nyamuneka ambara ingofero |  |
| `qm_helmet_for_passenger_drv` | DRIVER | Helmet ready for you | Casque prêt pour vous | Ingofero iri tegure |  |
| `qm_pedal_pace_drv` | DRIVER | Going at pedalling pace | Je pédale, allure modérée | Ndatambaga buhoro |  |
| `qm_uphill_slow_drv` | DRIVER | Slower on the hill | Plus lent dans la montée | Buhoro ku musozi |  |
| `qm_battery_low_drv` | DRIVER | Battery is low | Batterie faible | Bateri irarangiye |  |
| `qm_child_travelling_with_child` | CUSTOMER | I am travelling with a small child | Je voyage avec un jeune enfant | Ndi kumwe n'umwana muto |  |
| `qm_child_drive_slower` | CUSTOMER | Please drive slower because of the child | Conduisez plus lentement à cause de l'enfant | Twiyumvirira kubera umwana, twibere buhoro |  |
| `qm_child_child_afraid` | CUSTOMER | The child is afraid — please drive even more slowly | L'enfant a peur — roulez encore plus lentement | Umwana arafite ubwoba — wiyumvirira ugende buhoro cyane |  |
| `qm_child_has_helmet` | CUSTOMER | The child has a helmet | L'enfant a un casque | Umwana afite ingofero |  |
| `qm_child_no_helmet` | CUSTOMER | The child does not have a helmet — do you have a small one? | L'enfant n'a pas de casque — en avez-vous un petit ? | Umwana ntafite ingofero — ufite ngufi? |  |
| `qm_child_have_seat` | CUSTOMER | I have a child seat available | J'ai un siège enfant disponible | Mfite intebe y'umwana |  |
| `qm_child_parent_calling` | CUSTOMER | I am a parent calling on behalf of a child passenger | Je suis un parent qui appelle au nom d'un enfant passager | Ndi umubyeyi mbahamagariye umwana |  |
| `qm_child_child_alone` | CUSTOMER | My child is travelling alone, please be careful | Mon enfant voyage seul, soyez prudent | Umwana wanjye ari wenyine — wiyumvirira |  |
| `qm_child_child_picked_up` | DRIVER | The child has been picked up safely | L'enfant a été pris en charge en toute sécurité | Umwana yafashwe neza |  |
| `qm_child_child_delivered` | DRIVER | The child has been delivered safely | L'enfant a été livré en toute sécurité | Umwana yagezweyo amahoro |  |
| `qm_child_speaks_only_rw` | CUSTOMER | The child speaks only Kinyarwanda | L'enfant ne parle que le kinyarwanda | Umwana avuga Ikinyarwanda gusa |  |
| `qm_child_call_parent_on_arrival` | DRIVER | I will call you when I arrive | Je vous appellerai à mon arrivée | Nzaguhamagara naho ngeze |  |
| `qm_safety_confirm_age` | CUSTOMER | I confirm the passenger is over the legal minimum age for a motorcycle | Je confirme que le passager a l'âge légal minimum pour la moto | Nemeza ko umugenzi yujuje imyaka isabwa kuri pikipiki |  |
| `qm_safety_cannot_carry_child` | DRIVER | I am not legally allowed to carry this child on a motorcycle — please request a bicycle or car | Je n'ai pas le droit de transporter cet enfant à moto — demandez un vélo ou une voiture | Nta burenganzira mfite bwo gutwara uyu mwana kuri pikipiki — saba igare cyangwa imodoka |  |
| `qm_safety_helmets_required` | DRIVER | Helmets are required for both passenger and driver — please confirm you have one | Les casques sont obligatoires pour le passager et le conducteur — confirmez en avoir un | Ingofero ni ngombwa ku mugenzi n'umushoferi — emeza ko ifite |  |
| `qm_urgent_recipient_waiting` | DRIVER | The recipient is waiting and ready | Le destinataire attend et est prêt | Uwakira ategereje ari witeguye |  |
| `qm_urgent_recipient_unavailable` | DRIVER | The recipient is not yet available — please wait | Le destinataire n'est pas encore disponible — veuillez attendre | Uwakira ntaraboneka — ategereze |  |
| `qm_urgent_handoff_only` | CUSTOMER | This is a fast handoff — no waiting needed | Ceci est un transfert rapide — pas besoin d'attendre | Iri ni iherekezwa ryihuse — nta gutegereza bisabwa |  |
| `qm_urgent_signature_required` | CUSTOMER | The recipient must sign on delivery | Le destinataire doit signer à la livraison | Uwakira agomba gusinya ku itangwa |  |
| `qm_urgent_sealed_envelope` | CUSTOMER | This envelope is sealed — please do not open | Cette enveloppe est scellée — ne l'ouvrez pas | Iyi nyandiko ifunze — ntimuyifungure |  |
| `qm_urgent_deadline_minutes` | CUSTOMER | I need this delivered within the next 30 minutes | J'ai besoin que ceci soit livré dans les 30 prochaines minutes | Nshaka ko bigezwa mu minota 30 itaha |  |
| `qm_delivery_parcel_handed_off` | DRIVER | I have collected the parcel and am on my way | J'ai récupéré le colis et je suis en route | Nakiriye ifunika ndi munzira |  |
| `qm_delivery_recipient_signed` | DRIVER | The recipient has signed for the parcel | Le destinataire a signé pour le colis | Uwakira yasinye ku ifunika |  |
| `qm_delivery_parcel_delivered` | DRIVER | The parcel has been delivered safely | Le colis a été livré en toute sécurité | Ifunika ryagejejweyo neza |  |
| `qm_delivery_recipient_not_present` | DRIVER | The recipient is not at the address — what should I do? | Le destinataire n'est pas à l'adresse — que dois-je faire? | Uwakira nta hari aha aderesi — nkore iki? |  |
| `qm_delivery_fragile_parcel` | CUSTOMER | This parcel is fragile, please handle with care | Ce colis est fragile, veuillez le manipuler avec soin | Iri funika ryangirika vuba, nyamuneka ribyitwareho neza |  |
| `qm_delivery_fee_paid_already` | CUSTOMER | The recipient has already paid — no payment needed at drop-off | Le destinataire a déjà payé — pas de paiement requis à la livraison | Uwakira yamaze kwishyura — nta kwishyura bikenewe ku gutangwa |  |
| `qm_priority_recipient_can_wait_30min` | CUSTOMER | The recipient can wait 30 minutes | Le destinataire peut attendre 30 minutes | Uwakira ashobora gutegereza iminota 30 |  |
| `qm_priority_signing_optional` | CUSTOMER | A signature would be nice but is not required | Une signature serait appréciée mais n'est pas requise | Umukono wakwemerwa ariko ntiwasabwa |  |
| `qm_priority_drop_at_reception` | CUSTOMER | If no answer, leave it at reception | Sans réponse, laissez-le à la réception | Niba nta gisubizo, sigara ku karangurura |  |
| `qm_priority_call_when_close` | CUSTOMER | Please call me when you are 5 minutes away | Appelez-moi quand vous serez à 5 minutes | Nyamuneka mumpamagare iyo musigaye iminota 5 |  |

_91 messages parsed from `packages/shared/src/constants/quick-messages.ts`._

---

# `KIGALI_LANDMARKS`

> **Note:** many Kigali landmarks (bus stations, hospitals, hotels) have
> established Kinyarwanda renderings in everyday use. Please **validate**
> the current AI rendering against common usage rather than re-creating it.

| English name | Category | French | Current RW (AI) | Reviewer's RW |
|--------------|----------|--------|-----------------|---------------|
| Kigali Heights | business | Kigali Heights | Kigali Heights |  |
| Kigali City Tower | business |  |  |  |
| CHIC Building | business |  |  |  |
| M. Peace Plaza | business |  |  |  |
| MTN Centre | business | Centre MTN | Ikigo cya MTN |  |
| KBC | business |  |  |  |
| Norrsken House Kigali | business |  |  |  |
| Centenary House | business |  |  |  |
| Downtown Building | business |  |  |  |
| Grand Pension Plaza | business |  |  |  |
| Simba Kimironko | business |  |  |  |
| City Plaza | business |  |  |  |
| Kanombe Plaza | business |  |  |  |
| Nyanza Plaza | business |  |  |  |
| Kagugu Plaza | business |  |  |  |
| Simba Gishushu Center | business |  |  |  |
| UTC | business |  |  |  |
| Plaza House Ziniya | business |  |  |  |
| Rubangura Commercial House | business |  |  |  |
| Market Plaza | business |  |  |  |
| Kicukiro Commercial Complex | business |  |  |  |
| Gisozi Commercial Center | business |  |  |  |
| ULK | education |  |  |  |
| IPRC Kigali | education |  |  |  |
| Carnegie Mellon University Africa | education |  |  |  |
| University of Kigali | education |  |  |  |
| Mount Kenya University Rwanda | education |  |  |  |
| Green Hills Academy | education |  |  |  |
| Lycée de Kigali | education |  |  |  |
| College Saint-Andre | education |  |  |  |
| FAWE Girls' School | education |  |  |  |
| African Leadership University | education |  |  |  |
| University of Rwanda - Kigali Campus | education | Université du Rwanda - Campus de Kigali | Kaminuza y'u Rwanda - Campus ya Kigali |  |
| AUCA | education | Université Adventiste d'Afrique Centrale (AUCA) | Kaminuza y'Abadivantiste bo muri Afurika yo Hagati |  |
| University of Rwanda - Remera Campus | education |  |  |  |
| University of Rwanda - Gikondo Campus | education |  |  |  |
| APACOPE | education |  |  |  |
| Kigali Parents' School | education |  |  |  |
| Riviera High School | education |  |  |  |
| Parliament of Rwanda | government |  |  |  |
| Kigali City Hall | government | Hôtel de Ville de Kigali | Urwego rw'Umujyi wa Kigali |  |
| Ministry of Foreign Affairs | government |  |  |  |
| RDB | government | Bureaux du RDB (Office Rwandais de Développement) | Ibiro bya RDB |  |
| Rwanda Revenue Authority | government |  |  |  |
| US Embassy Rwanda | government |  |  |  |
| National Bank of Rwanda | government |  |  |  |
| MINJUST | government |  |  |  |
| Prime Minister's Office | government |  |  |  |
| BRD Building | government |  |  |  |
| CHUK | hospital | Centre Hospitalier Universitaire de Kigali (CHUK) | CHUK |  |
| King Faisal Hospital | hospital | Hôpital King Faisal | Ibitaro bya King Faisal |  |
| Kibagabaga Hospital | hospital | Hôpital de Kibagabaga | Ibitaro bya Kibagabaga |  |
| Kanombe Military Hospital | hospital |  |  |  |
| Hopital ya Muhima | hospital |  |  |  |
| Hopital ya Nyamirambo | hospital |  |  |  |
| Hopital La Croix du Sud | hospital |  |  |  |
| Kacyiru Police Hospital | hospital |  |  |  |
| Masaka Hospital | hospital |  |  |  |
| Dream Medical Center | hospital |  |  |  |
| Legacy Clinics | hospital |  |  |  |
| Baho International Hospital | hospital |  |  |  |
| Mediheal Hospital | hospital |  |  |  |
| Polyclinique du Plateau | hospital |  |  |  |
| Dr. Agarwal's Eye Hospital | hospital |  |  |  |
| WIWO Specialized Hospital | hospital |  |  |  |
| CARAES Ndera Hospital | hospital |  |  |  |
| Inkurunziza Orthopedic Hospital | hospital |  |  |  |
| Polyclinique du Carrefour | hospital |  |  |  |
| Polyfam Clinic | hospital |  |  |  |
| Clinique Medicale Saint-Michel | hospital |  |  |  |
| Kigali Marriott Hotel | hotel | Hôtel Marriott de Kigali | Hoteli Marriott ya Kigali |  |
| Kigali Serena Hotel | hotel | Hôtel Serena de Kigali | Hoteli Serena ya Kigali |  |
| Hôtel des Mille Collines | hotel |  |  |  |
| Ubumwe Grande Hotel | hotel |  |  |  |
| Onomo Hotel | hotel |  |  |  |
| Lemigo Hotel | hotel |  |  |  |
| Grand Legacy Hotel | hotel |  |  |  |
| The Manor Hotel | hotel |  |  |  |
| Heaven Restaurant & Boutique Hotel | hotel |  |  |  |
| Chez Lando Hotel | hotel |  |  |  |
| Five To Five Hotel | hotel |  |  |  |
| Okapi Hotel | hotel |  |  |  |
| 2000 Hotel | hotel |  |  |  |
| Gloria Hotel | hotel |  |  |  |
| City Blue Hotel | hotel |  |  |  |
| Golf Hills Residence | hotel |  |  |  |
| Hilltop Hotel | hotel |  |  |  |
| Green Page Hotel | hotel |  |  |  |
| Radisson Blu Hotel & Convention Centre | hotel | Hôtel Radisson Blu et Centre de Conventions | Hoteli Radisson Blu n'Ikigo cy'inama |  |
| Park Inn by Radisson | hotel |  |  |  |
| The Retreat by Heaven | hotel |  |  |  |
| Gorillas City Centre | hotel |  |  |  |
| Kagarama Heights Hotel | hotel |  |  |  |
| Crown Conference Hotel | hotel |  |  |  |
| Keba Hotel | hotel |  |  |  |
| Airport Grand Hotel | hotel |  |  |  |
| Olympic Hotel | hotel |  |  |  |
| Special Economic Zone | industrial |  |  |  |
| DP World Kigali | industrial |  |  |  |
| Magerwa | industrial |  |  |  |
| Gikondo Industrial Zone | industrial |  |  |  |
| Bralirwa Gikondo Depot | industrial |  |  |  |
| Inyange Industries | industrial |  |  |  |
| Isoko ya Kimironko | market | Marché de Kimironko | Isoko rya Kimironko |  |
| Isoko ya Nyabugogo | market | Marché de Nyabugogo | Isoko rya Nyabugogo |  |
| Isoko ya Nyamirambo | market |  |  |  |
| Isoko ya Kicukiro Centre | market |  |  |  |
| Isoko ya Gikondo | market |  |  |  |
| Isoko ya Gisozi | market |  |  |  |
| Isoko ya Kibagabaga | market |  |  |  |
| Isoko ya Nyarutarama | market |  |  |  |
| Isoko ya Gatenga | market |  |  |  |
| Isoko ya Masaka | market |  |  |  |
| Isoko ya Kagugu | market |  |  |  |
| Isoko ya Kinyinya | market |  |  |  |
| Isoko ya Kimisagara | market |  |  |  |
| Isoko y'I Gahanga | market |  |  |  |
| Isoko y'Umujyi | market |  |  |  |
| Isoko ya Miduha | market |  |  |  |
| Isoko ya Ziniya | market |  |  |  |
| Isoko y'I Gitikinyoni | market |  |  |  |
| Isoko ya Rwezamenyo | market |  |  |  |
| Isoko ya Nyarugunga | market |  |  |  |
| Kigali Genocide Memorial | memorial | Mémorial du Génocide de Kigali | Urwibutso rwa Jenoside rwa Kigali |  |
| Kigali Convention Centre | memorial | Centre de Conventions de Kigali | Ikigo cy'inama cy'i Kigali |  |
| Campaign Against Genocide Museum | memorial |  |  |  |
| Kandt House Museum | memorial |  |  |  |
| Belgian Peacekeepers Memorial | memorial | Mémorial Camp Kigali | Urwibutso rwa Camp Kigali |  |
| Nyanza Genocide Memorial | memorial |  |  |  |
| Inema Arts Center | memorial |  |  |  |
| Niyo Art Gallery | memorial |  |  |  |
| Ivuka Arts Studio | memorial |  |  |  |
| Nyamirambo Women's Center | memorial |  |  |  |
| Kiyovu | neighborhood |  |  |  |
| Nyamirambo | neighborhood | Nyamirambo | Nyamirambo |  |
| Remera | neighborhood | Remera | Remera |  |
| Kimironko | neighborhood |  |  |  |
| Kacyiru | neighborhood | Kacyiru | Kacyiru |  |
| Kimihurura | neighborhood | Kimihurura | Kimihurura |  |
| Gisozi | neighborhood | Gisozi | Gisozi |  |
| Nyarutarama | neighborhood |  |  |  |
| Kibagabaga | neighborhood | Kibagabaga | Kibagabaga |  |
| Gikondo | neighborhood | Gikondo | Gikondo |  |
| Kicukiro | neighborhood | Centre de Kicukiro | Kicukiro |  |
| Kanombe | neighborhood | Kanombe | Kanombe |  |
| Gahanga | neighborhood |  |  |  |
| Masaka | neighborhood |  |  |  |
| Kagugu | neighborhood | Kagugu | Kagugu |  |
| Kinyinya | neighborhood |  |  |  |
| Nyabugogo | neighborhood |  |  |  |
| Kimisagara | neighborhood |  |  |  |
| Ndera | neighborhood |  |  |  |
| Bumbogo | neighborhood |  |  |  |
| Kabuga | neighborhood |  |  |  |
| Rebero | neighborhood |  |  |  |
| Muhima | neighborhood |  |  |  |
| Gatsata | neighborhood | Gatsata | Gatsata |  |
| Kabeza | neighborhood | Kabeza | Kabeza |  |
| Chez Lando | orientation |  |  |  |
| Sonatubes | orientation |  |  |  |
| Giporoso | orientation |  |  |  |
| Gishushu | orientation |  |  |  |
| Prince House | orientation |  |  |  |
| Rwandex | orientation |  |  |  |
| Kinamba | orientation |  |  |  |
| Rubangura | orientation |  |  |  |
| Kwa Mutwe | orientation |  |  |  |
| Onatracom | orientation |  |  |  |
| Chez Rasta | orientation |  |  |  |
| Chez Lando Roundabout | orientation |  |  |  |
| Kimihurura Roundabout | orientation |  |  |  |
| KBC Roundabout | orientation |  |  |  |
| Kagugu Centre | orientation |  |  |  |
| Kinyinya Centre | orientation |  |  |  |
| Gatenga Stop | orientation |  |  |  |
| Kagarama Stop | orientation |  |  |  |
| Gahanga Stop | orientation |  |  |  |
| Kimisagara Maison des Jeunes Stop | orientation |  |  |  |
| Kabuga Centre | orientation |  |  |  |
| Kanombe Military Turnoff | orientation |  |  |  |
| Gisozi Gaposho | orientation |  |  |  |
| Kanogo | orientation |  |  |  |
| Ziniya | orientation |  |  |  |
| Giticyinyoni | orientation |  |  |  |
| KMT | orientation |  |  |  |
| Nyarutarama Top Tower Stop | orientation |  |  |  |
| Gikondo Merez | orientation |  |  |  |
| Kwa Ryenyana | orientation |  |  |  |
| Kwa Jules | orientation |  |  |  |
| Nyabugogo Poids Lourds Turnoff | orientation |  |  |  |
| Rwezamenyo Stop | orientation |  |  |  |
| Gatenga Sonatubes Turnoff | orientation |  |  |  |
| BK Arena | recreation | Kigali Arena | Kigali Arena |  |
| Stade Amahoro | recreation | Stade Amahoro | Sitade y'Amahoro |  |
| Nyandungu Eco-Park | recreation |  |  |  |
| Kigali Pele Stadium | recreation |  |  |  |
| Umusambi Village | recreation |  |  |  |
| Maison des Jeunes Kimisagara | recreation |  |  |  |
| Kigali Golf Resort & Villas | recreation |  |  |  |
| Gahanga International Cricket Stadium | recreation |  |  |  |
| Mont Kigali Hiking Trails & Zipline | recreation |  |  |  |
| Imbuga City Walk | recreation |  |  |  |
| Biryogo Car-Free Food Street | recreation |  |  |  |
| Ekurhuleni Park | recreation |  |  |  |
| Gare ya Nyabugogo | transport | Gare routière de Nyabugogo | Sitasiyo ya Nyabugogo |  |
| Gare y'Umujyi | transport | Parc de bus de Kigali | Pariki ya bisi ya Kigali |  |
| Gare ya Remera | transport | Parc de taxis de Remera | Pariki ya tagisi ya Remera |  |
| Gare ya Kimironko | transport |  |  |  |
| Gare ya Kicukiro | transport |  |  |  |
| Gare ya Kabuga | transport |  |  |  |
| Gare ya Gisozi | transport |  |  |  |
| Kigali International Airport | transport | Aéroport International de Kigali | Ikibuga cy'indege cya Kigali |  |
| Gare ya Nyarutarama | transport |  |  |  |
| Gare ya Bugesera Turnoff | transport |  |  |  |
| Villa Portofino | venue |  |  |  |
| Intare Conference Arena | venue |  |  |  |
| Rebero Cultural Village | venue |  |  |  |
| La Palisse Hotel | venue |  |  |  |
| Kagarama Garden Venues | venue |  |  |  |
| Mount Kigali Gardens | venue |  |  |  |
| Jannah Hotel & Lawns | venue |  |  |  |
| Jalia Hall & Gardens | venue |  |  |  |
| Les Tentes Camp Kigali | venue |  |  |  |
| Intare arena | venue |  |  |  |
| Sainte-Famille | worship |  |  |  |
| Saint-Michel | worship |  |  |  |
| Christian Life Assembly | worship |  |  |  |
| Restoration Church Kimironko | worship |  |  |  |
| EPR Nyarugenge | worship |  |  |  |
| Regina Pacis | worship |  |  |  |
| Zion Temple Celebration Center | worship |  |  |  |
| EPR Remera | worship |  |  |  |
| Eglise Vivante Kicukiro & Kimironko | worship |  |  |  |
| New Life Bible Church | worship |  |  |  |
| Masjid al-Fath | worship |  |  |  |
| Masjid al-Madina | worship |  |  |  |
| Paroisse Saint-Pierre Kacyiru | worship |  |  |  |
| Eglise Catholique Kibagabaga | worship |  |  |  |

_238 landmarks parsed from `packages/shared/src/constants/locations.ts` and `constants/landmarks/`._

---

# Translator guidance carried over from the hand-maintained workbook

> These notes were written by hand between 2026-07-02 and 2026-07-23, when this
> file was maintained by appending dated addenda. The addenda are gone — the
> tables above are regenerated whole — but the tone guidance in them is human
> work and still applies, so it is preserved verbatim in
> `scripts/i18n-review/notes.json` and re-emitted here. Wording such as
> "appended below" refers to the old file, not this one.

### 2026-07-02 — card payment (PR #99)

The 12 `payment.method.*` / `payment.card.*` keys shipped with the
card-payment client work. Like every other row, the Current RW column
is AI-generated and pending native review.

### 2026-07-02 — PAYOUT-C (driver money screen)

The 29 `payout.*` keys and 4 new `errors.*` keys shipped with the driver
money screen. All RW renderings are AI-generated best-effort and pending
native review. Money/time wording matters here — see the glossary for
`amafaranga` / `kwishyurwa` usage.

### 2026-07-03 — GEOCODE (address search)

The 4 `journey.address*` keys shipped with the LocationIQ address-search
work. RW renderings are AI-generated and pending native review.

### 2026-07-08 — DRIVER-ID v3 (jacket numbers)

11 keys shipped with the revocable driver-identity work, all with
AI-generated RW pending native review: `driver.revokedNotice` (the revoked
driver's terminal notice — tone must stay calm and neutral, no accusatory
vocabulary), `driver.jacketNumber`, `errors.vehicleChangeBlocked`, and the 8
`checkDriver.*` keys of the public driver-number check page (`title`,
`subtitle`, `inputLabel`, `inputPlaceholder`, `submit`, `active`,
`inactive`, `error`). The `checkDriver.inactive` line is the uniform public
negative — it must not imply wrongdoing, only non-activity.

### 2026-07-23 — SCHED-UI (advance booking)

The 26 `scheduled.*` keys, 4 new `errors.scheduledFor*` keys,
`nav.scheduled`, and `journey.status.scheduled` shipped with the
advance-booking UI. All RW renderings are AI-generated and pending native
review. Time/fallback wording matters: the customer reassurance lines
(`scheduled.waitingNote`, `scheduled.fallbackNote`) must read as calm
statements that waiting is normal, not as warnings.

### 2026-07-23 — BIKE-GATE (vehicle-aware verification)

2 `verification.*` keys shipped with the vehicle-aware driver-verification
work: `verification.driverNumber` (the person identifier label shown to
drivers whose vehicle type needs no RURA authorization — it names the
Bimoto jacket number, not a government permit; keep the RURA/jacket
distinction clear) and `verification.driverNumberHint`. RW renderings are
AI-generated and pending native review.

### 2026-07-23 — PILOT-UX G4 (completeness sweep)

A systematic extractor (now a permanent vitest:
`packages/client/src/__tests__/i18n-used-keys.test.ts`) diffed every
translation key used in `packages/client/src` against the locale files and
found **262 keys used by live screens but present in no locale** — these
rendered as raw key strings on the pilot phone (`journey.findDrivers`,
`profile.title`, the whole driver ride flow, the confirm/rating flow,
etc.). All 262 are now supplied in en/fr/rw. Every RW rendering is
AI-generated best-effort and pending native review. Tone notes:
`emergency.*` / `interrupt.*` must stay calm and factual; `status.*` are
short badge labels; `bid.*` / `bids.*` money wording should follow the
glossary's `igiciro`/`amafaranga` usage.

### 2026-08-15 — TRUE-WORDS (the team's 13-Aug wording review)

The team's own correction document ("APP TRANSLATED WORDING CORRECTIONS", 13 Aug) was applied across the app. It reviewed build 5226c5c; every row was reconciled against HEAD first and the result is in `docs/wording-reconciliation.md` — 84 rows applied, 24 already applied, 5 drifted (reported, not applied), 2 split, 4 with no live target.

Three things a reviewer should know before working the queue below.

1. **Provenance is in the note column.** Rows marked "verbatim from the review" carry the team's own Kinyarwanda and need a transcription check, not a translation check — the source PDF split words across lines. Rows marked "mechanical vocabulary sweep" changed only because Umushoferi became Umumotari, so the question is noun class and agreement, not word choice.

2. **The paired form needs a decision.** Where the review addresses both a moto rider and a cyclist it writes "umumotari/umunyonzi". That is faithful to the document, but a slash in a button label is a UX cost. If the app should pick one word from the journey's vehicle type instead, say so and it becomes two keys.

3. **French moved too, mechanically.** 55 French values changed in the same pass: the decided role words (Chauffeur / Cycliste / Passager, with "conducteur" and the Kinyarwanda "motari" retired from French copy), "Écrivez ici" for the two faded hints, "séquestre" retired with escrow, and fresh French for the keys whose meaning changed. This generator only queues Kinyarwanda, so the French list lives in `docs/wording-reconciliation.md` §9 and wants a French speaker on the next pass.

### 2026-08-15 — RED-BUTTON (the motari's SOS)

The driver now carries the same red SOS button as the passenger, on his approach and active-ride screens. No new keys were needed — `emergency.*` was already written role-neutrally ("your contacts", "Bimoto"), and it now reads correctly for either person because the server resolves whose contacts to call from who is calling.

One string changed and wants a native eye: **`guide.sos.body`** gained a closing sentence in all three locales, stating that motari and passenger each have the same button and that it alerts the presser's own contacts. Two things to check in the Kinyarwanda:

1. **The reflexive is load-bearing.** "abantu we ubwe yashyizeho" has to land as *that person's own* contacts, not *your* contacts — the whole point of the sentence is that the two lists never cross. If a cleaner construction says it better, take it.

2. **`Umumotari` follows TRUE-WORDS.** The sentence uses the decided role words (Umumotari / umugenzi); it does not use the paired "umumotari/umunyonzi" form, whose open question is unchanged by this work.

The French sentence is likewise AI-drafted and wants the French pass tracked in `docs/wording-reconciliation.md` §9.

### 2026-08-15 — OUTBOX (booking with no signal)

The 17 `outbox.*` keys shipped with the offline booking outbox. All
RW and FR renderings are AI-generated best-effort and pending native
review. Tone matters more than literal fidelity here: every one of
these strings is read by somebody who has just discovered they have no
connection, and the whole point of the feature is that this is NOT a
failure. `outbox.savedTitle` / `outbox.savedBody` must read as a calm
statement of fact ('it is here, it will go'), never as an apology or a
warning. `outbox.cancel` is the passenger taking their own booking
back, not the system cancelling on them — the verb should not imply
refusal. `outbox.rejectedGeneric` is the opposite case and must stay
neutral: the server said no, and the copy must not guess why.

### 2026-08-15 — RED-BUTTON banner truth (driver-raised alerts)

3 new `emergency.*` keys shipped with the admin banner's raisedBy
branch: `adminBannerTitleDriver`, `adminDriverPhone`, `adminPlate`. RW and
FR are AI-generated and pending native review. This is life-safety copy
read by an ops operator at speed: `adminBannerTitleDriver` must be
instantly distinguishable from the existing passenger title at a glance,
so the two should differ in their FIRST content word, not only in a
trailing noun. Use the same word for the rider the rest of the app uses
(see the glossary on umumotari/umugenzi) — an operator who has to work
out which of two similar words means the driver has already lost the
seconds this banner exists to save.

### 2026-08-16 — FLIGHT-RECORDER (consented diagnostics upload)

6 keys shipped with the automatic error-report upload, RW and FR
AI-generated and pending native review: `legal.diagnosticsConsent` (the
signup consent paragraph), `settings.diagnosticsUpload` +
`settings.diagnosticsUploadHelp` (the off switch), `common.on` /
`common.off`, and a rewritten `diagnostics.sendConsent`.

This is CONSENT copy, so accuracy outranks fluency: the paragraph must
say that reports are sent automatically, that phone numbers and sign-in
codes are removed before anything is stored, that messages, trips and
location are never included, and that Settings can switch it off. If a
natural Kinyarwanda rendering would soften or drop any of those four
facts, keep the fact and flag the wording — a consent line that reads
well and promises less than the code does is the one failure mode that
matters here.

`diagnostics.sendConsent` previously ended "Nothing is sent until you tap
Send report", which is no longer true; the replacement must not be
translated from the old sentence. `common.on`/`common.off` label a
two-button switch on a small screen — prefer the shortest natural pair
that still reads as on/off rather than as open/closed.

### 2026-08-16 — FLIGHT-RECORDER G5 (SOS guard + the e-bike filter)

3 keys, RW and FR AI-generated and pending native review.

`emergency.holdHint` is read ALOUD by a screen reader and by nobody
else — it never appears on screen. It must say two things without
ambiguity: that a pointer press must be held, and that a keyboard or
assistive user presses Enter instead and does not have to hold anything.
If only one of those survives translation, keep the second: a person who
cannot hold the button is the person this line exists for.

`emergency.cancelSend` is the label on the single large button shown
while a three-second countdown runs before the alert goes to Bimoto. It
carries `{{seconds}}` and must read as BOTH a statement and an
instruction — what is about to happen, and that tapping stops it. This
is read by someone who may be frightened or may have pressed by mistake,
so plainness beats politeness, and the cancel meaning must not be softer
than the sending meaning. Note 112 is never behind this delay; the copy
should not imply that any help is being withheld for three seconds.

`autoBid.vehicleEbike` is a filter chip next to `vehicleBike` and
`vehicleEmoto`. It must be distinguishable from BOTH at a glance on a
small screen — check the RW rendering against `vehicleBike` (igare) and
`vehicleEmoto` in particular, since an e-bike driver picking the wrong
chip writes a rule that can never fire.

### 2026-08-16 — INTEL-DECK (mobility reading room)

The 49 `intel.*` keys shipped with the analyst intelligence surface: the
hex density map, the origin-destination flow table, the CSV/JSONL export
and the admin-only pipeline panel. All RW and FR renderings are
AI-generated best-effort and pending native review. Vocabulary notes:
`akazu`/`utuzu` is used for the hexagonal grid cell (a made-up sense of an
everyday word — a native reviewer should say whether a clearer term
exists); "k-anonymised" is deliberately left as a borrowed technical term
rather than translated; and the privacy lines noted under the `intel`
namespace matter more than literal fidelity.

### 2026-08-17 — LOOSE-ENDS (the emergency system learns "parcel")

4 keys shipped so the emergency surfaces stop calling a parcel run a
ride: `emergency.alertReceivedParcel` (the in-journey toast),
`emergency.adminBannerTitleSender` and
`emergency.adminBannerTitleDriverParcel` (the admin banner titles), and
`emergency.adminSenderPhone` (the customer's phone label when he is a
sender rather than a passenger). RW and FR are AI-generated and pending
native review.

The RW vocabulary needs a native decision on ONE thing: how a parcel
sender is named. The glossary lists "sender (goods)" as the
translator's call and it was not user-facing until now; these keys use
`uwohereza umuzigo` ("the one who sends the parcel"), built on the
locked `umuzigo` from the parcel flow. If a shorter or more natural
noun exists, it should replace this everywhere the four keys use it —
and also in the hardcoded bilingual SMS bodies in
`packages/server/src/routes/journey.routes.ts` (the emergency endpoint),
which carry the same phrase and are NOT locale keys. `Atwaye umuzigo`
("he is carrying a parcel") and `mu gutwara umuzigo` ("while carrying
the parcel") live there too.

Tone is the whole job on these lines: they are read by a family member
or by an ops operator during an emergency, so they must say who is in
trouble and what he was doing, plainly, with no softening. A sender is
NOT on the bike — that distinction is the reason these keys exist, and
it must survive translation.

### 2026-08-25 — COUNTER-READY (the counter-offer, and the walk-away)

35 keys shipped in this wave and 2 retired, across five namespaces.
RW and FR are AI-generated and pending native review as usual, but two
groups carry more weight than the rest and should be reviewed even if
the others wait.

THE COUNTER STRINGS ARE NOT YET LIVE. The whole counter-offer feature
ships DORMANT behind a server switch (COUNTER_BID_ENABLED) and the
founder turns it on only after several weeks of plain bidding have
produced a baseline. So `bids.suggestPrice`, `bids.counter*`,
`bid.counter*`, `notify.bidCountered/counterAccepted/counterDeclined`
and `errors.counter*` will render for nobody until then — which is a
gift, not a problem: there is real time to get the wording right
before a single passenger reads it.

(1) TWO SENTENCES MUST NOT DRIFT, in any language, because each one
corrects a false reading the screen would otherwise invite.
`bids.counterDeclinedState` ("Your price was not accepted. This offer
still stands at {{price}} RWF.") and `notify.counterDeclined` are read
by a passenger who has just been told no. The motari's offer is STILL
LIVE at his own price and she can still accept it — the bid never left
PENDING. A rendering that lands as "this offer is gone" has told her
something false and will cost her a ride she could have had. Its mirror
is `bid.counterDeclineNote` ("If you decline, your offer of {{price}}
RWF stays on their screen."), read by the motari with his thumb over
the decline button: it must not land as "give up this ride".

(2) `bids.counterOnce` ("You can suggest a price once per offer.") is
the one-shot rule, said BEFORE it is spent. There is no way back to
that entry — she gets one number per offer, ever — so this must read
as a plain fact she can act on, not as a warning and not as a
restriction being apologised for.

THE WITHDRAW STRINGS (`bidList.withdraw*`) ARE LIVE IN APK 14 and are
read by a passenger walking away from a request she made minutes ago.
`bidList.withdrawConfirmBody` must be honest in both halves: her
request closes AND the offers on it end, and she can book again
whenever she likes. `bidList.withdrawKeep` ("Keep waiting") is the
safe half of a two-button choice and should read as the calm option,
never as a nag.

RETIRED: `account.deleteConfirm` and `account.deleteButton` are gone.
They rendered nowhere and had been FALSE since the 72-hour deletion
window shipped — "this cannot be undone" is not what account deletion
does any more. The live `map.offline.deleteConfirm` and
`map.offline.deleteConfirmNamed` keys are a different namespace and are
untouched.
