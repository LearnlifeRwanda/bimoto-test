# Kinyarwanda native-review queue

> **This file is generated** by `pnpm i18n:review` from the same locale files
> as the full workbook (`docs/i18n-rw-review.md`), so the two can never disagree.
> Do not edit it by hand. Notes belong in `scripts/i18n-review/notes.json`.

> **Process:** a native reviewer works top-down, edits
> `packages/client/public/locales/rw/translation.json` directly, then runs
> `pnpm i18n:review:baseline && pnpm i18n:review` in the same commit to move
> the baseline forward and clear the reviewed rows from this queue.
>
> Glossary and tone rules: `docs/i18n-glossary.md`, `docs/i18n-translator-brief.md`.

## Standing truth

All 1615 Kinyarwanda strings are AI-generated. None has been signed off by a native speaker, so the honest work list is the full workbook (`docs/i18n-rw-review.md`). This queue narrows that to what changed and what a human explicitly flagged.

_Generated 2026-08-26 at commit `b2a2fe0`; sources digest `ed3dd35963f2173d`._

## Outstanding

### New since the review baseline `e28cd92` (592)

PILOT-READY (#136), 2026-07-28 — the last commit that changed English source text; every key added after it is still unseen by a native reviewer.

| Key | EN | Current RW (AI) | Note |
| --- | -- | --------------- | ---- |
| `activeJourney.inProgressDelivery` | Delivery in progress | Kohereza birakomeje |  |
| `activeJourney.inProgressRide` | Ride in progress | Urugendo rurakomeje |  |
| `activeJourney.matchedCustomer` | Driver on the way | Umumotari ari mu nzira |  |
| `activeJourney.matchedDriver` | Matched — head to the pickup | Wabonye urugendo — jya aho bagutegereje |  |
| `activeJourney.resume` | Tap to return | Kanda usubireyo |  |
| `activeJourney.titleDelivery` | Active delivery | Kohereza birimo gukorwa |  |
| `activeJourney.titleRide` | Active ride | Urugendo rurimo gukorwa |  |
| `activeJourney.waitingForOffers` | Waiting for offers | Gutegereza ibiciro |  |
| `appLock.call112` | Call 112 | Hamagara 112 |  |
| `appLock.chooseCode` | Choose a code of at least {{min}} digits | Hitamo kode y'imibare itari munsi ya {{min}} |  |
| `appLock.confirmCode` | Enter the same code again | Ongera wandike iyo kode imwe |  |
| `appLock.disableCta` | Turn off app lock | Hagarika urufunguzo |  |
| `appLock.disabled` | App lock is off. | Urufunguzo rwahagaritswe. |  |
| `appLock.enableCta` | Turn on app lock | Fungura urufunguzo |  |
| `appLock.enabled` | App lock is on. It will ask next time you open the app. | Urufunguzo rurakora. Ruzasabwa ubutaha ufunguye porogaramu. |  |
| `appLock.enterCodeToDisable` | Enter your app code | Andika kode ya porogaramu |  |
| `appLock.forgotHelp` | Forgot your code? Log out and log back in with an SMS code. Logging out removes the app lock. | Wibagiwe kode? Sohoka wongere winjire ukoresheje kode ya SMS. Gusohoka bikuraho urufunguzo rwa porogaramu. |  |
| `appLock.formatHelp` | At least {{min}} digits — longer than your 4-digit money PIN, so the two can never be the same. | Nibura imibare {{min}} — ndende kurusha kode y'amafaranga y'imibare 4, kugira ngo zitigere zisa. |  |
| `appLock.logoutCta` | Log out | Sohoka |  |
| `appLock.mismatch` | Those did not match. Start again. | Ntabwo zihuye. Ongera utangire. |  |
| `appLock.padLabel` | App lock keypad | Ahanditse kode ya porogaramu |  |
| `appLock.recommendDriver` | If you sometimes hand your phone to other people, an app lock is worth turning on. | Niba rimwe na rimwe uha abandi telefone yawe, urufunguzo rwa porogaramu rufite akamaro. |  |
| `appLock.rejectMoneyPinLength` | That is 4 digits, which is a money PIN. Your app code needs at least {{min}}, so you can never mix the two up. | Iyo ni imibare 4, ni kode y'amafaranga. Kode ya porogaramu isaba nibura imibare {{min}}, kugira ngo utazivanga. |  |
| `appLock.rejectNotDigits` | Digits only. | Imibare gusa. |  |
| `appLock.rejectTooShort` | Too short. Use at least {{min}} digits. | Ni ngufi cyane. Koresha nibura imibare {{min}}. |  |
| `appLock.settingsHelp` | Lock the whole app behind a code of your own. Off unless you turn it on. Calling 112 always works, locked or not. | Funga porogaramu yose ukoresheje kode yawe bwite. Ntikora keretse uyifunguye. Guhamagara 112 bihora bikora, ifunze cyangwa ifunguye. |  |
| `appLock.settingsTitle` | App lock | Urufunguzo rwa porogaramu |  |
| `appLock.sosOnRide` | You have a ride in progress. You can still raise an alert. | Ufite urugendo rukomeje. Uracyashobora gutabaza. |  |
| `appLock.subtitle` | This phone is locked. | Iyi telefone irafunze. |  |
| `appLock.timeoutHelp` | By default the app only locks when you restart it. You can also have it lock after you have been away for a while. | Muri rusange porogaramu ifunga gusa iyo wongeye kuyifungura. Ushobora no gutuma ifunga numara igihe utayikoresha. |  |
| `appLock.timeoutLabel` | Also lock after being away | Nanone ifunge numara igihe utayikoresha |  |
| `appLock.timeoutMinutes` | {{count}} min | Iminota {{count}} |  |
| `appLock.timeoutOff` | Only on restart | Iyo wongeye gufungura gusa |  |
| `appLock.title` | Enter your app code | Andika kode ya porogaramu |  |
| `appLock.unlock` | Unlock | Fungura |  |
| `appLock.wrongCode` | Wrong code. Try again. | Kode ntiyemewe. Ongera ugerageze. |  |
| `approach.paymentConfirmed` | Fare paid — this ride is covered. | Ikiguzi cyishyuwe — uru rugendo rwishyuwe. |  |
| `approach.paymentSettling` | Fare not confirmed yet. Keep going — if it is not paid within {{minutes}} minutes, we release you and tell you here. | Ikiguzi ntikiremezwa. Komeza — nikidashyurwa mu minota {{minutes}}, turagufungura tukakubwira hano. |  |
| `autoBid.addRule` | Write a rule | Andika itegeko |  |
| `autoBid.amountFlatLabel` | Your price | Igiciro cyawe |  |
| `autoBid.amountHelp` | Between {{min}} and {{max}}. | Hagati ya {{min}} na {{max}}. |  |
| `autoBid.amountModeLabel` | What do you bid? | Utanga igiciro ki? |  |
| `autoBid.amountPercentLabel` | Percent of the fair price | Ijanisha ry'igiciro gikwiye |  |
| `autoBid.atCap` | You have all {{max}} rules. Delete one to write another. | Ufite amategeko {{max}} yose. Siba rimwe kugira ngo wandike irindi. |  |
| `autoBid.capNote` | You are using {{used}} of {{max}} rules. | Ukoresha amategeko {{used}} kuri {{max}}. |  |
| `autoBid.deleteRule` | Delete this rule | Siba iri tegeko |  |
| `autoBid.enabledLabel` | Rule status when saved | Uko itegeko rizaba rimeze igihe ribitswe |  |
| `autoBid.entryHint` | Write your rules now. They stay off until Bimoto turns this on. | Andika amategeko yawe ubu. Ntazakora kugeza Bimoto ibikoresheje. |  |
| `autoBid.entryLabel` | Set up automatic bidding | Shyiraho gutanga igiciro byikora |  |
| `autoBid.intro` | A rule tells Bimoto which jobs you would take and what you would charge, so a bid can go out without you touching the phone. | Itegeko ribwira Bimoto ingendo wakwakira n'igiciro wasaba, kugira ngo igiciro gitangwe utakoze kuri telefone. |  |
| `autoBid.maxPickupHelp` | Up to {{max}} km. | Kugeza kuri km {{max}}. |  |
| `autoBid.maxPickupLabel` | How far will you go to collect? | Ugenda kure kangahe kugira ngo ufate umukiriya? |  |
| `autoBid.maxRideHelp` | Up to {{max}} km from pickup to destination. | Kugeza kuri km {{max}} uhereye aho ufatira ukageza aho ugana. |  |
| `autoBid.maxRideLabel` | How long a job will you take? | Urugendo rungana iki wakwakira? |  |
| `autoBid.modeFlat` | A fixed price | Igiciro gihoraho |  |
| `autoBid.modePercent` | A share of the fair price | Igice cy'igiciro gikwiye |  |
| `autoBid.newRule` | New rule | Itegeko rishya |  |
| `autoBid.noRules` | You have not written any rules yet. | Nta tegeko urandika kugeza ubu. |  |
| `autoBid.offBody` | You can write your rules and they are saved. Nothing bids on your behalf until Bimoto turns this on — every job still needs you to bid yourself. | Ushobora kwandika amategeko yawe akabikwa. Nta kintu na kimwe gitanga igiciro mu izina ryawe kugeza Bimoto ibikoresheje — buri rugendo rugusaba gutanga igiciro wowe ubwawe. |  |
| `autoBid.offTitle` | Automatic bidding is off during the pilot. | Gutanga igiciro byikora ntibikora muri iki gihe cy’igerageza. |  |
| `autoBid.pauseAll` | Pause all my rules | Hagarika amategeko yanjye yose |  |
| `autoBid.resumeAll` | Turn all my rules back on | Subiza amategeko yanjye yose |  |
| `autoBid.resumeAllBlocked` | Available once Bimoto turns automatic bidding on. | Bizaboneka Bimoto nimara gukoresha gutanga igiciro byikora. |  |
| `autoBid.ruleOrder` | Rule {{n}} | Itegeko {{n}} |  |
| `autoBid.saveRule` | Save rule | Bika itegeko |  |
| `autoBid.stateActive` | Active | Rirakora |  |
| `autoBid.stateWaiting` | Saved, not active | Ryabitswe, ntirikora |  |
| `autoBid.summaryDistances` | Up to {{pickupKm}} km to collect, jobs up to {{rideKm}} km. | Kugeza km {{pickupKm}} kugira ngo ufate, ingendo kugeza km {{rideKm}}. |  |
| `autoBid.summaryFlat` | Bids {{amount}} RWF. | Itanga {{amount}} RWF. |  |
| `autoBid.summaryPercent` | Bids {{percent}}% of the fair price. | Itanga {{percent}}% by'igiciro gikwiye. |  |
| `autoBid.summaryVehicle` | Machine: {{vehicle}}. | Ikinyabiziga: {{vehicle}}. |  |
| `autoBid.title` | Automatic bidding | Gutanga igiciro byikora |  |
| `autoBid.vehicleAny` | Any machine | Ikinyabiziga icyo ari cyo cyose |  |
| `autoBid.vehicleBike` | Bicycle | Igare |  |
| `autoBid.vehicleEbike` | Electric bicycle | Igare ry'amashanyarazi |  |
| `autoBid.vehicleEmoto` | Electric moto | Moto y'amashanyarazi |  |
| `autoBid.vehicleLabel` | Which jobs? | Ingendo zihe? |  |
| `autoBid.vehicleMoto` | Moto | Moto |  |
| `bid.counterAcceptButton` | Accept price | Emera igiciro |  |
| `bid.counterAccepted` | Price accepted — the ride is yours | Igiciro cyemewe — urugendo ni urwawe |  |
| `bid.counterDeclineButton` | Keep my price | Guma ku giciro cyanjye |  |
| `bid.counterDeclineNote` | If you decline, your offer of {{price}} RWF stays on their screen. | Nutemera, igiciro cyawe cya {{price}} RWF kiguma ku kigaragaza cyabo. |  |
| `bid.counterDeclined` | Your offer stands at your own price | Igiciro cyawe kiracyahari nk’uko wagitanze |  |
| `bid.counterTheirPrice` | They suggest {{amount}} RWF | Basaba {{amount}} RWF |  |
| `bid.counterTitle` | A different price was suggested | Hatanzwe ikindi giciro |  |
| `bid.counterYourPrice` | Your offer: {{price}} RWF | Igiciro watanze: {{price}} RWF |  |
| `bidList.request.offersBody` | {{count}} so far. Take one, or wait for more. | {{count}} kugeza ubu. Hitamo kimwe, cyangwa utegereze ibindi. |  |
| `bidList.request.offersTitle` | Offers have arrived | Ibiciro byaje |  |
| `bidList.request.sentBody` | Drivers nearby are being asked now. Offers appear here on their own. | Abamotari bari hafi barabazwa ubu. Ibiciro bizigaragaza hano ubwabyo. |  |
| `bidList.request.sentTitle` | Request sent — waiting for offers | Icyifuzo cyoherejwe — gutegereza ibiciro |  |
| `bidList.request.sentToast` | Request sent — we are asking drivers now | Icyifuzo cyoherejwe — turimo kubaza abamotari |  |
| `bidList.state.expiredBody` | No driver took this ride in time. You can ask again — it only takes a moment. | Nta motari wafashe uru rugendo ku gihe. Ushobora kongera gusaba — ni akanya gato. |  |
| `bidList.state.expiredTitle` | This request is closed | Ubu busabe bwarafunzwe |  |
| `bidList.state.fetching` | Looking for offers… | Turashakisha ibiciro… |  |
| `bidList.state.liveHint` | Offers appear here instantly — you don't need to refresh. | Igiciro kigaragara aha. Nta mpamvu yo gusubira inyuma. |  |
| `bidList.state.offlineBody` | Your phone can't reach Bimoto right now. Offers already sent are safe; this page will fill in as soon as the connection is back. | Telefoni yawe ntiribashije kugera kuri Bimoto ubu. Ibiciro byamaze koherezwa birakomeza kubaho; uru rupapuro ruzuzura umurandasi nugaruka. |  |
| `bidList.state.offlineTitle` | Connection lost — still trying | Umurandasi wacitse — turacyagerageza |  |
| `bidList.state.requestAgain` | Request a ride again | Ongera usabe urugendo |  |
| `bidList.withdraw` | Withdraw my request | Kuraho icyifuzo cyanjye |  |
| `bidList.withdrawConfirm` | Yes, withdraw | Yego, kuraho |  |
| `bidList.withdrawConfirmBody` | Your request will be closed and any offers on it will end. You can book again at any time. | Icyifuzo cyawe kizafungwa kandi ibiciro byatanzwe bizarangira. Ushobora kongera gusaba igihe icyo ari cyo cyose. |  |
| `bidList.withdrawConfirmTitle` | Withdraw this request? | Kuraho iki cyifuzo? |  |
| `bidList.withdrawKeep` | Keep waiting | Komeza gutegereza |  |
| `bidList.withdrawn` | Your request was withdrawn | Icyifuzo cyawe cyavanyweho |  |
| `bids.anyVehicleWaiting` | Offers can come from bicycles, motos and e-motos. | Ibiciro bishobora guturuka ku magare, kuri moto no kuri e-moto. |  |
| `bids.cheapestOfKind` | Cheapest here | Gihendutse hano |  |
| `bids.counterDeclinedState` | Your price was not accepted. This offer still stands at {{price}} RWF. | Igiciro cyawe nticyemewe. Iki giciro kiracyari {{price}} RWF. |  |
| `bids.counterEqualsPrice` | That is the price already offered. | Icyo ni cyo giciro cyari cyatanzwe. |  |
| `bids.counterIntro` | {{driver}} offered {{price}} RWF. What would you like to pay? | {{driver}} yatanze {{price}} RWF. Wifuza kwishyura angahe? |  |
| `bids.counterLabel` | Your price (RWF) | Igiciro cyawe (RWF) |  |
| `bids.counterLapsedState` | This offer expired before your price was answered. | Iki giciro cyarangiye igihe mbere y’uko igiciro cyawe gisubizwa. |  |
| `bids.counterOnce` | You can suggest a price once per offer. | Ushobora gusaba igiciro rimwe gusa kuri buri giciro cyatanzwe. |  |
| `bids.counterOutOfBounds` | Enter a price between {{min}} and {{max}} RWF. | Andika igiciro kiri hagati ya {{min}} na {{max}} RWF. |  |
| `bids.counterPendingState` | You suggested {{amount}} RWF — waiting for an answer | Wasabye {{amount}} RWF — utegereje igisubizo |  |
| `bids.counterSend` | Send | Ohereza |  |
| `bids.counterSent` | Your price was sent to the driver | Igiciro cyawe cyoherejwe umushoferi |  |
| `bids.decline` | Decline | Wanga |  |
| `bids.declineConfirm` | Decline this offer? Your request stays open and the other offers stay live. | Wanga iki cyifuzo? Icyifuzo cyawe gikomeza gufunguye, n’ibindi byifuzo bigakomeza. |  |
| `bids.declined` | Offer declined. | Icyifuzo cyanzwe. |  |
| `bids.sectionHeader` | {{vehicle}} · {{count}} offer | {{vehicle}} · igiciro {{count}} |  |
| `bids.sectionHeader_other` | {{vehicle}} · {{count}} offers | {{vehicle}} · ibiciro {{count}} |  |
| `bids.suggestPrice` | Suggest another price | Saba ikindi giciro |  |
| `bids.yourBidAccepted` | Your offer was accepted — the passenger is waiting | Igiciro wasabye cyemewe — umugenzi arakutegereje |  |
| `bids.yourBidDeclined` | The passenger did not take this offer | Umugenzi ntiyemeye iki cyifuzo |  |
| `childTravel.blockedByParcel` | You're sending a package on this ride — book a separate ride to travel with a child. | Uri kohereza ipaki kuri uru rugendo — saba urundi rugendo niba ugenda n'umwana. |  |
| `childTravel.noticeToDriver` | The passenger is travelling with a child. | Umugenzi ari kugendana n'umwana. |  |
| `childTravel.toggle` | Travelling with a child? | Uri kugendana n'umwana? |  |
| `childTravel.toggleHelper` | Tick this and the driver sees it before accepting, so they know a child is coming. | Nushyiraho aka kamenyetso, umumotari arakabona mbere yo kwemera, akamenya ko hari umwana ugiye kugenda. |  |
| `common.off` | Off | Birafunze |  |
| `common.on` | On | Birafunguye |  |
| `common.refresh` | Refresh | Ongera ufungure |  |
| `confirmArrival.confirm` | Confirm arrival | Emeza ko wageze |  |
| `confirmArrival.done` | Arrival confirmed. Thank you. | Kugera kwemejwe. Murakoze. |  |
| `confirmArrival.fallback` | If you do not, it confirms itself after 2 hours and your motari is paid either way. | Nutabikora, rwiyemeza nyuma y’amasaha 2 kandi umumotari wawe agahembwa uko byagenda kose. |  |
| `confirmArrival.prompt` | Your motari says the ride is done. Confirm you have arrived. | Umumotari wawe avuga ko urugendo rurangiye. Emeza ko wageze. |  |
| `confirmArrival.title` | Ride finished | Urugendo rurangiye |  |
| `connection.detailTitle` | Connection & saved bookings | Umurongo n’ibyabitswe | CHROME-C: title of the sheet the status pill opens. Covers BOTH the connection and anything saved on the phone waiting to go out, so it must not name only one of them. |
| `connection.openDetail` | open details | fungura ibisobanuro | CHROME-C: screen-reader-only tail on the status pill's label, e.g. 'Offline — open details'. A verb phrase, lower case, never shown visually. |
| `connection.shortNoServer` | No server | Nta seriveri | CHROME-C: the header status pill's word for network-up-but-Bimoto-unreachable. Short, as above; `connection.unreachable` is the same state's full sentence in the detail sheet. This is the one state that turns the whole header red, so the word must carry that weight in two or three syllables. |
| `connection.shortOffline` | Offline | Nta murandasi | CHROME-C: the header status pill's word for a device with no network. MUST be short — it sits in a pill beside the back control, not in a banner. `connection.offline` is the same state's full sentence and stays as it is, inside the detail sheet. |
| `dashboard.finishCurrentRide` | Finish your current ride first | Banza urangize urugendo urimo |  |
| `dashboard.finishCurrentRideSubtitle` | New requests come back as soon as you complete the ride you have. | Ibisabwa bishya bizagaruka umaze kurangiza urugendo ufite. |  |
| `dashboard.reopenedUnpaid` | Back in the list: the passenger’s payment did not complete, so this ride is open to everyone again. | Yagarutse ku rutonde: kwishyura k’umugenzi ntibyakunze, bityo uru rugendo rwongeye gufungurirwa bose. |  |
| `deletion.bannerCancel` | Keep my account | Gumana konti yanjye |  |
| `deletion.bannerCancelFailed` | We could not stop the deletion. Please try again. | Ntitwashoboye guhagarika gusiba. Ongera ugerageze. |  |
| `deletion.bannerCancelPending` | Keeping your account… | Kugumana konti yawe… |  |
| `deletion.bannerCancelled` | Your account will not be deleted. | Konti yawe ntizasibwa. |  |
| `deletion.bannerCountdownDays` | It will be erased in about {{count}} days. | Izasibwa mu minsi {{count}} nka gutyo. |  |
| `deletion.bannerCountdownDays_one` | It will be erased in about {{count}} day. | Izasibwa mu munsi {{count}} nka gutyo. |  |
| `deletion.bannerCountdownDays_other` | It will be erased in about {{count}} days. | Izasibwa mu minsi {{count}} nka gutyo. |  |
| `deletion.bannerCountdownHours` | It will be erased in about {{count}} hours. | Izasibwa mu masaha {{count}} nka gutyo. |  |
| `deletion.bannerCountdownHours_one` | It will be erased in about {{count}} hour. | Izasibwa mu isaha {{count}} nka gutyo. |  |
| `deletion.bannerCountdownHours_other` | It will be erased in about {{count}} hours. | Izasibwa mu masaha {{count}} nka gutyo. |  |
| `deletion.bannerCountdownImminent` | It will be erased any moment now. | Igiye gusibwa ako kanya. |  |
| `deletion.bannerCountdownMinutes` | It will be erased in about {{count}} minutes. | Izasibwa mu minota {{count}} nka gutyo. |  |
| `deletion.bannerCountdownMinutes_one` | It will be erased in about {{count}} minute. | Izasibwa mu munota {{count}} nka gutyo. |  |
| `deletion.bannerCountdownMinutes_other` | It will be erased in about {{count}} minutes. | Izasibwa mu minota {{count}} nka gutyo. |  |
| `deletion.bannerDeferredTitle` | Your deletion is waiting on one thing | Gusiba konti yawe gutegereje ikintu kimwe |  |
| `deletion.bannerRidesNote` | You can keep using Bimoto until then. Rides you take between now and then are erased along with everything else. | Ushobora gukomeza gukoresha Bimoto kugeza icyo gihe. Ingendo uzakora hagati aha na cyo zizasibwa hamwe n'ibindi byose. |  |
| `deletion.bannerTitle` | Your account is being deleted | Konti yawe iri gusibwa |  |
| `deletion.deferredAccountFrozen` | Your account is frozen, so it cannot be deleted yet. Contact Bimoto support to settle the freeze and the deletion will go ahead. | Konti yawe irahagaritswe, bityo ntishobora gusibwa ubu. Vugana na serivisi z'abakiriya za Bimoto kugira ngo iryo hagarikwa rikemuke, hanyuma gusiba bizakomeza. |  |
| `deletion.deferredInFlightPayout` | A payout to you is on its way. It ends when the transfer settles. | Amafaranga yawe ari mu nzira. Bizarangira igihe kohereza birangiye. |  |
| `deletion.deferredLiveEscrow` | We cannot delete your account while the payment for one of your rides is still being settled. It will be deleted once that payment is finished. | Ntidushobora gusiba konti yawe mu gihe kwishyura kw'urugendo rwawe bikiri gukorwa. Izasibwa iyo kwishyura birangiye. |  |
| `deletion.deferredNonTerminalJourney` | We cannot delete your account while a ride is still going. It will be deleted once that ride ends. | Ntidushobora gusiba konti yawe mu gihe urugendo rukiri mu nzira. Izasibwa iyo urwo rugendo rurangiye. |  |
| `deletion.deferredOpenBid` | You have an offer out on a ride. It ends when the passenger accepts, you withdraw it, or it expires. | Ufite igiciro watanze ku rugendo. Bizarangira igihe umugenzi acyemeye, ucyikuyeho, cyangwa igihe cyacyo kirangiye. |  |
| `deletion.deferredPositiveDriverBalance` | We still owe you money for your rides. We cannot delete your account before paying you — it will be deleted once you have been paid. | Turacyakubereyemo amafaranga y'ingendo zawe. Ntidushobora gusiba konti yawe tutarayaguha — izasibwa iyo umaze kuyahabwa. |  |
| `deletion.deferredScheduledPayout` | A payout to you is scheduled. It ends when the payout is sent. | Amafaranga yawe yateganyijwe koherezwa. Bizarangira igihe azaba yoherejwe. |  |
| `deletion.deferredUnresolvedEmergency` | We cannot delete your account while an emergency you raised is still open. Our team is working on it, and your account will be deleted once it is closed. | Ntidushobora gusiba konti yawe mu gihe ikibazo cy'ubutabazi watanze kitarakemuka. Ikipe yacu irakikoraho, kandi konti yawe izasibwa iyo gikemutse. |  |
| `deletion.exportCopied` | Your data was copied. Paste it somewhere to keep it. | Amakuru yawe yarakoporowe. Yomeke ahantu kugira ngo uyabike. |  |
| `deletion.exportDownloaded` | Your data has been downloaded. | Amakuru yawe yaramanuwe. |  |
| `deletion.exportFailed` | We could not prepare your data. Please try again. | Ntitwashoboye gutegura amakuru yawe. Ongera ugerageze. |  |
| `deletion.exportNotice` | This export contains the records Bimoto holds about you as a rider, a driver, and a party to your own rides. It deliberately leaves out our fraud-prevention and investigation records about this account — anti-money-laundering flags, administrator actions taken about you, name-mismatch checks, driver conflict overrides, and the tombstone kept after an account is deleted. Those are withheld so that a fraud check cannot be read by the person it is about. You can ask for them, and for the reasons behind them, by making a request to Bimoto support. | Iyi dosiye irimo amakuru Bimoto ifite kuri wowe nk’umugenzi, nk’umumotari, no nk’umwe mu bagize urugendo rwawe. Ku bushake ntirimo inyandiko zacu zo kurwanya uburiganya n’izo iperereza kuri iyi konti: ibimenyetso byo kurwanya iyezandonke, ibyemezo by’ubuyobozi byafashwe kuri wowe, igenzura ry’amazina atahuye, ibyemezo byihariye ku makimbirane y’umumotari, n’inyandiko isigara konti imaze gusibwa. Ibyo ntibitangwa kugira ngo igenzura ry’uburiganya ritasomwa n’uwo rireba. Ushobora kubisaba, hamwe n’impamvu zabyo, wandikira ubufasha bwa Bimoto. |  |
| `deletion.exportPreparing` | Preparing your data… | Gutegura amakuru yawe… |  |
| `deletion.exportShared` | Your data is ready to share. | Amakuru yawe yiteguye gusangirwa. |  |
| `deletion.step1Back` | Go back | Subira inyuma |  |
| `deletion.step1Continue` | Continue | Komeza |  |
| `deletion.step1ErasedContacts` | Your emergency contacts | Abo uhamagara mu bihe by'ubutabazi |  |
| `deletion.step1ErasedDocuments` | Your licence, insurance and other documents | Uruhushya rwawe, ubwishingizi n'izindi nyandiko zawe |  |
| `deletion.step1ErasedName` | Your name and your profile | Izina ryawe n'umwirondoro wawe |  |
| `deletion.step1ErasedPhone` | Your phone number | Nimero yawe ya telefone |  |
| `deletion.step1ErasedTitle` | What is erased | Ibisibwa |  |
| `deletion.step1Intro` | Read this first. Once the deletion goes through, it cannot be undone. | Banza usome ibi. Iyo gusiba bimaze gukorwa, ntibisubirwaho. |  |
| `deletion.step1KeptPayments` | Payment and receipt records for those rides | Inyandiko z'ubwishyu n'inyemezabwishyu z'izo ngendo |  |
| `deletion.step1KeptRides` | The record that each ride happened — where it went and when | Inyandiko y'uko buri rugendo rwabaye — aho rwagiye n'igihe |  |
| `deletion.step1KeptSafety` | Safety and dispute records, where a ride had one | Inyandiko z'umutekano n'iz'amakimbirane, iyo urugendo rwarwo rwazigize |  |
| `deletion.step1KeptTitle` | What is kept, with your name taken off it | Ibibikwa, izina ryawe rikuweho |  |
| `deletion.step1KeptWhy` | The law requires us to keep these records, and other people were on those rides too. They stay, but nothing in them points back to you. | Amategeko adusaba kubika izi nyandiko, kandi n'abandi bantu bari muri izo ngendo. Zirabikwa, ariko nta na kimwe kirimo kigaruka kuri wowe. |  |
| `deletion.step1Title` | Delete my account | Siba konti yanjye |  |
| `deletion.step1Window` | Nothing happens straight away. You have 72 hours to change your mind, and Bimoto works normally for the whole of it. | Nta kintu kibaho ako kanya. Ufite amasaha 72 yo guhindura umwanzuro, kandi Bimoto ikora nk'ubusanzwe muri ayo masaha yose. |  |
| `deletion.step2Back` | No, keep my account | Oya, ngumane konti yanjye |  |
| `deletion.step2Hold` | Hold to delete my account | Fata kugira ngo usibe konti yanjye |  |
| `deletion.step2HoldInstruction` | Press and hold the button below for two seconds to confirm. | Kanda ubuto buri hasi ubufate amasegonda abiri kugira ngo wemeze. |  |
| `deletion.step2Holding` | Keep holding… | Komeza gufata… |  |
| `deletion.step2Submitting` | Starting… | Biratangira… |  |
| `deletion.step2Title` | Are you sure? | Urabyemeje? |  |
| `deletion.step2Warning` | This starts the 72-hour countdown. After that, your name, phone number, contacts and documents are erased for good. | Ibi bitangiza kubara amasaha 72. Nyuma yayo, izina ryawe, nimero yawe ya telefone, abo uhamagara n'inyandiko zawe bizasibwa burundu. |  |
| `delivery.blockedByChild` | You're travelling with a child on this ride — book a separate ride to send a package. | Ugenda n'umwana kuri uru rugendo — saba urundi rugendo niba wohereza ipaki. |  |
| `delivery.speedExpress` | Express | Byihuse (Vuba vuba) |  |
| `delivery.speedExpressDesc` | Faster than standard. There is no fixed extra charge — drivers see that you want it fast and bid their price, and you choose the one you want. | Byihuta kurusha ibisanzwe. Nta kiguzi cy'inyongera gihoraho — abamotari babona ko ushaka ko byihuta bakagutanga igiciro cyabo, ukahitamo icyo ushaka. |  |
| `delivery.speedLabel` | Delivery speed | Umuvuduko wo gutanga |  |
| `delivery.speedStandard` | Standard | Bisanzwe |  |
| `delivery.speedStandardDesc` | Delivered the same day. Choose an hour window below if you need one. | Bigezwa kuri uwo munsi. Hitamo igihe hepfo niba ubikeneye. |  |
| `delivery.standardHoursAny` | Any time | Igihe icyo ari cyo cyose |  |
| `delivery.standardHoursLabel` | Deliver within (optional) | Gutanga mu gihe kitarenze (si ngombwa) |  |
| `delivery.standardHoursN` | {{count}} h | amasaha {{count}} |  |
| `delivery.standardHoursNote` | This does not change the price — the driver still bids their own fare. | Ibi ntibihindura igiciro — motari akomeza gutanga igiciro cye. |  |
| `delivery.standardHoursWithin` | within {{count}} h | mu masaha {{count}} |  |
| `diagnostics.appBuild` | App build | Verisiyo ya porogaramu |  |
| `diagnostics.buildsMatch` | Builds match | Verisiyo zirahuye |  |
| `diagnostics.clearLog` | Clear log | Siba urutonde |  |
| `diagnostics.errorCount` | Errors recorded | Amakosa yanditswe |  |
| `diagnostics.errorLog` | Error log | Urutonde rw'amakosa |  |
| `diagnostics.errorLogEmpty` | No errors recorded on this phone. | Nta kosa ryanditswe kuri iyi telefoni. |  |
| `diagnostics.feedStatus` | Last feed reply | Igisubizo giheruka cy'urutonde |  |
| `diagnostics.feedViewAs` | Feed sent viewAs | viewAs yoherejwe n'urutonde |  |
| `diagnostics.intro` | A snapshot of what this phone and the server currently agree on. Take a screenshot and send it to us if something is not working. | Incamake y'ibyo iyi telefoni na seriveri bemeranyaho ubu. Fata ifoto y'ecran uyitwoherereze igihe hari ikitagenda neza. |  |
| `diagnostics.lastLocation` | Last position sent | Aho waherukira kohereza |  |
| `diagnostics.open` | Diagnostics | Isuzuma |  |
| `diagnostics.rideTraceNote` | Ride traces: recorded during rides and deliveries, kept 14 days, longer only under dispute. Never visible live to anyone, except our safety team during an emergency, until it is closed. | Inzira z'ingendo: zandikwa mu gihe cy'ingendo n'ubwikorezi, zibikwa iminsi 14, zikarenzaho gusa iyo hari ikibazo. Nta muntu uzireba mu buryo buhita, keretse itsinda ryacu ry'umutekano mu gihe cy'ubutabazi, kugeza ubutabazi bufunzwe. |  |
| `diagnostics.role` | Signed in as | Winjiye nka |  |
| `diagnostics.sendConsent` | The report contains only what is shown above: the time, the app build, the screen you were on, and the error text — with phone numbers and sign-in codes already removed. It goes to the Bimoto team in Kigali. It is sent automatically unless you turn that off in Settings, and Send report sends it now either way. | Raporo irimo gusa ibigaragara hejuru: isaha, verisiyo ya porogaramu, urupapuro wari uriho, n'ubutumwa bw'ikosa — nimero za telefoni n'imibare yo kwinjira byamaze gukurwamo. Ijya ku ikipe ya Bimoto i Kigali. Yoherezwa mu buryo bwikora keretse ubihagaritse muri Settings, kandi Ohereza raporo iyohereza ubu uko byaba biri kose. |  |
| `diagnostics.sendFailed` | not sent | ntiyoherejwe |  |
| `diagnostics.sendReport` | Send report | Ohereza raporo |  |
| `diagnostics.sendStatus` | Report sent | Raporo yoherejwe |  |
| `diagnostics.serverBuild` | Server build | Verisiyo ya seriveri |  |
| `diagnostics.serverOnline` | Online (per server) | Kuri interineti (nk'uko seriveri ibivuga) |  |
| `diagnostics.socket` | Live connection | Umurandasi uhoraho |  |
| `diagnostics.socketTransport` | Live connection type | Ubwoko bw’umurongo uhoraho |  |
| `diagnostics.title` | Diagnostics | Isuzuma |  |
| `diagnostics.transportPollingOnly` | Polling only — degraded ({{transport}}) | Kubaza gusa — bidakora neza ({{transport}}) |  |
| `diagnostics.transportWebsocket` | Websocket (fast) | Websocket (byihuse) |  |
| `driver.cancelledTrips.entryHint` | If a customer was marked absent by mistake, say so here. An admin reviews every dispute. | Niba urugendo rwanditswe nk'aho umukiriya atari ahari ari uko atari byo, bivuge hano. Umuyobozi asuzuma buri kirego. |  |
| `driver.cancelledTrips.entryLabel` | Dispute a no-show | Kujurira ku kudahari |  |
| `driverNav.locating` | Finding your location… | Turashaka aho uri… |  |
| `driverNav.mapLabelDestination` | Map to the destination | Ikarita igana aho ugiye |  |
| `driverNav.mapLabelPickup` | Map to the pickup | Ikarita igana aho batwara |  |
| `emergency.adminBannerTitleDriver` | Emergency — driver needs help | Ubutabazi — umumotari akeneye ubufasha |  |
| `emergency.adminBannerTitleDriverParcel` | Emergency — driver carrying a parcel needs help | Ubutabazi — umumotari utwaye umuzigo akeneye ubufasha |  |
| `emergency.adminBannerTitleSender` | Emergency — parcel sender needs help | Ubutabazi — uwohereza umuzigo akeneye ubufasha |  |
| `emergency.adminDriverPhone` | Driver phone | Telefone y'umumotari |  |
| `emergency.adminFollow` | Follow | Kurikirana |  |
| `emergency.adminPlate` | plate | plaka |  |
| `emergency.adminSenderPhone` | Sender phone | Telefoni y'uwohereza umuzigo |  |
| `emergency.alertReceivedParcel` | Emergency alert on this parcel delivery | Hari ubutabazi mu gutwara umuzigo |  |
| `emergency.cancelSend` | Sending to Bimoto in {{seconds}} — tap to cancel | Byoherezwa kuri Bimoto mu masegonda {{seconds}} — kanda uhagarike |  |
| `emergency.followingLive` | Our safety team is following this ride until the emergency is closed. | Itsinda ryacu ry'umutekano rikurikirana uru rugendo kugeza ubutabazi bufunzwe. |  |
| `emergency.followingLiveParcel` | Our safety team is following this delivery until the emergency is closed. | Itsinda ryacu ry'umutekano rikurikirana ubu bwikorezi kugeza ubutabazi bufunzwe. |  |
| `emergency.holdHint` | Press and hold this button to send an emergency alert. If you are using a keyboard or a screen reader, press Enter instead. | Kanda uhagarare kuri iyi buto kugira ngo wohereze ubutumwa bw'ubutabazi. Niba ukoresha klavye cyangwa igisomyi cy'ecran, kanda Enter. |  |
| `emergency.opsAgeHours` | {{hours}} h | amasaha {{hours}} |  |
| `emergency.opsAgeMinutes` | {{minutes}} min | iminota {{minutes}} |  |
| `emergency.opsAgeSeconds` | {{seconds}} s | amasegonda {{seconds}} |  |
| `emergency.opsClosedBy` | Closed by {{name}} | Byafunzwe na {{name}} |  |
| `emergency.opsIntro` | Open emergencies can be followed live until they are closed. Every alert is closed by an operator with a note, or by the system after 60 minutes. | Ubutabazi bufunguye bushobora gukurikiranwa ako kanya kugeza bufunzwe. Buri mpuruza ifungwa n'umukozi atanga inyandiko, cyangwa na sisitemu nyuma y'iminota 60. |  |
| `emergency.opsLastPosition` | last position {{age}} ago | aho baheruka kuba hamaze {{age}} |  |
| `emergency.opsLoadFailed` | Could not load emergency alerts — check the connection and try again. | Ntibyakunze gupakira impuruza z'ubutabazi — reba umurongo hanyuma wongere ugerageze. |  |
| `emergency.opsNoFramesYet` | No live position yet — call the numbers on the alert. | Nta hantu haramenyekana ako kanya — hamagara nimero ziri ku mpuruza. |  |
| `emergency.opsNoPosition` | No position for this alert. | Nta hantu hazwi kuri iyi mpuruza. |  |
| `emergency.opsNoneActive` | No emergency is open. | Nta butabazi bufunguye. |  |
| `emergency.opsNoneClosed` | No emergency has been closed yet. | Nta butabazi burafungwa. |  |
| `emergency.opsOpenFor` | open {{age}} | bumaze {{age}} |  |
| `emergency.opsRaisedByCustomer` | Passenger | Umugenzi |  |
| `emergency.opsRaisedByDriver` | Driver | Umushoferi |  |
| `emergency.opsResolve` | Close this emergency | Funga ubu butabazi |  |
| `emergency.opsResolveFailed` | Could not close this alert — it may already be closed. Reload the page. | Ntibyakunze gufunga iyi mpuruza — birashoboka ko yamaze gufungwa. Ongera upakire urupapuro. |  |
| `emergency.opsResolveNoteLabel` | What happened | Ibyabaye |  |
| `emergency.opsResolveNotePlaceholder` | Spoke to the driver, he is safe and the ride ended normally. | Twavuganye n'umushoferi, ari amahoro kandi urugendo rwarangiye neza. |  |
| `emergency.opsResolveNoteTooShort` | Write at least {{min}} characters — this note is the record of what happened. | Andika nibura inyuguti {{min}} — iyi nyandiko ni yo nyandiko y'ibyabaye. |  |
| `emergency.opsStatusExpired` | Timed out | Igihe cyarangiye |  |
| `emergency.opsStatusResolved` | Closed by ops | Byafunzwe n'abakozi |  |
| `emergency.opsTabActive` | Open ({{count}}) | Bufunguye ({{count}}) |  |
| `emergency.opsTabHistory` | History | Amateka |  |
| `emergency.opsTitle` | Emergency alerts | Impuruza z'ubutabazi |  |
| `errors.alreadyBid` | You have already made an offer on this ride. | Wamaze gutanga ituro kuri uru rugendo. |  |
| `errors.alreadyDeclined` | You have already declined this offer. | Wamaze kwanga iki cyifuzo. |  |
| `errors.alreadyRated` | You have already rated this ride. | Wamaze gutanga amanota kuri uru rugendo. |  |
| `errors.alreadyReported` | You have already reported this ride. | Wamaze gutanga ikibazo kuri uru rugendo. |  |
| `errors.bidWindowClosed` | Offers have closed for this ride. | Igihe cyo gutanga amaturo kuri uru rugendo cyarangiye. |  |
| `errors.bidWindowNotYetOpen` | Offers haven't opened for this ride yet. | Igihe cyo gutanga amaturo kuri uru rugendo ntikiratangira. |  |
| `errors.boundaryClearHint` | Keeps you signed in. Removes the downloaded map and locally cached ride data. | Uguma winjiye. Bisiba ikarita yakuruwe n'amakuru y'ingendo abitswe kuri telefoni. |  |
| `errors.boundaryClearRetry` | Clear cached data and retry | Siba amakuru abitswe hanyuma wongere ugerageze |  |
| `errors.boundaryLogoutReset` | Log out and start over | Sohoka hanyuma utangire bundi bushya |  |
| `errors.contactsNotLoaded` | Your emergency contacts have not loaded yet. Check your connection and try again. | Abo wahamagara mu byihutirwa ntibarapakirwa. Reba interineti yawe hanyuma wongere ugerageze. |  |
| `errors.counterAlreadyAnswered` | This price suggestion was already answered. | Icyo giciro cyasabwe cyamaze gusubizwa. |  |
| `errors.counterAlreadyExists` | You have already suggested a price for this offer. | Wamaze gusaba igiciro kuri iki giciro cyatanzwe. |  |
| `errors.counterDisabled` | Suggesting a price is not available yet. | Gusaba igiciro ntibiraboneka. |  |
| `errors.counterEqualsBidPrice` | That is the price already offered. | Icyo ni cyo giciro cyari cyatanzwe. |  |
| `errors.counterNoLongerOpen` | This offer was already matched. | Iki giciro cyamaze guhabwa undi. |  |
| `errors.counterNotFound` | There is no price suggestion on this offer. | Nta giciro cyasabwe kuri iki giciro cyatanzwe. |  |
| `errors.counterOutOfBounds` | That price is outside the allowed range. | Icyo giciro kiri hanze y’ibipimo byemewe. |  |
| `errors.deletionAlreadyPending` | Your account is already scheduled for deletion. | Konti yawe isanzwe iteganyijwe gusibwa. |  |
| `errors.disputeWindowClosed` | The time to dispute this ride has passed. | Igihe cyo kuburanisha uru rugendo cyarangiye. |  |
| `errors.driverIncompleteCompliance` | Some of your documents are still missing, so you can't make offers yet. | Hari inyandiko zawe zikibura, ntushobora gutanga amaturo. |  |
| `errors.driverRevoked` | Your driver account was revoked. Contact support to apply again. | Konti yawe y'umushoferi yakuweho. Vugana na serivisi z'abakiriya kugira ngo wongere usabe. |  |
| `errors.driverSuspended` | Your account is suspended, so you can't make offers right now. | Konti yawe yahagaritswe by'agateganyo, ntushobora gutanga amaturo ubu. |  |
| `errors.emergencyAlertNotActive` | This emergency alert is not open. | Iyi mpuruza y'ubutabazi ntabwo ifunguye. |  |
| `errors.escrowNotAdoptable` | This ride's payment is already being processed. | Kwishyura kw'uru rugendo kuri gutunganywa. |  |
| `errors.fileTooLarge` | That file is too large. The limit is 10 MB. | Iyi dosiye ni nini cyane. Ntirenge 10 MB. |  |
| `errors.geocodeQueryTooShort` | Type a little more so we can find the place. | Andika andi magambo make kugira ngo tubone aho hantu. |  |
| `errors.geocodingFailed` | That address search didn't work. Try again, or pick your point on the map. | Gushakisha iyo aderesi ntibyagenze. Ongera ugerageze, cyangwa uhitemo ahantu ku ikarita. |  |
| `errors.geocodingUnavailable` | Address search isn't available right now. Pick your point on the map instead. | Gushakisha aderesi ntibiraboneka ubu. Hitamo ahantu ku ikarita. |  |
| `errors.goHome` | Go to home screen | Subira ku ipaji y'itangiriro |  |
| `errors.invalidEmergencyContact` | That is not a phone number we can call. Use 07XX XXX XXX, or a country code like +250 or +44. | Iyi si nimero ya telefone dushobora guhamagara. Koresha 07XX XXX XXX, cyangwa kode y'igihugu nka +250 cyangwa +44. |  |
| `errors.invalidPreference` | That payout schedule isn't valid. | Iyo gahunda yo kwishyurwa ntabwo yemewe. |  |
| `errors.invalidRating` | Please choose between 1 and 5 stars. | Hitamo kuva ku nyenyeri 1 kugeza kuri 5. |  |
| `errors.journeyNotAcceptingBids` | This ride is no longer taking offers. | Uru rugendo ntirwakira amaturo ukundi. |  |
| `errors.journeyNotCompleted` | This ride is not finished yet. | Uru rugendo ntirurarangira. |  |
| `errors.journeyNotEnded` | This ride is not finished yet. | Uru rugendo ntirurarangira. |  |
| `errors.lateCancelNotAllowed` | It's too close to your pickup time to cancel here. Call your driver. | Igihe cyo kugufata kiri hafi cyane ngo uhagarike hano. Hamagara umushoferi wawe. |  |
| `errors.messageTooLong` | That message is too long. Keep it under 500 characters. | Ubwo butumwa ni burebure cyane. Ntiburenze inyuguti 500. |  |
| `errors.moneyPinAlreadySet` | You already have a money PIN. | Usanzwe ufite kode y'amafaranga. |  |
| `errors.moneyPinEnrollmentRequired` | Set a money PIN to open this screen. | Shyiraho kode y'amafaranga kugira ngo ufungure uru rupapuro. |  |
| `errors.moneyPinInvalid` | Wrong PIN. Try again. | Kode ntiyemewe. Ongera ugerageze. |  |
| `errors.moneyPinInvalidFormat` | A money PIN is 4 digits. | Kode y'amafaranga igizwe n'imibare 4. |  |
| `errors.moneyPinLocked` | Too many wrong tries. Wait a little, then try again. | Wagerageje inshuro nyinshi. Tegereza gato, ubone kongera kugerageza. |  |
| `errors.moneyPinNotSet` | You have not set a money PIN yet. | Ntabwo urashyiraho kode y'amafaranga. |  |
| `errors.moneyStepUpRequired` | Enter your money PIN to continue. | Andika kode y'amafaranga kugira ngo ukomeze. |  |
| `errors.noDeletionPending` | There is no deletion request to cancel. | Nta cyifuzo cyo gusiba konti gihari cyo kureka. |  |
| `errors.notBidOwner` | That offer belongs to a different account. | Iryo turo ni irya konti indi. |  |
| `errors.notJourneyDriver` | You did not drive this ride. | Ntabwo ari wowe watwaye uru rugendo. |  |
| `errors.notShiftEndMode` | Your current schedule pays you automatically — no need to request it. | Gahunda yawe y'ubu yishyura mu buryo bwikora — ntukeneye kubisaba. |  |
| `errors.otpInvalid` | That code is not right. Check the SMS and enter it again. | Uwo mubare si wo. Reba SMS wongere uwandike. |  |
| `errors.otpRequired` | Enter the code we sent you by SMS. | Andika kode twaguhereje kuri SMS. |  |
| `errors.outsideOperationArea` | That place is not in our operation area. Bimoto serves Kigali for now. | Ahantu hatari mu karere dukoreramo. Bimoto ikorera i Kigali kugeza ubu. |  |
| `errors.parcelTooHeavyForVehicle` | That is too heavy for the vehicle you chose. Pick a lighter parcel or a different vehicle. | Ibyo biraremereye kuri iyo modoka wahisemo. Hitamo ipaki yoroshye cyangwa indi modoka. |  |
| `errors.parcelTooLargeForVehicle` | That parcel is too big for a moto on its own — a moto alone takes envelope-size items. Choose a bicycle, or send it with a passenger ride. | Iyo paki ni nini kuri moto yonyine — moto yonyine itwara ibintu bingana n'ibahasha. Hitamo igare, cyangwa uyoherereze mu rugendo rw'umugenzi. |  |
| `errors.pickupCoordsInvalid` | That pickup point isn't valid. Choose it again on the map. | Aho uva ntabwo ari ho. Hongere uhitemo ku ikarita. |  |
| `errors.pickupCoordsOutOfBounds` | That pickup point is not in our operation area. Bimoto serves Kigali for now. | Aho uva ntabwo ari mu gace dukoreramo. Bimoto ikorera i Kigali kugeza ubu. |  |
| `errors.preferenceChangeRateLimited` | You already changed your payout schedule today. Try again tomorrow. | Wamaze guhindura gahunda yo kwishyurwa uyu munsi. Ongera ugerageze ejo. |  |
| `errors.roleNotSelfAssignable` | That account type cannot be set here. | Ubwo bwoko bwa konti ntibushobora guhindurirwa hano. |  |
| `errors.scheduledPastDeletion` | That pickup time is after your account is deleted. Choose an earlier time, or cancel the deletion. | Icyo gihe cyo gufatwa kiri nyuma y'uko konti yawe isibwa. Hitamo igihe cya mbere, cyangwa ureke gusiba konti. |  |
| `errors.screenCrashTitle` | This screen hit a problem | Iyi paji yagize ikibazo |  |
| `errors.tooFarFromDestination` | You're too far from the destination to finish this ride. Get closer and try again. | Uri kure cyane y'aho ujya ngo urangize uru rugendo. Egera hafi wongere ugerageze. |  |
| `errors.tooFarFromPickup` | You're too far from the pickup point to start this ride. Get closer and try again. | Uri kure cyane y'aho uva ngo utangire uru rugendo. Egera hafi wongere ugerageze. |  |
| `errors.unsupportedFileType` | That file type isn't accepted. Send a photo (JPEG or PNG) or a PDF. | Ubwo bwoko bw'idosiye ntibwemewe. Ohereza ifoto (JPEG cyangwa PNG) cyangwa PDF. |  |
| `errors.upgradeRequired` | This version of Bimoto is out of date. Please update the app to continue. | Iyi verisiyo ya Bimoto yarashaje. Nyamuneka vugurura porogaramu kugira ngo ukomeze. |  |
| `errors.uploadRejected` | That upload was not accepted. Try a different file. | Iyi dosiye ntiyemewe. Gerageza indi dosiye. |  |
| `errors.vehicleMismatch` | This ride asked for a different vehicle than the one on your account. | Uru rugendo rusaba ikinyabiziga gitandukanye n'icyo ufite kuri konti yawe. |  |
| `errors.vehicleNotLoaded` | Your vehicle details have not loaded yet. Check your connection and try again. | Amakuru y’ikinyabiziga cyawe ntiyarapakirwa. Reba interineti yawe hanyuma wongere ugerageze. |  |
| `goods.wishPriceHelper` | Set a price for the parcel, or wait for the driver's price | Igiciro cy'umuzigo (Shyiramo igiciro cyangwa utegereze igiciro cy'umumotari/umunyonzi) |  |
| `goodsPickup.resumed` | Resumed where you left off | Twakomeje aho wari ugeze |  |
| `guide.children.body` | Children under 12 are not an independent booking option on Bimoto — a child travels with a responsible adult, who makes the booking. When you book a ride you can tick 'Travelling with a child?' so the driver knows before they arrive. | Abana bari munsi y'imyaka 12 ntibashobora gutumiza urugendo ubwabo kuri Bimoto — umwana agendana n'umuntu mukuru ubishinzwe, ari na we utumiza urugendo. Igihe utumiza urugendo, ushobora gushyiraho akamenyetso ka 'Uri kugendana n'umwana?' kugira ngo umumotari abimenye mbere yo kugera aho uri. |  |
| `guide.children.title` | Travelling with children | Kugendana n'abana |  |
| `guide.trace.body` | During your ride, the driver's phone records the route — for safety, and so that any dispute can be settled with facts rather than memory. It is deleted after 14 days unless a dispute is open, in which case it is kept until the dispute is settled. It is never visible live to anyone — except our safety team during an emergency, until the emergency is closed. | Mu gihe cy'urugendo rwawe, telefoni y'umumotari yandika inzira munyuzemo — ku mutekano, no kugira ngo ikibazo cyose gishobore gukemurwa hashingiwe ku byabaye aho gushingira ku kwibuka. Isibwa nyuma y'iminsi 14 keretse hari ikibazo cyafunguwe; icyo gihe ibikwa kugeza igihe gikemukiye. Nta muntu n'umwe uyireba mu buryo buhita — keretse itsinda ryacu ry'umutekano mu gihe cy'ubutabazi, kugeza ubutabazi bufunzwe. |  |
| `guide.trace.title` | The route is recorded | Inzira yandikwa |  |
| `guide.welcomeLink` | User guide | Amabwiriza |  |
| `history.sectionAsMotari` | As motari | Nk'umumotari |  |
| `history.sectionAsPassenger` | As passenger | Nk'umugenzi |  |
| `intel.cell.noMarginals` | This tier publishes no attribute splits. | Uru rwego ntirutangaza uko ibiranga bitandukanye. |  |
| `intel.cell.tapPrompt` | Tap a hexagon to see what it carries. | Kanda ku kazu k'impande esheshatu urebe ibikarimo. |  |
| `intel.cell.threshold` | This cell exists because at least {{k}} movements lit it. | Aka kazu kabaho kubera ko byibuze ingendo {{k}} zakamurikiye. |  |
| `intel.cell.window` | {{from}} — {{to}} | {{from}} — {{to}} |  |
| `intel.empty` | No cells cleared the privacy threshold here. | Nta kazu (cell) kanyuze ku rugero rw'ibanga hano. |  |
| `intel.export.csv` | Export this view (CSV) | Sohora iyi paji (CSV) |  |
| `intel.export.failed` | Could not export. | Ntibyakunze gusohora. |  |
| `intel.export.heading` | Export ({{lines}} lines) | Ibyasohotse (imirongo {{lines}}) |  |
| `intel.export.jsonl` | Export (JSONL) | Sohora (JSONL) |  |
| `intel.export.working` | Exporting… | Birimo gusohorwa… |  |
| `intel.filter.from` | From | Kuva |  |
| `intel.filter.tier` | Tier | Urwego |  |
| `intel.filter.to` | To | Kugeza |  |
| `intel.flows.count` | Journeys | Ingendo |  |
| `intel.flows.destination` | Destination cell | Akazu k'aho bagiye |  |
| `intel.flows.empty` | No origin–destination pair cleared the stricter endpoint's threshold in this window. | Nta gice cy'aho batangiriye n'aho bagiye cyanyuze ku rugero rukomeye muri iki gihe. |  |
| `intel.flows.origin` | Origin cell | Akazu k'aho batangiriye |  |
| `intel.flows.share` | Share | Igipimo |  |
| `intel.flows.window` | Window | Igihe |  |
| `intel.grainNote` | Cells of {{metres}} m, buckets of {{minutes}} min, and at least {{k}} movements per cell before it exists at all. | Utuzu twa metero {{metres}}, ibice by'iminota {{minutes}}, kandi byibuze ingendo {{k}} kuri buri kazu mbere y'uko kabaho. |  |
| `intel.loadFailed` | Could not load aggregates. | Ntibyakunze gupakira imibare yateranyijwe. |  |
| `intel.loading` | Loading… | Birimo gupakirwa… |  |
| `intel.marginal.fareDeciles` | Fare band | Urwego rw'igiciro |  |
| `intel.marginal.hourBuckets` | Hour of day | Isaha y'umunsi |  |
| `intel.marginal.other` | other (folded) | ibindi (byahurijwe hamwe) |  |
| `intel.marginal.vehicleTypes` | Vehicle | Ikinyabiziga |  |
| `intel.ops.attributes` | Attributes | Ibiranga |  |
| `intel.ops.bucket` | Bucket | Igice |  |
| `intel.ops.cellSize` | Cell | Akazu |  |
| `intel.ops.cells` | Cells | Utuzu |  |
| `intel.ops.classificationVersion` | Tier classification version {{version}} | Verisiyo y'ishyirwa mu byiciro {{version}} |  |
| `intel.ops.kThreshold` | k | k |  |
| `intel.ops.points` | Movements | Ingendo |  |
| `intel.ops.rangeClear` | Clear range | Siba igihe |  |
| `intel.ops.rangeFrom` | From | Kuva |  |
| `intel.ops.rangeIncomplete` | Give both dates, or leave both empty. | Shyiramo amatariki yombi, cyangwa usige yombi ubusa. |  |
| `intel.ops.rangeOutOfOrder` | The end date has to come after the start date. | Itariki yo kurangiriraho igomba kuza nyuma y’iyo watangiriyeho. |  |
| `intel.ops.rangeTo` | To | Kugeza |  |
| `intel.ops.rangeTooLarge` | That range is longer than the {{days}}-day maximum. | Icyo gihe kirenze iminsi {{days}} yemewe. |  |
| `intel.ops.rangeUnparseable` | That is not a date the server can read. | Iyi si itariki seriveri ishobora gusoma. |  |
| `intel.ops.reload` | Reload tier classification | Ongera upakire ishyirwa mu byiciro |  |
| `intel.ops.reloadFailed` | Could not reload the classification file. | Ntibyakunze kongera gupakira dosiye y'ishyirwa mu byiciro. |  |
| `intel.ops.reloaded` | Reloaded — version {{version}}. | Byongeye gupakirwa — verisiyo {{version}}. |  |
| `intel.ops.reloading` | Reloading… | Birimo kongera gupakirwa… |  |
| `intel.ops.runAccepted` | Accepted — the run is happening in the background. | Byemewe — birimo gukorwa inyuma. |  |
| `intel.ops.runAcceptedRange` | Accepted — re-building {{from}} to {{to}} in the background. | Byakiriwe — kwongera kubaka kuva {{from}} kugeza {{to}} birimo gukorwa. |  |
| `intel.ops.runFailed` | Could not start the run. | Ntibyakunze gutangira. |  |
| `intel.ops.runNow` | Run aggregation now | Teranya nonaha |  |
| `intel.ops.runNowNote` | Leave the dates empty to run the same lookback window as the nightly job. Give a range to re-build the aggregates for those days instead. | Siga amatariki ubusa kugira ngo ukoreshe igihe kimwe n'akazi ko nijoro. Shyiramo igihe kugira ngo wongere wubake imibare y'iyo minsi. |  |
| `intel.ops.runNowNoteCapped` | Leave the dates empty to run the same lookback window as the nightly job. Give a range of up to {{days}} days to re-build the aggregates for those days instead. | Siga amatariki ubusa kugira ngo ukoreshe igihe kimwe n'akazi ko nijoro. Shyiramo igihe kitarenze iminsi {{days}} kugira ngo wongere wubake imibare y'iyo minsi. |  |
| `intel.ops.running` | Starting… | Birimo gutangira… |  |
| `intel.ops.subtitle` | What the aggregation is configured to do, and what it produced in this range. | Icyo guteranya kwagenewe gukora, n'icyo kwakoze muri iki gihe. |  |
| `intel.ops.tier` | Tier | Urwego |  |
| `intel.ops.title` | Pipeline | Uburyo bwo guteranya |  |
| `intel.subtitle` | Aggregated, k-anonymised movement. This surface cannot show you a person, only a city. | Ingendo zateranyijwe kandi zihishwe amazina (k-anonymised). Iyi paji ntishobora kukwereka umuntu, yerekana umujyi gusa. |  |
| `intel.title` | Mobility intelligence | Ubwenge ku migendere |  |
| `intel.view.density` | Density | Ubwinshi |  |
| `intel.view.flows` | Flows | Ingendo |  |
| `journey.addressClear` | Clear | Siba |  |
| `journey.describePlaceHelp` | Anything that helps the driver find the exact spot | Ibintu byose byafasha motari kubona neza aho hantu |  |
| `journey.describePlaceLabel` | Describe the place (optional) | Sobanura aho hantu (ntibisabwa) |  |
| `journey.describePlacePlaceholder` | e.g. Kuwa Mudugudu | urugero: Kuwa Mudugudu |  |
| `journey.destinationDescriptionShown` | Destination notes | Ibisobanuro by’aho ujya |  |
| `journey.estimateDurationRange` | {{min}}–{{max}} min | iminota {{min}}–{{max}} |  |
| `journey.estimateLabel` | Estimates — the real price is what a motari offers | Ibigereranyo — igiciro nyacyo ni icyo umumotari atanga |  |
| `journey.estimateTypicalPrice` | about {{price}} RWF | nka {{price}} RWF |  |
| `journey.landmarkNeedsPin` | Tap the map to show where this is | Kanda ku ikarita werekane aho hantu hari |  |
| `journey.pickupDescriptionShown` | Pickup notes | Ibisobanuro by’aho uva |  |
| `layout.appHeader` | App header | Umutwe wa porogaramu |  |
| `layout.logoHome` | Go to home screen | Jya ku rupapuro rwa mbere |  |
| `legal.diagnosticsConsent` | When the app hits an error, this phone records what happened — the time, the app version, the screen you were on, and the error text. Phone numbers and sign-in codes are removed before it is saved. To help us fix problems quickly, these error records are sent automatically to the Bimoto team in Kigali. You can see exactly what would be sent on the Diagnostics screen, and you can turn automatic sending off at any time in Settings. Your messages, your trips and your location are never part of it. | Iyo porogaramu ihuye n'ikibazo, iyi telefoni yandika ibyabaye: isaha, verisiyo ya porogaramu, urupapuro wari uriho, n'ubutumwa bw'ikosa. Nimero za telefoni n'imibare yo kwinjira bikurwamo mbere yo kubikwa. Kugira ngo dukemure ibibazo vuba, izo nyandiko z'amakosa zoherezwa mu buryo bwikora ku ikipe ya Bimoto i Kigali. Ushobora kureba neza ibyoherezwa ku rupapuro rwa Diagnostics, kandi ushobora guhagarika kohereza kwikora igihe icyo ari cyo cyose muri Settings. Ubutumwa bwawe, ingendo zawe n'aho uri ntibijyanwa na rimwe. |  |
| `legal.rideTraceNotice` | Your position is recorded during rides and deliveries — for safety, and to settle disputes with facts. Traces are kept for 14 days and then deleted; if a ride is under dispute, its trace is kept until the dispute is settled. Nobody can watch your rides live — except our safety team during an emergency, until it is closed. | Aho uri handikwa mu gihe cy'ingendo n'ubwikorezi bw'ibintu — ku mutekano, no gukemura amakimbirane hashingiwe ku byabaye. Inzira zibikwa iminsi 14 hanyuma zigasibwa; niba urugendo rufite ikibazo, inzira yarwo ibikwa kugeza ikibazo gikemutse. Nta muntu ushobora kureba ingendo zawe mu buryo buhita — keretse itsinda ryacu ry'umutekano mu gihe cy'ubutabazi, kugeza ubutabazi bufunzwe. |  |
| `legal.safetyAckAgree` | I have read and accept these three safety rules | Nasomye kandi nemera aya mategeko atatu y’umutekano |  |
| `legal.safetyAckDriverRefuse` | As a driver, you also accept that you will refuse any ride that would break these rules, even if the passenger insists. | Nka umushoferi, wemera kandi ko uzanga urugendo rwose rwaba runyuranyije n’aya mategeko, n’ubwo umugenzi yabyifuza cyane. |  |
| `legal.safetyAckMinimumAge` | Anyone below the legal minimum age for a moto passenger may not be carried. | Umuntu wese utaragera ku myaka ngombwa yemewe n’amategeko yo kuba umugenzi wa moto ntashobora gutwarwa. |  |
| `legal.safetyAckNoInfants` | No babies or infants may ever be carried on a moto. This has no exception. | Nta mwana muto cyangwa uruhinja rwigeze rushobora gutwarwa kuri moto. Nta gahonzu na kamwe. |  |
| `legal.safetyAckOnePassenger` | A moto carries exactly one passenger. Never two, never a child in addition to an adult. | Moto itwara umugenzi umwe gusa. Ntibabiri, kandi nta mwana wiyongera ku muntu mukuru. |  |
| `legal.safetyAckTitle` | Safety rules you must accept | Amategeko y’umutekano ugomba kwemera |  |
| `legal.termsChildPolicy` | Children: children under 12 are not an independent booking option. A child travels with a responsible adult, who makes the booking and stays with the child for the whole trip. | Abana: abana bari munsi y'imyaka 12 ntibashobora gutumiza urugendo ubwabo. Umwana agendana n'umuntu mukuru ubishinzwe, ari na we utumiza urugendo kandi agumana n'umwana urugendo rwose. |  |
| `map.offline.chipDone` | The {{region}} map is on this phone — it works without internet now. | Ikarita ya {{region}} iri kuri iyi telefoni — ubu ikora nta internet. |  |
| `map.offline.chipOffer` | Download the {{region}} map ({{mb}} MB) so this works without internet | Kuramo ikarita ya {{region}} ({{mb}} MB) kugira ngo ibi bikore nta internet |  |
| `map.offline.chipProgress` | Downloading the {{region}} map… | Kuramo ikarita ya {{region}}… |  |
| `map.offline.deleteConfirmNamed` | Delete the offline map for {{region}}? Without it that area needs a connection again. | Gusiba ikarita ya {{region}} ikora nta murandasi? Idahari, ako karere kazongera gukenera umurandasi. |  |
| `map.offline.discard` | Discard | Siba |  |
| `map.offline.intro` | Keep maps on this phone so they show instantly, even with no connection. | Bika amakarita kuri iyi telefoni kugira ngo agaragare ako kanya, n'iyo nta murandasi uhari. |  |
| `map.offline.noSpace` | There isn't enough space on this phone for the offline map. Free some space and try again. | Nta mwanya uhagije uri kuri iyi telefone kugira ngo ikarita yo hanze ya interineti ibike. Sohora umwanya hanyuma wongere ugerageze. |  |
| `map.offline.paused` | Download paused | Gukurura byahagaritswe |  |
| `map.offline.resume` | Resume download | Komeza gukurura |  |
| `map.offline.resumeMeta` | {{mb}} MB already downloaded — it will carry on from there. | Miliyoni {{mb}} MB zamaze gukururwa — bizakomereza aho byagejeje. |  |
| `map.offline.size` | {{mb}} MB | MB {{mb}} |  |
| `map.offline.tierCountry` | The whole country | Igihugu cyose |  |
| `map.offline.tierDistrict` | Districts | Uturere |  |
| `map.offline.tierProvince` | Provinces | Intara |  |
| `map.regions.east` | Eastern Province | Iburasirazuba |  |
| `map.regions.kigali` | Kigali City | Umujyi wa Kigali |  |
| `map.regions.north` | Northern Province | Amajyaruguru |  |
| `map.regions.rwanda` | All of Rwanda | U Rwanda rwose |  |
| `map.regions.south` | Southern Province | Amajyepfo |  |
| `map.regions.west` | Western Province | Iburengerazuba |  |
| `map.routeChoiceHint` | Preview only — your driver may take a different road. | Ni icyitegererezo gusa — umumotari ashobora kunyura mu yindi nzira. |  |
| `map.routeOption` | Route {{n}} | Inzira ya {{n}} |  |
| `map.routeOptionsLabel` | Route options | Amahitamo y'inzira |  |
| `map.routeUnavailable` | Route unavailable — showing direct line | Inzira ntibonetse — hagaragajwe umurongo utaziguye |  |
| `moneyPin.alreadySet` | You already have a money PIN. | Usanzwe ufite kode y'amafaranga. |  |
| `moneyPin.backspace` | Delete last digit | Siba umubare wa nyuma |  |
| `moneyPin.badFormat` | A money PIN is 4 digits. | Kode y'amafaranga igizwe n'imibare 4. |  |
| `moneyPin.changeCta` | Change my PIN | Hindura kode yanjye |  |
| `moneyPin.changed` | Your money PIN was changed. | Kode y'amafaranga yawe yahinduwe. |  |
| `moneyPin.chooseNew` | Choose 4 new digits | Hitamo imibare 4 mishya |  |
| `moneyPin.confirmNew` | Enter the same 4 digits again | Ongera wandike iyo mibare 4 imwe |  |
| `moneyPin.digitsEntered` | {{count}} of {{total}} digits entered | Wanditse imibare {{count}} kuri {{total}} |  |
| `moneyPin.enrollTitle` | Set your money PIN | Shyiraho kode y'amafaranga |  |
| `moneyPin.enrollWhy` | Choose 4 digits. From now on Bimoto asks for them before showing your balance or changing where your money goes. Nowhere else. | Hitamo imibare 4. Guhera ubu Bimoto izayisaba mbere yo kukwereka amafaranga yawe cyangwa guhindura aho ajya. Ahandi hose ntacyo. |  |
| `moneyPin.enterCurrent` | Enter your current PIN | Andika kode usanzwe ukoresha |  |
| `moneyPin.forgotCta` | I forgot my PIN | Nibagiwe kode yanjye |  |
| `moneyPin.genericError` | That did not work. Try again. | Ntibyakunze. Ongera ugerageze. |  |
| `moneyPin.lockedShort` | Too many wrong tries. Wait a little, then try again. | Wagerageje inshuro nyinshi. Tegereza gato, ubone kongera kugerageza. |  |
| `moneyPin.lockedTitle` | Too many wrong tries | Wagerageje inshuro nyinshi |  |
| `moneyPin.lockedUntil` | Too many wrong tries. You can try again after {{time}}. | Wagerageje inshuro nyinshi. Ushobora kongera kugerageza nyuma ya {{time}}. |  |
| `moneyPin.mismatch` | Those did not match. Start again. | Ntabwo zihuye. Ongera utangire. |  |
| `moneyPin.notNow` | Not now | Ubu si ubu |  |
| `moneyPin.padLabel` | Money PIN keypad | Ahanditse kode y'amafaranga |  |
| `moneyPin.pendingWarning` | Someone asked to change your money PIN. The new one starts working on {{time}}. If this was not you, change your PIN now with the one you know — that cancels it. | Hari usabye guhindura kode y'amafaranga yawe. Iyo nshya izatangira {{time}}. Niba atari wowe, hindura kode yawe ubu ukoresheje iyo uzi — ibyo birabihagarika. |  |
| `moneyPin.resetDoneTitle` | Your new PIN starts tomorrow | Kode nshya itangira ejo |  |
| `moneyPin.resetExplain` | Your new PIN will work from {{time}} — about a day from now. | Kode yawe nshya izatangira gukora kuva {{time}} — nka nyuma y'umunsi umwe. |  |
| `moneyPin.resetOldStillWorks` | Your old PIN keeps working until then. If you remember it, use it — that cancels this change straight away. | Kode yawe ya kera iracyakora kugeza icyo gihe. Niba uyibuka, yikoreshe — ibyo bihagarika iri hinduka ako kanya. |  |
| `moneyPin.resetSmsSent` | We sent a code to your phone. | Twoherereje kode kuri telefone yawe. |  |
| `moneyPin.resetTitle` | Reset your money PIN | Hindura kode y'amafaranga |  |
| `moneyPin.resetWhy` | We wait a day because anyone holding your phone can also read your SMS. The wait gives you time to notice. We have just sent you a message about this change. | Dutegereza umunsi kuko ufashe telefone yawe ashobora no gusoma SMS zawe. Uwo munsi uguha umwanya wo kubimenya. Turakoherereje ubutumwa kuri iri hinduka. |  |
| `moneyPin.settingsHelp` | The 4 digits Bimoto asks for before showing your balance or changing where your money goes. | Imibare 4 Bimoto isaba mbere yo kukwereka amafaranga yawe cyangwa guhindura aho ajya. |  |
| `moneyPin.settingsTitle` | Money PIN | Kode y'amafaranga |  |
| `moneyPin.smsCodeLabel` | Code from the SMS | Kode yo muri SMS |  |
| `moneyPin.verifyTitle` | Enter your money PIN | Andika kode y'amafaranga |  |
| `moneyPin.verifyWhy` | This screen shows your money. | Uru rupapuro rwerekana amafaranga yawe. |  |
| `moneyPin.wrongPin` | Wrong PIN. Try again. | Kode ntiyemewe. Ongera ugerageze. |  |
| `notify.bidCountered` | A passenger suggested {{amount}} RWF for your offer | Umugenzi yasabye {{amount}} RWF ku giciro watanze |  |
| `notify.counterAccepted` | Your price of {{amount}} RWF was accepted | Igiciro cyawe cya {{amount}} RWF cyemewe |  |
| `notify.counterDeclined` | Your price was not accepted — the offer of {{price}} RWF still stands | Igiciro cyawe nticyemewe — igiciro cya {{price}} RWF kiracyahari |  |
| `notify.disputeClosed` | Your dispute was closed with no action | Ikirego cyawe cyafunzwe nta cyakozwe |  |
| `notify.disputeRejected` | Your dispute was not upheld | Ikirego cyawe nticyemewe |  |
| `notify.disputeUpheld` | Your dispute was upheld | Ikirego cyawe cyemewe |  |
| `notify.escrowRefunded` | {{amount}} RWF has been returned to you | {{amount}} RWF wagarujwe |  |
| `notify.escrowReleased` | You were paid {{amount}} RWF | Wishyuwe {{amount}} RWF |  |
| `notify.noShowWarning` | No-show warning ({{count}}) — this affects your account | Umuburo wo kutitaba ({{count}}) — bigira ingaruka kuri konti yawe |  |
| `notify.ratingReceived` | You received a {{count}}-star rating | Wahawe amanyenyeri {{count}} |  |
| `notify.verificationApproved` | Your account is verified — you can start working | Konti yawe yemejwe — ushobora gutangira gukora |  |
| `notify.verificationRejected` | Your verification was not approved — check your documents | Kwemeza konti yawe ntibyakunze — reba inyandiko zawe |  |
| `outbox.cancel` | Cancel this booking | Hagarika iri tegeko |  |
| `outbox.cancelled` | Booking cancelled | Itegeko ryahagaritswe |  |
| `outbox.dismiss` | Dismiss | Funga |  |
| `outbox.done` | Done | Byarangiye |  |
| `outbox.empty` | Nothing is waiting to be sent. | Nta kintu gitegereje koherezwa. |  |
| `outbox.rejectedGeneric` | The server did not accept this booking. | Seriveri ntiyemeye iri tegeko. |  |
| `outbox.rejectedLabel` | Saved booking | Itegeko ryabitswe |  |
| `outbox.savedBody` | You have no connection right now. We will send this booking the moment you are back online. | Nta murandasi ufite ubu. Tuzohereza iri tegeko ako kanya nimugarukira kuri murandasi. |  |
| `outbox.savedRoute` | {{from}} → {{to}} | {{from}} → {{to}} |  |
| `outbox.savedTitle` | Saved on this phone | Byabitswe kuri iyi telefone |  |
| `outbox.savedToast` | Saved on this phone — it will go out when there is signal | Byabitswe kuri iyi telefoni — bizohereza igihe umurandasi uzagaruka | CHROME-C: the toast shown the moment a booking is held on the phone. Same job and same tone as the strip it replaces — calm statement of fact, never an apology or a warning — but it now has to work as a sentence that appears and leaves on its own, so it must be complete and readable at a glance. |
| `outbox.sentTitle` | Your saved booking was sent | Itegeko ryawe ryabitswe ryoherejwe |  |
| `outbox.view` | View the ride | Reba urugendo |  |
| `outbox.waitingCount` | {{count}} bookings saved on this phone | Amategeko {{count}} yabitswe kuri iyi telefone |  |
| `outbox.waitingCount_one` | {{count}} booking saved on this phone — tap to review | Itegeko {{count}} ryabitswe kuri iyi telefone — kanda urebe |  |
| `outbox.waitingCount_other` | {{count}} bookings saved on this phone — tap to review | Amategeko {{count}} yabitswe kuri iyi telefone — kanda urebe |  |
| `outbox.waitingTitle` | Waiting to send | Bitegereje koherezwa |  |
| `parcel.badge` | PARCEL | UMUZIGO |  |
| `parcel.badgeAriaLabel` | Parcel delivery | Kohereza umuzigo |  |
| `parcel.weightKg` | {{weight}} kg | {{weight}} kg |  |
| `parcelWeight.bicycleAlone` | A bicycle carrying only a parcel can take up to {{max}} kg. | Igare ritwaye gusa ipaki rishobora gutwara kugeza ku biro {{max}}. |  |
| `parcelWeight.bicycleWithPassenger` | A bicycle carrying a passenger can take a parcel up to {{max}} kg. | Igare ritwaye umugenzi rishobora gutwara ipaki y'ibiro {{max}} nibura. |  |
| `parcelWeight.label` | Weight | Ibiro |  |
| `parcelWeight.motoAlone` | A moto carrying only a parcel takes envelope-size items. | Moto itwaye gusa ipaki itwara ibintu bingana n'ibahasha. |  |
| `parcelWeight.motoWithPassenger` | A moto carrying a passenger can take a parcel up to {{max}} kg. | Moto itwaye umugenzi ishobora gutwara ipaki y'ibiro {{max}} nibura. |  |
| `parcelWeight.placeholder` | How heavy is it? | Bifite ibiro bingana bite? |  |
| `payment.reason.declined` | Your Mobile Money provider refused the payment. | Uwo utanga Mobile Money yanze kwishyura. |  |
| `payment.reason.gatewayDown` | Payments are having trouble right now. Try again in a moment. | Kwishyura birimo ikibazo muri iki gihe. Ongera ugerageze nyuma gato. |  |
| `payment.reason.insufficientFunds` | Not enough money on your Mobile Money account. Top up, then try again. | Nta mafaranga ahagije kuri konti yawe ya Mobile Money. Yongeremo, hanyuma ugerageze. |  |
| `payment.reason.invalidWallet` | That Mobile Money number was not accepted. Check the number on your account. | Iyi nomero ya Mobile Money ntiyemewe. Reba nomero ya konti yawe. |  |
| `payment.reason.timeout` | Mobile Money did not answer in time. You were not charged. | Mobile Money ntiyasubije ku gihe. Nta mafaranga yakuweho. |  |
| `payment.reason.unknown` | The payment did not go through. You were not charged. | Kwishyura ntibyagenze. Nta mafaranga yakuweho. |  |
| `payment.recover.checkPhone` | Check your phone and approve the Mobile Money request. | Reba kuri telefone yawe wemeze icyifuzo cya Mobile Money. |  |
| `payment.recover.driverHeld` | Your driver is still holding this ride. Pay again and you keep them. | Umumotari wawe aracyakubitseho urugendo. Ongera wishyure, agume ari uwawe. |  |
| `payment.recover.iApproved` | I approved it | Nabyemeje |  |
| `payment.recover.payByCard` | Pay by card instead | Wishyure ukoresheje ikarita |  |
| `payment.recover.seeMyRide` | See my ride | Reba urugendo rwanjye |  |
| `payment.recover.stillWaiting` | Still waiting for your Mobile Money approval. | Turacyategereje ko wemeza Mobile Money. |  |
| `payment.recover.title` | Payment didn't go through | Kwishyura ntibyagenze |  |
| `payment.recover.tooManyAttempts` | Too many attempts. Wait a minute, then try again. | Wagerageje kenshi cyane. Tegereza umunota, ongere ugerageze. |  |
| `payment.recover.tryMomo` | Try Mobile Money again | Ongera ugerageze Mobile Money |  |
| `payout.costImmediateWithdrawal` | If you ask to be paid immediately, outside your schedule, the {{fee}} RWF transfer fee comes out of your money. | Nusaba kwishyurwa ako kanya, hanze y'igihe wihitiyemo, amafaranga yo kohereza {{fee}} RWF akurwa ku mafaranga yawe. |  |
| `payout.costScheduled` | Costs you nothing — Bimoto pays the {{fee}} RWF transfer fee. | Nta kiguzi ubona — Bimoto ni yo yishyura amafaranga yo kohereza {{fee}} RWF. |  |
| `profile.adminDashboard` | Admin dashboard | Ikibaho cy'ubuyobozi |  |
| `rating.detailsLabel` | Anything else? (optional) | Hari ikindi? (si ngombwa) |  |
| `rating.detailsPlaceholder` | In your own words | Mu magambo yawe bwite |  |
| `rating.rateYourRide` | How was your ride? | Urugendo rwawe rwagenze rute? |  |
| `rating.reason.OTHER` | Something else | Ikindi kintu |  |
| `rating.reason.PRICE_DISAGREEMENT` | Disagreement about the price | Kutumvikana ku giciro |  |
| `rating.reason.RUDE_BEHAVIOUR` | Rude behaviour | Imyitwarire mibi |  |
| `rating.reason.UNSAFE_DRIVING` | Unsafe driving | Gutwara nabi bishobora guteza impanuka |  |
| `rating.reason.VEHICLE_CONDITION` | Condition of the motorcycle | Imiterere ya moto |  |
| `rating.reason.WRONG_ROUTE` | Took the wrong route | Yanyuze inzira itari yo |  |
| `rating.reasonGiven` | Reason: | Impamvu: |  |
| `rating.reasonLabel` | What went wrong? (optional) | Ni iki kitagenze neza? (si ngombwa) |  |
| `rating.reasonNone` | Rather not say | Sinshaka kubivuga |  |
| `rating.reasonOptional` | Both are optional. Your stars are sent either way. | Byombi si ngombwa. Inyenyeri zawe zoherezwa uko byagenda kose. |  |
| `rating.submit` | Send rating | Ohereza amanota |  |
| `rating.thankYou` | Thank you — your rating helps other passengers. | Murakoze — amanota yawe afasha abandi bagenzi. |  |
| `rating.yourRating` | Your rating | Amanota yawe |  |
| `register.useDifferentNumber` | Use a different number | Koresha indi nimero |  |
| `report.alreadyFiled` | You have reported this ride. | Wamaze gutanga ikibazo kuri uru rugendo. |  |
| `report.detailsLabel` | Anything else? (optional) | Hari ikindi? (si ngombwa) |  |
| `report.detailsPlaceholder` | In your own words | Mu magambo yawe bwite |  |
| `report.filed` | Report sent. Thank you. | Ikibazo cyoherejwe. Murakoze. |  |
| `report.openLink` | Report a problem with this ride | Tanga ikibazo kuri uru rugendo |  |
| `report.reason.NO_SHOW_OR_LATE` | Passenger did not come, or kept me waiting | Umugenzi ntiyaje, cyangwa yantegereje igihe kirekire |  |
| `report.reason.OTHER` | Something else | Ikindi kintu |  |
| `report.reason.REFUSED_AGREED_PRICE` | Refused to pay the agreed price | Yanze kwishyura igiciro twumvikanyeho |  |
| `report.reason.RUDE_BEHAVIOUR` | Rude behaviour | Imyitwarire mibi |  |
| `report.reason.UNSAFE_REQUEST` | Asked me to do something unsafe | Yansabye gukora ikintu gishobora guteza akaga |  |
| `report.reasonLabel` | What happened? | Ni iki cyabaye? |  |
| `report.reasonNone` | Choose one | Hitamo kimwe |  |
| `report.reviewNote` | This goes to the Bimoto team to look at. The passenger is not scored, and is not told who reported. | Ibi bijya ku itsinda rya Bimoto kugira ngo babisuzume. Umugenzi ntahabwa amanota, kandi ntabwo amenyeshwa uwatanze ikibazo. |  |
| `report.submit` | Send report | Ohereza ikibazo |  |
| `report.title` | Report a problem with this ride | Tanga ikibazo kuri uru rugendo |  |
| `scheduled.commitmentAssigned` | Confirmed — this ride is yours | Byemejwe — uru rugendo ni urwawe |  |
| `scheduled.commitmentBidPending` | Your offer is waiting for the passenger | Igiciro watanze gitegereje umugenzi |  |
| `scheduled.viewOffers` | View offers | Reba ibyifuzo |  |
| `scheduled.yourOffer` | Your offer | Igiciro watanze |  |
| `settings.contactFormatHint` | 07XX XXX XXX, or with a country code (+250, +44…) | 07XX XXX XXX, cyangwa hamwe na kode y'igihugu (+250, +44…) |  |
| `settings.diagnosticsUpload` | Send error reports automatically | Kohereza raporo z'amakosa mu buryo bwikora |  |
| `settings.diagnosticsUploadHelp` | Lets the Bimoto team see errors this phone hits, without you having to report them. Only the error records shown on the Diagnostics screen are sent — never your messages, trips or location. Turn this off and nothing is sent unless you tap Send report yourself. | Bituma ikipe ya Bimoto ibona amakosa iyi telefoni ihura na yo, utagombye kubimenyesha. Hoherezwa gusa inyandiko z'amakosa zigaragara ku rupapuro rwa Diagnostics — ntabwo ari ubutumwa bwawe, ingendo zawe cyangwa aho uri. Nubihagarika nta kintu kizoherezwa keretse wikanze Ohereza raporo ubwawe. |  |
| `settings.mapsOffline` | Maps & offline | Amakarita no gukora nta internet |  |
| `settings.mapsOfflineHelp` | Keep maps on this phone so they show instantly, even with no connection. | Bika amakarita kuri iyi telefoni kugira ngo agaragare ako kanya, ndetse nta murandasi. |  |
| `settings.mapsOfflineOpen` | Manage offline maps | Gucunga amakarita yo gukoresha nta internet |  |
| `settings.notificationSounds` | Notification sounds | Amajwi y'ubutumwa |  |
| `settings.notificationSoundsHelp` | Play the Bimoto sound when something happens — an offer, a ride, a payment. Turning this off keeps the messages on screen; only the sound stops. | Kuvuza ijwi rya Bimoto iyo hari ikibaye — igiciro, urugendo, ubwishyu. Iyo uhagaritse, ubutumwa buguma ku kizamini; ijwi ryonyine ni ryo rihagarara. |  |
| `toast.more` | +{{count}} more | +{{count}} ibindi |  |
| `transparency.customerFeeWaived` | Platform fee waived during the pilot. | Amafaranga ya porogaramu yarasonewe mu gihe cy’igerageza. |  |
| `transparency.customerTierLine` | Your tier: {{tier}} | Urwego rwawe: {{tier}} |  |
| `transparency.totalPlatformFeeExact` | Platform fee: {{rate}}% | Amafaranga ya porogaramu: {{rate}}% |  |
| `vehicleTypeInfo.any.label` | Any vehicle | Ikinyabiziga icyo ari cyo cyose |  |
| `vehicleTypeInfo.any.whoCanOffer` | Offers may come from bicycles, motos and e-motos. | Ibiciro bishobora guturuka ku magare, kuri moto no kuri e-moto. |  |
| `vehicleTypeInfo.any.youChoose` | You choose from the offers that arrive. | Uhitamo mu biciro byaje. |  |
| `verification.dashboardBannerBody` | Add your licence, authorization and insurance so you can be approved. | Ongeraho uruhushya rwo gutwara, uburenganzira n'ubwishingizi kugira ngo wemererwe. |  |
| `verification.dashboardBannerTitle` | Finish your driver documents | Uzuza impapuro zawe z'umumotari |  |
| `verification.myDocuments` | My documents | Impapuro zanjye |  |

### Flagged by a human, still unreviewed (176)

Rows a previous reviewer singled out with a reason. The English and Kinyarwanda columns are read live from the locale files, so a note can never outlive the string it describes.

| Key | EN | Current RW (AI) | Flagged in | Note |
| --- | -- | --------------- | ---------- | ---- |
| `account.viewAccount` | View account status | Reba imiterere ya konti | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `activeJourney.matchedCustomer` | Driver on the way | Umumotari ari mu nzira | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `admin.funnel.subtitle` | 4-stage funnel + operational metrics for the 500-driver pilot. | Igisingi cy'ibyiciro 4 + ibipimo by'imikorere by'abamotari 500 ba pilote. | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `approach.cantMakeTripConfirm` | The customer will be notified and able to request another driver. Are you sure? | Umukiriya azamenyeshwa kandi ashobore gusaba undi mumotari. Urabyemera? | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `auth.role_driver` | Driver | Umumotari | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `bid.bid_too_late` | Too late - ride already matched | Birarangiye - urugendo rusanzwe rufite umumotari | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `bid.new_driver` | New driver | Umumotari mushya | TRUE-WORDS (PR #165, 2026-08-15) | The review writes "Umumotori mushya"; normalised to Umumotari. Confirm, and say whether a bicycle offer should read Umunyonzi here. |
| `bidList.state.liveHint` | Offers appear here instantly — you don't need to refresh. | Igiciro kigaragara aha. Nta mpamvu yo gusubira inyuma. | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `bids.anonymousDriver` | Driver | Umumotari | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `bids.sortEta` | Arrival | Kuhagera | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `bids.sortRating` | Rating | Ikigereranyo | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `bids.waitingForDrivers` | Waiting for drivers to make offers… | Tegereza umumotari/umunyonzi atange igiciro… | TRUE-WORDS (PR #165, 2026-08-15) | Uses the review's paired form. Note the review's corrected sentence is singular ("atange") where the live one was plural. |
| `checkDriver.active` | Active Bimoto driver | Umumotari wa Bimoto ukora | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `checkDriver.inactive` | This number is not an active Bimoto driver | Iyi nomero si iy'umumotari wa Bimoto ukora | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `checkDriver.inputLabel` | Driver number | Nomero y'umumotari | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `checkDriver.subtitle` | Enter the driver number from a jacket or vest. Only this live check confirms a driver — printed numbers alone do not. | Andika nomero y'umumotari iri ku ikoti cyangwa ku gilet. Iri genzura rikorwa ako kanya ni ryo ryonyine ryemeza umumotari — nomero yanditse ntihagije. | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `checkDriver.title` | Check a Bimoto driver | Genzura Umumotari/Umunyonzi wa Bimoto | TRUE-WORDS (PR #165, 2026-08-15) | Uses the review's paired form "Umumotari/Umunyonzi". |
| `dashboard.goOnline` | Go online to see nearby requests | Jya ku murongo kugira ngo ubone ubusabe buri hafi | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `dashboard.imOffline` | I'm offline | Si ndi ku murongo | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `dashboard.imOnline` | I'm online | Ndi ku murongo | TRUE-WORDS (PR #165, 2026-08-15) | Not a row of the review: moved so it stays coherent with its corrected pair. See docs/wording-reconciliation.md §8. |
| `deletion.exportNotice` | This export contains the records Bimoto holds about you as a rider, a driver, and a party to your own rides. It deliberately leaves out our fraud-prevention and investigation records about this account — anti-money-laundering flags, administrator actions taken about you, name-mismatch checks, driver conflict overrides, and the tombstone kept after an account is deleted. Those are withheld so that a fraud check cannot be read by the person it is about. You can ask for them, and for the reasons behind them, by making a request to Bimoto support. | Iyi dosiye irimo amakuru Bimoto ifite kuri wowe nk’umugenzi, nk’umumotari, no nk’umwe mu bagize urugendo rwawe. Ku bushake ntirimo inyandiko zacu zo kurwanya uburiganya n’izo iperereza kuri iyi konti: ibimenyetso byo kurwanya iyezandonke, ibyemezo by’ubuyobozi byafashwe kuri wowe, igenzura ry’amazina atahuye, ibyemezo byihariye ku makimbirane y’umumotari, n’inyandiko isigara konti imaze gusibwa. Ibyo ntibitangwa kugira ngo igenzura ry’uburiganya ritasomwa n’uwo rireba. Ushobora kubisaba, hamwe n’impamvu zabyo, wandikira ubufasha bwa Bimoto. | EXPORT-AND-LEDGER (2026-08-24) | LEGAL-ADJACENT — the data-export carve-out sentence (founder decision D20). It names five categories of fraud-prevention record that are deliberately withheld, and it is the sentence a user will quote back at us. Check the rw keeps all five categories DISTINCT rather than collapsing them into one word for “investigation”, keeps the reason (a fraud check readable by its own subject stops working) rather than softening it to a policy formula, and keeps “you can ask for them” as a real offer rather than a refusal. Machine-drafted. |
| `delivery.addStopToggle` | Drop a package on the way | Siga umuzigo mu nzira | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `delivery.infoCardLine1` | Driver will drop your parcel between pickup and destination | Umumotari azatanga ifunika ryawe hagati y'aho ufatwa n'aho ujya | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `delivery.speedExpress` | Express | Byihuse (Vuba vuba) | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `driver.jacketNumber` | Jacket Nº {{number}} | Ikoti Nº {{number}} | PR #110 (DRIVER-ID v3, 2026-07-08) | "Jacket Nº {{number}}" — check the numeral/abbreviation convention. |
| `driver.revokedNotice` | Your Bimoto driver account is no longer active. Any remaining earnings have been paid out or will be settled with support. Contact support with any question. | Konti yawe y'umumotari ya Bimoto ntikiri gukora. Amafaranga yawe asigaye yamaze koherezwa cyangwa azishyurwa binyuze ku bafasha. Vugisha abafasha ku kibazo icyo ari cyo cyose. | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `driver.stats.acceptanceRate` | Acceptance rate | Igipimo cyo kwemera gukora urugendo | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `driver.stats.avgAcceptanceTime` | Avg acceptance time | Impuzandengo y'igihe cyo kwemera gukora urugendo | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `driver.stats.cohortBreakdownTitle` | How you compare in your vehicle type | Aho uhagaze ku bandi bafite ubwoko bw’ikinyabiziga/ikinyamitende nk’icyawe | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `driver.stats.cohortSize` | {{n}} drivers in cohort | abamotari {{n}} muri iri tsinda | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `driver.stats.completionRate` | Completion rate | Igipimo cyo gusoza ingendo | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `driver.stats.earningsTrendTitle` | 4-week earnings trend | Ayinjiye mu byumweru 4 | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `driver.stats.showMore` | ▼ Show more stats | ▼ Reba izindi raporo | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `driver.stats.weeklyEarnings` | Weekly earnings | Ayinjiye mu cyumweru | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `driverApproach.etaUnknown` | Locating driver… | Turashaka umumotari… | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `driverApproach.mapLabel` | Driver approach map | Ikarita y'umumotari uje | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `driverApproach.stale` | Driver location unavailable — last seen {{seconds}}s ago | Aho umumotari ari ntibizwi — yagaragaye bwa nyuma hashize amasegonda {{seconds}} | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `errors.driverNotVerified` | Your driver account isn't verified yet. | Konti yawe y'umumotari ntiremezwa. | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `errors.journey_already_matched` | This ride has already been matched. | Uru rugendo rusanzwe rufite umumotari. | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `errors.notAssignedDriver` | You're not the driver for this ride. | Ntabwo uri umumotari w'uru rugendo. | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `errors.vehicleChangeBlocked` | Finish your current ride before changing your vehicle details. | Banza urangize urugendo urimo mbere yo guhindura amakuru y'ikinyabiziga cyawe. | PR #110 (DRIVER-ID v3, 2026-07-08) |  |
| `goods.description` | Description | Ubusobanuro | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `goods.descriptionPlaceholder` | What is being sent? | Wohereje iki | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `goods.details` | Package details | Ibigize umuzigo | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `goods.fragile` | Fragile | Birameneka | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `goods.recipientNamePlaceholder` | Write here | Andika hano | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `goods.size_large` | Large | Umuzigo munini | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `goods.size_medium` | Medium | Umuzigo uringaniye | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `goods.size_small` | Small | Umuzigo muto | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `goods.tierLabel` | When do you need the package? | Ukeneye umuzigo ryari? | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `goods.tierNormal` | Not urgent · standard fare | Ntabwo byihutirwa | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `goods.title` | Send package | Kohereza umuzigo | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `guide.bidding.body` | After submitting your request, nearby drivers will respond with their fares. Compare their prices, ratings, and estimated arrival times, then accept your preferred offer. You can also suggest your own fare — use the fair-price hint to see what similar trips cost. | Numara kohereza ubusabe bwawe, abamotari bari hafi batanga ibiciro byabo. Gereranya ibiciro, ikigereranyo n'igihe bazagerera, hanyuma wemere igiciro wishimiye. Ushobora no gutanga igiciro cyawe — koresha akamenyetso k'igiciro gikwiye kugira ngo urebe icyo ingendo nk'iyi zitwara. | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `guide.bidding.title` | Offers and choosing a driver | Ibiciro no guhitamo umumotari | TRUE-WORDS (PR #165, 2026-08-15) | Applied the review's "Ibiciro no guhitamo umumotari". Confirm it reads better than the live "Ibiciro n'ihitamo ry'umumotari". |
| `guide.help.body` | During a trip, use the in-app chat to communicate with your driver. For anything else, contact the Bimoto support team at a pilot stand or through your local contact — they can review any trip with you. | Mu gihe cy'urugendo, koresha ikiganiro kiri muri app uvugane n'umumotari wawe. Ku bindi byose, vugisha ikipe ifasha abakoresha Bimoto ku ivuriro rya pilote cyangwa unyuze ku muhuza wawe — bashobora kugusubiriramo urugendo urwo ari rwo rwose. | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `guide.parcel.body` | Tap 'Send a parcel', enter the pickup and drop-off locations, and provide details about the item and the recipient. The driver collects the parcel and delivers it — you do not travel with it. For faster delivery, pick the Express option. | Kanda 'Ohereza umuzigo', shyiramo aho ufatirwa n'aho ugezwa, hanyuma utange ibisobanuro ku muzigo no ku wakira. Umumotari afata umuzigo akawugeza aho woherejwe — wowe ntugenda nawo. Niba wifuza ko umuzigo ugera yo vuba, hitamo Byihuse. | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `guide.ride.body` | Tap 'Request a ride' on the home screen, enter your pickup location and destination, and submit your request. A driver will then come to pick you up. | Kanda 'Saba moto' ahabanza, shyiramo aho uherereye n'aho ugiye, maze wohereze ubusabe bwawe. Umumotari araza kugufata aho uri. | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `guide.sos.body` | During a ride, the red SOS button alerts the Bimoto team and your emergency contacts, and keeps the emergency number 112 one tap away. Use it whenever you feel unsafe — it never cancels your ride by itself. Motari and passenger each have the same button: whoever presses it, it alerts that person's own emergency contacts. | Mu gihe cy'urugendo, akamenyetso gatukura ka SOS kohereza integuza ku ikipe ya Bimoto n'abantu washyizeho wakwiyambaza mu butabazi, kandi kakugumishiriza nimero y'ubutabazi ya 112 hafi ku buryo wayikanda rimwe gusa. Gakoreshe igihe cyose wumva utekanye. Umumotari n'umugenzi bafite buto imwe: uwayikanda wese, imenyesha abantu we ubwe yashyizeho yakwiyambaza mu butabazi. | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `guide.title` | User guide | Imfashanyigisho y'ukoresha ino service | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `history.title` | My Journey | Urugendo Rwajye | TRUE-WORDS (PR #165, 2026-08-15) | The review's English is singular ("My Journey") for a list of many; the Kinyarwanda follows it ("Urugendo Rwajye"). Confirm, or give the plural. |
| `home.priorityDeliveryHint` | Faster than normal, cheaper than urgent — 1.15× premium with a quicker driver match | Byihuse kuruta ibisanzwe, hatari igiciro cyo kohereza byihuse — umusoro 1.15× n'umumotari avumbuwe vuba | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `home.requestRideHint` | You travel as the passenger — a driver picks you up and takes you there | Ukoresha app nk'umugenzi — umumotari/umunyonzi aza kugufata akakugeza aho ugiye | TRUE-WORDS (PR #165, 2026-08-15) | Uses the review's paired form "umumotari/umunyonzi". |
| `home.sendParcel` | Send a package | Ohereza umuzigo | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `home.sendParcelHint` | Only the package travels — a driver picks it up and delivers it | Umuzigo ni wo wonyine wohereza — umumotari/umunyonzi afata umuzigo akawugeza aho woherejwe | TRUE-WORDS (PR #165, 2026-08-15) | Uses the review's paired form "umumotari/umunyonzi". |
| `home.title` | What do you need today? | Turagufasha iki uyu munsi | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `home.urgentDeliveryHint` | Send a parcel right now — broadcast to every nearby driver instantly | Ohereza ipaki ubu — yegeranywa ako kanya ku bamotari bose bari hafi | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `journey.destination` | Destination | Aho Ugana | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `journey.findDrivers` | Find drivers | Shakisha umumotari/umunyonzi | TRUE-WORDS (PR #165, 2026-08-15) | Uses the review's paired form "umumotari/umunyonzi". Same question as transparency.driverReceives. |
| `journey.pickup` | Departure Point | Hitamo aho uva | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `journey.searching` | Searching for drivers... | Gushaka abamotari... | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `journey.vehicleType` | Preferred Vehicle | Ikinyabiziga/Ikinyamitende ushaka kugendaho | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `journey.will_go_live` | Your request will go live to nearby drivers | Ubusabe bwawe buzagaragarira abamotari bari hafi | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `journey.wishPriceHelper` | Drivers see this as your suggested price | Igiciro umumotari/umunyonzi abona | TRUE-WORDS (PR #165, 2026-08-15) | Uses the review's paired form "umumotari/umunyonzi". |
| `journey.wishPricePlaceholder` | Write here | Andika hano | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `journeyHistory.badgeDriverDisputed` | Driver disputed — admin reviewing | Umumotari yatanze ikibazo — umuyobozi araba | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `journeyHistory.badgeNoDriverDispute` | Reported, driver did not dispute | Byatanzwe, umumotari nta cyo yatanze | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `legal.driverTermsAgree` | I Accept the Driver Terms | Nemera amasezerano y'umumotari | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `legal.driverTermsText` | As a Bimoto driver, you agree to: offer only fixed prices, provide safe transport, follow traffic laws, wear and provide helmets, maintain valid RURA authorization and insurance, and allow GPS tracking during rides. | Nk'umumotari wa Bimoto, wemera: gutanga ibiciro bihamye gusa, gutanga ubwikorezi bwizewe, gukurikiza amategeko y'umuhanda, kwambara no gutanga ingofero, kugira uruhushya rwa RURA n'ubwishingizi byemewe, no kwemerera GPS mu gihe cy'ingendo. | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `legal.driverTermsTitle` | Driver Agreement | Amasezerano y'umumotari | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `legal.privacyText` | Bimoto collects your phone number, location (only when you share it), and ride history to match you with drivers and process payments. We encrypt your data and never share it with third parties except as needed to complete rides. You can delete your account and all data at any time. | Bimoto ikusanya nomero ya telefoni yawe, aho uherereye (gusa iyo ubisabye) kugira ngo uguhuzwe n'umumotari/umunyonzi no kwishyura cyangwa kwishyurwa. Tubika amakuru yawe kandi ntituyasangiza abandi keretse bikenewe mu gukora ingendo. Ushobora gusiba konti yawe n'amakuru yose igihe icyo ari cyo cyose. | TRUE-WORDS (PR #165, 2026-08-15) | Uses the review's paired form "umumotari/umunyonzi". |
| `legal.privacyTitle` | Your Data, Your Privacy | Amakuru yawe, umutekano wawe | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `legal.safetyAckAgree` | I have read and accept these three safety rules | Nasomye kandi nemera aya mategeko atatu y’umutekano | COMPLIANCE-ACK / LOGIN-EASE (2026-08-24) | LEGAL-ADJACENT — the checkbox label; this is the affirmative act itself. Must read as "I have read AND accept", not just "OK". |
| `legal.safetyAckDriverRefuse` | As a driver, you also accept that you will refuse any ride that would break these rules, even if the passenger insists. | Nka umushoferi, wemera kandi ko uzanga urugendo rwose rwaba runyuranyije n’aya mategeko, n’ubwo umugenzi yabyifuza cyane. | COMPLIANCE-ACK / LOGIN-EASE (2026-08-24) | LEGAL-ADJACENT — the motari’s own sentence: he refuses such a ride even when the passenger insists. Check the rw carries refusal-despite-pressure, not mere reluctance. |
| `legal.safetyAckMinimumAge` | Anyone below the legal minimum age for a moto passenger may not be carried. | Umuntu wese utaragera ku myaka ngombwa yemewe n’amategeko yo kuba umugenzi wa moto ntashobora gutwarwa. | COMPLIANCE-ACK / LOGIN-EASE (2026-08-24) | LEGAL-ADJACENT, HIGH PRIORITY — deliberately carries NO number; the legal minimum age awaits counsel (Trello 2ZazTeyo). The rw must NOT introduce a figure, and must read as a legal threshold rather than a vague "too young". |
| `legal.safetyAckNoInfants` | No babies or infants may ever be carried on a moto. This has no exception. | Nta mwana muto cyangwa uruhinja rwigeze rushobora gutwarwa kuri moto. Nta gahonzu na kamwe. | COMPLIANCE-ACK / LOGIN-EASE (2026-08-24) | LEGAL-ADJACENT, HIGH PRIORITY — "no babies or infants, ever, no exception". The rw must carry the absoluteness; a softened modal here changes what the user is agreeing to. Check that "uruhinja" and the infant term read as the founder means them. |
| `legal.safetyAckOnePassenger` | A moto carries exactly one passenger. Never two, never a child in addition to an adult. | Moto itwara umugenzi umwe gusa. Ntibabiri, kandi nta mwana wiyongera ku muntu mukuru. | COMPLIANCE-ACK / LOGIN-EASE (2026-08-24) | LEGAL-ADJACENT, HIGH PRIORITY — "exactly one passenger, no exception". Check the rw numeral/exclusivity construction: "one" must read as a hard limit, not a typical case. |
| `legal.safetyAckTitle` | Safety rules you must accept | Amategeko y’umutekano ugomba kwemera | COMPLIANCE-ACK / LOGIN-EASE (2026-08-24) | LEGAL-ADJACENT — heads the safety acknowledgment a user ticks at consent. Machine-drafted rw; needs Lilian. |
| `login.phoneLabel` | Phone number | Andika numero ya telefone hano | TRUE-WORDS (PR #165, 2026-08-15) | The review turns this label into an instruction ("Andika numero ya telefone hano") while English stays the noun "Phone number". Confirm that is intended and not a placeholder the reviewer mistook for the label. |
| `login.subtitle` | Bimoto connects passengers with moto drivers and bicycle riders | Bimoto ihuza abagenzi n’abamotari n’abagendera ku magare | COMPLIANCE-ACK / LOGIN-EASE (2026-08-24) | REWORDED (Jean, 24 Aug) — was the phone-entry instruction, now the standing welcome under the wordmark. Check "abamotari" and the bicycle-rider term are the words the field actually uses, and that it stays one short line on a small screen. |
| `map.offline.description` | Keep the Kigali map on this phone (about {{mb}} MB) so it shows instantly, even with no connection. | Bika ikarita muri telefoni yawe (urasabwa ububiko bwa MB {{mb}} byibura muri telefoni yawe) kugira ngo ujye uyibona n'iyo waba nta internet ufite. Wayibona byihuse ukoresheje Wi-Fi. | TRUE-WORDS (PR #165, 2026-08-15) | The review's sentence names a storage figure; the live string interpolates {{mb}} instead, so the token was kept. Confirm the phrasing still reads naturally around it. |
| `match.choose_another` | Choose another driver | Hitamo undi mumotari | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `match.driver_coming` | Your driver is on the way! | Umumotari wawe ari mu nzira! | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `matched.approach.approaching` | Driver is approaching | Umumotari araza | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `matched.approach.arrived` | Driver has arrived | Umumotari yageze | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `matched.approach.lost` | Driver appears to be lost | Umumotari asa nk'utazi inzira | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `matched.approach.silent` | Driver hasn't started moving yet | Umumotari ntiyatangiye kugenda | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `matched.cancelDriverLate` | Driver is too late, cancel | Umumotari atinze, hagarika | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `matched.cancelDriverNoShow` | Driver did not show up | Umumotari ntiyaje | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `matched.chooseAnother` | Choose another driver | Hitamo undi mumotari | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `matched.driver` | Driver | Umumotari | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `matched.driverDidntShow` | Your driver didn't show up. | Umumotari wawe ntiyaje. | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `matched.driverOnTheWay` | Your driver is on the way | Umumotari wawe ari mu nzira | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `matched.findAnotherDriver` | Find another driver | Shaka undi mumotari | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `matched.liveTracking` | Live driver tracking on map | Kurikirana umumotari/umunyonzi ku ikarita | TRUE-WORDS (PR #165, 2026-08-15) | Uses the review's paired form "Umumotari/Umunyonzi". |
| `matched.pickupVerify.title` | Is this your driver? | Uyu ni we mumotari wawe? | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `matched.pickupVerify.yes` | Yes, that's my driver | Yego, ni we mumotari wanjye | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `matched.redispatchFailed` | Could not request another driver. Please try again. | Ntibyakunze gusaba undi mumotari. Ongera ugerageze. | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `nav.myRides` | My Journey | Urugendo Rwajye | TRUE-WORDS (PR #165, 2026-08-15) | The review's English is singular ("My Journey") for a list of many; the Kinyarwanda follows it ("Urugendo Rwajye"). Confirm, or give the plural. |
| `nav.scheduled` | Scheduled rides | Ibyateganyijwe | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `payments.howItWorks` | You choose how to pay when you accept a driver's offer: Mobile Money or card. The money is held safely and given to the driver only after you confirm you arrived. | Uhitamo uko wishyura igihe wemera igiciro cy'umumotari: Mobile Money cyangwa ikarita. Amafaranga abikwa neza agahabwa umumotari ari uko wemeje ko wageze. | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `payments.status.RELEASED` | Paid to the driver | Bwahawe umumotari | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `payout.balanceLabel` | earned, waiting to be paid | Ayo wakoreye, agomba kwishyurwa | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `payout.emptyBalance` | Nothing yet today — money from completed rides shows up here. | Nta mafaranga arageramo — amafaranga y'ingendo zarangiye agaragara hano. | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `payout.frozenNotice` | Your payouts are paused while we review your account. Your balance is safe. Questions? Contact support. | Kwishyurwa kwawe guhagaritswe by'agateganyo mu gihe turi gusuzuma konti yawe. Amafaranga yawe ari mu mutekano. Ufite ikibazo? Vugana n'abashinzwe ubufasha. | PR #109 (AML-FP, 2026-07-08) | Money+trust wording — must reassure, never accuse. "ari amahoro" (is safe) needs a native check. |
| `payout.landsAt` | Lands in your MoMo wallet at {{time}} | Amafaranga yoherezwa kuri konti yawe ya MoMo saa {{time}} | TRUE-WORDS (PR #165, 2026-08-15) | The review's sentence names 18:00 literally; the live string interpolates {{time}}, so the token was kept. |
| `payout.title` | Your money today | Amafaranga winjije uyu munsi | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `payout.trainingWheelsExplainer` | Your first payouts arrive automatically twice a day ({{count}}/3 shifts done). After 3 shifts your own choice takes over. | Ubwishyu bwawe bwa mbere buza mu buryo bwikora kabiri ku munsi ({{count}}/3 by'imirimo irangiye). Nyuma y'imirimo 3, amahitamo yawe bwite azakurikizwa. | TRUE-WORDS (PR #165, 2026-08-15) | The review queried whether this says three hours where English says three shifts. At HEAD it already says "imirimo 3" — please confirm that reads as shifts, not tasks. |
| `payout.waiverLifetime` | No Bimoto commission on your rides — you keep 100% of every fare. | Nta mafaranga ya Bimoto ku ngendo zawe — ubika 100% bya buri giciro. | LAUNCH-TRUTH (2026-07-13) | This is the stage-promise sentence — it must match what cooperative leaders say aloud. |
| `payout.waiverTemporary` | No Bimoto commission until {{date}} — you keep 100% of every fare until then. | Nta mafaranga ya Bimoto kugeza {{date}} — ubika 100% bya buri giciro kugeza icyo gihe. | LAUNCH-TRUTH (2026-07-13) | The cliff date must be unmistakable; a driver must never be surprised by the waiver ending. |
| `picker.destination` | Destination | Aho njya | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `picker.pickup` | Pickup | Aho unsanga | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `profile.emergencyContacts` | Emergency contacts | Uwahamagarwa mu gihe havutse ikibazo | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `profile.emergency_contacts` | Emergency Contacts | Uwahamagarwa mu gihe havutse ikibazo | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `register.driverProfileFailed` | Could not create the driver profile | Ntibyakunze gukora umwirondoro w'umumotari | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `register.roleCustomer` | As passenger | Nk'umugenzi | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `register.roleDriver` | As a driver | Nk'umumotari/Nk'umunyonzi | TRUE-WORDS (PR #165, 2026-08-15) | Uses the review's paired form "Nk'umumotari/Nk'umunyonzi". If the role picker should ask which vehicle first, say so. |
| `register.vehicleType` | Vehicle type | Ubwoko bw'ikinyabiziga/ikinyamitende | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `reliability.newDriver` | New driver | Umumotari mushya | TRUE-WORDS (PR #165, 2026-08-15) | The review writes "Umumotori mushya"; normalised to Umumotari. Confirm, and say whether a bicycle offer should read Umunyonzi here. |
| `ride.rate_driver` | Rate your driver | Ha amanota umumotari wawe | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `scheduled.acceptAnywayFailed` | Could not confirm this driver. Please choose another offer. | Ntibyakunze kwemeza uyu mumotari. Hitamo irindi ciro. | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `scheduled.biddingOpensAt` | Drivers can bid from {{time}} | Abamotari bashobora gutanga ibiciro kuva {{time}} | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `scheduled.chooseAnotherDriver` | Choose another driver | Hitamo undi mumotari | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `scheduled.conflictBody` | This driver has another scheduled ride close to your pickup time. You can choose another driver, or accept anyway. | Uyu mumotari afite urundi rugendo rwagenwe hafi y'igihe cyawe cyo gufatwa. Ushobora guhitamo undi mumotari, cyangwa ukemera uko biri. | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `scheduled.conflictTitle` | Driver already booked near this time | Umumotari asanzwe afite urugendo kuri iki gihe | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `scheduled.driverListEmpty` | No scheduled rides yet | Nta rugendo rwateganijwe | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `scheduled.driverListEmptyHint` | Rides you commit to in advance appear here. Offers on a scheduled ride open 60 minutes before its pickup time. | Ingendo Wateganije zizagaragara hano. Gutanga igiciro ku rugendo rwateganijwe bifungurwa iminota 60 mbere y'isaha yo guhaguruka. | TRUE-WORDS (PR #165, 2026-08-15) | The review rewrote the first sentence only; the second (offers open 60 minutes before pickup) post-dates the review and was kept. Confirm the two sit together. |
| `scheduled.fallbackNote` | If you haven't chosen a driver 30 minutes before pickup, we'll automatically match you with the lowest-priced offer that can reach you in time. | Niba utarahitamo umumotari iminota 30 mbere yo gufatwa, tuzaguhitiramo igiciro gito gishoboka kigera ku gihe. | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `scheduled.leaveNow` | Leave now | Tugende Nonaha | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `scheduled.pickupTimeLabel` | Departure Time | Igihe cyo guhaguruka | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `scheduled.scheduleLater` | Book for later | Teganya urugendo | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `scheduled.submit` | Confirm Ride | Emeza Urugendo | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `screener.help.is18OrOlder` | Bimoto is for drivers and cyclists aged 18 and over. We can't onboard you below that age. Applicants under 18 can still join the venture-team cohort in a different role. | Bimoto igenewe abamotari bafite imyaka 18 cyangwa irenga. Ntidushobora kukwakira uri munsi y'iyo myaka. Abari munsi y'imyaka 18 bashobora kwinjira mu itsinda rishinga muri uruhare rutandukanye. | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `screener.help.weeklyAvailabilityHours` | Be realistic. Most active drivers commit 20+ hours per week. Lower availability is fine during soft launch and you can update this later. | Vuga ukuri. Abamotari benshi bakora bakora amasaha 20 cyangwa arenga mu cyumweru. Igihe gito kiremewe mu gihe cyo gutangira kandi ushobora kubihindura nyuma. | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `screener.questions.cooperativeAffiliation` | Are you affiliated with a driver cooperative? (optional) | Muri muri kooperative y'abamotari? (bidategetswe) | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `settings.emergencyContacts` | Emergency contacts | Uwahamagarwa mu gihe havutse ikibazo | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `settings.logout` | Log Out | Sohokamo | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `simulation.inboxLink` | Inbox messages | Ubutumwa Bugufi | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `status.MATCHED` | Matched | Rwabonye umumotari | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `sync.connected` | Connected | Ndi ku murongo | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `transparency.confirmOffer` | Confirm your offer | Emeza ubusabe bwawe | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `transparency.customerCommission` | Customer commission ({{tier}} {{rate}}%) | komisiyo y'umukiriya ({{tier}} {{rate}}%) | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `transparency.driverCommission` | Driver commission ({{tier}} {{rate}}%) | komisiyo y'umumotari ({{tier}} {{rate}}%) | TRUE-WORDS (PR #165, 2026-08-15) | Not a row of the review: moved so it stays coherent with its corrected pair. See docs/wording-reconciliation.md §8. |
| `transparency.driverReceives` | Driver receives: {{amount}} RWF | Umumotari/Umunyonzi ahabwa: {{amount}} RWF | TRUE-WORDS (PR #165, 2026-08-15) | Uses the review's paired form "Umumotari/Umunyonzi". Say whether the app should instead pick one word from the journey's vehicle type. |
| `transparency.exactAmountDependsOnCustomer` | Exact amount depends on customer's tier. Minimum shown is guaranteed. | Amafaranga yishyurwa ashobora gutandukana bitewe n'urwego rw'umukiriya. Amafaranga y'ubwishingizi agaragazwa munsi y'ibiciro byerekanwe. | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `transparency.feeWaivedAmount` | 0 RWF — waived (normally {{amount}} RWF) | 0 RWF — yahagaritswe (ubusanzwe {{amount}} RWF) | LAUNCH-TRUTH (2026-07-13) | Same "waived" verb decision as above. |
| `transparency.feeWaivedChip` | fee waived | nta mafaranga ya Bimoto | LAUNCH-TRUTH (2026-07-13) | Rendered as a tiny chip — must stay short. |
| `transparency.feeWaivedLine` | Platform fee: 0 RWF — waived during the pilot (normally {{amount}} RWF) | Amafaranga ya Bimoto: 0 RWF — yahagaritswe mu gihe cy'igerageza (ubusanzwe {{amount}} RWF) | LAUNCH-TRUTH (2026-07-13) | "yahagaritswe" (suspended/stopped) vs a better verb for "waived/forgiven" — glossary decision needed. Must NOT read as "payment failed". |
| `transparency.feeWaivedNote` | Pilot fee waiver — the driver keeps 100% of this fare. | Igerageza rya Bimoto — umumotari abika 100% y'iki giciro. | LAUNCH-TRUTH (2026-07-13) | "abika" (keeps/saves) — confirm it reads as "keeps all of it". |
| `transparency.paymentHeldInEscrow` | Payment held in system until you confirm arrival. | Ubwishyu bibikwa muri sisiteme kugeza urugendo rurangiye. | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `transparency.priceBinding` | This price is fixed. If accepted, the trip will be completed at this price. | Iki giciro ni ntakuka. Niba cyemewe, urugendo rurakorwa kuri iki giciro. | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `transparency.submitOffer` | Submit Offer | Ohereza igiciro | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `transparency.youWillReceive` | You will receive | Urakira | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `urgent.broadcastNotice` | Showing your request to all nearby drivers immediately | Icyifuzo cyawe gihita kigaragara ku bamotari bose bari hafi | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `urgent.infoCardSpeed` | Driver will be asked to prioritise this trip | Umumotari azasabwa guhita uru rugendo mbere | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `vehicles.bike` | Bicycle Taxi | Igare | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `vehicles.bikeRegistrationHint` | No documents required for bicycle taxis. You can start accepting rides once your profile is complete. | Nta nyandiko zisabwa ku bamotari b'amagare. Ushobora gutangira kwakira ingendo iyo umwirondoro wawe urangiye. | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `vehicles.ebike` | E-Bike Taxi | Igare ry'amashanyarazi | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `vehicles.emoto` | E-Moto Taxi | Moto y'amashanyarazi | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `vehicles.emotoRegistrationHint` | E-moto drivers need the same documents as moto drivers: Category A license, RURA authorization, cooperative membership, and insurance. | Abamotari ba e-moto bakeneye inyandiko zimwe n'abamotari ba moto: Uruhushya rw'icyiciro A, uruhushya rwa RURA, ubunyamuryango bwa koperative, n'ubwishingizi. | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `vehicles.moto` | Moto Taxi | Moto | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `vehicles.motoRegistrationHint` | Moto-taxi driver requirements: Category A licence, RURA authorization, cooperative membership, and insurance. | Umumotari akeneye: Uruhushya rwa Categori A, uruhushya rwa RURA, ubunyamuryango bwa koperative, n'ubwishingizi. | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `verification.driverNumber` | Bimoto driver number (jacket number) | Inomero y'umumotari ya Bimoto (inomero y'ikoti) | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `verification.title` | Driver Verification | Kwemeza umumotari | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `welcome.screen1.body` | Bimoto is the transport app that connects drivers, cyclists, passengers, and courier delivery. | Bimoto ni app ihuza abagenzi, abamotari, abanyonzi, no kohereza imizigo. | TRUE-WORDS (PR #165, 2026-08-15) | Kinyarwanda taken verbatim from the team's 13-Aug wording review. Confirm the transcription: the PDF split words across lines and lost some spacing, which was repaired rather than guessed. |
| `welcome.screen2.body` | You ride with drivers from your cooperative — and cooperative leaders are first-class users of the platform. | Ugenda n'abamotari bo muri koperative yawe — kandi abayobozi b'amakoperative ni abakoresha bafite uburenganzira bwuzuye kuri iyi porogaramu. | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |
| `welcome.screen3.body` | Every price is a binding offer from the driver. No surge. No hidden fees. You choose. | Buri giciro ni icyemezo gifite agaciro k'umumotari. Nta kuzamuka. Nta mafaranga ahishe. Wowe uhitamo. | TRUE-WORDS (PR #165, 2026-08-15) | Mechanical vocabulary sweep only — Umushoferi → Umumotari (founder decision, 12 Aug). Check the noun class and any agreement the swap disturbed. |

### Kinyarwanda identical to English, reason undecided (11)

The generator could not tell whether these are correct as-is or untranslated. Each needs a yes/no from a native speaker; record the answer by translating the string, or by adding it to `scripts/i18n-review/classification.json`.

| Key | Value (identical in EN and RW) |
| --- | ----------------------------- |
| `autoBid.vehicleMoto` | Moto |
| `common.ok` | OK |
| `intel.ops.kThreshold` | k |
| `journey.ebike` | E-Bike |
| `journey.emoto` | E-Moto |
| `journey.moto` | Moto |
| `vehicle.eBike` | E-Bike |
| `vehicle.eMoto` | E-Moto |
| `vehicle.e_bike` | E-Bike |
| `vehicle.e_moto` | E-Moto |
| `vehicle.moto` | Moto |

### Stub values (1)

| Key | EN | Current RW |
| --- | -- | ---------- |
| `errors.invalid_transition` | Invalid status transition. | [RW] Invalid status transition. |
